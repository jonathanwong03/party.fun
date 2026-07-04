import { anyConfigured } from '../services/ai/modelRouter.js';
import { suggestEventCopy as suggestEventCopyTask } from '../services/ai/tasks/suggestEventCopy.js';
import { revenueTips as revenueTipsTask } from '../services/ai/tasks/revenueTips.js';
import { recommendEvents as recommendEventsTask } from '../services/ai/tasks/recommendEvents.js';
import { answerAppQuestion, buildKnowledgeSystem } from '../services/ai/tasks/answerAppQuestion.js';
import { runGraph, resumeGraph } from '../services/ai/agent/eventGraph.js';
import { executeAction } from '../services/ai/agent/actions.js';
import { loadMemory, formatMemory } from '../services/ai/memory.js';
import { forecastForEvent } from '../services/forecastService.js';

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

function guard(req, res) {
  if (!anyConfigured()) {
    res.json({ available: false });
    return false;
  }
  if (rateLimited(req.user.id)) {
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
  let result;
  try {
    result = await forecastForEvent(req.params.eventId);
  } catch (e) {
    return res.status(400).json({ status: 'error', message: e.message });
  }
  if (!result) return res.status(404).json({ status: 'not_found', message: 'Event not found.' });

  const ev = result.event;
  if (ev.hostId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ status: 'forbidden', message: 'Not your event.' });
  }

  const event = {
    title: ev.title,
    description: ev.description,
    startDate: ev.startDate,
    address: ev.address,
    pricingModel: ev.hypeDrivenPricing ? 'hype' : 'tiered/static',
  };
  res.json(await revenueTipsTask({ event, forecast: result.forecast }));
}

// POST /api/ai/recommend-events
export async function recommendEvents(req, res) {
  if (!guard(req, res)) return;
  const { interests } = req.body ?? {};
  const { data: rows, error } = await req.supabase.rpc('get_events');
  if (error) return res.status(400).json({ status: 'error', message: error.message });

  const candidates = (rows ?? [])
    .filter((e) => e.hostId !== req.user.id && e.status !== 'cancelled' && e.status !== 'completed')
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
    })
    .slice(0, 40);

  res.json(await recommendEventsTask({ interests, candidates }));
}

// POST /api/ai/ask
export async function ask(req, res) {
  if (!guard(req, res)) return;
  const { question, history } = req.body ?? {};
  if (!question || !String(question).trim()) {
    return res.status(400).json({ status: 'error', message: 'Question is required.' });
  }
  res.json(await answerAppQuestion({ question, history: Array.isArray(history) ? history : [] }));
}

const AGENT_SYSTEM = () => [
  buildKnowledgeSystem(),
  '',
  'You are an event-planning agent for party.fun. Prefer calling a tool over guessing about events, prices or numbers.',
  '',
  'READ tools:',
  '- list_available_events: the ALL EVENTS / discovery list — events the user can BUY (not their own, not already purchased). Use this for "cheapest/most expensive ticket I can buy".',
  "- get_my_hosted_events: the organiser's OWN events (Hosted Events) with status + early-bird/greenlit prices + hype.",
  '- get_my_joined_events: events the user has joined (pledged for).',
  '- search_events: general search across events the user can see.',
  '- get_event_details: full details for one event.',
  "- get_event_forecast: projected sales/revenue/costs for the user's OWN events (host only).",
  '',
  '- get_wallet: the user\'s wallet balance, linked card, and recent transactions. Check this before proposing a top-up or a wallet-paid purchase.',
  '- list_my_drafts: the user\'s unpublished event drafts (use to find a draftId before proposing to delete one).',
  '- get_current_date: today\'s date & time in Singapore. Call it whenever you reason about dates (how soon an event is, whether a date is in the future, computing a new event\'s dates) and before checking future weather.',
  '- get_weather: the rain forecast for an event\'s date (by eventId or a start date). If it reports willRain (over 70% chance), warn that it is not ideal for an OUTDOOR event and suggest an indoor venue or another date. Forecasts only reach ~10 days ahead.',
  '- research_event_ideas: searches the web for what university students are into now and suggests an event name, description, why it fits, and a good location (ideally near the organiser\'s university). Use it when an organiser asks what students want, for naming/description help, or where to host.',
  '- search_events / list_available_events return FULL details (date/time, venue, address, deadline, description, price) — use them to answer detail questions and to find an event\'s id before editing it. list_available_events is the events the user can ATTEND (never their own, never already-ended).',
  '',
  'WRITE tools (each creates a PROPOSAL the user confirms — they do NOT apply immediately; there is no auto-apply mode, so ALWAYS wait for confirmation):',
  "- propose_update_event: EDIT one of the user's OWN existing events IN PLACE. To change a field (e.g. an early-bird price), first find the event with get_my_hosted_events or search_events, then call this with its eventId and ONLY the fields to change. NEVER create a new event to make an edit.",
  '- propose_create_event: create a NEW event as a DRAFT. Follow the create flow: ask the theme (or research one), use research_event_ideas for name/description/location, RECOMMEND a pricing model (tiered vs hype) with brief pros/cons, and only draft after the organiser confirms. You MUST have a title + start/end/deadline (ISO 8601). Pass pricingModel plus matching prices (tiered: earlyPrice+greenlitPrice; hype: basePrice+maxPrice). It saves a draft the user reviews and publishes.',
  "- propose_invite_coorganiser: invite a co-organiser to the user's own event.",
  '- propose_topup: add money to the wallet by charging the linked card. Requires a linked card.',
  '- propose_pledge: buy ticket(s) to an event using the WALLET balance (a deduction). Not the user\'s own event.',
  '- propose_give_away_tickets: give away some of the user\'s OWN tickets for an event they joined. They MUST say how many (more than 0, at most what they hold). Final and non-refundable — the released spots return to the public pool.',
  '- propose_cancel_event: cancel one of the user\'s OWN live events — this REFUNDS every backer, and is also how you DELETE a published event. A REASON is REQUIRED: ask the organiser why before proposing.',
  '- propose_delete_draft: permanently delete one of the user\'s unpublished drafts.',
  '',
  'PRICING MODELS (help the organiser choose): TIERED = a fixed early-bird price until the early allocation sells out, then a fixed greenlit price — predictable and simplest. HYPE = each ticket\'s price rises from a base price toward a max price as more sell — rewards early buyers and can earn more when demand is high. The model is LOCKED once the event is created.',
  '',
  'MONEY & DELETION SAFETY: top-ups, purchases (deductions), give-aways and refunds are all irreversible — only ever PROPOSE them; execution happens after the user confirms and re-validates balances/ownership server-side. "Delete this event" means cancel it with a reason (refunding backers) for a published event, or delete the draft for an unpublished one.',
  '',
  'MEMORY: call `remember` to save a durable preference you learn about the user (interests, budget, preferred venue/theme/timing, or an organiser\'s pricing/venue preferences). Personalise your help using what you already remember about them (shown below, if any). Do not re-remember something already known.',
  '',
  'CREATING & EDITING: you CAN create, edit, cancel and delete events for an organiser — do it, never say you cannot. propose_create_event saves the event as a DRAFT (it is NOT published) that the organiser reviews and publishes from their Drafts; always tell them it was saved to Drafts. propose_update_event edits an existing event IN PLACE (never recreate it). Every write pauses for the organiser to confirm before anything happens.',
  '',
  'When you call a propose_* tool, tell the user what you are proposing and that it needs their confirmation; never claim it is already done.',
  "Distinguish \"all events\" (discovery — events to buy) from \"hosted events\" (the organiser's own). Keep replies short, friendly and practical.",
  '',
  'SCOPE: You are ONLY an events assistant for party.fun. You help with discovering/buying events, wallet/top-ups, hosting (create/edit/cancel), event ideas, and the weather for an event. If asked anything unrelated to events or party.fun (e.g. what to wear, general trivia, coding, personal advice), politely say you can only help with events on party.fun and offer an events-related next step — do NOT answer the off-topic question. Still respond warmly to greetings, thanks and small pleasantries.',
  '',
  'FORMATTING: reply in PLAIN TEXT only. Do NOT use markdown — no **bold**, no # headings, no bullet/asterisk characters, and no | tables |. Do NOT use emojis. Write short paragraphs and separate each paragraph with a blank line so replies are easy to read.',
].join('\n');

// A one-line statement of who the current user is, prepended to the system prompt so
// the agent always knows their role without a tool call.
function roleLine(role) {
  const r = String(role || 'user').toLowerCase();
  const detail = r === 'admin'
    ? 'an ADMIN who can manage (including cancel) any event on the platform'
    : r === 'organiser'
      ? 'an ORGANISER who can host, edit and cancel their own events, and can also join/buy tickets for other people\'s events'
      : 'a regular USER who joins and buys tickets for events';
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
      if (rows.length) await supabase.from('AI_CHAT_MESSAGES').insert(rows);
      await supabase.from('AI_CHAT_CONVERSATIONS').update({ updated_at: new Date().toISOString() }).eq('id', convoId);
    }
  } catch (e) {
    console.warn('[ai] history persist failed:', e?.message || e);
  }
  return convoId;
}

const modelLabelOf = (result) => (result.model ? `${result.provider} · ${result.model}` : null);

// POST /api/ai/chat — agentic chat (the LangGraph workflow). In 'ask' mode a write
// returns status:'awaiting_confirmation' + proposals + a threadId; the UI confirms
// via /chat/resume. In 'auto' mode writes execute inline. Returns conversationId +
// threadId so the UI can keep appending and resume pending proposals.
export async function chat(req, res) {
  if (!guard(req, res)) return;
  const { messages, conversationId } = req.body ?? {};
  const list = Array.isArray(messages) ? messages : [];
  // Every write always pauses for confirmation — no auto-apply mode.
  const ctx = { supabase: req.supabase, userId: req.user.id, role: req.user.role };
  const memBlock = formatMemory(await loadMemory(req.supabase, req.user.id));
  const system = [AGENT_SYSTEM(), roleLine(req.user.role), dateLine(), memBlock].filter(Boolean).join('\n\n');
  const result = await runGraph({ system, messages: list, ctx, mode: 'ask' });

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
