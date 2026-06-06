import express from 'express';
import { giveAwayBookingTickets, getProfile } from '../controllers/userController.js';

const router = express.Router();

router.get('/', getProfile);
router.post('/bookings/:bookingId/give-away', giveAwayBookingTickets);

export default router;
