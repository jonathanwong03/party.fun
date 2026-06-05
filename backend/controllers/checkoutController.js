import { createPlaceholderHandler } from '../utils/apiPlaceholder.js';
import { createPledge, quotePledge, getEvent } from '../services/eventMemoryService.js';
import { requireMockRole } from '../services/mockAuth.js';
import { notifyPledgeConfirmed, notifyEventGreenlit } from '../services/notificationService.js';

export const getCheckout = createPlaceholderHandler('checkout');
export const postCheckout = createPlaceholderHandler('checkout');

export function getQuote(req, res) {
  const quote = quotePledge(req.params.eventId, req.query.qty);
  if (!quote) {
    res.status(404).json({
      status: 'not_found',
      route: req.originalUrl,
      message: 'Event not found.',
    });
    return;
  }
  res.json(quote);
}

export function postPledge(req, res) {
  const auth = requireMockRole(req, res);
  if (!auth) return;

  const eventBefore = getEvent(req.params.eventId);
  if (!eventBefore) {
    res.status(404).json({
      status: 'not_found',
      route: req.originalUrl,
      message: 'Event not found.',
    });
    return;
  }

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

  // Trigger notifications asynchronously (fire-and-forget)
  notifyPledgeConfirmed(auth.userId, req.params.eventId, req.body.qty, req.body.amount);

  // Check if status transitioned to greenlit
  if (eventBefore.status !== 'greenlit' && result.event.status === 'greenlit') {
    notifyEventGreenlit(req.params.eventId);
  }

  res.json({
    status: 'ok',
    event: result.event,
    profile: result.profile,
  });
}
