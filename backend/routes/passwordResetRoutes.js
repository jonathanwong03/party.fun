import express from 'express';
import { postRequest, postVerify, postComplete } from '../controllers/passwordResetController.js';

// Public (the user is logged out during a reset). Protected by code expiry + attempt limits.
const router = express.Router();

router.post('/request', postRequest);
router.post('/verify', postVerify);
router.post('/complete', postComplete);

export default router;
