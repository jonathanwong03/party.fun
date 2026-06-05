import express from 'express';
import { getCheckout, getQuote, postCheckout, postPledge } from '../controllers/checkoutController.js';

const router = express.Router();

router.get('/:eventId/quote', getQuote);
router.get('/:eventId', getCheckout);
router.post('/:eventId', postCheckout);
router.post('/:eventId/pledge', postPledge);

export default router;
