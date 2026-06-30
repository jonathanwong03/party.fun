import express from 'express';
import { suggestEventCopy, revenueTips, recommendEvents, ask, chat } from '../controllers/aiController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.post('/suggest-event-copy', requireAuth, suggestEventCopy);
router.post('/revenue-tips/:eventId', requireAuth, revenueTips);
router.post('/recommend-events', requireAuth, recommendEvents);
router.post('/ask', requireAuth, ask);
router.post('/chat', requireAuth, chat);

export default router;
