import { randomUUID } from 'crypto';
import * as eventService from '../services/eventService.js';
import * as notificationService from '../services/notificationService.js';
import { adminClient } from '../services/supabaseAdmin.js';
import { stripe, stripeEnabled } from '../services/stripeClient.js';
import { pledgeWithPayment } from '../services/checkoutService.js';
import { auditLog } from '../services/auditLog.js';
import { formatVenueAddress } from '../utils/eventDisplay.js';

// Error code → HTTP status for a failed pledge (unmapped codes fall back to 409).
const PLEDGE_STATUS = {
  not_found: 404,
  insufficient_funds: 402,
  university_restricted: 403,
  stripe_disabled: 503,
  no_card: 400,
  charge_failed: 402,
  charge_incomplete: 402,
};

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
  invalid_pricing: "This event's ticket pricing is incomplete, so it can't be bought right now.",
  admin_forbidden: 'Admin accounts cannot attend events or buy tickets.',
};

async function walletFailureDetails(req, eventId, qty, method) {
  if (method !== 'wallet') return {};

  try {
    const [walletResult, quote] = await Promise.all([
      req.supabase
        .from('USER')
        .select('walletBalance')
        .eq('id', req.user.id)
        .single(),
      dependencies.quotePledge(req.supabase, eventId, qty),
    ]);
    return {
      balance: Number(walletResult.data?.walletBalance ?? 0),
      required: quote && !quote.error ? Number(quote.total ?? 0) : null,
    };
  } catch {
    return {};
  }
}

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
  if (req.user.role === 'admin') {
    res.status(403).json({ status: 'admin_forbidden', message: PLEDGE_MESSAGES.admin_forbidden });
    return;
  }
  const eventId = req.params.eventId;
  const qty = Number(req.body.qty) || 1;
  const method = req.body.paymentMethod === 'card' ? 'card' : 'wallet';

  const eventBefore = await dependencies.getEvent(req.supabase, eventId, req.user.id);
  // Stable across client retries: keys the Stripe charge AND the booking so a replay never double-charges.
  const attemptId = attemptIdOf(req.body);

  // Shared orchestration: card → off-session charge (+ refund-on-fail) → createPledge; wallet → createPledge.
  const result = await pledgeWithPayment({ deps: dependencies, sb: req.supabase, userId: req.user.id, eventId, qty, method, attemptId });
  if (result.error) {
    const status = PLEDGE_STATUS[result.error] ?? 409;
    const details = result.error === 'insufficient_funds'
      ? await walletFailureDetails(req, eventId, qty, method)
      : {};
    if (result.error === 'insufficient_funds') {
      console.warn('[checkout] insufficient_funds', {
        userId: req.user.id,
        eventId,
        qty,
        method,
        balance: details.balance,
        required: details.required,
      });
    }
    res.status(status).json({
      status: result.error,
      message: result.message ?? PLEDGE_MESSAGES[result.error] ?? 'Unable to complete pledge.',
      ...details,
    });
    return;
  }

  // Audit the money movement (best-effort, never throws).
  void auditLog({
    actorUserId: req.user.id, action: 'pledge', targetType: 'event', targetId: eventId,
    amount: result.amount != null ? Number(result.amount) : null,
    metadata: { qty, method, bookingId: result.bookingId },
  });

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
