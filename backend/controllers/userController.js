import { getProfile as readProfile, giveAwayTickets, deleteBooking as removeBooking } from '../services/eventService.js';
import { notifyPledgeCancelled, notifyTicketsGivenAway } from '../services/notificationService.js';

export async function getProfile(req, res) {
  const profile = await readProfile(req.supabase);
  res.json(profile);
}

export async function giveAwayBookingTickets(req, res) {
  const quantity = Number(req.body.quantity);
  const result = await giveAwayTickets(req.supabase, req.user.id, Number(req.params.bookingId), quantity);
  if (result.error) {
    const status = result.error === 'not_found' ? 404 : 400;
    res.status(status).json({
      status: result.error,
      message: result.error === 'not_found' ? 'Booking not found.' : 'Choose a valid number of active tickets.',
    });
    return;
  }

  const profile = result.profile?.profile;
  const bookingId = Number(req.params.bookingId);
  const ticket = result.profile?.tickets?.find((t) => Number(t.bookingId) === bookingId);
  const eventId = ticket?.eventId;

  if (profile && eventId) {
    const pricePerTicket = result.event?.price ?? 0;
    notifyPledgeCancelled({
      userId: req.user.id,
      email: profile.email,
      username: profile.handle || profile.fullName,
      eventId,
      eventTitle: result.event?.title ?? 'your event',
      qty: quantity,
      refundAmount: pricePerTicket * quantity,
    });
  }

  // Fire-and-forget give-away email. allGivenAway = the booking has no active tickets left.
  const { data: me } = await req.supabase.from('USER').select('email, username, role').eq('id', req.user.id).single();
  if (me?.email && result.event) {
    notifyTicketsGivenAway({
      email: me.email,
      username: me.username,
      role: me.role,
      eventTitle: result.event.title,
      qty: quantity,
      allGivenAway: !ticket || ticket.activeTicketCount === 0,
    });
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
