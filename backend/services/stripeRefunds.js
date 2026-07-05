import { stripe, stripeEnabled } from './stripeClient.js';
import { adminClient } from './supabaseAdmin.js';
import { canRefund } from './refundPolicy.js';

// Issues Stripe refunds for an event's CARD-paid bookings (wallet refunds are done
// in the cancel_event / expire_overdue_events RPCs). Safe to call repeatedly —
// only bookings without a stripeRefundId are refunded, the Stripe call is idempotent,
// and charges older than the refund window are flagged for manual handling. Never throws.
export async function refundEventCardBookings(eventId) {
  if (!stripeEnabled()) return;
  try {
    const admin = adminClient();
    const { data: bookings } = await admin
      .from('BOOKINGS')
      .select('id, stripePaymentIntentId, stripeChargeAt')
      .eq('eventId', eventId)
      .eq('paymentMethod', 'card')
      .is('stripeRefundId', null)
      .not('stripePaymentIntentId', 'is', null);
    for (const b of bookings ?? []) {
      if (!canRefund(b.stripeChargeAt)) {
        await admin.from('BOOKINGS').update({ refundStatus: 'refund_blocked_too_old' }).eq('id', b.id);
        console.warn(`[stripeRefunds] booking ${b.id} charge too old to refund — flagged for manual review.`);
        continue;
      }
      try {
        const refund = await stripe().refunds.create(
          { payment_intent: b.stripePaymentIntentId },
          { idempotencyKey: `refund:${b.stripePaymentIntentId}` },
        );
        await admin.from('BOOKINGS').update({ stripeRefundId: refund.id, refundStatus: 'refunded' }).eq('id', b.id);
      } catch (e) {
        console.error(`[stripeRefunds] refund failed for booking ${b.id}:`, e?.message || e);
      }
    }
  } catch (e) {
    console.error('[stripeRefunds] refundEventCardBookings error:', e?.message || e);
  }
}
