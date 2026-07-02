import { adminClient } from '../../supabaseAdmin.js';
import { mapEventRow } from '../../eventService.js';
import { notifyAgentAdvice } from '../../notificationService.js';
import { anyConfigured } from '../modelRouter.js';
import { runAgent } from './runAgent.js';
import { loadMemory, formatMemory } from '../memory.js';

// Proactive autonomy: on a schedule (no user prompt), a fully agentic run reviews
// each at-risk event — the model autonomously calls tools (details, forecast, and
// may draft price/co-organiser proposals) — then emails the organiser its advice.
// It only ADVISES: proposals are surfaced as suggestions; nothing is auto-applied.

const ADVISOR_SYSTEM = [
  'You are the party.fun proactive event advisor. You are reviewing ONE at-risk event on the',
  "organiser's behalf (early-bird, nearing its deadline, still below its hype threshold).",
  'Use your tools to look up the event details and its forecast before advising. If a price change or',
  'a co-organiser would clearly help, draft the corresponding proposal so it can be listed as a suggestion.',
  'Then write the email body: a short, warm, concrete, prioritised set of recommendations to boost ticket',
  'sales before the deadline. Plain prose only — no greeting, no sign-off, no markdown headings; the email',
  'template adds the greeting and button.',
].join(' ');

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // hourly
const FIRST_RUN_DELAY_MS = 30 * 1000;
const RISK_WINDOW_MS = 72 * 60 * 60 * 1000; // deadline within 72h

async function alreadyAdvised(admin, eventId) {
  const { data } = await admin
    .from('NOTIFICATION_LOGS')
    .select('id')
    .eq('event_id', eventId)
    .eq('notification_type', 'agent_advice')
    .limit(1);
  return (data ?? []).length > 0;
}

// Events that are open, near their deadline, and below threshold.
export function selectAtRisk(rows, now = Date.now()) {
  return (rows ?? [])
    .map((r) => mapEventRow(r, null))
    .filter((e) => {
      if (e.status !== 'early_bird' || !e.deadlineAt) return false;
      const dt = new Date(e.deadlineAt).getTime() - now;
      return dt > 0 && dt <= RISK_WINDOW_MS && e.activeTicketCount < e.hypeThreshold;
    });
}

async function runOnce() {
  if (!anyConfigured()) return;
  const admin = adminClient();
  const { data: rows, error } = await admin.rpc('get_events');
  if (error) { console.error('[AgentAdvisor] get_events failed:', error.message); return; }

  const atRisk = selectAtRisk(rows);
  if (atRisk.length) console.log(`[AgentAdvisor] ${atRisk.length} at-risk event(s) to review.`);

  for (const e of atRisk) {
    try {
      if (await alreadyAdvised(admin, e.id)) continue;

      // Run the agent as the organiser (service-role client + their user id) so the
      // ownership-scoped tools (forecast, proposals) work without a logged-in session.
      const ctx = { supabase: admin, userId: e.hostId, role: 'organiser' };
      const memBlock = formatMemory(await loadMemory(admin, e.hostId));
      const system = memBlock ? `${ADVISOR_SYSTEM}\n\n${memBlock}` : ADVISOR_SYSTEM;
      const prompt = `Proactively review my event "${e.title}" (id ${e.id}). It's an early-bird event nearing its deadline and still below its hype threshold. Investigate it and tell me concrete, prioritised ways to boost ticket sales before the deadline.`;
      const result = await runAgent({ system, messages: [{ role: 'user', content: prompt }], ctx });
      if (!result?.available || !result.reply) continue;

      const { data: host } = await admin.from('USER').select('id, email, username').eq('id', e.hostId).single();
      if (!host?.email) continue;
      notifyAgentAdvice({
        organiser: { userId: host.id, email: host.email, username: host.username },
        eventTitle: e.title,
        eventId: e.id,
        advice: result.reply,
        proposals: result.proposals,
      });
      console.log(`[AgentAdvisor] Advised organiser of "${e.title}".`);
    } catch (err) {
      console.error(`[AgentAdvisor] failed for ${e.id}:`, err?.message || err);
    }
  }
}

export function startAgentAdvisor() {
  // Off by default: the advisor sends real emails to real organisers, so it only
  // runs when explicitly enabled.
  const enabled = /^(1|true|yes|on)$/i.test(String(process.env.AGENT_ADVISOR_ENABLED ?? ''));
  if (!enabled) {
    console.log('[AgentAdvisor] Disabled (set AGENT_ADVISOR_ENABLED=true to turn on).');
    return;
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[AgentAdvisor] SUPABASE_SERVICE_ROLE_KEY not set; proactive advisor disabled.');
    return;
  }
  const interval = Number(process.env.AGENT_ADVISOR_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  const tick = () => runOnce().catch((e) => console.error('[AgentAdvisor]', e?.message || e));
  setTimeout(tick, FIRST_RUN_DELAY_MS);
  setInterval(tick, interval);
  console.log(`[AgentAdvisor] Started (every ${Math.round(interval / 1000)}s).`);
}
