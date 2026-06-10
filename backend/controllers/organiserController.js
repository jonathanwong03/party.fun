import { createPlaceholderHandler } from '../utils/apiPlaceholder.js';
import { createEvent, updateEvent, deleteEvent as removeEvent } from '../services/eventService.js';

// The organiser console reads its events from the shared events list (filtered to
// `mine`), so these GET endpoints are unused by the frontend and stay as stubs.
export const getHostedEvents = createPlaceholderHandler('organiser-hosted-events');
export const getCreateEvent = createPlaceholderHandler('create-event');
export const getEditEvent = createPlaceholderHandler('edit-event');

export async function postCreateEvent(req, res) {
  const result = await createEvent(req.supabase, req.body);
  if (result.error) {
    res.status(400).json({ status: result.error, message: 'Unable to create event.' });
    return;
  }
  res.status(201).json({ status: 'ok', eventId: result.eventId });
}

export async function patchEvent(req, res) {
  const result = await updateEvent(req.supabase, { ...req.body, id: req.params.eventId });
  if (result.error) {
    res.status(400).json({ status: result.error, message: 'Unable to update event.' });
    return;
  }
  res.json({ status: 'ok' });
}

export async function deleteEvent(req, res) {
  const result = await removeEvent(req.supabase, req.params.eventId);
  if (result.error) {
    res.status(400).json({ status: result.error, message: 'Unable to delete event.' });
    return;
  }
  res.json({ status: 'ok' });
}
