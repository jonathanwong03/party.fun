import { adminClient } from './supabaseAdmin.js';
import { notifyEventCancelled } from './notificationService.js';
import { refundEventCardBookings } from './stripeRefunds.js';

// Periodically auto-cancels + refunds early_bird events that passed their deadline
// below the hype threshold (via the expire_overdue_events RPC), then emails the
// affected backers + organiser through the existing Resend pipeline.
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FIRST_RUN_DELAY_MS = 10 * 1000;

async function gatherAndNotify(admin, eventId) {
  const { data: event } = await admin.from('EVENT').select('title, hostId').eq('id', eventId).single();
  if (!event) return;
  const { data: organiser } = await admin.from('USER').select('email, username').eq('id', event.hostId).single();

  // Sum the refund per backer for this event (deletedAt stays null after expiry).
  const { data: bookings } = await admin.from('BOOKINGS').select('userId, refundedAmount').eq('eventId', eventId).is('deletedAt', null);
  const byUser = {};
  for (const b of bookings ?? []) byUser[b.userId] = (byUser[b.userId] ?? 0) + Number(b.refundedAmount ?? 0);
  const ids = Object.keys(byUser);
  let backers = [];
  if (ids.length) {
    const { data: users } = await admin.from('USER').select('id, email, username, role').in('id', ids);
    backers = (users ?? []).map((u) => ({ email: u.email, username: u.username, role: u.role, refundAmount: byUser[u.id] }));
  }

  notifyEventCancelled({
    eventTitle: event.title ?? 'your event',
    reason: 'missed_threshold',
    backers,
    organiser: organiser?.email ? { email: organiser.email, username: organiser.username } : null,
  });
}

async function runOnce() {
  const admin = adminClient();
  const { data, error } = await admin.rpc('expire_overdue_events');
  if (error) {
    console.error('[DeadlineScheduler] expire_overdue_events failed:', error.message);
    return;
  }
  const ids = (data ?? []).map((r) => r.event_id);
  if (!ids.length) return;
  console.log(`[DeadlineScheduler] Expired ${ids.length} overdue event(s); sending refund notifications.`);
  for (const id of ids) {
    try {
      await refundEventCardBookings(id); // real Stripe refunds for card-paid backers
      await gatherAndNotify(admin, id);
    } catch (e) {
      console.error(`[DeadlineScheduler] post-expiry handling failed for ${id}:`, e?.message || e);
    }
  }
}

export function startDeadlineScheduler() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[DeadlineScheduler] SUPABASE_SERVICE_ROLE_KEY not set; deadline auto-cancel disabled.');
    return;
  }
  const interval = Number(process.env.DEADLINE_CHECK_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  const tick = () => runOnce().catch((e) => console.error('[DeadlineScheduler]', e?.message || e));
  setTimeout(tick, FIRST_RUN_DELAY_MS);
  setInterval(tick, interval);
  console.log(`[DeadlineScheduler] Started (every ${Math.round(interval / 1000)}s).`);
}
