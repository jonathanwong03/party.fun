import {
  getEvent as findEvent,
  listEvents as findEvents,
  getEventAttendees,
  getEventAttendeesPrivate,
} from '../services/eventService.js';
import { matchEventsHybrid } from '../services/ai/eventSearch.js';

export async function listEvents(req, res) {
  const events = await findEvents(req.supabase, req.user?.id ?? null);
  res.json(events);
}

// GET /events/search?q= — HYBRID ranking of event ids: Postgres full-text (exact titles,
// venues, proper nouns) fused with vector similarity (meaning). Returns { ids } best-first;
// the client reorders its list and falls back to substring matching when this is empty.
// No longer gated on embeddings: keyword search alone is still a real result, so the box
// keeps working when embeddings are off or an event hasn't been backfilled.
export async function searchEventsSemantic(req, res) {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json({ ids: [] });
  const ranked = await matchEventsHybrid(req.supabase, q, { count: 50 });
  res.json({ ids: ranked.map((r) => r.eventId) });
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
