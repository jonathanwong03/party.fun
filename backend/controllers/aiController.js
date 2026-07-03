import { anyConfigured, listConfiguredModels } from '../services/ai/modelRouter.js';
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
  '',
  'WRITE tools (each creates a PROPOSAL the user confirms — they do NOT apply immediately):',
  "- propose_update_event: edit any fields (title, description, venue, address, dates, deadline, capacity, hype threshold, prices) of the user's OWN event. Pass only the fields to change.",
  '- propose_create_event: create a NEW event as a DRAFT. First ASK the user for the details; you MUST have the event date, start & end time and pledging deadline (pass as ISO 8601) plus a title before calling — do not create a draft with missing dates. It saves a draft the user reviews and publishes.',
  "- propose_invite_coorganiser: invite a co-organiser to the user's own event.",
  '- propose_topup: add money to the wallet by charging the linked card. Requires a linked card.',
  '- propose_pledge: buy ticket(s) to an event using the WALLET balance (a deduction). Not the user\'s own event.',
  '- propose_cancel_event: cancel one of the user\'s OWN live events — this REFUNDS every backer, and is also how you DELETE a published event.',
  '- propose_delete_draft: permanently delete one of the user\'s unpublished drafts.',
  '',
  'MONEY & DELETION SAFETY: top-ups, purchases (deductions) and refunds are all real money — only ever PROPOSE them; execution happens after the user confirms and re-validates balances/ownership server-side. "Delete this event" means cancel it (refunding backers) for a published event, or delete the draft for an unpublished one.',
  '',
  'MEMORY: call `remember` to save a durable preference you learn about the user (interests, budget, preferred venue/theme/timing, or an organiser\'s pricing/venue preferences). Personalise your help using what you already remember about them (shown below, if any). Do not re-remember something already known.',
  '',
  'When you call a propose_* tool, tell the user what you are proposing and that it needs confirmation; never claim it is already done.',
  "Distinguish \"all events\" (discovery — events to buy) from \"hosted events\" (the organiser's own). Keep replies short, friendly and practical.",
  '',
  'FORMATTING: reply in PLAIN TEXT only. Do NOT use markdown — no **bold**, no # headings, no bullet/asterisk characters, and no | tables |. Write short paragraphs and separate each paragraph with a blank line so replies are easy to read.',
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
  const { messages, provider, model, conversationId, mode } = req.body ?? {};
  const list = Array.isArray(messages) ? messages : [];
  const preferred = provider && model ? { provider, model } : undefined;
  const runMode = mode === 'auto' ? 'auto' : 'ask';
  const ctx = { supabase: req.supabase, userId: req.user.id, role: req.user.role };
  const memBlock = formatMemory(await loadMemory(req.supabase, req.user.id));
  const system = [AGENT_SYSTEM(), roleLine(req.user.role), memBlock].filter(Boolean).join('\n\n');
  const result = await runGraph({ system, messages: list, ctx, preferred, mode: runMode });

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
  const { threadId, proposalId, decision, conversationId, provider, model } = req.body ?? {};
  if (!threadId || !proposalId) {
    return res.status(400).json({ status: 'error', message: 'threadId and proposalId are required.' });
  }
  const preferred = provider && model ? { provider, model } : undefined;
  const ctx = { supabase: req.supabase, userId: req.user.id, role: req.user.role };
  const result = await resumeGraph({
    system: `${AGENT_SYSTEM()}\n\n${roleLine(req.user.role)}`,
    ctx,
    preferred,
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

// GET /api/ai/models — configured provider/model options for the UI picker.
export function models(_req, res) {
  res.json({ available: anyConfigured(), models: listConfiguredModels() });
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
