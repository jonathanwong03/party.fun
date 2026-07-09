import { anyConfigured } from '../services/ai/modelRouter.js';
import { embedText, toVectorLiteral, isEmbeddingEnabled } from '../services/ai/embeddingService.js';
import { suggestEventCopy as suggestEventCopyTask } from '../services/ai/tasks/suggestEventCopy.js';
import { revenueTips as revenueTipsTask } from '../services/ai/tasks/revenueTips.js';
import { recommendEvents as recommendEventsTask } from '../services/ai/tasks/recommendEvents.js';
import { answerAppQuestion, buildKnowledgeSystem } from '../services/ai/tasks/answerAppQuestion.js';
import { runGraph, resumeGraph } from '../services/ai/agent/eventGraph.js';
import { executeAction } from '../services/ai/agent/actions.js';
import { loadMemory, loadRelevantMemory, formatMemory } from '../services/ai/memory.js';
import { embedChatMessages, loadRelevantChatHistory, formatChatHistory } from '../services/ai/chatHistory.js';
import { computeEconomics, loadCalculator } from '../services/eventEconomics.js';

// ── Simple per-user rate limit (cost guard) ───────────────────────────────────
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;
const hits = new Map(); // userId -> number[] (timestamps)

function rateLimited(userId) {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(userId, recent);
    return true;
  }
  recent.push(now);
  hits.set(userId, recent);
  return false;
}

function rateLimitKey(req) {
  return req?.user?.id || `guest:${req?.ip || req?.headers?.['x-forwarded-for'] || 'unknown'}`;
}

function guard(req, res) {
  if (!anyConfigured()) {
    res.json({ available: false });
    return false;
  }
  if (rateLimited(rateLimitKey(req))) {
    res.status(429).json({ status: 'rate_limited', message: 'Too many AI requests; try again shortly.' });
    return false;
  }
  return true;
}

// POST /api/ai/suggest-event-copy
export async function suggestEventCopy(req, res) {
  if (!guard(req, res)) return;
  const { title, theme, audience, university } = req.body ?? {};
  res.json(await suggestEventCopyTask({ title, theme, audience, university }));
}

// POST /api/ai/revenue-tips/:eventId  (host-scoped)
export async function revenueTips(req, res) {
  if (!guard(req, res)) return;
  const { data: events, error } = await req.supabase.rpc('get_events');
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  const ev = (events ?? []).find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ status: 'not_found', message: 'Event not found.' });
  if (ev.hostId !== req.user.id && !ev.canEdit && !ev.isCoOrganiser && req.user.role !== 'admin') {
    return res.status(403).json({ status: 'forbidden', message: 'Not your event.' });
  }

  const state = await loadCalculator(req.supabase, ev);
  const economics = computeEconomics(state);
  const event = {
    title: ev.title,
    description: ev.description,
    startDate: ev.startDate,
    address: ev.address,
    pricingModel: ev.hypeDrivenPricing ? 'hype' : 'tiered',
  };
  res.json(await revenueTipsTask({ event, economics }));
}

// POST /api/ai/recommend-events
export async function recommendEvents(req, res) {
  if (!guard(req, res)) return;
  const { interests } = req.body ?? {};
  const { data: rows, error } = await req.supabase.rpc('get_events');
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  const userId = req.user?.id ?? null;

  let candidates = (rows ?? [])
    .filter((e) => (!userId || e.hostId !== userId) && e.derived_status !== 'cancelled' && e.derived_status !== 'completed')
    .map((e) => {
      const prices = (e.statuses ?? []).map((s) => Number(s.price)).filter((n) => Number.isFinite(n));
      const cheapest = prices.length ? Math.min(...prices) : 0;
      const threshold = Number(e.hypeThreshold ?? 0);
      const active = Number(e.active_ticket_count ?? 0);
      return {
        id: e.id,
        title: e.title,
        description: e.description ?? '',
        cheapestPrice: cheapest,
        hypePct: threshold > 0 ? Math.min(100, Math.round((active / threshold) * 100)) : 0,
      };
    });

  // Semantic pre-ranking: order candidates by embedding similarity to the interests,
  // then let the LLM pick/reason over the closest ones. Falls back to the raw list.
  if (interests && String(interests).trim() && isEmbeddingEnabled()) {
    const vec = await embedText(String(interests), { taskType: 'RETRIEVAL_QUERY' });
    if (vec) {
      const { data: matches } = await req.supabase.rpc('match_events', { p_embedding: toVectorLiteral(vec), p_count: 40 });
      const order = new Map((matches ?? []).map((m, i) => [m.eventId, i]));
      if (order.size) {
        candidates = candidates
          .filter((c) => order.has(c.id))
          .sort((a, b) => order.get(a.id) - order.get(b.id));
      }
    }
  }
  candidates = candidates.slice(0, 40);

  res.json(await recommendEventsTask({ interests, candidates }));
}

// POST /api/ai/for-you — a personalised event feed from the user's taste profile
// (remembered interests + the titles of events they've joined) → semantic match.
// Returns { ids } best-first (excluding events they already joined). Empty when
// there's no history/interests or embeddings are off.
export async function forYou(req, res) {
  if (!isEmbeddingEnabled()) return res.json({ ids: [] });
  const [memories, profileRes, eventsRes] = await Promise.all([
    loadMemory(req.supabase, req.user.id),
    req.supabase.rpc('get_profile'),
    req.supabase.rpc('get_events'),
  ]);
  const joined = new Set((profileRes.data?.tickets ?? []).map((t) => t.eventId));
  const joinedTitles = (eventsRes.data ?? []).filter((e) => joined.has(e.id)).map((e) => e.title);
  const profileText = [...memories.map((m) => m.content), ...joinedTitles].filter(Boolean).join('\n');
  if (!profileText.trim()) return res.json({ ids: [] });
  const vec = await embedText(profileText, { taskType: 'RETRIEVAL_QUERY' });
  if (!vec) return res.json({ ids: [] });
  const { data: matches } = await req.supabase.rpc('match_events', { p_embedding: toVectorLiteral(vec), p_count: 20 });
  res.json({ ids: (matches ?? []).map((m) => m.eventId).filter((id) => !joined.has(id)) });
}

// POST /api/ai/ask
export async function ask(req, res) {
  if (!guard(req, res)) return;
  const { question, history } = req.body ?? {};
  if (!question || !String(question).trim()) {
    return res.status(400).json({ status: 'error', message: 'Question is required.' });
  }
  res.json(await answerAppQuestion({ question, history: Array.isArray(history) ? history : [], supabase: req.supabase }));
}

const AGENT_SYSTEM = () => [
  buildKnowledgeSystem(),
  '',
  'You are an event-planning agent for party.fun. Prefer calling a tool over guessing about events, prices or numbers.',
  'ALWAYS call the matching tool for the user\'s own data — get_my_hosted_events (events they host), get_my_joined_events (events they joined + tickets held), get_wallet (balance), list_my_drafts, list_available_events (events they can attend). NEVER answer these from memory or assume "none"; if a tool returns an empty list, say so, but only after actually calling it.',
  'REFERENCES: users refer to events by NAME (or by "it"/"that"/"the first one" from earlier in the chat), never by id. Before ANY action on an event — buy/pledge, edit, cancel, give away, get details or forecast — find that event by NAME in the SAME turn using a search tool (list_available_events or search_events for events to attend; get_my_hosted_events for their own; list_my_drafts for drafts) and use the EXACT id it returns. NEVER treat the user\'s words or an event name as an id, never ask the user for an id, and never invent or reuse an id from an earlier message.',
  '',
  'IDs are internal only. Never show event IDs, draft IDs, database IDs, UUIDs, or parenthetical "(ID: ...)" text in user-facing replies, even when a tool result includes them.',
  'For "events I can join" or "events I can attend", use list_available_events and list ALL returned events unless the user asks for a shorter list.',
  '"Ongoing events" means buyable All Events items for attendees/users. For organisers, clarify whether they mean buyable All Events or their own active hosted events. Completed events are never ongoing.',
  'Only organisers can create, draft, publish, edit, cancel, or manage hosted events. If a normal user asks to create an event, tell them they need an organiser account.',
  'Retrieved memory and chat history are context only. Current events, tickets, wallet, draft state, pricing and permissions must come from tools in the current turn.',
  '',
  'READ tools:',
  '- list_available_events: the ALL EVENTS / discovery list, and the ONLY correct tool for "which events can I attend / buy / participate in" and "cheapest/most expensive ticket I can buy". It returns exactly the events the user can BUY right now: hosted by SOMEONE ELSE, still open (early_bird or greenlit), starting strictly in the FUTURE, and NOT already purchased by them. It accepts an optional query/maxPrice. NEVER use search_events to answer "what can I attend" — it does not exclude own or already-purchased events.',
  "- get_my_hosted_events: the organiser's OWN events (Hosted Events) with status + early-bird/greenlit prices + hype.",
  '- search_events: general lookup of a SPECIFIC event by name (includes the user\'s own events and ones they already bought; excludes ended events). Use ONLY to find one event (e.g. before editing) — never to list what the user can attend/buy.',
  '- get_event_details: full details for one event.',
  "- get_event_forecast: projected sales/revenue/costs and PROFIT for the user's OWN events (host only). Forecasts are estimates; operational costs are NOT charged through party.fun.",
  '- get_event_attendees: who is attending an event (people holding active tickets) and the count — for "who is coming / how many backers".',
  '- get_my_joined_events: the events the user has joined, split into upcoming / past / cancelled, with how many tickets they still hold for each.',
  '',
  '- get_wallet: the user\'s wallet balance, linked card, and recent transactions. Check this before proposing a top-up or a wallet-paid purchase.',
  '- list_my_drafts: the user\'s unpublished event DRAFTS (events they created but have not published). Call this for "what are my drafts?" and to find a draftId before editing (propose_edit_draft) or deleting (propose_delete_draft) one. Drafts are SEPARATE from hosted/published events — never conclude a draft does not exist from get_my_hosted_events.',
  '- get_current_date: today\'s date & time in Singapore. Call it whenever you reason about dates (how soon an event is, whether a date is in the future, computing a new event\'s dates) and before checking future weather.',
  '- get_weather: the rain forecast for an event\'s date (by eventId or a start date). If it reports willRain (over 70% chance), warn that it is not ideal for an OUTDOOR event and suggest an indoor venue or another date. Forecasts only reach ~10 days ahead.',
  '- research_event_ideas: searches the web for what university students are into now and suggests an event name, description, why it fits, and a good location (ideally near the organiser\'s university). Use it when an organiser asks what students want, for naming/description help, or where to host.',
  '- search_events / list_available_events return FULL details (date/time, venue, address, deadline, description, price) — use them to answer detail questions and to find an event\'s id before editing it. list_available_events is the events the user can ATTEND (never their own, never already-ended).',
  '',
  'WRITE tools (each creates a PROPOSAL the user confirms — they do NOT apply immediately; there is no auto-apply mode, so ALWAYS wait for confirmation):',
  "- propose_update_event: EDIT one of the user's OWN existing events IN PLACE. To change a field (e.g. an early-bird price), first find the event with get_my_hosted_events or search_events, then call this with its eventId and ONLY the fields to change. NEVER create a new event to make an edit.",
  '- propose_create_event: create a NEW event as a DRAFT. Create flow: when asked to plan/create an event, IMMEDIATELY research (research_event_ideas) and check get_current_date, then propose ONE COMPLETE draft filling every field — title, description, start/end date-time (STRICTLY after today), venue, a chosen pricingModel with a one-line rationale, and all prices+quantities (tiered: earlyPrice+greenlitPrice+early qty+capacity; hype: basePrice+maxPrice+threshold+capacity) — then wait; if they dislike it, offer alternatives. It saves a draft the user reviews and publishes.',
  "- propose_invite_coorganiser: invite a co-organiser to the user's own event (owner only).",
  '- propose_topup: add money to the wallet by charging the linked card. Requires a linked card.',
  '- propose_pledge: buy ticket(s) with the WALLET balance. First ask how many + payment preference, then state the total and wallet balance (get_wallet). If the wallet is short, offer a card top-up (propose_topup) for the shortfall then pledge; if no card is linked, tell them to link one. Only for attendable events (someone else\'s, open, future-start, not already bought).',
  '- propose_give_away_tickets: give away some of the user\'s OWN tickets for an event they joined. They MUST say how many (more than 0, at most what they hold). Final and non-refundable — the released spots return to the public pool.',
  '- propose_cancel_event: cancel one of the user\'s OWN live events — this REFUNDS every backer, and is also how you DELETE a published event. A reason is OPTIONAL: if the organiser gives one, use it as-is (accept ANY reason, even informal like "it is not nice"); if they give none, proceed without one. Never demand a "formal" or "valid" reason.',
  '- propose_edit_draft: edit fields of an unpublished DRAFT (find it with list_my_drafts). Use this — NOT propose_update_event — to change an event that is still a draft. Pass draftId + only the fields to change.',
  '- propose_delete_draft: permanently delete one of the user\'s unpublished drafts.',
  '',
  'PRICING MODELS (help the organiser choose): TIERED = a fixed early-bird price until the early allocation sells out, then a fixed greenlit price — predictable and simplest. HYPE = each ticket\'s price rises from a base price toward a max price as more sell — rewards early buyers and can earn more when demand is high. The model is LOCKED once the event is created.',
  '',
  'MONEY & DELETION SAFETY: top-ups, purchases (deductions), give-aways and refunds are all irreversible — only ever PROPOSE them; execution happens after the user confirms and re-validates balances/ownership server-side. "Delete this event" means cancel it with a reason (refunding backers) for a published event, or delete the draft for an unpublished one.',
  '',
  'MEMORY: call `remember` to save a durable preference you learn about the user (interests, budget, preferred venue/theme/timing, or an organiser\'s pricing/venue preferences). Personalise your help using what you already remember about them (shown below, if any). Do not re-remember something already known.',
  '',
  'CREATING & EDITING: only organiser/admin accounts can create, edit, cancel and delete hosted events. For organiser/admin accounts, use the propose_* tools and never claim a write is done before confirmation. propose_create_event saves the event as a DRAFT (it is NOT published) that the organiser reviews and publishes from their Drafts; once confirmed it IS saved — tell them it is in their Drafts. To change a still-unpublished draft afterwards, call list_my_drafts to find it then propose_edit_draft (do NOT use propose_update_event, and never claim the draft was not saved without first calling list_my_drafts). propose_update_event edits an existing PUBLISHED event IN PLACE (never recreate it). Every write pauses for the organiser to confirm before anything happens.',
  '',
  'When you call a propose_* tool, tell the user what you are proposing and that it needs their confirmation; never claim it is already done.',
  "Distinguish \"all events\" (discovery — events to buy) from \"hosted events\" (the organiser's own). Keep replies short, friendly and practical.",
  '',
  'AUTHORITY & ACCURACY: the backend (Supabase RLS + Postgres RPCs + wallet/Stripe logic) is the source of truth — you propose, it decides and validates. Never invent event, ticket, wallet or payment state; rely on the tools. Answer strictly from tool results. Co-organisers can edit and view attendees for an event they were invited to, but cannot cancel, delete or invite. A user cannot buy more tickets for an event while they still hold active tickets. Forecasts are ESTIMATES and operational costs are NOT charged through party.fun. Do NOT promise that an email was delivered.',
  '',
  'SCOPE: You are ONLY an events assistant for party.fun. You help with discovering/buying events, wallet/top-ups, hosting (create/edit/cancel), giving away tickets, event ideas, and the weather for an event. If asked anything unrelated to events or party.fun (e.g. what to wear, general trivia, coding, personal advice, maths), politely say you can only help with events on party.fun and offer an events-related next step — do NOT answer the off-topic question. Still respond warmly to greetings, thanks and small pleasantries.',
  '',
  'FORMATTING: whenever you list multiple items (events, drafts, options, tips), you MUST number them — put each item on its OWN line, starting with "1.", then "2.", then "3.", and so on. For example:\n1. First item.\n\n2. Second item.\n\n3. Third item.\nNever present a list as unnumbered paragraphs. Otherwise reply in PLAIN TEXT — no markdown bold/headings/tables, no dash or asterisk bullets, and no emojis. Keep paragraphs short, separated by a blank line.',
].join('\n');

// A one-line statement of who the current user is, prepended to the system prompt so
// the agent always knows their role without a tool call.
function roleLine(role) {
  const r = String(role || 'user').toLowerCase();
  const detail = r === 'admin'
    ? 'an ADMIN who can manage (including cancel) any event on the platform'
    : r === 'organiser'
      ? 'an ORGANISER who can host, edit and cancel their own events, and can also join/buy tickets for other people\'s events'
      : 'a regular USER (attendee) who joins and buys tickets for events. Attendees CANNOT create, host, edit, cancel or delete events — only organiser accounts can. If this user asks to create/host/manage an event, do NOT attempt it: tell them event hosting is for organiser accounts and they would need to sign up as (or switch to) an organiser';
  return `The current user's role is: ${r} — ${detail}.`;
}

// Today's date/time in Singapore, prepended so the agent always knows "now" (for
// reasoning about how far off events are, computing new dates, and future weather).
function dateLine() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long', hour12: false,
  }).formatToParts(new Date()).reduce((o, x) => ({ ...o, [x.type]: x.value }), {});
  return `Today's date is ${p.weekday}, ${p.year}-${p.month}-${p.day} and the current time is ${p.hour}:${p.minute} (Singapore time, SGT UTC+8).`;
}

// Title a new conversation from the opening message (first ~8 words).
function makeTitle(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
  return (words || 'New chat').slice(0, 60);
}

export function isRoleQuestion(text) {
  const t = String(text ?? '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return /\b(what|which|tell|show|check|confirm|remind)\b.*\b(my|account)\b.*\b(role|account type|type|permission|access)\b/.test(t)
    || /\bwhat\s+(am|is)\s+i\b/.test(t)
    || /\bam\s+i\s+(an?\s+)?(organiser|organizer|admin|user|attendee|host)\b/.test(t)
    || /\bdo\s+i\s+have\s+(organiser|organizer|admin|host)\s+(access|role|permissions?)\b/.test(t)
    || /\bcan\s+i\s+(host|create|manage)\s+events?\b.*\b(role|account|allowed|permission)\b/.test(t);
}

async function loadCurrentRole(req) {
  try {
    const { data, error } = await req.supabase
      .from('USER')
      .select('role')
      .eq('id', req.user.id)
      .maybeSingle();
    const dbRole = String(data?.role || '').toLowerCase();
    if (!error && ['user', 'organiser', 'admin'].includes(dbRole)) return dbRole;
  } catch { /* fall back to request role */ }
  const role = String(req.user?.role || 'user').toLowerCase();
  return ['user', 'organiser', 'admin'].includes(role) ? role : 'user';
}

// Persist chat turns (user + assistant) into a conversation, creating + auto-titling
// one when needed. Returns the conversationId. Never throws.
async function persistTurn(supabase, { conversationId, titleSeed, userText, reply, modelLabel }) {
  let convoId = conversationId || null;
  try {
    if (!convoId) {
      const { data: conv } = await supabase
        .from('AI_CHAT_CONVERSATIONS')
        .insert({ title: makeTitle(titleSeed) })
        .select('id')
        .single();
      convoId = conv?.id ?? null;
    }
    if (convoId) {
      const rows = [];
      // Stored as 'chat user' (not 'user') to avoid confusion with the app's USER role.
      if (userText) rows.push({ conversation_id: convoId, role: 'chat user', content: String(userText) });
      if (reply) rows.push({ conversation_id: convoId, role: 'assistant', content: reply, model: modelLabel ?? null });
      if (rows.length) {
        const { data: inserted, error: insertError } = await supabase
          .from('AI_CHAT_MESSAGES')
          .insert(rows)
          .select('id, content');
        if (insertError) throw insertError;
        embedChatMessages(supabase, inserted ?? []);
      }
      await supabase.from('AI_CHAT_CONVERSATIONS').update({ updated_at: new Date().toISOString() }).eq('id', convoId);
    }
  } catch (e) {
    console.warn('[ai] history persist failed:', e?.message || e);
  }
  return convoId;
}

const modelLabelOf = (result) => (result.model ? `${result.provider} · ${result.model}` : null);

// Deterministic backstop for the "never show internal IDs" prompt rule: strip any
// leaked event/draft/database IDs (UUIDs) from a user-facing reply, whether bare,
// labelled ("ID: <uuid>"), or parenthetical ("(ID: <uuid>)"). Trailing/duplicate
// whitespace and now-empty parens/brackets left behind are tidied up.
const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function stripInternalIds(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text
    // "(ID: <uuid>)" / "[id <uuid>]" and similar wrappers, with optional separators.
    .replace(new RegExp(`[\\(\\[]\\s*(?:event\\s+)?id[:#]?\\s*${UUID_RE}\\s*[\\)\\]]`, 'gi'), '')
    // Bare "ID: <uuid>" / "id = <uuid>" label with no brackets.
    .replace(new RegExp(`\\b(?:event\\s+)?id\\s*[:=#]?\\s*${UUID_RE}`, 'gi'), '')
    // Any remaining standalone UUID.
    .replace(new RegExp(UUID_RE, 'g'), '')
    // Tidy: empty brackets/parens left behind, doubled spaces, and space-before-punctuation.
    .replace(/[\(\[]\s*[\)\]]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:)\]])/g, '$1');
  return out;
}

// POST /api/ai/chat — agentic chat (the LangGraph workflow). In 'ask' mode a write
// returns status:'awaiting_confirmation' + proposals + a threadId; the UI confirms
// via /chat/resume. In 'auto' mode writes execute inline. Returns conversationId +
// threadId so the UI can keep appending and resume pending proposals.
export async function chat(req, res) {
  const { messages, conversationId } = req.body ?? {};
  const list = Array.isArray(messages) ? messages : [];
  // Every write always pauses for confirmation — no auto-apply mode.
  const ctx = { supabase: req.supabase, userId: req.user.id, role: req.user.role };
  // Recall only the memories relevant to THIS turn (vector match; falls back to all).
  const lastUserMsg = [...list].reverse().find((m) => m && m.role === 'user' && String(m.content ?? '').trim());
  if (isRoleQuestion(lastUserMsg?.content)) {
    const role = await loadCurrentRole(req);
    const firstUser = list.find((m) => m && m.role === 'user' && String(m.content ?? '').trim());
    const convoId = await persistTurn(req.supabase, {
      conversationId: conversationId || null,
      titleSeed: firstUser?.content,
      userText: lastUserMsg?.content,
      reply: role,
      modelLabel: null,
    });
    return res.json({ available: true, status: 'done', reply: role, proposals: [], results: [], threadId: null, conversationId: convoId });
  }
  if (!guard(req, res)) return;
  const [memories, chatHistory] = await Promise.all([
    loadRelevantMemory(req.supabase, req.user.id, lastUserMsg?.content),
    loadRelevantChatHistory(req.supabase, lastUserMsg?.content),
  ]);
  const memBlock = formatMemory(memories);
  const historyBlock = formatChatHistory(chatHistory);
  const system = [AGENT_SYSTEM(), roleLine(req.user.role), dateLine(), memBlock, historyBlock].filter(Boolean).join('\n\n');
  const result = await runGraph({ system, messages: list, ctx, mode: 'ask' });
  if (result?.reply) result.reply = stripInternalIds(result.reply);

  let convoId = conversationId || null;
  if (result?.available && result.reply) {
    const firstUser = list.find((m) => m && m.role === 'user' && String(m.content ?? '').trim());
    const lastUser = [...list].reverse().find((m) => m && m.role === 'user' && String(m.content ?? '').trim());
    convoId = await persistTurn(req.supabase, {
      conversationId: convoId,
      titleSeed: firstUser?.content,
      userText: lastUser?.content,
      reply: result.reply,
      modelLabel: modelLabelOf(result),
    });
  }

  res.json({ ...result, conversationId: convoId });
}

// POST /api/ai/chat/resume — apply the user's decision (confirm/reject) on one
// pending proposal, resuming the parked graph thread; execution re-validates
// ownership/balances. Persists the execution summary to the conversation.
export async function resumeChat(req, res) {
  if (!guard(req, res)) return;
  const { threadId, proposalId, decision, conversationId } = req.body ?? {};
  if (!threadId || !proposalId) {
    return res.status(400).json({ status: 'error', message: 'threadId and proposalId are required.' });
  }
  const ctx = { supabase: req.supabase, userId: req.user.id, role: req.user.role };
  const result = await resumeGraph({
    system: `${AGENT_SYSTEM()}\n\n${roleLine(req.user.role)}\n\n${dateLine()}`,
    ctx,
    threadId,
    proposalId,
    decision: decision === 'reject' ? 'reject' : 'confirm',
  });
  if (result?.reply) result.reply = stripInternalIds(result.reply);

  let convoId = conversationId || null;
  if (result?.available && result.reply) {
    convoId = await persistTurn(req.supabase, { conversationId: convoId, reply: result.reply, modelLabel: modelLabelOf(result) });
  }

  res.json({ ...result, conversationId: convoId });
}

// GET /api/ai/conversations — the user's saved conversations (most recent first).
export async function listConversations(req, res) {
  const { data, error } = await req.supabase
    .from('AI_CHAT_CONVERSATIONS')
    .select('id, title, updated_at')
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  res.json({ conversations: (data ?? []).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at })) });
}

// GET /api/ai/conversations/:id — messages in one conversation (oldest first).
export async function getConversation(req, res) {
  const { data, error } = await req.supabase
    .from('AI_CHAT_MESSAGES')
    .select('role, content, model, created_at')
    .eq('conversation_id', req.params.id)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  // Map stored 'chat user' back to the standard 'user' role the UI/LLM expect.
  res.json({ messages: (data ?? []).map((m) => ({ role: m.role === 'chat user' ? 'user' : m.role, content: m.content, model: m.model })) });
}

// DELETE /api/ai/conversations/:id — delete a conversation (messages cascade).
export async function deleteConversation(req, res) {
  const { error } = await req.supabase.from('AI_CHAT_CONVERSATIONS').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  res.json({ status: 'ok' });
}

// GET /api/ai/memory — what the assistant has learned about the user.
export async function getMemory(req, res) {
  const { data, error } = await req.supabase
    .from('AI_USER_MEMORY')
    .select('id, content, category, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  res.json({ memories: (data ?? []).map((m) => ({ id: m.id, content: m.content, category: m.category })) });
}

// DELETE /api/ai/memory/:id — forget one fact.
export async function deleteMemory(req, res) {
  const { error } = await req.supabase.from('AI_USER_MEMORY').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  res.json({ status: 'ok' });
}

// DELETE /api/ai/memory — forget everything.
export async function clearMemory(req, res) {
  const { error } = await req.supabase.from('AI_USER_MEMORY').delete().eq('user_id', req.user.id);
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  res.json({ status: 'ok' });
}

// GET /api/ai/models — whether AI features are enabled (a Gemini key is configured).
export function models(_req, res) {
  res.json({ available: anyConfigured() });
}

// POST /api/ai/execute-action — run a user-confirmed agent proposal (a write).
// No LLM needed, so it only enforces the rate limit, not provider availability.
export async function executeActionHandler(req, res) {
  if (rateLimited(req.user.id)) {
    return res.status(429).json({ status: 'rate_limited', message: 'Too many requests; try again shortly.' });
  }
  const { action, eventId, payload } = req.body ?? {};
  if (!action) {
    return res.status(400).json({ status: 'error', message: 'action is required.' });
  }
  const result = await executeAction({ sb: req.supabase, user: req.user, action, eventId, payload });
  if (result?.error) {
    const code = result.error === 'not_owner' ? 403 : result.error === 'not_found' ? 404 : 400;
    return res.status(code).json({ status: result.error, message: result.message });
  }
  res.json(result);
}
