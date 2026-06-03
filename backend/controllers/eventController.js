import { getEvent as findEvent, listEvents as findEvents } from '../services/eventMemoryService.js';

export function listEvents(_req, res) {
  res.json(findEvents());
}

export function getEvent(req, res) {
  const event = findEvent(req.params.eventId);
  if (!event) {
    res.status(404).json({
      status: 'not_found',
      route: req.originalUrl,
      message: 'Event not found.',
    });
    return;
  }
  res.json(event);
}
