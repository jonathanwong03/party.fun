import express from 'express';
import {
  deleteEvent,
  getCreateEvent,
  getDashboard,
  getEditEvent,
  patchEvent,
  postCreateEvent,
} from '../controllers/organiserController.js';

const router = express.Router();

router.get('/', getDashboard);
router.get('/events/new', getCreateEvent);
router.post('/events', postCreateEvent);
router.get('/events/:eventId/edit', getEditEvent);
router.patch('/events/:eventId', patchEvent);
router.delete('/events/:eventId', deleteEvent);

export default router;
