import express from 'express';
import { postRequest, postVerify } from '../controllers/phoneLoginController.js';
import { rateLimit } from '../middleware/rateLimit.js';

// Public (the user is logged out while signing in by phone). Protected by code expiry +
// attempt limits; the OTP is delivered to the SMS override number in dev.
const router = express.Router();

// Throttle OTP sends per phone+IP: 1 every 30s, at most 5 per hour (cross-instance).
const phoneKey = (req) => `${String(req.body?.phone ?? '').replace(/\D/g, '')}:${req.ip}`;
const sendLimiters = [
  rateLimit({ keyFn: phoneKey, limit: 1, windowSec: 30, message: 'Please wait before requesting another code.' }),
  rateLimit({ keyFn: phoneKey, limit: 5, windowSec: 3600, message: 'Too many code requests. Try again later.' }),
];

router.post('/request', ...sendLimiters, postRequest);
router.post('/verify', postVerify);

export default router;
