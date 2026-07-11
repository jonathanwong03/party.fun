import express from 'express';
import { postRequest, postVerify, postComplete } from '../controllers/passwordResetController.js';
import { rateLimit } from '../middleware/rateLimit.js';

// Public (the user is logged out during a reset). Protected by code expiry + attempt limits.
const router = express.Router();

// Throttle reset-code sends per identifier+IP: 1 every 30s, at most 5 per hour (cross-instance).
const idKey = (req) => `${String(req.body?.email ?? '').trim().toLowerCase()}:${req.ip}`;
const sendLimiters = [
  rateLimit({ keyFn: idKey, limit: 1, windowSec: 30, message: 'Please wait before requesting another code.' }),
  rateLimit({ keyFn: idKey, limit: 5, windowSec: 3600, message: 'Too many code requests. Try again later.' }),
];

router.post('/request', ...sendLimiters, postRequest);
router.post('/verify', postVerify);
router.post('/complete', postComplete);

export default router;
