import * as eventService from '../services/eventService.js';
import * as notificationService from '../services/notificationService.js';
import { stripe, stripeEnabled } from '../services/stripeClient.js';

export const dependencies = {
  getEvent: eventService.getEvent,
  quotePledge: eventService.quotePledge,
  createPledge: eventService.createPledge,
  notifyPledgeConfirmed: notificationService.notifyPledgeConfirmed,
  notifyEventGreenlit: notificationService.notifyEventGreenlit,
};

const PLEDGE_MESSAGES = {
  not_found: 'Event not found.',
  event_cancelled: 'This event has been cancelled.',
  own_event: 'You cannot pledge for your own event.',
  active_booking_exists: 'Give away all active tickets before pledging for this event again.',
  not_enough_tickets: 'Not enough tickets are available.',
  insufficient_funds: 'Not enough wallet balance — top up or pay by card.',
  no_card: 'Link a card before paying by card.',
  price_mismatch: 'The ticket price changed — refresh and try again.',
};

export async function getQuote(req, res) {
  // Quotes are public (used on the checkout screen before committing).
  const quote = await dependencies.quotePledge(req.supabase, req.params.eventId, req.query.qty);
  if (!quote) {
    res.status(404).json({ status: 'not_found', route: req.originalUrl, message: 'Event not found.' });
    return;
  }
  if (quote.error) {
    res.status(409).json({ status: quote.error, message: 'Not enough tickets are available.' });
    return;
  }
  res.json(quote);
}

export async function postPledge(req, res) {
  const eventId = req.params.eventId;
  const qty = Number(req.body.qty) || 1;
  const method = req.body.paymentMethod === 'card' ? 'card' : 'wallet';
  let paymentIntentId = null;

  const eventBefore = await dependencies.getEvent(req.supabase, eventId, req.user.id);
  let chargedAmount = null;

  // Card path: charge the saved card via Stripe BEFORE creating the booking.
  if (method === 'card') {
    if (!stripeEnabled()) {
      res.status(503).json({ status: 'stripe_disabled', message: 'Card payments are not configured.' });
      return;
    }
    const quote = await dependencies.quotePledge(req.supabase, eventId, qty);
    if (!quote || quote.error) {
      res.status(quote ? 409 : 404).json({ status: quote?.error ?? 'not_found', message: quote ? 'Not enough tickets are available.' : 'Event not found.' });
      return;
    }
    const { data: me } = await req.supabase.from('USER').select('stripeCustomerId, stripePaymentMethodId').eq('id', req.user.id).single();
    if (!me?.stripeCustomerId || !me?.stripePaymentMethodId) {
      res.status(400).json({ status: 'no_card', message: PLEDGE_MESSAGES.no_card });
      return;
    }
    let pi;
    try {
      pi = await stripe().paymentIntents.create({
        amount: Math.round(Number(quote.total) * 100),
        currency: 'sgd',
        customer: me.stripeCustomerId,
        payment_method: me.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: { eventId, userId: req.user.id, qty: String(qty) },
      });
    } catch (e) {
      res.status(402).json({ status: 'charge_failed', message: e?.message || 'Your card was declined.' });
      return;
    }
    if (pi.status !== 'succeeded') {
      res.status(402).json({ status: 'charge_incomplete', message: 'Payment could not be completed.' });
      return;
    }
    paymentIntentId = pi.id;
    chargedAmount = quote.total;
  }

  const result = await dependencies.createPledge(req.supabase, req.user.id, eventId, qty, method, paymentIntentId, chargedAmount);
  if (result.error) {
    // Card was charged but booking failed (e.g. sold out) → refund immediately.
    if (method === 'card' && paymentIntentId) {
      try { await stripe().refunds.create({ payment_intent: paymentIntentId }); } catch { /* logged by Stripe dashboard */ }
    }
    const status = result.error === 'not_found' ? 404 : result.error === 'insufficient_funds' ? 402 : 409;
    res.status(status).json({
      status: result.error,
      message: PLEDGE_MESSAGES[result.error] ?? 'Unable to complete pledge.',
    });
    return;
  }

  const profile = result.profile?.profile;
  const capturedTotal = result.amount != null ? Number(result.amount) : null;
  const pricePerTicket = capturedTotal != null && qty > 0
    ? capturedTotal / qty
    : (result.event?.price ?? 0);
  if (profile) {
    void dependencies.notifyPledgeConfirmed({
      userId: req.user.id,
      email: profile.email,
      username: profile.handle || profile.fullName,
      eventId: req.params.eventId,
      eventTitle: result.event?.title ?? eventBefore?.title ?? 'your event',
      deadline: result.event?.deadline ?? eventBefore?.deadline ?? '',
      qty,
      pricePerTicket,
      totalAmount: capturedTotal ?? undefined,
    });
  }

  if (eventBefore?.status !== 'greenlit' && result.event?.status === 'greenlit') {
    void dependencies.notifyEventGreenlit(req.params.eventId, result.event);
  }

  res.json({ status: 'ok', event: result.event, profile: result.profile, reference: result.reference });
}
