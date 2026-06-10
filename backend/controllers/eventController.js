import { getEvent as findEvent, listEvents as findEvents } from '../services/eventService.js';

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
