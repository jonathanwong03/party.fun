import express from 'express';
import { suggestEventCopy, revenueTips, recommendEvents, forYou, ask, chat, resumeChat, models, executeActionHandler, listConversations, getConversation, deleteConversation, getMemory, deleteMemory, clearMemory, transcribe } from '../controllers/aiController.js';
import { requireAuth, optionalAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = express.Router();

// Each chat message fans out into several Gemini calls (scope guard → classify → branch agent →
// tool calls), so it costs real money — throttle per user to bound abuse/runaway cost. Generous
// enough that a natural back-and-forth never trips it; only rapid-fire/loops do. Confirm/reject
// (/chat/resume) is deliberately NOT limited — clicking Confirm must never be throttled. Fail-open
// when Redis is off (dev unaffected).
const chatLimiter = rateLimit({
  keyFn: (req) => req.user?.id ?? req.ip,
  limit: 10,
  windowSec: 20,
  message: "I'm getting a lot of messages — give me a few seconds and try again.",
});

router.get('/models', requireAuth, models);
router.get('/conversations', requireAuth, listConversations);
router.get('/conversations/:id', requireAuth, getConversation);
router.delete('/conversations/:id', requireAuth, deleteConversation);
router.get('/memory', requireAuth, getMemory);
router.delete('/memory', requireAuth, clearMemory);
router.delete('/memory/:id', requireAuth, deleteMemory);
router.post('/suggest-event-copy', requireAuth, suggestEventCopy);
router.post('/revenue-tips/:eventId', requireAuth, revenueTips);
router.post('/recommend-events', optionalAuth, recommendEvents);
router.post('/for-you', requireAuth, forYou);
router.post('/ask', requireAuth, ask);
router.post('/chat', requireAuth, chatLimiter, chat);
router.post('/chat/resume', requireAuth, resumeChat);
router.post('/execute-action', requireAuth, executeActionHandler);

// Voice input for the assistant composer. Each call is a billed Google Speech request, so it
// gets its own (looser than chat) throttle. express.raw keeps the audio as a Buffer — posting
// it as JSON would base64-inflate every clip by ~33% and blow past the global 100kb json limit.
const transcribeLimiter = rateLimit({
  keyFn: (req) => req.user?.id ?? req.ip,
  limit: 20,
  windowSec: 60,
  message: 'Too many voice messages — give it a few seconds.',
});
router.post(
  '/transcribe',
  requireAuth,
  transcribeLimiter,
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '10mb' }),
  transcribe,
);

export default router;
