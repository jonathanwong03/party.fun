import express from 'express';
import { giveAwayBookingTickets, getProfile, deleteBooking } from '../controllers/userController.js';

const router = express.Router();

router.get('/', getProfile);
router.post('/bookings/:bookingId/give-away', giveAwayBookingTickets);
router.delete('/bookings/:bookingId', deleteBooking);

export default router;
