import { randomUUID } from 'crypto';
import * as eventService from '../services/eventService.js';
import * as notificationService from '../services/notificationService.js';
import { adminClient } from '../services/supabaseAdmin.js';
import { stripe, stripeEnabled } from '../services/stripeClient.js';
import { formatVenueAddress } from '../utils/eventDisplay.js';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Per-attempt idempotency key: trust the client's UUID (reused across retries), else mint one.
const attemptIdOf = (body) => (UUID_RE.test(body?.attemptId ?? '') ? body.attemptId : randomUUID());

async function fanOutGreenlitTickets(eventId) {
  const admin = adminClient();
  const { data: ev } = await admin.from('EVENT').select('title, location, address, startDate').eq('id', eventId).single();
  if (!ev) return;
  const dateText = fmtDate(ev.startDate);
  const { data: bookings } = await admin.from('BOOKINGS').select('id, userId, reference, qrToken').eq('eventId', eventId).is('deletedAt', null);
  for (const b of bookings ?? []) {
    const { data: tix } = await admin.from('TICKETS').select('qrCode, status').eq('bookingId', b.id);
    const codes = (tix ?? []).filter((t) => t.status === 'active').map((t) => t.qrCode);
    if (!codes.length) continue;
    const { data: u } = await admin.from('USER').select('email, username, role').eq('id', b.userId).single();
    if (!u?.email) continue;
    notificationService.notifyBookingTicket({
      email: u.email,
      username: u.username,
      role: u.role,
      eventTitle: ev.title,
      dateText,
      location: formatVenueAddress(ev.location, ev.address),
      reference: b.reference,
      bookingToken: b.qrToken,
      ticketCodes: codes,
      greenlit: true,
    });
  }
}

export const dependencies = {
  getEvent: eventService.getEvent,
  quotePledge: eventService.quotePledge,
  createPledge: eventService.createPledge,
  notifyPledgeConfirmed: notificationService.notifyPledgeConfirmed,
  notifyEventGreenlit: notificationService.notifyEventGreenlit,
  notifyBookingTicket: notificationService.notifyBookingTicket,
  // Stripe behind the dependencies object so the charge/refund orchestration is unit-testable.
  stripeEnabled,
  getStripe: () => stripe(),
};

const PLEDGE_MESSAGES = {
  not_found: 'Event not found.',
  event_cancelled: 'This event has been cancelled.',
  own_event: 'You cannot pledge for your own event.',
  active_booking_exists: 'Give away all active tickets before pledging for this event again.',
  not_enough_tickets: 'Not enough tickets are available.',
  insufficient_funds: 'Not enough wallet balance — top up or pay by card.',
  no_card: 'Link a card before paying by card.',
  university_restricted: 'This event is open to members of a specific university only.',
  price_mismatch: 'The ticket price changed — refresh and try again.',
};

export async function getQuote(req, res) {
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
  // Stable across client retries: keys the Stripe charge AND the booking so a replay never double-charges.
  const attemptId = attemptIdOf(req.body);

  if (method === 'card') {
    if (!dependencies.stripeEnabled()) {
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
      pi = await dependencies.getStripe().paymentIntents.create({
        amount: Math.round(Number(quote.total) * 100),
        currency: 'sgd',
        customer: me.stripeCustomerId,
        payment_method: me.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: { kind: 'pledge', eventId, userId: req.user.id, qty: String(qty), attemptId },
      }, { idempotencyKey: `pledge:${attemptId}` });
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

  const result = await dependencies.createPledge(req.supabase, req.user.id, eventId, qty, method, paymentIntentId, chargedAmount, attemptId);
  if (result.error) {
    // Booking didn't commit — refund the charge (idempotent so a retry never double-refunds).
    if (method === 'card' && paymentIntentId) {
      try { await dependencies.getStripe().refunds.create({ payment_intent: paymentIntentId }, { idempotencyKey: `refund:${paymentIntentId}` }); } catch { /* logged by Stripe dashboard */ }
    }
    const status = result.error === 'not_found' ? 404 : result.error === 'insufficient_funds' ? 402 : result.error === 'university_restricted' ? 403 : 409;
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

  const { data: me } = await req.supabase.from('USER').select('email, username, role').eq('id', req.user.id).single();
  const [{ data: ev }, { data: tix }] = await Promise.all([
    req.supabase.from('EVENT').select('title, location, address, startDate').eq('id', eventId).single(),
    req.supabase.from('TICKETS').select('qrCode, status, bookingId').eq('bookingId', result.bookingId),
  ]);
  const codes = (tix ?? []).filter((t) => t.status === 'active').map((t) => t.qrCode);
  if (me?.email && ev && codes.length && result.qrToken) {
    void dependencies.notifyBookingTicket({
      email: me.email,
      username: me.username,
      role: me.role,
      eventTitle: ev.title,
      dateText: fmtDate(ev.startDate),
      location: formatVenueAddress(ev.location, ev.address),
      reference: result.reference,
      bookingToken: result.qrToken,
      ticketCodes: codes,
    });
  }

  if (result.greenlitNow) {
    Promise.resolve().then(() => fanOutGreenlitTickets(eventId)).catch((e) => console.error('[Checkout] greenlit fan-out failed:', e?.message || e));
  }

  if (eventBefore?.status !== 'greenlit' && result.event?.status === 'greenlit') {
    void dependencies.notifyEventGreenlit(req.params.eventId, result.event);
  }

  res.json({ status: 'ok', event: result.event, profile: result.profile, reference: result.reference });
}
