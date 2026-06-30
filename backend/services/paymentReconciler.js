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

export async function reconcilePayments() {
  if (!stripeEnabled()) return { scanned: 0, refunded: 0 };
  let scanned = 0;
  let refunded = 0;
  try {
    const sdk = dependencies.getStripe();
    const admin = dependencies.getAdmin();
    const createdGte = Math.floor((Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000) / 1000);

    // Stripe auto-pagination over recent PaymentIntents.
    for await (const pi of sdk.paymentIntents.list({ created: { gte: createdGte }, limit: 100 })) {
      if (pi?.metadata?.kind !== 'pledge' || pi.status !== 'succeeded') continue;
      scanned += 1;

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
  return { scanned, refunded };
}
