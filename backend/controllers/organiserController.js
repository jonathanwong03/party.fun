import { createPlaceholderHandler } from '../utils/apiPlaceholder.js';
import {
  createEvent,
  updateEvent,
  deleteEvent as removeEvent,
  hideEvent as hideEventService,
  listDrafts,
  saveDraft,
  deleteDraft as removeDraft,
  getHostedSummary,
  listCoOrganiserInvites,
  inviteCoOrganiser,
  respondCoOrganiserInvite,
  getAllAttendees as readAllAttendees,
} from '../services/eventService.js';
import { cancelEventWithRefunds } from '../services/eventCancellationService.js';
import { notifyCoOrganiserInvite, notifyEventCreated, notifyEventUpdated } from '../services/notificationService.js';
import { adminClient } from '../services/supabaseAdmin.js';

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

// Snapshot the editable fields of an event (service-role read) so an edit can be diffed.
async function loadEventSnapshot(admin, eventId) {
  const [{ data: e }, { data: s }, { data: ps }] = await Promise.all([
    admin.from('EVENT').select('title, description, location, address, startDate, endDate, imageUrl').eq('id', eventId).single(),
    admin.from('EVENT_SETTINGS').select('hypeThreshold, maxCapacity, deadline').eq('eventId', eventId).single(),
    admin.from('PRICE_STATUSES').select('statusName, price').eq('eventId', eventId),
  ]);
  const early = (ps ?? []).find((p) => p.statusName === 'early_bird');
  const greenlit = (ps ?? []).find((p) => p.statusName === 'greenlit');
  return { e: e ?? {}, s: s ?? {}, earlyPrice: early?.price, greenlitPrice: greenlit?.price };
}

// Build a human-readable list of what changed between a snapshot and the edit payload.
function diffEvent(before, body) {
  const out = [];
  const sEq = (a, b) => String(a ?? '') === String(b ?? '');
  const tEq = (a, b) => a && b && Math.floor(new Date(a).getTime() / 60000) === Math.floor(new Date(b).getTime() / 60000);
  const be = before.e, bs = before.s;
  if (!sEq(be.title, body.title)) out.push({ label: 'Title', from: be.title || '—', to: body.title || '—' });
  if (!sEq(be.description, body.description)) out.push({ label: 'Description', from: '(previous)', to: '(updated)' });
  if (!sEq(be.location, body.location)) out.push({ label: 'Venue', from: be.location || '—', to: body.location || '—' });
  if (!sEq(be.address, body.address)) out.push({ label: 'Address', from: be.address || 'none', to: body.address || 'none' });
  if (!sEq(be.imageUrl, body.image)) out.push({ label: 'Image', from: be.imageUrl ? '(previous image)' : 'none', to: body.image ? '(updated image)' : 'none' });
  if (body.startsAt && !tEq(be.startDate, body.startsAt)) out.push({ label: 'Start', from: fmtDateTime(be.startDate), to: fmtDateTime(body.startsAt) });
  if (body.endsAt && !tEq(be.endDate, body.endsAt)) out.push({ label: 'End', from: fmtDateTime(be.endDate), to: fmtDateTime(body.endsAt) });
  if (body.deadlineAt && bs.deadline && !tEq(bs.deadline, body.deadlineAt)) out.push({ label: 'Deadline', from: fmtDateTime(bs.deadline), to: fmtDateTime(body.deadlineAt) });
  if (body.hypeThreshold != null && !sEq(bs.hypeThreshold, body.hypeThreshold)) out.push({ label: 'Hype threshold', from: `${bs.hypeThreshold}`, to: `${body.hypeThreshold}` });
  if (body.maxCapacity != null && !sEq(bs.maxCapacity, body.maxCapacity)) out.push({ label: 'Capacity', from: `${bs.maxCapacity}`, to: `${body.maxCapacity}` });
  const be2 = (body.statuses ?? []).find((s) => s.statusName === 'early_bird');
  const bg2 = (body.statuses ?? []).find((s) => s.statusName === 'greenlit');
  if (be2 && !sEq(before.earlyPrice, be2.price)) out.push({ label: 'Early bird price', from: `$${Number(before.earlyPrice ?? 0).toFixed(2)}`, to: `$${Number(be2.price).toFixed(2)}` });
  if (bg2 && !sEq(before.greenlitPrice, bg2.price)) out.push({ label: 'Greenlit price', from: `$${Number(before.greenlitPrice ?? 0).toFixed(2)}`, to: `$${Number(bg2.price).toFixed(2)}` });
  return out;
}

// Every distinct backer (live booking) of an event, with contact info (service-role read).
async function gatherEventBackers(admin, eventId) {
  const { data: bookings } = await admin.from('BOOKINGS').select('userId').eq('eventId', eventId).is('deletedAt', null);
  const ids = [...new Set((bookings ?? []).map((b) => b.userId))];
  if (!ids.length) return [];
  const { data: users } = await admin.from('USER').select('email, username, role').in('id', ids);
  return (users ?? []).filter((u) => u.email).map((u) => ({ email: u.email, username: u.username, role: u.role }));
}

// Human-readable messages for the authoritative validation codes the RPCs return.
const EVENT_ERROR_MESSAGES = {
  price_order: 'Greenlit price must be higher than the Early Birds price.',
  hype_pricing_invalid: 'Set a max price higher than the base price.',
  pricing_locked: "The pricing system can't be changed after event creation.",
  pricing_model_locked: "The pricing system can't be changed after event creation.",
  bad_schedule: 'The event end must be after its start.',
  deadline_after_start: 'The deadline must be before the event start.',
  not_future: 'Event start and deadline must be in the future.',
  not_organiser: 'Only organisers can create events.',
  not_found: 'Event not found.',
  reason_required: 'A cancellation reason is required.',
  event_started: "You can't cancel an event that has already started.",
  not_owner: 'Only the event owner can manage co-organisers.',
  invitee_not_found: 'No organiser account found for that email or username.',
  invite_self: "You can't invite yourself as a co-organiser.",
  invalid_action: 'Invalid invite action.',
  not_invitee: 'This invite does not belong to your account.',
  not_pending: 'This invite has already been responded to.',
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

export async function getCoOrganiserInvites(req, res) {
  try {
    res.json(await listCoOrganiserInvites(req.supabase, req.user.id));
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
}

export async function postCoOrganiserInvite(req, res) {
  const identifier = String(req.body?.identifier ?? '').trim();
  if (!identifier) {
    res.status(400).json({ status: 'identifier_required', message: 'Enter an organiser email or username.' });
    return;
  }

  const result = await inviteCoOrganiser(req.supabase, req.params.eventId, identifier);
  if (result?.error) {
    res.status(400).json({ status: result.error, message: eventErrorMessage(result.error, 'Unable to invite co-organiser.') });
    return;
  }

  if (result?.inviteeEmail) {
    notifyCoOrganiserInvite({
      email: result.inviteeEmail,
      username: result.inviteeUsername,
      inviterName: result.ownerUsername,
      eventTitle: result.eventTitle,
      eventId: result.eventId,
    });
  }

  res.status(201).json(result);
}

export async function acceptCoOrganiserInvite(req, res) {
  const result = await respondCoOrganiserInvite(req.supabase, req.params.inviteId, 'accept');
  if (result?.error) {
    res.status(400).json({ status: result.error, message: eventErrorMessage(result.error, 'Unable to accept invite.') });
    return;
  }
  res.json(result);
}

export async function declineCoOrganiserInvite(req, res) {
  const result = await respondCoOrganiserInvite(req.supabase, req.params.inviteId, 'decline');
  if (result?.error) {
    res.status(400).json({ status: result.error, message: eventErrorMessage(result.error, 'Unable to decline invite.') });
    return;
  }
  res.json(result);
}

// Aggregated attendee list across all of the organiser's events (cached per-user).
export async function getAllAttendees(req, res) {
  try {
    res.json(await readAllAttendees(req.supabase, req.user.id));
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
}

// Tickets for one of the organiser's events (check-in list). NOT cached — this is the
// live door check-in view and must reflect scans in real time.
export async function getEventTickets(req, res) {
  const { data, error } = await req.supabase.rpc('get_event_tickets', { p_event_id: req.params.eventId });
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  res.json(data ?? []);
}

// Door check-in. A per-ticket QR (PF-… code) checks in one ticket; a booking QR
// (a bare uuid token) checks in all of that booking's remaining active tickets.
export async function postCheckIn(req, res) {
  const code = String(req.body?.qr ?? '').trim();
  const isTicketCode = code.startsWith('PF-');
  const { data, error } = isTicketCode
    ? await req.supabase.rpc('check_in_ticket', { p_qr: code })
    : await req.supabase.rpc('check_in_booking', { p_token: code });
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  res.json(data);
}

export async function getDrafts(req, res) {
  res.json(await listDrafts(req.supabase, req.user.id));
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
  const eventId = req.params.eventId;
  const admin = adminClient();
  const before = await loadEventSnapshot(admin, eventId);

  const result = await updateEvent(req.supabase, { ...req.body, id: eventId });
  if (result.error) {
    // A stale edit (someone else saved first) or an edit to a dead event is a 409, not a plain 400.
    const status = result.error === 'conflict' || result.error === 'not_editable' ? 409 : 400;
    let message;
    if (result.error === 'conflict') {
      message = 'This event changed since you opened it. Reload to see the latest, then re-apply your edit.';
    } else if (result.error === 'not_editable') {
      message = 'This event is cancelled or completed and can no longer be edited.';
    } else {
      message = eventErrorMessage(result.error, 'Unable to update event.');
    }
    res.status(status).json({ status: result.error, message });
    return;
  }
  res.json({ status: 'ok' });

  // Fire-and-forget: notify the organiser + every backer of what changed (organiser or admin edit).
  const changes = diffEvent(before, req.body);
  if (changes.length) {
    const [{ data: me }, { data: ev }] = await Promise.all([
      admin.from('USER').select('role').eq('id', req.user.id).single(),
      admin.from('EVENT').select('title, hostId').eq('id', eventId).single(),
    ]);
    const editedByAdmin = me?.role === 'admin';
    const { data: host } = await admin.from('USER').select('email, username, role').eq('id', ev?.hostId).single();
    const backers = await gatherEventBackers(admin, eventId);
    notifyEventUpdated({ eventTitle: ev?.title ?? 'your event', changes, editedByAdmin, organiser: host?.email ? host : null, backers });
  }
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
  const result = await cancelEventWithRefunds(req.supabase, req.user.id, req.params.eventId, req.body?.reason);
  if (result.error) {
    res.status(400).json({ status: result.error, message: eventErrorMessage(result.error, 'Unable to cancel event.') });
    return;
  }
  res.json({ status: 'ok' });
}
