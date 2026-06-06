import { getEvent as findEvent, listEvents as findEvents } from '../services/eventMemoryService.js';

export function listEvents(req, res) {
  res.json(findEvents(req.get('X-Mock-User-Id')));
}

export function getEvent(req, res) {
  const event = findEvent(req.params.eventId, req.get('X-Mock-User-Id'));
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
