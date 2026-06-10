import express from 'express';
import {
  deleteEvent,
  getCreateEvent,
  getHostedEvents,
  getEditEvent,
  patchEvent,
  postCreateEvent,
} from '../controllers/organiserController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.get('/', getHostedEvents);
router.get('/events/new', getCreateEvent);
router.post('/events', requireAuth, postCreateEvent);
router.get('/events/:eventId/edit', getEditEvent);
router.patch('/events/:eventId', requireAuth, patchEvent);
router.delete('/events/:eventId', requireAuth, deleteEvent);

export default router;
