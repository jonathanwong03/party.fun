import { createPledge, quotePledge } from '../services/eventService.js';
import { notifyBookingTicket } from '../services/notificationService.js';
import { adminClient } from '../services/supabaseAdmin.js';
import { stripe, stripeEnabled } from '../services/stripeClient.js';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// On greenlight, re-issue a ticket email (booking QR + per-ticket PDF) to every backer.
// Uses the service-role client because it reads across all backers' rows.
async function fanOutGreenlitTickets(eventId) {
  const admin = adminClient();
  const { data: ev } = await admin.from('EVENT').select('title, location, startDate').eq('id', eventId).single();
  if (!ev) return;
  const dateText = fmtDate(ev.startDate);
  const { data: bookings } = await admin.from('BOOKINGS').select('id, userId, reference, qrToken').eq('eventId', eventId).is('deletedAt', null);
  for (const b of bookings ?? []) {
    const { data: tix } = await admin.from('TICKETS').select('qrCode, status').eq('bookingId', b.id);
    const codes = (tix ?? []).filter((t) => t.status === 'active').map((t) => t.qrCode);
    if (!codes.length) continue;
    const { data: u } = await admin.from('USER').select('email, username, role').eq('id', b.userId).single();
    if (!u?.email) continue;
    notifyBookingTicket({ email: u.email, username: u.username, role: u.role, eventTitle: ev.title, dateText, location: ev.location, reference: b.reference, bookingToken: b.qrToken, ticketCodes: codes, greenlit: true });
  }
}

const PLEDGE_MESSAGES = {
  not_found: 'Event not found.',
  event_cancelled: 'This event has been cancelled.',
  own_event: 'You cannot pledge for your own event.',
  active_booking_exists: 'Give away all active tickets before pledging for this event again.',
  not_enough_tickets: 'Not enough tickets are available.',
  insufficient_funds: 'Not enough wallet balance — top up or pay by card.',
  no_card: 'Link a card before paying by card.',
};

export async function getQuote(req, res) {
  // Quotes are public (used on the checkout screen before committing).
  const quote = await quotePledge(req.supabase, req.params.eventId, req.query.qty);
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
  const qty = req.body.qty;
  const method = req.body.paymentMethod === 'card' ? 'card' : 'wallet';
  let paymentIntentId = null;

  // Card path: charge the saved card via Stripe BEFORE creating the booking.
  if (method === 'card') {
    if (!stripeEnabled()) {
      res.status(503).json({ status: 'stripe_disabled', message: 'Card payments are not configured.' });
      return;
    }
    const quote = await quotePledge(req.supabase, eventId, qty);
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
  }

  const result = await createPledge(req.supabase, req.user.id, eventId, qty, method, paymentIntentId);
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
  // Fire-and-forget: email the buyer their booking ticket (booking QR + per-ticket PDF).
  const { data: me } = await req.supabase.from('USER').select('email, username, role').eq('id', req.user.id).single();
  const [{ data: ev }, { data: tix }] = await Promise.all([
    req.supabase.from('EVENT').select('title, location, startDate').eq('id', eventId).single(),
    req.supabase.from('TICKETS').select('qrCode, status, bookingId').eq('bookingId', result.bookingId),
  ]);
  const codes = (tix ?? []).filter((t) => t.status === 'active').map((t) => t.qrCode);
  if (me?.email && ev && codes.length && result.qrToken) {
    notifyBookingTicket({
      email: me.email, username: me.username, role: me.role,
      eventTitle: ev.title, dateText: fmtDate(ev.startDate), location: ev.location,
      reference: result.reference, bookingToken: result.qrToken, ticketCodes: codes,
    });
  }
  // If this pledge crossed the threshold, re-issue tickets to all backers as "greenlit".
  if (result.greenlitNow) {
    Promise.resolve().then(() => fanOutGreenlitTickets(eventId)).catch((e) => console.error('[Checkout] greenlit fan-out failed:', e?.message || e));
  }

  res.json({ status: 'ok', event: result.event, profile: result.profile, reference: result.reference });
}
