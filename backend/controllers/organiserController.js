import { createPlaceholderHandler } from '../utils/apiPlaceholder.js';
import {
  createEvent,
  updateEvent,
  deleteEvent as removeEvent,
  cancelEvent as cancelEventService,
  hideEvent as hideEventService,
  listDrafts,
  saveDraft,
  deleteDraft as removeDraft,
  getHostedSummary,
} from '../services/eventService.js';
import { notifyEventCreated, notifyEventCancelled } from '../services/notificationService.js';
import { refundEventCardBookings } from '../services/stripeRefunds.js';

// Human-readable messages for the authoritative validation codes the RPCs return.
const EVENT_ERROR_MESSAGES = {
  price_order: 'Greenlit price must be higher than the Early Birds price.',
  bad_schedule: 'The event end must be after its start.',
  deadline_after_start: 'The deadline must be before the event start.',
  not_future: 'Event start and deadline must be in the future.',
  not_organiser: 'Only organisers can create events.',
  not_found: 'Event not found.',
  reason_required: 'A cancellation reason is required.',
  event_started: "You can't cancel an event that has already started.",
};
const eventErrorMessage = (code, fallback) => EVENT_ERROR_MESSAGES[code] ?? fallback;

// The organiser console reads its events from the shared events list (filtered to
// `mine`), so these GET endpoints are unused by the frontend and stay as stubs.
export const getHostedEvents = createPlaceholderHandler('organiser-hosted-events');
export const getCreateEvent = createPlaceholderHandler('create-event');
export const getEditEvent = createPlaceholderHandler('edit-event');

export async function getSummary(req, res) {
  res.json(await getHostedSummary(req.supabase, req.user.id));
}

export async function getDrafts(req, res) {
  res.json(await listDrafts(req.supabase));
}

export async function postDraft(req, res) {
  const draft = await saveDraft(req.supabase, req.user.id, req.body);
  res.json(draft);
}

export async function deleteDraftHandler(req, res) {
  await removeDraft(req.supabase, req.params.draftId);
  res.json({ status: 'ok' });
}

export async function postCreateEvent(req, res) {
  const result = await createEvent(req.supabase, req.body);
  if (result.error) {
    res.status(400).json({ status: result.error, message: eventErrorMessage(result.error, 'Unable to create event.') });
    return;
  }
  // Fire-and-forget "event created" email to the organiser.
  const { data: me } = await req.supabase.from('USER').select('email, username').eq('id', req.user.id).single();
  if (me?.email) {
    notifyEventCreated({
      email: me.email,
      organiserName: me.username,
      eventTitle: req.body.title,
      eventId: result.eventId,
      hypeThreshold: req.body.hypeThreshold,
      deadline: req.body.deadlineAt,
    });
  }

  res.status(201).json({ status: 'ok', eventId: result.eventId });
}

export async function patchEvent(req, res) {
  const result = await updateEvent(req.supabase, { ...req.body, id: req.params.eventId });
  if (result.error) {
    res.status(400).json({ status: result.error, message: eventErrorMessage(result.error, 'Unable to update event.') });
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

export async function postHideEvent(req, res) {
  const result = await hideEventService(req.supabase, req.params.eventId);
  if (result.error) {
    res.status(result.error === 'not_found' ? 404 : 400).json({ status: result.error, message: eventErrorMessage(result.error, 'Unable to remove event.') });
    return;
  }
  res.json({ status: 'ok' });
}

export async function postCancelEvent(req, res) {
  const eventId = req.params.eventId;
  // Reason is optional in the UI; default it so the RPC's reason_required never trips.
  const reason = (req.body?.reason ?? '').trim() || 'Cancelled by the organiser';
  const result = await cancelEventService(req.supabase, eventId, reason);
  if (result.error) {
    res.status(400).json({ status: result.error, message: eventErrorMessage(result.error, 'Unable to cancel event.') });
    return;
  }

  // Card-paid backers get a real Stripe refund to their card (wallet refunds done in the RPC).
  await refundEventCardBookings(eventId);

  // Fire-and-forget: email every refunded backer + the organiser. Runs after the
  // cancel RPC so refundedAmount is set; get_event_backer_contacts is host-only.
  const [{ data: ev }, { data: me }, { data: backers }] = await Promise.all([
    req.supabase.from('EVENT').select('title').eq('id', eventId).single(),
    req.supabase.from('USER').select('email, username').eq('id', req.user.id).single(),
    req.supabase.rpc('get_event_backer_contacts', { p_event_id: eventId }),
  ]);
  notifyEventCancelled({
    eventTitle: ev?.title ?? 'your event',
    reason: 'organiser',
    backers: (backers ?? []).map((b) => ({ email: b.email, username: b.username, role: b.role, method: b.paymentMethod, refundAmount: b.refundAmount })),
    organiser: me?.email ? { email: me.email, username: me.username } : null,
  });

  res.json({ status: 'ok' });
}
