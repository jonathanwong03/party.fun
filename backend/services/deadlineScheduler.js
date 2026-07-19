import { adminClient } from './supabaseAdmin.js';
import { notifyEventCancelled, notifyEventCompleted, notifyReviewInvites } from './notificationService.js';
import { refundEventCardBookings } from './stripeRefunds.js';
import { reconcilePayments } from './paymentReconciler.js';
import { checkWalletDrift } from './walletIntegrity.js';
import { getReadyRedis } from './redisClient.js';

export const dependencies = {
  adminClient,
  notifyEventCancelled,
  notifyEventCompleted,
  notifyReviewInvites,
  refundEventCardBookings,
  reconcilePayments,
  checkWalletDrift,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  setInterval: (fn, ms) => setInterval(fn, ms),
};

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

  dependencies.notifyEventCancelled({
    eventTitle: event.title ?? 'your event',
    reason: 'missed_threshold',
    backers,
    organiser: organiser?.email ? { email: organiser.email, username: organiser.username } : null,
  });
}

// Re-entrancy guards. A run that outlasts DEADLINE_CHECK_INTERVAL_MS (a slow sweep, or a second
// backend instance) must NOT overlap another — overlapping runs double-pay/double-cancel.
//   1) an in-process flag stops the SAME process from overlapping itself;
//   2) a best-effort Redis lock (fail-open, like the rest of the app) stops TWO instances.
let running = false;
const LOCK_KEY = 'lock:deadline-scheduler';
const LOCK_TTL_SEC = 15 * 60; // safety expiry so a crashed run can't hold the lock forever

async function acquireCrossInstanceLock() {
  const redis = getReadyRedis();
  if (!redis) return { proceed: true, release: null }; // no Redis → rely on the in-process flag
  try {
    const ok = await redis.set(LOCK_KEY, String(Date.now()), 'NX', 'EX', LOCK_TTL_SEC);
    if (ok !== 'OK') return { proceed: false, release: null }; // another instance holds it
    return { proceed: true, release: async () => { try { await redis.del(LOCK_KEY); } catch { /* best effort */ } } };
  } catch {
    return { proceed: true, release: null }; // Redis error → fail open (in-process flag still applies)
  }
}

// Test seam: clear the in-process flag between tests.
export function __resetSchedulerForTests() { running = false; }

export async function runOnce() {
  if (running) { console.warn('[DeadlineScheduler] previous run still in progress; skipping this tick.'); return 'skipped'; }
  running = true;
  const lock = await acquireCrossInstanceLock();
  if (!lock.proceed) { running = false; console.warn('[DeadlineScheduler] another instance holds the lock; skipping this tick.'); return 'skipped'; }
  try {
    return await runSweep();
  } finally {
    running = false;
    if (lock.release) await lock.release();
  }
}

async function runSweep() {
  const admin = dependencies.adminClient();

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
          await dependencies.refundEventCardBookings(id); // real Stripe refunds for card-paid backers
          await gatherAndNotify(admin, id);
        } catch (e) { console.error(`[DeadlineScheduler] post-expiry handling failed for ${id}:`, e?.message || e); }
      }
    }
  }

  // 2) Pay out greenlit events whose end time has passed (organiser wallet) and
  //    email each organiser the revenue generated from ticket sales.
  const { data: completed, error: payoutErr } = await admin.rpc('complete_due_events');
  if (payoutErr) {
    console.error('[DeadlineScheduler] complete_due_events failed:', payoutErr.message);
  } else if ((completed ?? []).length) {
    console.log(`[DeadlineScheduler] Paid out ${completed.length} completed event(s) to organisers.`);
    for (const { event_id } of completed) {
      try {
        // complete_due_events stores the paid-out revenue in EVENT.profit.
        const { data: event } = await admin.from('EVENT').select('title, hostId, profit').eq('id', event_id).single();
        if (!event) continue;
        const { data: organiser } = await admin.from('USER').select('id, email, username').eq('id', event.hostId).single();
        dependencies.notifyEventCompleted({
          organiser: organiser?.email ? { userId: organiser.id, email: organiser.email, username: organiser.username } : null,
          eventTitle: event.title ?? 'your event',
          revenue: Number(event.profit ?? 0),
          eventId: event_id,
        });
        // Invite every attendee to review the finished event.
        dependencies.notifyReviewInvites({ eventId: event_id, eventTitle: event.title ?? 'your event' });
      } catch (e) { console.error(`[DeadlineScheduler] completion email failed for ${event_id}:`, e?.message || e); }
    }
  }

  // 3) Orphan recovery: refund pledge charges with no booking, and credit top-up charges with no
  //    wallet credit (money the buyer already paid for).
  const { refunded, credited } = await dependencies.reconcilePayments();
  if (refunded) console.log(`[DeadlineScheduler] Reconciler refunded ${refunded} orphaned charge(s).`);
  if (credited) console.log(`[DeadlineScheduler] Reconciler credited ${credited} orphaned top-up(s).`);

  // 4) Integrity check (detection only): flag any wallet whose balance disagrees with its ledger.
  const drifts = await dependencies.checkWalletDrift();
  if (drifts?.length) console.error(`[DeadlineScheduler] ${drifts.length} wallet(s) drifted from their ledger — see [walletDrift] logs.`);
}

export function startDeadlineScheduler() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[DeadlineScheduler] SUPABASE_SERVICE_ROLE_KEY not set; deadline auto-cancel disabled.');
    return;
  }
  const interval = Number(process.env.DEADLINE_CHECK_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  const tick = () => runOnce().catch((e) => console.error('[DeadlineScheduler]', e?.message || e));
  dependencies.setTimeout(tick, FIRST_RUN_DELAY_MS);
  dependencies.setInterval(tick, interval);
  console.log(`[DeadlineScheduler] Started (every ${Math.round(interval / 1000)}s).`);
}

