import { getProfile as readProfile, giveAwayTickets, deleteBooking as removeBooking } from '../services/eventService.js';

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
