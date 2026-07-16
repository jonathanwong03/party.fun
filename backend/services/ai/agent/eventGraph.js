import { randomUUID } from 'crypto';
import { StateGraph, Annotation, MessagesAnnotation, MemorySaver, Command, interrupt, START, END } from '@langchain/langgraph';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { createAgent } from 'langchain';
import { resolveCandidates, runTier } from '../modelRouter.js';
import { EXECUTORS, TOOLS_BY_NAME } from './tools.js';
import { executeAction } from './actions.js';
import { sanitizeAiReply } from '../responseSanitizer.js';
import { INTERROGATIVE_LEAD_RX, TRAILING_QUESTION_RX, REQUEST_RX } from './buyIntent.js';

// ── LangGraph event-planning agent (full workflow) ───────────────────────────
// The whole diagram is one graph:
//
//   START → classify →(intent)→ { answer | discover | bestfit | manage | transact }
//                                       each branch = a createAgent agent
//                                       ↓ (if it produced write proposals)
//                     ask:  confirm(interrupt) → execute → (more? loop) → END
//                     auto: execute → END
//
// Each branch is a canonical LangChain v1 `createAgent(...)` (built on LangGraph) —
// a single named agent with a SCOPED toolset. The confirm step is a real
// human-in-the-loop `interrupt()` persisted by a checkpointer; the execute step
// calls the existing `executeAction` (re-validates ownership/balances via RLS), so
// "execute in the graph" never trusts graph state for money.

const RECURSION_LIMIT = 25;

// One in-process checkpointer holds paused threads (pending confirmations) between
// the propose request and the confirm/resume request. In-memory: lost on restart /
// single-instance — acceptable because execute re-validates and a lost pending
// confirmation just means the user re-asks.
const CHECKPOINTER = new MemorySaver();

// The tools (idiomatic `tool()` + zod definitions) live in tools.js; bind the
// scoped subset for each branch by name.
const pickTools = (names) => names.map((n) => TOOLS_BY_NAME[n]).filter(Boolean);

// Per-branch scoped toolsets (the only structural difference between branches).
// Personal read tools about the CURRENT user's own data — available in EVERY branch
// so an answer never depends on classify routing perfectly (otherwise a misrouted
// "what have I hosted?" lands in a branch without the tool and the model guesses).
const PERSONAL_READS = ['get_my_hosted_events', 'get_my_joined_events', 'get_wallet', 'get_event_attendees', 'get_event_details', 'list_my_drafts', 'get_current_date'];
const withPersonal = (...names) => [...new Set([...names, ...PERSONAL_READS])];
// Safety net: bind the buy tool in the read/discovery branches too, so a mis-routed
// purchase ask can never again make the model say "I don't have that functionality".
// (classify already force-routes clear purchases to `transaction`.)
const withBuy = (...names) => withPersonal(...names, 'propose_pledge');

export const BRANCH_TOOLS = {
  read_only: withBuy('search_events', 'list_available_events', 'list_live_events', 'get_event_forecast', 'list_my_drafts', 'get_weather', 'remember'),
  // NOTE: no search_events here — "which events can I attend/buy" must use list_available_events,
  // which excludes the caller's own events, already-purchased ones, and past events. search_events
  // is unfiltered (shows own/purchased) and stays in read_only/event_mgmt for looking up a specific event.
  discovery: withBuy('list_available_events', 'list_live_events', 'semantic_search_events', 'find_similar_events', 'recommend_events', 'research_event_ideas', 'remember'),
  best_fit: withPersonal('list_available_events', 'recommend_events', 'semantic_search_events', 'find_similar_events', 'get_similar_past_events', 'research_event_ideas', 'remember'),
  event_mgmt: withPersonal('search_events', 'get_event_forecast', 'get_weather', 'research_event_ideas', 'get_similar_past_events', 'propose_update_event', 'propose_create_event', 'propose_edit_draft', 'propose_invite_coorganiser', 'propose_cancel_event', 'propose_delete_draft', 'remember'),
  transaction: withPersonal('list_available_events', 'propose_topup', 'propose_pledge', 'propose_cancel_event', 'propose_give_away_tickets', 'remember'),
};

const DIRECTIVES = {
  read_only: 'INTENT: read-only question. Answer using your read tools (events, wallet, forecast). Do not propose changes unless the user explicitly asks.',
  discovery: 'INTENT: event discovery. Use list_available_events / search_events and present a short, scannable list with prices.',
  best_fit: "INTENT: best-fit / recommendation. When the user gives INTERESTS (e.g. 'I'm into gaming'), call recommend_events (semantic — ranks by meaning, so 'gaming' matches an arcade/esports night even without the word). For a vague thematic search use semantic_search_events; for 'events like X' use find_similar_events. Present the top few with a short why; when purely price-driven, fall back to list_available_events sorted by price. Trust the semantic ranking over literal keyword matches.",
  event_mgmt: "INTENT: manage events. ROLE GATE: a regular USER/attendee CANNOT create, edit, cancel or delete events — do NOT call any propose_* tool; briefly tell them event hosting is for organiser accounts. ORGANISERS can create, edit, cancel and delete their OWN events. ADMINS can EDIT and CANCEL/DELETE ANY event (moderation) but CANNOT create/draft events — if an admin asks to create an event, tell them creating is organiser-only and do NOT call propose_create_event/propose_edit_draft. ADMIN DELETE: when an admin deletes/cancels an event, a reason is MANDATORY — ask for one if they didn't give it (accept ANY non-empty reason, even one word), then call propose_cancel_event with it.\n"
    + "CREATE (research to full draft): when an organiser asks to create/plan an event, DON'T interrogate them first. IMMEDIATELY call research_event_ideas (pass any theme they mentioned; if none, research current student interests and pick a sensible theme) and get_current_date, then propose ONE complete draft that fills EVERY field: title, description, start & end date-time (STRICTLY after today), venue/location (near their university), a chosen pricing model WITH a one-line rationale, and all prices + quantities — tiered: earlyPrice, greenlitPrice, early-bird quantity (hypeThreshold) and capacity; hype: basePrice, maxPrice, hypeThreshold and capacity. Then WAIT for the organiser. If they don't like it, be open-minded and offer ALTERNATIVE suggestions. Only call propose_create_event once details are set; it saves to their DRAFTS — say so.\n"
    + "RAG PLANNING: for event creation, planning, pricing, capacity or revenue advice, call get_similar_past_events when a useful theme/reference exists. Use examples only as historical benchmarks, never as current availability, and never expose example IDs.\n"
    + "EDIT (in place): to change fields of an EXISTING PUBLISHED event (e.g. 'set Event A early-bird to $8'), FIND it BY NAME with search_events (organisers can also use get_my_hosted_events for their own; ADMINS use search_events to find ANY event) — NEVER ask the user for an event id. Once you have the event, ASK which field(s) they want to change (title, description, venue, address, start/end date-time, deadline, capacity, hype threshold, early-bird price, greenlit price) if they haven't said, accept ONE OR MORE, then call propose_update_event with the event's NAME and ONLY those fields. To change an unpublished DRAFT (including one you just created), call list_my_drafts then propose_edit_draft with its draftId. NEVER create a new event to make an edit. Co-organisers and admins can edit; co-organisers cannot cancel/delete.\n"
    + "DID YOU MEAN: if a tool reply says 'Did you mean \"X\"?' (a close but not exact event match), do NOT act — ask the user to confirm, and only proceed once they say yes (then use the exact name X). If the user says no (or anything meaning no), tell them there is no such event and offer to list events — do NOT act on any event. Never assume the suggestion is correct.\n"
    + "DELETE: to delete/cancel a PUBLISHED event use propose_cancel_event — the reason is OPTIONAL; accept whatever the organiser gives (even informal like 'it is not nice'), and if they give none, proceed without one (never demand a 'formal'/'valid' reason). It refunds all backers. To delete a DRAFT use propose_delete_draft (list_my_drafts to find it).\n"
    + "REVENUE: for 'how do I increase revenue/profit?' call get_event_forecast, then suggest concrete EDITS they can make (adjust prices, hype threshold, capacity, dates, description) — operational costs are estimates, not charged by the app.",
  transaction: "INTENT: wallet/ticket action. You CAN buy tickets — you have propose_pledge. NEVER say you cannot help with purchases or that you lack the functionality. NEVER ask for a card number, expiry or CVC: if no card is linked, tell them you'll open the secure card form (or offer the wallet) — card details are only ever entered in the app's secure Stripe form, never in chat. For BUYING tickets, follow these STEPS IN ORDER. STEP 1 — IDENTIFY THE EVENT FIRST: the user names the event (not an id); look it up by name with get_event_details or search_events. If the tool does NOT return an exact event — it replies 'Did you mean \"X\"?' or a didYouMean suggestion — relay that and WAIT for the user to confirm yes/no. Do NOT ask for quantity or payment method until the exact event is confirmed (or the user picks one). If they say no, tell them there is no such event. STEP 2 — once the event is confirmed, ALWAYS ask the PAYMENT METHOD (in-app wallet or debit/credit card). STEP 3 — then ask HOW MANY tickets. STEP 4 — call propose_pledge with the confirmed event name + paymentMethod set. For WALLET: call get_wallet and tell them the TOTAL price and their BALANCE; if the wallet covers it, propose_pledge(paymentMethod:'wallet'); if it's short, offer propose_topup to add the shortfall by charging their linked card (or paying by card instead), then pledge. For CARD: propose_pledge(paymentMethod:'card') charges their linked card; if no card is linked, tell them to link one in Wallet (or pay by wallet). Also: propose_give_away_tickets (give away some of the user's OWN tickets for an event they joined — they must say how many; final, releases the spots to the pool), or propose_cancel_event (refund backers by cancelling — needs a reason). Every action is a proposal the user must confirm — never say it happened until they confirm.",
};

const INTENT_TO_NODE = { read_only: 'answer', discovery: 'discover', best_fit: 'bestfit', event_mgmt: 'manage', transaction: 'transact' };

// Regex fallback classifier (also the default when no cheap model is configured).
// Unit-tested directly.
export function classifyIntent(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return 'read_only';
  if (/\b(top\s?up|top-up|refund|deduct|wallet|balance|pay|purchase|buy|checkout|charge|give\s?away|give-away|giveaway)\b/.test(t)) return 'transaction';
  if (/\b(cancel|delete|remove|edit|update|change|reschedule|rename|create|host|launch|draft|co-?organiser|coorganiser|invite|price|capacity|deadline)\b/.test(t)) return 'event_mgmt';
  if (/\b(cheapest|cheap|best|recommend|suggest|value|affordable|under\s*\$?\d|below\s*\$?\d|for me|interested)\b/.test(t)) return 'best_fit';
  if (/\b(find|search|show|list|browse|discover|whats on|what's on|events?\s+(near|around|happening))\b/.test(t)) return 'discovery';
  return 'read_only';
}

const INTENTS = ['read_only', 'discovery', 'best_fit', 'event_mgmt', 'transaction'];

// Default classify NODE logic: a cheap-tier LLM call, regex fallback on error/junk.
// `text` carries the last few turns (recent user messages + a hint of any pending
// proposal) so a follow-up like "yes, whatever you think is good" keeps the create/
// edit intent instead of being misrouted to a read-only branch that lacks write tools.
async function defaultClassify(text) {
  const t = String(text || '');
  if (!t.trim()) return 'read_only';
  try {
    const res = await runTier('cheap', {
      system: 'Classify the CURRENT intent of a conversation with an events-app assistant into EXACTLY one label, using the recent turns for context (a short confirmation like "yes" or "whatever you think" keeps the intent of what was being discussed). Reply with ONLY one of: read_only, discovery, best_fit, event_mgmt, transaction. Use event_mgmt for anything about creating, editing, cancelling or drafting the user\'s own events.',
      messages: [{ role: 'user', content: t }],
      maxTokens: 16,
    });
    const out = String(res?.text || '').toLowerCase();
    const hit = INTENTS.find((l) => out.includes(l));
    if (hit) return hit;
  } catch { /* fall through to regex */ }
  return classifyIntent(t);
}

// ── Scope guard (strict off-topic filter) ────────────────────────────────────
// party.fun is an EVENTS assistant only. The guard runs before classify and lets
// through app/event/wallet/hosting/weather/date questions plus greetings & thanks,
// and refuses anything unrelated (math, trivia, coding, general advice) up front.
export const OFF_TOPIC_REPLY = "I'm the party.fun events assistant, so I can only help with things on party.fun — finding and buying event tickets, your wallet, and hosting or managing your own events. I can't help with that one, but I'd be glad to help you discover an event or plan one.";

export const ROLE_BLOCK_REPLY = "Your current role is attendee/user, so you cannot create, host, edit, cancel or delete events. Event hosting is only available from organiser accounts. To host an event, sign up with or switch to an organiser account.";

export const ADMIN_CREATE_BLOCK_REPLY = "As an admin you moderate the platform — you can edit and cancel/delete any event — but you cannot create or host events. Only organiser accounts can create events. Would you like to edit or cancel an existing event instead?";

const ON_TOPIC_RX = /\b(event|events|ticket|tickets|pledge|pledging|wallet|top\s?up|top-up|refund|organiser|organizer|host|hosting|hosted|draft|drafts|price|pricing|greenlit|hype|early[\s-]?bird|party\.?fun|attend|attending|join|joined|buy|weather|rain|forecast|date|today|deadline|give\s?away|give-?away|co-?organiser|co-?organizer|revenue|profit|capacity|venue|cancel|card|cash|pay)\b/i;
const GREETING_RX = /^(hi|hey|hello+|yo|hiya|good\s(morning|afternoon|evening)|thanks|thank\syou|thx|ty|cool|nice|great|sup|how\sare\syou|what\scan\syou\sdo|who\sare\syou|help|hi there)\b/i;
// Short mid-flow continuations / confirmations — always on-topic (never block these).
const AFFIRMATION_RX = /^(yes|yeah|yep|yup|sure|ok|okay|k|go\sahead|do\sit|sounds?\sgood|please|confirm|proceed|that\sone|the\s(first|second|third|last)\sone|first|second|third|either|both|whatever\syou\sthink|you\sdecide|any|no|nope|not\sreally)\b/i;
// A short answer to the agent's own question — a bare number/quantity or a one-word reply
// (e.g. "3", "3 tickets", "$20"). These are continuations of an on-topic flow, never off-topic.
const SHORT_ANSWER_RX = /^\$?\d[\d.,]*\s*(tickets?|ticket|pax|people|persons?|x)?[.!]?$/i;
const EVENT_MANAGEMENT_WRITE_RX = /\b(cancel|delete|remove|edit|update|change|reschedule|rename|create|host|launch|draft|publish|co-?organiser|coorganiser|invite|manage|my event|hosted event)\b/i;
const CREATE_EVENT_RX = /\b(create|host|plan|draft|organise|organize|launch)\b.{0,80}\b(event|party|workshop|mixer|night|session|festival|gala|meetup)\b|\b(event|party|workshop|mixer|night|session|festival|gala|meetup)\b.{0,80}\b(create|host|plan|draft|organise|organize|launch)\b/i;
const NON_CREATE_MANAGEMENT_RX = /\b(edit|update|change|reschedule|rename|cancel|delete|remove|publish|invite|co-?organiser|coorganiser|price|capacity|deadline)\b/i;

// Synchronous fast-path: obviously in-scope (or a short continuation answer) → allow
// without an LLM call. Exported so it can be unit-tested.
export function guardAllows(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  return ON_TOPIC_RX.test(t) || GREETING_RX.test(t) || AFFIRMATION_RX.test(t) || SHORT_ANSWER_RX.test(t);
}

async function defaultGuard(text) {
  const t = String(text || '').trim();
  if (!t) return true; // empty → let classify handle it
  if (guardAllows(t)) return true; // obvious in-scope / short-answer fast-path
  try {
    const res = await runTier('cheap', {
      system: 'You gate an events-app assistant (party.fun). Decide if the user\'s latest message is IN SCOPE. In scope = anything about events, tickets, pledging, the wallet, hosting/organising events, event weather or dates, OR a greeting/thanks/pleasantry, OR asking what the assistant can do. Out of scope = general knowledge, math, coding, trivia, personal or unrelated topics. Reply with ONLY one word: on_topic or off_topic.',
      messages: [{ role: 'user', content: t }],
      maxTokens: 8,
    });
    const out = String(res?.text || '').toLowerCase();
    if (out.includes('off_topic') || out.includes('off topic')) return false;
    if (out.includes('on_topic') || out.includes('on topic')) return true;
  } catch { /* fall through */ }
  return true; // fail open so a model hiccup never blocks a legitimate question
}

// Default branch-agent builder: five canonical createAgent agents, one per intent.
function defaultBuildAgents(model, system) {
  const agents = {};
  for (const intent of INTENTS) {
    agents[intent] = createAgent({
      model,
      tools: pickTools(BRANCH_TOOLS[intent]),
      prompt: `${system}\n\n${DIRECTIVES[intent]}`,
    });
  }
  return agents;
}

// Model selection: the router resolves to Gemini; build the LangChain chat model.
async function instantiate(provider, model, maxTokens) {
  if (provider === 'gemini') {
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
    // thinkingBudget:-1 = DYNAMIC thinking: the model decides how much hidden
    // reasoning to spend, which meaningfully improves tool choice and
    // instruction-following on the agent branches.
    // IMPORTANT: Gemini counts thinking tokens against maxOutputTokens, so that
    // budget must cover the hidden reasoning PLUS the answer. It is 4096 (not
    // 1024) for exactly this reason — at 1024 a long list (e.g. 16 hosted events)
    // got truncated mid-item because thinking had eaten the budget.
    // (The cheap-tier classifier/guard in modelRouter stays as-is — one-word
    // classifications don't need reasoning.)
    return new ChatGoogleGenerativeAI({ model, apiKey: process.env.GEMINI_API_KEY, maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: -1 } });
  }
  return null;
}
async function defaultBuildModel(preferred, maxTokens) {
  const specs = resolveCandidates('premium', preferred);
  if (!specs.length) return null;
  const { provider, model } = specs[0];
  const chat = await instantiate(provider, model, maxTokens);
  if (!chat) return null;
  return { model: chat, provider, modelId: model };
}

// Test seams: swap in a fake model/agents/classifier/guard without any API keys.
export const dependencies = { buildModel: defaultBuildModel, buildAgents: defaultBuildAgents, classify: defaultClassify, guard: defaultGuard };
export function __setBuildModelForTests(fn) { dependencies.buildModel = fn; }
export function __setAgentsForTests(fn) { dependencies.buildAgents = fn; }
export function __setClassifyForTests(fn) { dependencies.classify = fn; }
export function __setGuardForTests(fn) { dependencies.guard = fn; }
export function __resetGraphForTests() {
  dependencies.buildModel = defaultBuildModel;
  dependencies.buildAgents = defaultBuildAgents;
  dependencies.classify = defaultClassify;
  dependencies.guard = defaultGuard;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('')
      : '';

function toLcMessage(m) {
  const content = String(m?.content ?? '');
  if (!content.trim()) return null;
  return m.role === 'assistant' ? new AIMessage(content) : new HumanMessage(content);
}

// Build the classifier input from the last few turns so intent survives short
// follow-ups. Weights the latest user message (repeated) but includes recent user
// text + the assistant's last line for context.
function recentContext(state) {
  const msgs = state?.messages ?? [];
  const recent = msgs.slice(-6);
  const users = recent.filter((m) => m?._getType?.() === 'human').map((m) => textOf(m.content).trim()).filter(Boolean);
  const lastAi = [...recent].reverse().find((m) => m?._getType?.() === 'ai');
  const lastAiLine = lastAi ? textOf(lastAi.content).trim().slice(0, 300) : '';
  const lastUser = users[users.length - 1] ?? '';
  const parts = [];
  if (lastAiLine) parts.push(`Assistant just said: ${lastAiLine}`);
  if (users.length) parts.push(`Recent user messages: ${users.join(' | ')}`);
  parts.push(`Latest user message: ${lastUser}`);
  return parts.join('\n');
}

// The latest user message text only — used by the scope guard so prior on-topic
// turns don't leak in and cause an off-topic question to slip through.
function latestUserText(state) {
  const msgs = state?.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i]?._getType?.() === 'human') return textOf(msgs[i].content).trim();
  }
  return '';
}

// True when the assistant's previous turn asked the user for input (a reason, a
// quantity, which event/field, etc.). Its reply is then a continuation of an on-topic
// flow — even a bare "q" or "not nice" — so the scope guard must not reject it.
const ASSISTANT_ASK_RX = /\b(reason|how many|which|what (would|do) you|please (provide|give|specify|confirm)|provide (a|an|the)|give (me )?(a|an|the)|specify|would you like|did you mean|what is the)\b/i;
// The assistant's previous turn text (the AI message just before the current user reply).
function previousAssistantText(state) {
  const msgs = state?.messages ?? [];
  let i = msgs.length - 1;
  while (i >= 0 && msgs[i]?._getType?.() === 'human') i -= 1; // skip the current user reply
  if (i < 0 || msgs[i]?._getType?.() !== 'ai') return '';
  return textOf(msgs[i].content).trim();
}
function priorAssistantAsked(state) {
  const text = previousAssistantText(state);
  if (!text) return false;
  return /\?\s*$/.test(text) || ASSISTANT_ASK_RX.test(text);
}
// True when the assistant's previous turn was clearly about events (a listing, a
// "no events matching"/"did you mean" reply, etc.). A SHORT follow-up (e.g. correcting
// a typo'd event name) is then a continuation of an on-topic flow — never off-topic —
// so the scope guard must not refuse it even though it lacks an event keyword itself.
const EVENT_CONTEXT_RX = /\b(no events?|did you mean|couldn't find|could not find|which (event|one)|event|events|ticket|tickets|pledge|wallet|organiser|organizer)\b/i;
// A short reply that continues the flow (a name correction, "the second one", etc.) — NOT
// a full standalone question. A wh-question ("what is 3*3") is not a mere continuation.
function isShortContinuation(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.split(/\s+/).filter(Boolean).length > 6) return false;
  if (/^(what|why|how|who|whom|whose|when|where|which|is|are|was|were|can|could|would|should|do|does|did|explain|tell|calculate|compute|solve|define)\b/i.test(t)) return false;
  return true;
}
function inEventFlow(state) {
  const prev = previousAssistantText(state);
  if (!prev || !(ON_TOPIC_RX.test(prev) || EVENT_CONTEXT_RX.test(prev))) return false;
  // Only bypass the guard for a short continuation, not a full new question.
  return isShortContinuation(latestUserText(state));
}

// Deterministic hard block for clearly off-topic questions (arithmetic, coding, trivia)
// that must be refused even mid-flow — the LLM guard is bypassed for continuations, so
// this catches "what is 3*3" / "what is 4 + 4" regardless of the prior turn.
const OFF_TOPIC_HARD_RX = /\d+(?:\.\d+)?\s*[-+*/×÷^]\s*\d|\bwhat\s+is\s+[-\d(][^?]*[-+*/×÷^]|\b(calculate|compute|solve|square\s+root|sqrt|factorial|derivative|integral)\b|\b(capital\s+of|who\s+(is|was)\s+the\b|president\s+of|prime\s+minister|translate|in\s+(french|spanish|chinese|german))\b|\b(write|give\s+me|generate)\s+(me\s+)?(a|some|the)?\s*(code|program|script|poem|essay|story|function|algorithm)\b|\b(python|javascript|typescript|java|c\+\+|html|css)\b/i;
export function looksClearlyOffTopic(text) {
  return OFF_TOPIC_HARD_RX.test(String(text || '').trim());
}

// Clear purchase intent — "help me purchase 4 tickets", "buy tickets for X", "i want to
// pledge". Routed deterministically to the transaction branch: the cheap LLM classifier
// sometimes labelled these read_only, landing them in a branch with no propose_pledge, and
// the model then (truthfully) answered "I don't have that functionality".
const BUY_INTENT_RX = /\b(buy|buying|purchase|purchasing|pledge|pledging|book|reserve)\b/i;
const TICKETY_RX = /\b(ticket|tickets|pledge|pledging|seat|seats|spot|spots)\b/i;
// A yes/no or wh- QUESTION about buying ("can i purchase tickets after 24 July?", "can i
// still buy tickets for X?", "is it too late to buy tickets?") must be ANSWERED, not turned
// into a purchase. Only an actual request routes to the buy flow. The interrogative/request
// vocabulary is shared with listReplies' matchBuyIntent (buyIntent.js) so the two layers
// can't drift; the trailing-"?" clause is this layer's alone — see isBuyQuestion's comment.
export function looksLikePurchase(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (!BUY_INTENT_RX.test(t)) return false;
  const isQuestion = TRAILING_QUESTION_RX.test(t) || INTERROGATIVE_LEAD_RX.test(t);
  if (isQuestion && !REQUEST_RX.test(t)) return false; // a question about buying
  // "buy/purchase" alone is enough when it's about tickets or an event, else require a
  // ticket-ish noun so "buy" in an unrelated sentence doesn't hijack the routing.
  return TICKETY_RX.test(t) || /\b(event|events)\b/i.test(t) || /^(help me |i want to |can you )?(buy|purchase)\b/i.test(t);
}
// "yes" (etc.) right after the assistant offered a purchase → continue into the buy flow.
export function affirmsPurchase(latest, previousAssistant) {
  return AFFIRMATION_RX.test(String(latest || '').trim())
    && /\b(purchase|buy|ticket|tickets|pledge)\b/i.test(String(previousAssistant || ''));
}

function shouldBlockUserEventManagement(state, ctx) {
  if (String(ctx?.role || 'user').toLowerCase() !== 'user') return false;
  if (state?.intent !== 'event_mgmt') return false;
  return EVENT_MANAGEMENT_WRITE_RX.test(recentContext(state));
}

// Admins may edit/cancel/delete ANY event but must NOT create. When an admin's
// event_mgmt request is a create/host/draft (and not an edit/cancel/delete), hard-refuse
// deterministically instead of letting the LLM engage the create flow.
function shouldBlockAdminCreate(state, ctx) {
  if (String(ctx?.role || 'user').toLowerCase() !== 'admin') return false;
  // Intentionally NOT gated on the classified intent — an admin's create/host/draft
  // request must be refused no matter how classify routed it. Only skip when the
  // message is clearly an edit/cancel/delete (which admins ARE allowed to do).
  const text = latestUserText(state) || recentContext(state);
  if (NON_CREATE_MANAGEMENT_RX.test(text)) return false;
  return CREATE_EVENT_RX.test(text) || /\b(create|host|hosting|draft|plan|planning|organi[sz]e|launch|set\s?up|start)\b.{0,40}\b(event|party|gathering|meetup|mixer|night|session|festival|gala|workshop|social)\b/i.test(text) || /\b(create|host|draft)\s+an?\s+event\b/i.test(text);
}

function shouldAutoDraft(state, ctx) {
  const role = String(ctx?.role || 'user').toLowerCase();
  if (role !== 'organiser') return false; // only organisers create/draft events (not admins)
  if (state?.intent !== 'event_mgmt') return false;
  const text = latestUserText(state) || recentContext(state);
  if (!CREATE_EVENT_RX.test(text)) return false;
  return !NON_CREATE_MANAGEMENT_RX.test(text);
}

const VENUE_BY_UNIVERSITY = {
  SMU: { venue: 'SMU Seminar Room 3.2', address: '60 Stamford Rd, Singapore 178900' },
  NUS: { venue: 'NUS University Town', address: '2 College Ave West, Singapore 138607' },
  NTU: { venue: 'NTU North Spine', address: '50 Nanyang Ave, Singapore 639798' },
  SUTD: { venue: 'SUTD Campus Centre', address: '8 Somapah Rd, Singapore 487372' },
  SIT: { venue: 'SIT@Dover', address: '10 Dover Dr, Singapore 138683' },
  SUSS: { venue: 'SUSS Campus', address: '463 Clementi Rd, Singapore 599494' },
  SIM: { venue: 'SIM Campus', address: '461 Clementi Rd, Singapore 599491' },
};

function sgIsoDaysFromNow(days, hour, minute = 0) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now.getTime() + days * 24 * 60 * 60 * 1000))
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`;
}

function titleCase(text) {
  return String(text || '').trim().replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function extractEventTheme(text) {
  const cleaned = String(text || '')
    .replace(/\b(can you|could you|please|for me|i want to|i would like to|help me|make me)\b/gi, ' ')
    .replace(/\b(create|host|plan|draft|organise|organize|launch)\b/gi, ' ')
    .replace(/\b(an?|the|one|event|party|please|anything|something)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length < 4) return null;
  return cleaned.slice(0, 80);
}

async function loadOrganiserUniversity(ctx) {
  try {
    const { data } = await ctx.supabase
      .from('USER')
      .select('university')
      .eq('id', ctx.userId)
      .maybeSingle();
    return String(data?.university || '').toUpperCase();
  } catch {
    return '';
  }
}

async function buildDraftArgsFromRequest(text, ctx) {
  const university = await loadOrganiserUniversity(ctx);
  const venue = VENUE_BY_UNIVERSITY[university] ?? VENUE_BY_UNIVERSITY.SMU;
  const theme = extractEventTheme(text);
  const title = theme ? `${titleCase(theme)} Social Night` : 'Campus Connect Night';
  const themePhrase = theme || 'campus networking, games and casual social activities';
  return {
    title,
    description: `A student-focused ${themePhrase} event with light activities, conversation starters and refreshments. Designed for students to meet new people, unwind after classes and lock in affordable tickets early.`,
    venue: venue.venue,
    address: venue.address,
    startDate: sgIsoDaysFromNow(21, 19, 0),
    endDate: sgIsoDaysFromNow(21, 22, 0),
    deadline: sgIsoDaysFromNow(14, 23, 59),
    pricingModel: 'tiered',
    earlyPrice: 10,
    greenlitPrice: 16,
    hypeThreshold: 30,
    earlyCapacity: 30,
    capacity: 80,
  };
}

function lastAiText(messages) {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?._getType?.() === 'ai') {
      const text = textOf(m.content);
      if (text.trim()) return text.trim();
    }
  }
  return "I gathered some info but couldn't finish — could you narrow that down?";
}

// Write proposals are surfaced by propose_* tools as { proposal } in their JSON result.
function parseProposals(messages) {
  const out = [];
  for (const m of messages ?? []) {
    if (m?._getType?.() !== 'tool') continue;
    try {
      const parsed = JSON.parse(typeof m.content === 'string' ? m.content : '');
      if (parsed && parsed.proposal) out.push(parsed.proposal);
    } catch { /* not a JSON tool result */ }
  }
  return out;
}

function summarize(results) {
  if (!results.length) return '';
  return results.map((r) => (r.ok ? `✅ ${r.message ?? 'Done.'}` : `⚠️ ${r.message ?? 'That action could not be completed.'}`)).join('\n');
}

// ── Graph state ──────────────────────────────────────────────────────────────
const GraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  intent: Annotation(),
  offtopic: Annotation(),
  roleBlocked: Annotation(),
  adminCreateBlocked: Annotation(),
  autoDraft: Annotation(),
  proposals: Annotation({ reducer: (a = [], b = []) => a.concat(b), default: () => [] }),
  decisions: Annotation({ reducer: (a = {}, b = {}) => ({ ...a, ...b }), default: () => ({}) }),
  results: Annotation({ reducer: (a = [], b = []) => a.concat(b), default: () => [] }),
});

const mode = (config) => config?.configurable?.mode ?? 'ask';

function buildApp(model, system) {
  const agents = dependencies.buildAgents(model, system);

  // Strict scope gate: runs first. Off-topic → a canned refusal and END (no branch/tools).
  const scope = async (state, config) => {
    const latest = latestUserText(state);
    // A clearly off-topic question (math/coding/trivia) is ALWAYS refused, even mid-flow,
    // so an event-related prior turn can't let "what is 3*3" slip through.
    if (looksClearlyOffTopic(latest)) return { offtopic: true };
    // A reply to the agent's OWN question (e.g. a cancellation reason like "q", a
    // quantity, or a field name) — or a SHORT follow-up while the assistant's last turn
    // was about events (e.g. correcting a typo'd event name) — is a continuation.
    if (priorAssistantAsked(state) || inEventFlow(state)) return { offtopic: false };
    // Otherwise judge ONLY the latest user message (not the rolling context) so earlier
    // on-topic turns can't let an off-topic question through.
    const onTopic = await dependencies.guard(latest, config?.configurable?.ctx);
    return { offtopic: !onTopic };
  };
  const refuse = () => ({ messages: [new AIMessage(OFF_TOPIC_REPLY)] });
  const roleRefuse = () => ({ messages: [new AIMessage(ROLE_BLOCK_REPLY)] });

  const classify = async (state, config) => {
    // Deterministic override: a purchase ask (or a "yes" to the assistant's own purchase
    // offer) MUST land in the transaction branch, which is the only one with the full buy
    // flow. The cheap LLM classifier mis-labelled these, so the model ended up in a
    // read-only branch and claimed it couldn't buy tickets.
    const latest = latestUserText(state);
    if (looksLikePurchase(latest) || affirmsPurchase(latest, previousAssistantText(state))) {
      return { intent: 'transaction' };
    }
    return { intent: await dependencies.classify(recentContext(state), config?.configurable?.ctx) };
  };

  const roleGate = (state, config) => ({
    roleBlocked: shouldBlockUserEventManagement(state, config?.configurable?.ctx),
    adminCreateBlocked: shouldBlockAdminCreate(state, config?.configurable?.ctx),
    autoDraft: shouldAutoDraft(state, config?.configurable?.ctx),
  });
  const adminCreateRefuse = () => ({ messages: [new AIMessage(ADMIN_CREATE_BLOCK_REPLY)] });

  const autoDraft = async (state, config) => {
    const ctx = config?.configurable?.ctx;
    const args = await buildDraftArgsFromRequest(latestUserText(state), ctx);
    const result = await EXECUTORS.propose_create_event(args, ctx);
    if (result?.proposal) {
      return {
        proposals: [result.proposal],
        messages: [new AIMessage(`I drafted "${result.proposal.payload.title}" for you. Review the details and confirm if you want to save it to Drafts.`)],
      };
    }
    return { messages: [new AIMessage(result?.error || 'I could not draft that event. Please try again with a theme or date.')] };
  };

  const runBranch = (intent) => async (state, config) => {
    const res = await agents[intent].invoke({ messages: state.messages }, config);
    const newMsgs = (res.messages ?? []).slice(state.messages.length);
    return { messages: newMsgs, proposals: parseProposals(newMsgs) };
  };

  // Human-in-the-loop: pause and surface the still-undecided proposals; on resume,
  // record the {proposalId, decision} the user sent.
  const confirm = (state) => {
    const undecided = state.proposals.filter((p) => !(p.id in state.decisions));
    const resume = interrupt({ proposals: undecided });
    return resume?.proposalId ? { decisions: { [resume.proposalId]: resume.decision } } : {};
  };

  // Deterministic execution — always through executeAction (re-validates RLS/ownership/balances).
  const execute = async (state, config) => {
    const ctx = config?.configurable?.ctx;
    const user = { id: ctx?.userId, role: ctx?.role };
    const doneIds = new Set(state.results.map((r) => r.proposalId));
    const toRun = mode(config) === 'auto'
      ? state.proposals.filter((p) => !doneIds.has(p.id))
      : state.proposals.filter((p) => state.decisions[p.id] === 'confirm' && !doneIds.has(p.id));
    const results = [];
    const nextProposals = [];
    for (const p of toRun) {
      const r = await executeAction({ sb: ctx.supabase, user, action: p.action, eventId: p.eventId, payload: p.payload });
      results.push({ proposalId: p.id, action: p.action, ok: !r?.error, message: r?.message ?? r?.error, status: r?.status });
      if (!r?.error && r?.nextProposal) nextProposals.push(r.nextProposal);
    }
    const text = summarize(results);
    return { results, proposals: nextProposals, messages: text ? [new AIMessage(text)] : [] };
  };

  const routeIntent = (state) => INTENT_TO_NODE[state.intent] ?? 'answer';

  const afterBranch = (state, config) => {
    if (!state.proposals.length) return END;
    return mode(config) === 'auto' ? 'execute' : 'confirm';
  };

  const afterExecute = (state, config) => {
    if (mode(config) === 'auto') return END;
    const undecided = state.proposals.filter((p) => !(p.id in state.decisions));
    return undecided.length ? 'confirm' : END;
  };

  const branchMap = { confirm: 'confirm', execute: 'execute', [END]: END };
  const graph = new StateGraph(GraphState)
    .addNode('scope', scope)
    .addNode('refuse', refuse)
    .addNode('classify', classify)
    .addNode('role_gate', roleGate)
    .addNode('role_refuse', roleRefuse)
    .addNode('admin_create_refuse', adminCreateRefuse)
    .addNode('auto_draft', autoDraft)
    .addNode('answer', runBranch('read_only'))
    .addNode('discover', runBranch('discovery'))
    .addNode('bestfit', runBranch('best_fit'))
    .addNode('manage', runBranch('event_mgmt'))
    .addNode('transact', runBranch('transaction'))
    .addNode('confirm', confirm)
    .addNode('execute', execute)
    .addEdge(START, 'scope')
    .addConditionalEdges('scope', (state) => (state.offtopic ? 'refuse' : 'classify'), { refuse: 'refuse', classify: 'classify' })
    .addEdge('refuse', END)
    .addEdge('classify', 'role_gate')
    .addConditionalEdges('role_gate', (state) => (state.roleBlocked ? 'role_refuse' : state.adminCreateBlocked ? 'admin_create_refuse' : state.autoDraft ? 'auto_draft' : routeIntent(state)), { role_refuse: 'role_refuse', admin_create_refuse: 'admin_create_refuse', auto_draft: 'auto_draft', answer: 'answer', discover: 'discover', bestfit: 'bestfit', manage: 'manage', transact: 'transact' })
    .addEdge('role_refuse', END)
    .addEdge('admin_create_refuse', END)
    .addConditionalEdges('auto_draft', afterBranch, branchMap)
    .addConditionalEdges('answer', afterBranch, branchMap)
    .addConditionalEdges('discover', afterBranch, branchMap)
    .addConditionalEdges('bestfit', afterBranch, branchMap)
    .addConditionalEdges('manage', afterBranch, branchMap)
    .addConditionalEdges('transact', afterBranch, branchMap)
    .addEdge('confirm', 'execute')
    .addConditionalEdges('execute', afterExecute, { confirm: 'confirm', [END]: END });

  return graph.compile({ checkpointer: CHECKPOINTER });
}

function shape(state, interrupted, { threadId, provider, modelId }) {
  return {
    available: true,
    status: interrupted ? 'awaiting_confirmation' : 'done',
    reply: sanitizeAiReply(lastAiText(state?.messages)),
    proposals: state?.proposals ?? [],
    results: state?.results ?? [],
    threadId,
    provider,
    model: modelId,
  };
}

// Start a run. `ctx` = { supabase, userId, role }; `mode` = 'ask'|'auto';
// Returns { available, status, reply, proposals, results, threadId, provider, model }.
export async function runGraph({ system, messages, ctx, preferred, mode: runMode = 'ask', threadId } = {}) {
  const built = await dependencies.buildModel(preferred, 4096);
  if (!built) return { available: false };
  const { model, provider, modelId } = built;

  const app = buildApp(model, system ?? '');
  const tid = threadId || randomUUID();
  const config = { configurable: { ctx, mode: runMode, thread_id: tid }, recursionLimit: RECURSION_LIMIT };
  const input = { messages: (messages ?? []).map(toLcMessage).filter(Boolean) };

  try {
    await app.invoke(input, config);
  } catch (e) {
    console.warn('[eventGraph] run failed:', e?.message || e);
    return { available: true, status: 'done', reply: 'Sorry — I hit a snag working on that. Could you rephrase or try again?', proposals: [], results: [], threadId: tid, provider, model: modelId };
  }
  const snap = await app.getState(config);
  return shape(snap?.values, (snap?.next?.length ?? 0) > 0, { threadId: tid, provider, modelId });
}

// Resume a parked thread with the user's decision on one proposal (confirm/reject).
export async function resumeGraph({ system, ctx, preferred, threadId, proposalId, decision } = {}) {
  const built = await dependencies.buildModel(preferred, 4096);
  if (!built) return { available: false };
  const { model, provider, modelId } = built;

  const app = buildApp(model, system ?? '');
  const config = { configurable: { ctx, mode: 'ask', thread_id: threadId }, recursionLimit: RECURSION_LIMIT };

  try {
    await app.invoke(new Command({ resume: { proposalId, decision } }), config);
  } catch (e) {
    console.warn('[eventGraph] resume failed:', e?.message || e);
    return { available: true, status: 'done', reply: 'Sorry — I could not apply that. Please try again.', proposals: [], results: [], threadId, provider, model: modelId };
  }
  const snap = await app.getState(config);
  return shape(snap?.values, (snap?.next?.length ?? 0) > 0, { threadId, provider, modelId });
}
