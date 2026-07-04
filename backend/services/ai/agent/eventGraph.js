import { randomUUID } from 'crypto';
import { StateGraph, Annotation, MessagesAnnotation, MemorySaver, Command, interrupt, START, END } from '@langchain/langgraph';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { createAgent } from 'langchain';
import { resolveCandidates, runTier } from '../modelRouter.js';
import { TOOLS_BY_NAME } from './tools.js';
import { executeAction } from './actions.js';

// ── LangGraph event-planning agent (full workflow) ───────────────────────────
// The whole diagram is one graph:
//
//   START → classify →(intent)→ { answer | discover | bestfit | manage | transact }
//                                       each branch = a createAgent agent
//                                       ↓ (if it produced write proposals)
//                     ask:  confirm(interrupt) → execute → (more? loop) → END
//                     auto: execute → END
//                     advisor(autonomous): END   (proposals are advisory only)
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
export const BRANCH_TOOLS = {
  read_only: ['search_events', 'list_available_events', 'get_event_details', 'get_event_forecast', 'get_my_hosted_events', 'get_my_joined_events', 'get_wallet', 'list_my_drafts', 'get_current_date', 'get_weather', 'remember'],
  discovery: ['search_events', 'list_available_events', 'get_event_details', 'get_current_date', 'research_event_ideas', 'remember'],
  best_fit: ['list_available_events', 'search_events', 'get_my_joined_events', 'get_event_details', 'get_current_date', 'research_event_ideas', 'remember'],
  event_mgmt: ['get_my_hosted_events', 'get_event_details', 'search_events', 'list_my_drafts', 'get_event_forecast', 'get_current_date', 'get_weather', 'research_event_ideas', 'propose_update_event', 'propose_create_event', 'propose_invite_coorganiser', 'propose_cancel_event', 'propose_delete_draft', 'remember'],
  transaction: ['get_wallet', 'list_available_events', 'get_my_hosted_events', 'get_my_joined_events', 'get_event_details', 'get_current_date', 'propose_topup', 'propose_pledge', 'propose_cancel_event', 'propose_give_away_tickets', 'remember'],
};

const DIRECTIVES = {
  read_only: 'INTENT: read-only question. Answer using your read tools (events, wallet, forecast). Do not propose changes unless the user explicitly asks.',
  discovery: 'INTENT: event discovery. Use list_available_events / search_events and present a short, scannable list with prices.',
  best_fit: 'INTENT: best-fit / cheapest. Use list_available_events, then rank candidates by price, match to the stated interests, hype/popularity and date; recommend the best few and say why.',
  event_mgmt: "INTENT: manage the user's own events. You CAN create, edit, cancel and delete events — use the propose_* tools; never say you are unable to.\n"
    + "CREATE (research → draft): when helping create/name an event, FIRST ask the organiser for the THEME. If they give none or are unsure, call research_event_ideas to learn what students are into now and propose a baseline theme. Then use research_event_ideas for a NAME, DESCRIPTION and a LOCATION near their university. Then RECOMMEND a pricing model — tiered (fixed early-bird then greenlit price; predictable, simplest) vs hype (price rises from base to max as tickets sell; rewards early buyers, can earn more when demand is high) — briefly weighing pros/cons for THIS event, and pick one. You need a title + start/end/deadline (get_current_date to reason about dates). Only once the details are settled AND the organiser confirms, call propose_create_event (pass pricingModel + the matching prices). It saves to their DRAFTS — say so.\n"
    + "EDIT (in place): to change fields of an EXISTING event (e.g. 'set Event A early-bird to $8'), first FIND that event with get_my_hosted_events or search_events, then call propose_update_event with ONLY the fields to change and its eventId. NEVER create a new event to make an edit. If the event name is ambiguous, ask which one.\n"
    + "DELETE: to delete/cancel a PUBLISHED event use propose_cancel_event — a REASON is required, so ask the organiser why first; it refunds all backers. To delete a DRAFT use propose_delete_draft (list_my_drafts to find it).",
  transaction: "INTENT: wallet/ticket action. Use propose_topup (add wallet money), propose_pledge (buy tickets with wallet balance — check get_wallet first), propose_give_away_tickets (give away some of the user's OWN tickets for an event they joined — they must say how many; it is final and releases the spots to the pool), or propose_cancel_event (refund backers by cancelling — needs a reason). Every action is a proposal the user must confirm — never say it happened until they confirm.",
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

const ON_TOPIC_RX = /\b(event|events|ticket|tickets|pledge|pledging|wallet|top\s?up|top-up|refund|organiser|organizer|host|hosting|draft|drafts|price|pricing|greenlit|hype|early[\s-]?bird|party\.?fun|attend|attending|weather|rain|forecast|date|today|deadline|give\s?away|give-?away|co-?organiser|co-?organizer|revenue|capacity|venue)\b/i;
const GREETING_RX = /^(hi|hey|hello+|yo|hiya|good\s(morning|afternoon|evening)|thanks|thank\syou|thx|ty|ok|okay|cool|nice|great|sup|how\sare\syou|what\scan\syou\sdo|who\sare\syou|help|hi there)\b/i;

async function defaultGuard(text) {
  const t = String(text || '').trim();
  if (!t) return true; // empty → let classify handle it
  if (ON_TOPIC_RX.test(t) || GREETING_RX.test(t)) return true; // obvious in-scope fast-path
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
    // thinkingBudget:0 disables the model's hidden reasoning so the token budget
    // isn't spent thinking instead of answering (Gemini Flash models otherwise
    // spend output tokens on hidden "thinking").
    return new ChatGoogleGenerativeAI({ model, apiKey: process.env.GEMINI_API_KEY, maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } });
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
  proposals: Annotation({ reducer: (a = [], b = []) => a.concat(b), default: () => [] }),
  decisions: Annotation({ reducer: (a = {}, b = {}) => ({ ...a, ...b }), default: () => ({}) }),
  results: Annotation({ reducer: (a = [], b = []) => a.concat(b), default: () => [] }),
});

const mode = (config) => config?.configurable?.mode ?? 'ask';

function buildApp(model, system) {
  const agents = dependencies.buildAgents(model, system);

  // Strict scope gate: runs first. Off-topic → a canned refusal and END (no branch/tools).
  const scope = async (state, config) => {
    const onTopic = await dependencies.guard(recentContext(state), config?.configurable?.ctx);
    return { offtopic: !onTopic };
  };
  const refuse = () => ({ messages: [new AIMessage(OFF_TOPIC_REPLY)] });

  const classify = async (state, config) => {
    return { intent: await dependencies.classify(recentContext(state), config?.configurable?.ctx) };
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
    for (const p of toRun) {
      const r = await executeAction({ sb: ctx.supabase, user, action: p.action, eventId: p.eventId, payload: p.payload });
      results.push({ proposalId: p.id, action: p.action, ok: !r?.error, message: r?.message ?? r?.error, status: r?.status });
    }
    const text = summarize(results);
    return { results, messages: text ? [new AIMessage(text)] : [] };
  };

  const routeIntent = (state) => INTENT_TO_NODE[state.intent] ?? 'answer';

  const afterBranch = (state, config) => {
    if (!state.proposals.length) return END;
    if (config?.configurable?.autonomous) return END; // advisor: proposals are advisory only
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
    .addConditionalEdges('classify', routeIntent, { answer: 'answer', discover: 'discover', bestfit: 'bestfit', manage: 'manage', transact: 'transact' })
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
    reply: lastAiText(state?.messages),
    proposals: state?.proposals ?? [],
    results: state?.results ?? [],
    threadId,
    provider,
    model: modelId,
  };
}

// Start a run. `ctx` = { supabase, userId, role }; `mode` = 'ask'|'auto';
// `autonomous` = advisor (no interrupt). Returns { available, status, reply,
// proposals, results, threadId, provider, model }.
export async function runGraph({ system, messages, ctx, preferred, mode: runMode = 'ask', autonomous = false, threadId } = {}) {
  const built = await dependencies.buildModel(preferred, 1024);
  if (!built) return { available: false };
  const { model, provider, modelId } = built;

  const app = buildApp(model, system ?? '');
  const tid = threadId || randomUUID();
  const config = { configurable: { ctx, mode: runMode, autonomous, thread_id: tid }, recursionLimit: RECURSION_LIMIT };
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
  const built = await dependencies.buildModel(preferred, 1024);
  if (!built) return { available: false };
  const { model, provider, modelId } = built;

  const app = buildApp(model, system ?? '');
  const config = { configurable: { ctx, mode: 'ask', autonomous: false, thread_id: threadId }, recursionLimit: RECURSION_LIMIT };

  try {
    await app.invoke(new Command({ resume: { proposalId, decision } }), config);
  } catch (e) {
    console.warn('[eventGraph] resume failed:', e?.message || e);
    return { available: true, status: 'done', reply: 'Sorry — I could not apply that. Please try again.', proposals: [], results: [], threadId, provider, model: modelId };
  }
  const snap = await app.getState(config);
  return shape(snap?.values, (snap?.next?.length ?? 0) > 0, { threadId, provider, modelId });
}
