import express from 'express';
import {
  deleteEvent,
  postCancelEvent,
  postHideEvent,
  getCreateEvent,
  getHostedEvents,
  getEditEvent,
  patchEvent,
  postCreateEvent,
  getSummary,
  getAllAttendees,
  getEventTickets,
  postCheckIn,
  getCoOrganiserInvites,
  postCoOrganiserInvite,
  acceptCoOrganiserInvite,
  declineCoOrganiserInvite,
  getDrafts,
  postDraft,
  deleteDraftHandler,
} from '../controllers/organiserController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.get('/', getHostedEvents);
router.get('/summary', requireAuth, getSummary);
router.get('/attendees', requireAuth, getAllAttendees);
router.get('/coorganiser-invites', requireAuth, getCoOrganiserInvites);
router.post('/coorganiser-invites/:inviteId/accept', requireAuth, acceptCoOrganiserInvite);
router.post('/coorganiser-invites/:inviteId/decline', requireAuth, declineCoOrganiserInvite);
router.get('/events/:eventId/tickets', requireAuth, getEventTickets);
router.post('/events/:eventId/coorganisers/invite', requireAuth, postCoOrganiserInvite);
router.post('/check-in', requireAuth, postCheckIn);
router.get('/events/new', getCreateEvent);
router.post('/events', requireAuth, postCreateEvent);
router.get('/events/:eventId/edit', getEditEvent);
router.patch('/events/:eventId', requireAuth, patchEvent);
router.post('/events/:eventId/cancel', requireAuth, postCancelEvent);
router.post('/events/:eventId/hide', requireAuth, postHideEvent);
router.delete('/events/:eventId', requireAuth, deleteEvent);

// Organiser drafts (private, persisted per-user).
router.get('/drafts', requireAuth, getDrafts);
router.post('/drafts', requireAuth, postDraft);
router.delete('/drafts/:draftId', requireAuth, deleteDraftHandler);

export default router;
