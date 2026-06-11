import {
  getEvent as findEvent,
  listEvents as findEvents,
  getEventAttendees,
  getEventAttendeesPrivate,
} from '../services/eventService.js';

export async function listEvents(req, res) {
  const events = await findEvents(req.supabase, req.user?.id ?? null);
  res.json(events);
}

export async function getEvent(req, res) {
  const event = await findEvent(req.supabase, req.params.eventId, req.user?.id ?? null);
  if (!event) {
    res.status(404).json({ status: 'not_found', route: req.originalUrl, message: 'Event not found.' });
    return;
  }
  res.json(event);
}

// Public: names + avatars of people going (used by the Who's going card + list).
export async function getAttendees(req, res) {
  const attendees = await getEventAttendees(req.supabase, req.params.eventId);
  res.json(attendees);
}

// Host-only: full attendee details (email + contacts). 403 for non-hosts.
export async function getAttendeeDetails(req, res) {
  const result = await getEventAttendeesPrivate(req.supabase, req.params.eventId);
  if (result.error === 'forbidden') {
    res.status(403).json({ status: 'forbidden', message: 'Only the event host can view attendee details.' });
    return;
  }
  res.json(result.attendees);
}
