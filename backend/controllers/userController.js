import { getProfile as readProfile, giveAwayTickets, deleteBooking as removeBooking } from '../services/eventService.js';
import { notifyTicketsGivenAway, notifyBookingTicket } from '../services/notificationService.js';
import { formatVenueAddress } from '../utils/eventDisplay.js';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// Re-issue the booking ticket (booking QR + per-ticket PDF) with the updated remaining
// count after some tickets were given away. No-op if no active tickets remain.
async function reissueBookingTicket(sb, userId, bookingId) {
  const { data: b } = await sb.from('BOOKINGS').select('qrToken, reference, eventId').eq('id', bookingId).single();
  if (!b) return;
  const [{ data: ev }, { data: tix }, { data: me }] = await Promise.all([
    sb.from('EVENT').select('title, location, address, startDate').eq('id', b.eventId).single(),
    sb.from('TICKETS').select('qrCode, status').eq('bookingId', bookingId),
    sb.from('USER').select('email, username, role').eq('id', userId).single(),
  ]);
  const codes = (tix ?? []).filter((t) => t.status === 'active').map((t) => t.qrCode);
  if (!me?.email || !ev || !codes.length) return;
  notifyBookingTicket({
    email: me.email, username: me.username, role: me.role,
    eventTitle: ev.title, dateText: fmtDate(ev.startDate), location: formatVenueAddress(ev.location, ev.address),
    reference: b.reference, bookingToken: b.qrToken, ticketCodes: codes,
  });
}

export async function getProfile(req, res) {
  const profile = await readProfile(req.supabase);
  res.json(profile);
}

export async function giveAwayBookingTickets(req, res) {
  const result = await giveAwayTickets(req.supabase, req.user.id, Number(req.params.bookingId), req.body.quantity);
  if (result.error) {
    const status = result.error === 'not_found' ? 404 : 400;
    res.status(status).json({
      status: result.error,
      message: result.error === 'not_found' ? 'Booking not found.' : 'Choose a valid number of active tickets.',
    });
    return;
  }

  // Fire-and-forget give-away email. allGivenAway = the booking has no active tickets left.
  const bookingId = Number(req.params.bookingId);
  const booking = (result.profile?.tickets ?? []).find((t) => Number(t.bookingId) === bookingId);
  const { data: me } = await req.supabase.from('USER').select('email, username, role').eq('id', req.user.id).single();
  if (me?.email && result.event) {
    notifyTicketsGivenAway({
      email: me.email,
      username: me.username,
      role: me.role,
      eventTitle: result.event.title,
      qty: Number(req.body.quantity),
      allGivenAway: !booking || booking.activeTicketCount === 0,
    });
  }
  // Re-send the updated ticket (new remaining count) if any active tickets are left.
  if (booking && booking.activeTicketCount > 0) {
    reissueBookingTicket(req.supabase, req.user.id, bookingId).catch((e) => console.error('[Profile] reissue ticket failed:', e?.message || e));
  }

  res.json({ status: 'ok', event: result.event, profile: result.profile });
}

export async function deleteBooking(req, res) {
  const result = await removeBooking(req.supabase, req.user.id, Number(req.params.bookingId));
  if (result.error) {
    res.status(404).json({ status: result.error, message: 'Booking not found.' });
    return;
  }
  res.json({ status: 'ok', event: result.event, profile: result.profile });
}
