import express from 'express';
import { getTicketsPdf, getTicketsPdfByToken } from '../controllers/ticketsController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

// Public, token-authenticated PDF (linked from the ticket email). Must precede /:bookingId.
router.get('/by-token/:qrToken/pdf', getTicketsPdfByToken);
router.get('/:bookingId/pdf', requireAuth, getTicketsPdf);

export default router;
