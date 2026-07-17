import express from 'express';
import { getQuote, postPledge } from '../controllers/checkoutController.js';
import { optionalAuth, requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = express.Router();

// Server-side double-submit guard (defence in depth — the idempotency key is what actually
// prevents a second charge). Rejects rapid duplicate clicks before they reach Stripe. Keyed by
// user id, runs after requireAuth so req.user is set. Fail-open when Redis is off.
const pledgeLimiter = rateLimit({
  keyFn: (req) => req.user?.id ?? req.ip,
  limit: 3,
  windowSec: 10,
  message: "You're going too fast — please wait a moment and try again.",
});

router.get('/:eventId/quote', optionalAuth, getQuote);
router.post('/:eventId/pledge', requireAuth, pledgeLimiter, postPledge);

export default router;
