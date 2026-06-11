import express from 'express';
import { getQuote, postPledge } from '../controllers/checkoutController.js';
import { optionalAuth, requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.get('/:eventId/quote', optionalAuth, getQuote);
router.post('/:eventId/pledge', requireAuth, postPledge);

export default router;
