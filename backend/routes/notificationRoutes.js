import express from 'express';
import { postWelcome } from '../controllers/notificationController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.post('/welcome', requireAuth, postWelcome);

export default router;
