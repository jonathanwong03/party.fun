
import { createPledge, quotePledge } from '../services/eventService.js';

const PLEDGE_MESSAGES = {
  not_found: 'Event not found.',
  event_cancelled: 'This event has been cancelled.',
  own_event: 'You cannot pledge for your own event.',
  active_booking_exists: 'Give away all active tickets before pledging for this event again.',
  not_enough_tickets: 'Not enough tickets are available.',
};

export async function getQuote(req, res) {
  // Quotes are public (used on the checkout screen before committing).
  const quote = await quotePledge(req.supabase, req.params.eventId, req.query.qty);
  if (!quote) {
    res.status(404).json({ status: 'not_found', route: req.originalUrl, message: 'Event not found.' });
    return;
  }
  if (quote.error) {
    res.status(409).json({ status: quote.error, message: 'Not enough tickets are available.' });
    return;
  }
  res.json(quote);
}

export async function postPledge(req, res) {
  const result = await createPledge(req.supabase, req.user.id, req.params.eventId, req.body.qty);
  if (result.error) {
    res.status(result.error === 'not_found' ? 404 : 409).json({
      status: result.error,
      message: PLEDGE_MESSAGES[result.error] ?? 'Unable to complete pledge.',
    });
    return;
  }
  res.json({ status: 'ok', event: result.event, profile: result.profile, reference: result.reference });
}
