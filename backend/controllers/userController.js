import { cancelPledge, getProfile as readProfile } from '../services/eventMemoryService.js';
import { requireMockRole } from '../services/mockAuth.js';

export function getProfile(req, res) {
  const auth = requireMockRole(req, res);
  if (!auth) return;

  res.json(readProfile(auth.userId));
}

export function cancelTicket(req, res) {
  const auth = requireMockRole(req, res);
  if (!auth) return;

  const result = cancelPledge({
    userId: auth.userId,
    eventId: req.params.eventId,
    qty: req.body.qty,
    amount: req.body.amount,
  });

  if (!result) {
    res.status(404).json({
      status: 'not_found',
      route: req.originalUrl,
      message: 'Event not found.',
    });
    return;
  }

  res.json({
    status: 'ok',
    event: result.event,
    profile: result.profile,
  });
}
