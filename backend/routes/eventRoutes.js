import express from 'express';
import { getEvent, listEvents, getAttendees, getAttendeeDetails } from '../controllers/eventController.js';
import { optionalAuth, requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

// Public: guests can browse events. optionalAuth attaches a (possibly anon)
// Supabase client and, when signed in, the user id for the `mine` flag.
router.get('/', optionalAuth, listEvents);
router.get('/:eventId', optionalAuth, getEvent);

// Public attendee names/avatars (Who's going); host-only full details.
router.get('/:eventId/attendees', optionalAuth, getAttendees);
router.get('/:eventId/attendees/details', requireAuth, getAttendeeDetails);

export default router;
