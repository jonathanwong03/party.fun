import { getProfile as readProfile, giveAwayTickets, deleteBooking as removeBooking } from '../services/eventMemoryService.js';
import { requireMockRole } from '../services/mockAuth.js';

export function getProfile(req, res) {
  const auth = requireMockRole(req, res);
  if (!auth) return;
  res.json(readProfile(auth.userId));
}

export function giveAwayBookingTickets(req, res) {
  const auth = requireMockRole(req, res);
  if (!auth) return;

  const result = giveAwayTickets({
    userId: auth.userId,
    bookingId: req.params.bookingId,
    quantity: req.body.quantity,
  });
  if (result.error) {
    const status = result.error === 'not_found' ? 404 : 400;
    res.status(status).json({ status: result.error, message: result.error === 'not_found' ? 'Booking not found.' : 'Choose a valid number of active tickets.' });
    return;
  }
  res.json({ status: 'ok', event: result.event, profile: result.profile });
}

export function deleteBooking(req, res) {
  const auth = requireMockRole(req, res);
  if (!auth) return;

  const result = removeBooking({
    userId: auth.userId,
    bookingId: req.params.bookingId,
  });
  if (result.error) {
    res.status(404).json({ status: result.error, message: 'Booking not found.' });
    return;
  }
  res.json({ status: 'ok', event: result.event, profile: result.profile });
}
