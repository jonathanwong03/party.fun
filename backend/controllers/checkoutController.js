import * as eventService from '../services/eventService.js';
import * as notificationService from '../services/notificationService.js';

export const dependencies = {
  getEvent: eventService.getEvent,
  quotePledge: eventService.quotePledge,
  createPledge: eventService.createPledge,
  notifyPledgeConfirmed: notificationService.notifyPledgeConfirmed,
  notifyEventGreenlit: notificationService.notifyEventGreenlit,
};

const PLEDGE_MESSAGES = {
  not_found: 'Event not found.',
  own_event: 'You cannot pledge for your own event.',
  active_booking_exists: 'Give away all active tickets before pledging for this event again.',
  not_enough_tickets: 'Not enough tickets are available.',
};

export async function getQuote(req, res) {
  // Quotes are public (used on the checkout screen before committing).
  const quote = await dependencies.quotePledge(req.supabase, req.params.eventId, req.query.qty);
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
  const eventBefore = await dependencies.getEvent(req.supabase, req.params.eventId, req.user.id);
  const result = await dependencies.createPledge(req.supabase, req.user.id, req.params.eventId, req.body.qty);
  if (result.error) {
    res.status(result.error === 'not_found' ? 404 : 409).json({
      status: result.error,
      message: PLEDGE_MESSAGES[result.error] ?? 'Unable to complete pledge.',
    });
    return;
  }

  const profile = result.profile?.profile;
  const qty = Number(req.body.qty) || 1;
  const pricePerTicket = result.event?.price ?? 0;
  if (profile) {
    void dependencies.notifyPledgeConfirmed({
      userId: req.user.id,
      email: profile.email,
      username: profile.handle || profile.fullName,
      eventId: req.params.eventId,
      eventTitle: result.event?.title ?? eventBefore?.title ?? 'your event',
      deadline: result.event?.deadline ?? eventBefore?.deadline ?? '',
      qty,
      pricePerTicket,
    });
  }

  if (eventBefore?.status !== 'greenlit' && result.event?.status === 'greenlit') {
    void dependencies.notifyEventGreenlit(req.params.eventId, result.event);
  }

  res.json({ status: 'ok', event: result.event, profile: result.profile });
}
