// Shared pledge-with-payment orchestration used by BOTH the checkout HTTP flow
// (checkoutController.postPledge) and the AI agent's confirmed `pledge` action
// (actions.js). Centralising it means a card purchase made through the chatbot goes
// through the exact same Stripe off-session charge + compensating-refund path as the
// in-app checkout — no divergence, no double-charge (idempotency key `pledge:<attemptId>`).
//
// `deps` carries the injectable seams { quotePledge, createPledge, stripeEnabled,
// getStripe } so callers keep their own testable dependency objects.

// Returns the createPledge result on success (spread with paymentIntentId/chargedAmount),
// or `{ error, message? }` on any failure. For card failures AFTER a successful charge,
// a compensating refund is issued here (idempotent) before returning the error.
export async function pledgeWithPayment({ deps, sb, userId, eventId, qty, method = 'wallet', attemptId }) {
  let paymentIntentId = null;
  let chargedAmount = null;

  if (method === 'card') {
    if (!deps.stripeEnabled()) return { error: 'stripe_disabled', message: 'Card payments are not configured.' };
    const quote = await deps.quotePledge(sb, eventId, qty);
    if (!quote || quote.error) return { error: quote?.error ?? 'not_found' };
    const { data: me } = await sb.from('USER').select('stripeCustomerId, stripePaymentMethodId').eq('id', userId).single();
    if (!me?.stripeCustomerId || !me?.stripePaymentMethodId) return { error: 'no_card' };
    let pi;
    try {
      pi = await deps.getStripe().paymentIntents.create({
        // Ticket prices are GST-inclusive — the buyer pays the ticket total, no separate GST.
        amount: Math.round(Number(quote.total) * 100),
        currency: 'sgd',
        customer: me.stripeCustomerId,
        payment_method: me.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: { kind: 'pledge', eventId, userId, qty: String(qty), attemptId },
      }, { idempotencyKey: `pledge:${attemptId}` });
    } catch (e) {
      return { error: 'charge_failed', message: e?.message || 'Your card was declined.' };
    }
    if (pi.status !== 'succeeded') return { error: 'charge_incomplete', message: 'Payment could not be completed.' };
    paymentIntentId = pi.id;
    chargedAmount = quote.total;
  }

  const result = await deps.createPledge(sb, userId, eventId, qty, method, paymentIntentId, chargedAmount, attemptId);
  if (result?.error) {
    // Booking didn't commit — refund the charge (idempotent so a retry never double-refunds).
    if (method === 'card' && paymentIntentId) {
      try { await deps.getStripe().refunds.create({ payment_intent: paymentIntentId }, { idempotencyKey: `refund:${paymentIntentId}` }); } catch { /* logged by Stripe dashboard */ }
    }
    return result;
  }
  return { ...result, paymentIntentId, chargedAmount };
}
