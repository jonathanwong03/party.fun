import { adminClient } from './supabaseAdmin.js';
import { notifyEventCancelled } from './notificationService.js';
import { refundEventCardBookings } from './stripeRefunds.js';
import { reconcilePayments } from './paymentReconciler.js';

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
  const { data: bookings } = await admin.from('BOOKINGS').select('userId, refundedAmount, paymentMethod').eq('eventId', eventId).is('deletedAt', null);
  const byUser = {};
  for (const b of bookings ?? []) {
    const cur = byUser[b.userId] ?? { amount: 0, method: b.paymentMethod };
    cur.amount += Number(b.refundedAmount ?? 0);
    byUser[b.userId] = cur;
  }
  const ids = Object.keys(byUser);
  let backers = [];
  if (ids.length) {
    const { data: users } = await admin.from('USER').select('id, email, username, role').in('id', ids);
    backers = (users ?? []).map((u) => ({ email: u.email, username: u.username, role: u.role, method: byUser[u.id].method, refundAmount: byUser[u.id].amount }));
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

  // 1) Cancel + refund (to wallet, in the RPC) events that missed their threshold.
  const { data: expired, error: expireErr } = await admin.rpc('expire_overdue_events');
  if (expireErr) {
    console.error('[DeadlineScheduler] expire_overdue_events failed:', expireErr.message);
  } else {
    const ids = (expired ?? []).map((r) => r.event_id);
    if (ids.length) {
      console.log(`[DeadlineScheduler] Expired ${ids.length} overdue event(s); refunding + notifying.`);
      for (const id of ids) {
        try {
          await refundEventCardBookings(id); // real Stripe refunds for card-paid backers
          await gatherAndNotify(admin, id);
        } catch (e) { console.error(`[DeadlineScheduler] post-expiry handling failed for ${id}:`, e?.message || e); }
      }
    }
  }

  // 2) Pay out greenlit events whose end time has passed (organiser wallet).
  const { data: completed, error: payoutErr } = await admin.rpc('complete_due_events');
  if (payoutErr) console.error('[DeadlineScheduler] complete_due_events failed:', payoutErr.message);
  else if ((completed ?? []).length) console.log(`[DeadlineScheduler] Paid out ${completed.length} completed event(s) to organisers.`);

  // 3) Orphan recovery: refund pledge charges that succeeded but have no booking recorded.
  const { refunded } = await reconcilePayments();
  if (refunded) console.log(`[DeadlineScheduler] Reconciler refunded ${refunded} orphaned charge(s).`);
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
