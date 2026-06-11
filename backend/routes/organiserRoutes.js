import express from 'express';
import {
  deleteEvent,
  getCreateEvent,
  getHostedEvents,
  getEditEvent,
  patchEvent,
  postCreateEvent,
  getSummary,
  getDrafts,
  postDraft,
  deleteDraftHandler,
} from '../controllers/organiserController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.get('/', getHostedEvents);
router.get('/summary', requireAuth, getSummary);
router.get('/events/new', getCreateEvent);
router.post('/events', requireAuth, postCreateEvent);
router.get('/events/:eventId/edit', getEditEvent);
router.patch('/events/:eventId', requireAuth, patchEvent);
router.delete('/events/:eventId', requireAuth, deleteEvent);

// Organiser drafts (private, persisted per-user).
router.get('/drafts', requireAuth, getDrafts);
router.post('/drafts', requireAuth, postDraft);
router.delete('/drafts/:draftId', requireAuth, deleteDraftHandler);

export default router;
