import express from 'express';
import { getWallet, postSetupIntent, postCard, postTopup } from '../controllers/walletController.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = express.Router();

// Server-side double-submit guard (defence in depth — the topup:<attemptId> idempotency key is
// what actually prevents a second charge). Rejects rapid duplicate clicks before they reach
// Stripe. Keyed by user id, runs after requireAuth. Fail-open when Redis is off.
const topupLimiter = rateLimit({
  keyFn: (req) => req.user?.id ?? req.ip,
  limit: 3,
  windowSec: 10,
  message: "You're going too fast — please wait a moment and try again.",
});

router.get('/', requireAuth, getWallet);
router.post('/setup-intent', requireAuth, postSetupIntent);
router.post('/card', requireAuth, postCard);
router.post('/topup', requireAuth, topupLimiter, postTopup);

export default router;
