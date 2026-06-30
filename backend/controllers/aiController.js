import { anyConfigured, listConfiguredModels } from '../services/ai/modelRouter.js';
import { suggestEventCopy as suggestEventCopyTask } from '../services/ai/tasks/suggestEventCopy.js';
import { revenueTips as revenueTipsTask } from '../services/ai/tasks/revenueTips.js';
import { recommendEvents as recommendEventsTask } from '../services/ai/tasks/recommendEvents.js';
import { answerAppQuestion, buildKnowledgeSystem } from '../services/ai/tasks/answerAppQuestion.js';
import { runAgent } from '../services/ai/agent/runAgent.js';
import { executeAction } from '../services/ai/agent/actions.js';
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
  'You are an event-planning agent for party.fun. You can call tools to look up real data and to PROPOSE changes:',
  '- search_events: find events the user can see (by keyword/price/hype).',
  '- get_event_details: full details for one event.',
  "- get_event_forecast: projected sales/revenue/costs for the user's OWN events (use this before giving revenue advice).",
  "- propose_adjust_pricing: PROPOSE a price change to the user's own event.",
  "- propose_invite_coorganiser: PROPOSE inviting a co-organiser to the user's own event.",
  'Prefer calling a tool over guessing about events or numbers.',
  'The propose_* tools do NOT make the change — they create a proposal the user must confirm. After calling one,',
  'tell the user what you are proposing and that they need to confirm it; never claim the change is already done.',
  'Keep replies short, friendly and practical.',
].join('\n');

// Title a new conversation from the opening message (first ~8 words).
function makeTitle(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
  return (words || 'New chat').slice(0, 60);
}

// POST /api/ai/chat — agentic chat. Persists into a conversation (creating one,
// auto-titled, when none is supplied) and returns the conversationId so the UI
// can keep appending to the same thread.
export async function chat(req, res) {
  if (!guard(req, res)) return;
  const { messages, provider, model, conversationId } = req.body ?? {};
  const list = Array.isArray(messages) ? messages : [];
  const preferred = provider && model ? { provider, model } : undefined;
  const ctx = { supabase: req.supabase, userId: req.user.id, role: req.user.role };
  const result = await runAgent({ system: AGENT_SYSTEM(), messages: list, ctx, preferred });

  let convoId = conversationId || null;
  if (result?.available && result.reply) {
    try {
      if (!convoId) {
        const firstUser = list.find((m) => m && m.role === 'user' && String(m.content ?? '').trim());
        const { data: conv } = await req.supabase
          .from('AI_CHAT_CONVERSATIONS')
          .insert({ title: makeTitle(firstUser?.content) })
          .select('id')
          .single();
        convoId = conv?.id ?? null;
      }
      if (convoId) {
        const lastUser = [...list].reverse().find((m) => m && m.role === 'user' && String(m.content ?? '').trim());
        const rows = [];
        // Stored as 'chat user' (not 'user') to avoid confusion with the app's USER role.
        if (lastUser) rows.push({ conversation_id: convoId, role: 'chat user', content: String(lastUser.content) });
        rows.push({ conversation_id: convoId, role: 'assistant', content: result.reply, model: result.model ? `${result.provider} · ${result.model}` : null });
        await req.supabase.from('AI_CHAT_MESSAGES').insert(rows);
        await req.supabase.from('AI_CHAT_CONVERSATIONS').update({ updated_at: new Date().toISOString() }).eq('id', convoId);
      }
    } catch (e) {
      console.warn('[ai] history persist failed:', e?.message || e);
    }
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
  if (!action || !eventId) {
    return res.status(400).json({ status: 'error', message: 'action and eventId are required.' });
  }
  const result = await executeAction({ sb: req.supabase, user: req.user, action, eventId, payload });
  if (result?.error) {
    const code = result.error === 'not_owner' ? 403 : result.error === 'not_found' ? 404 : 400;
    return res.status(code).json({ status: result.error, message: result.message });
  }
  res.json(result);
}
