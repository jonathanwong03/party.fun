import { createPlaceholderHandler } from '../utils/apiPlaceholder.js';
import { createPledge, quotePledge } from '../services/eventMemoryService.js';
import { requireMockRole } from '../services/mockAuth.js';

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
  if (quote.error) {
    res.status(409).json({ status: quote.error, message: 'Not enough tickets are available.' });
    return;
  }
  res.json(quote);
}

export function postPledge(req, res) {
  const auth = requireMockRole(req, res);
  if (!auth) return;

  const result = createPledge({
    userId: auth.userId,
    eventId: req.params.eventId,
    qty: req.body.qty,
  });

  if (result.error) {
    const messages = {
      not_found: 'Event not found.',
      own_event: 'You cannot pledge for your own event.',
      active_booking_exists: 'Give away all active tickets before pledging for this event again.',
      not_enough_tickets: 'Not enough tickets are available.',
    };
    res.status(result.error === 'not_found' ? 404 : 409).json({ status: result.error, message: messages[result.error] });
    return;
  }

  res.json({
    status: 'ok',
    event: result.event,
    profile: result.profile,
  });
}
