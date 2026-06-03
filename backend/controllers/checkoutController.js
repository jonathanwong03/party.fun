import { createPlaceholderHandler } from '../utils/apiPlaceholder.js';
import { createPledge } from '../services/eventMemoryService.js';
import { requireMockRole } from '../services/mockAuth.js';

export const getCheckout = createPlaceholderHandler('checkout');
export const postCheckout = createPlaceholderHandler('checkout');

export function postPledge(req, res) {
  const auth = requireMockRole(req, res);
  if (!auth) return;

  const result = createPledge({
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
