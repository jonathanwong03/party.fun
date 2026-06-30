import { adminClient } from '../../supabaseAdmin.js';
import { mapEventRow } from '../../eventService.js';
import { forecastForEvent } from '../../forecastService.js';
import { revenueTips } from '../tasks/revenueTips.js';
import { notifyAgentAdvice } from '../../notificationService.js';
import { anyConfigured } from '../modelRouter.js';

// Proactive autonomy: on a schedule (no user prompt), the agent finds at-risk
// events and emails the organiser concrete suggestions to boost them. It only
// ADVISES — it never mutates data (writes stay human-confirmed in the chat).

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
      const fc = await forecastForEvent(e.id);
      if (!fc) continue;
      const advice = await revenueTips({
        event: { title: e.title, description: e.description, startDate: e.startsAt, address: e.address, pricingModel: e.hypeDrivenPricing ? 'hype' : 'tiered/static' },
        forecast: fc.forecast,
      });
      if (!advice.available || !advice.tips?.length) continue;

      const { data: host } = await admin.from('USER').select('id, email, username').eq('id', e.hostId).single();
      if (!host?.email) continue;
      notifyAgentAdvice({ organiser: { userId: host.id, email: host.email, username: host.username }, eventTitle: e.title, eventId: e.id, tips: advice.tips });
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
