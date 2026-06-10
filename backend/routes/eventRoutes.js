import express from 'express';
import { getEvent, listEvents } from '../controllers/eventController.js';
import { optionalAuth } from '../middleware/requireAuth.js';

const router = express.Router();

// Public: guests can browse events. optionalAuth attaches a (possibly anon)
// Supabase client and, when signed in, the user id for the `mine` flag.
router.get('/', optionalAuth, listEvents);
router.get('/:eventId', optionalAuth, getEvent);

export default router;
