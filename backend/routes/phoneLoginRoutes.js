import express from 'express';
import { postRequest, postVerify } from '../controllers/phoneLoginController.js';

// Public (the user is logged out while signing in by phone). Protected by code expiry +
// attempt limits; the OTP is delivered to the SMS override number in dev.
const router = express.Router();

router.post('/request', postRequest);
router.post('/verify', postVerify);

export default router;
