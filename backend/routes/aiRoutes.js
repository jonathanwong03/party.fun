import express from 'express';
import { suggestEventCopy, revenueTips, recommendEvents, ask, chat, models, executeActionHandler, listConversations, getConversation, deleteConversation } from '../controllers/aiController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.get('/models', requireAuth, models);
router.get('/conversations', requireAuth, listConversations);
router.get('/conversations/:id', requireAuth, getConversation);
router.delete('/conversations/:id', requireAuth, deleteConversation);
router.post('/suggest-event-copy', requireAuth, suggestEventCopy);
router.post('/revenue-tips/:eventId', requireAuth, revenueTips);
router.post('/recommend-events', requireAuth, recommendEvents);
router.post('/ask', requireAuth, ask);
router.post('/chat', requireAuth, chat);
router.post('/execute-action', requireAuth, executeActionHandler);

export default router;
