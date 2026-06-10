import express from 'express';
import { giveAwayBookingTickets, getProfile, deleteBooking } from '../controllers/userController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.get('/', requireAuth, getProfile);
router.post('/bookings/:bookingId/give-away', requireAuth, giveAwayBookingTickets);
router.delete('/bookings/:bookingId', requireAuth, deleteBooking);

export default router;
