import { stripe, stripeEnabled } from './stripeClient.js';
import { adminClient } from './supabaseAdmin.js';
import { canRefund } from './refundPolicy.js';

// Orphan recovery: a pledge charge can succeed and then the process dies before the booking is
// recorded (and before the inline compensating refund). That leaves money taken with no booking
// and no refund — so the buyer pays again. This sweep finds succeeded pledge PaymentIntents that
// have no booking and auto-refunds them (idempotently). Safe to run repeatedly; never throws.
//
// Dependencies are injected for testing.
export const dependencies = {
  getStripe: () => stripe(),
  getAdmin: () => adminClient(),
};

const LOOKBACK_DAYS = Number(process.env.RECONCILE_LOOKBACK_DAYS) || 7;
// A pledge's booking commits a moment after the Stripe charge (checkoutService), so a PI that
// only just succeeded may be mid-commit, not abandoned. Ignore charges younger than this so the
// sweep never refunds a real in-flight purchase out from under it.
const MIN_AGE_MS = (Number(process.env.RECONCILE_MIN_AGE_MINUTES) || 5) * 60 * 1000;

export async function reconcilePayments() {
  if (!stripeEnabled()) return { scanned: 0, refunded: 0, credited: 0 };
  let scanned = 0;
  let refunded = 0;
  let credited = 0;
  try {
    const sdk = dependencies.getStripe();
    const admin = dependencies.getAdmin();
    const createdGte = Math.floor((Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000) / 1000);

    // Stripe auto-pagination over recent PaymentIntents. Expand the charge so we can see whether
    // it was already refunded — a refund does NOT change pi.status (stays 'succeeded').
    for await (const pi of sdk.paymentIntents.list({ created: { gte: createdGte }, limit: 100, expand: ['data.latest_charge'] })) {
      const kind = pi?.metadata?.kind;
      if ((kind !== 'pledge' && kind !== 'topup') || pi.status !== 'succeeded') continue;
      if (pi.created && pi.created * 1000 > Date.now() - MIN_AGE_MS) continue; // too young to be sure it's an orphan
      scanned += 1;

      // Orphaned TOP-UP: the card was charged but the wallet was never credited (the wallet_topup
      // RPC failed after the charge). Deliver what the buyer paid for — credit it. Idempotent:
      // wallet_txn_stripe_pi_uniq blocks a double credit, and we skip PIs that already have a txn.
      if (kind === 'topup') {
        const { data: existingTxn } = await admin
          .from('WALLET_TRANSACTIONS')
          .select('id')
          .eq('stripePaymentIntentId', pi.id)
          .maybeSingle();
        if (existingTxn) continue; // already credited
        const userId = pi?.metadata?.userId;
        const amount = Number(pi.amount) / 100;
        if (!userId || !(amount > 0)) {
          console.warn(`[paymentReconciler] top-up PI ${pi.id} missing userId/amount — manual review.`);
          continue;
        }
        const { data, error } = await admin.rpc('wallet_topup', { p_user_id: userId, p_amount: amount, p_payment_intent_id: pi.id });
        if (error || data?.error) {
          console.error(`[paymentReconciler] credit failed for orphan top-up ${pi.id}:`, error?.message || data?.error);
          continue;
        }
        credited += 1;
        console.warn(`[paymentReconciler] credited orphan top-up ${pi.id} (charge succeeded, wallet not credited).`);
        continue;
      }

      // Already refunded (by the inline compensating refund, or a previous sweep)? Then there is
      // nothing to do — attempting again just makes Stripe error "already refunded" every tick,
      // which is pure log noise (and masks a genuine refund failure). Checked before the DB read.
      const charge = typeof pi.latest_charge === 'object' && pi.latest_charge ? pi.latest_charge : null;
      if (charge && (charge.refunded || Number(charge.amount_refunded) >= Number(charge.amount))) continue;

      const { data: booking } = await admin
        .from('BOOKINGS')
        .select('id')
        .eq('stripePaymentIntentId', pi.id)
        .maybeSingle();
      if (booking) continue; // a booking exists → not an orphan

      // Orphan: charged but never recorded. Refund within the window, idempotently.
      const chargeAt = pi.created ? new Date(pi.created * 1000).toISOString() : null;
      if (!canRefund(chargeAt)) {
        console.warn(`[paymentReconciler] orphan PI ${pi.id} too old to refund — manual review.`);
        continue;
      }
      try {
        await sdk.refunds.create(
          { payment_intent: pi.id },
          { idempotencyKey: `orphan:${pi.id}` },
        );
        refunded += 1;
        console.warn(`[paymentReconciler] refunded orphan charge ${pi.id} (no booking recorded).`);
      } catch (e) {
        console.error(`[paymentReconciler] refund failed for orphan ${pi.id}:`, e?.message || e);
      }
    }
  } catch (e) {
    console.error('[paymentReconciler] reconcilePayments error:', e?.message || e);
  }
  return { scanned, refunded, credited };
}
