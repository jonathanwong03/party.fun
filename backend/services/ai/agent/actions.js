import { mapEventRow, updateEvent, inviteCoOrganiser, saveDraft } from '../../eventService.js';
import { notifyEventUpdated, notifyCoOrganiserInvite } from '../../notificationService.js';

// Executes a user-CONFIRMED agent action. Runs through the caller's own
// (user-scoped) Supabase client so RLS + the RPCs re-enforce ownership/validation;
// we also re-check ownership here. Never trusts the proposal blindly.

const ACTIONS = new Set(['update_event', 'create_event_draft', 'invite_coorganiser']);
const NEEDS_EVENT = new Set(['update_event', 'invite_coorganiser']); // create_event_draft has no event yet

const ERROR_MESSAGES = {
  price_order: 'Greenlit price must be higher than the Early Birds price.',
  hype_pricing_invalid: 'Set a max price higher than the base price.',
  pricing_locked: "The pricing system can't be changed after event creation.",
  bad_schedule: 'The event end must be after its start.',
  deadline_after_start: 'The deadline must be before the event start.',
  not_future: 'Event start and deadline must be in the future.',
  not_owner: 'You can only manage events you host.',
  not_found: 'Event not found.',
  invitee_not_found: 'No organiser account found for that email or username.',
  invite_self: "You can't invite yourself as a co-organiser.",
};
const msg = (code, fallback) => ERROR_MESSAGES[code] ?? fallback;
const money = (n) => `$${Number(n ?? 0).toFixed(2)}`;

export async function executeAction({ sb, user, action, eventId, payload }) {
  if (!ACTIONS.has(action)) return { error: 'invalid_action', message: 'Unknown action.' };

  // ── Create a DRAFT (no existing event / ownership check needed) ──────────────
  if (action === 'create_event_draft') {
    const p = payload ?? {};
    const title = String(p.title ?? '').trim();
    if (!title) return { error: 'title_required', message: 'An event title is required.' };
    const draft = {
      title,
      description: p.description ?? '',
      location: p.venue ?? '',
      address: p.address ?? '',
      startsAt: p.startDate ?? '',
      endsAt: p.endDate ?? '',
      deadlineAt: p.deadline ?? '',
      maxCapacity: p.capacity ?? 0,
      hypeThreshold: p.hypeThreshold ?? 0,
      restrictedUniversity: p.university ?? '',
      hypeDrivenPricing: false,
      statuses: [
        { statusName: 'early_bird', price: p.earlyPrice ?? 0, qty: p.hypeThreshold ?? 0 },
        { statusName: 'greenlit', price: p.greenlitPrice ?? 0, qty: p.capacity ?? 0 },
      ],
    };
    try {
      const saved = await saveDraft(sb, user.id, draft);
      return { status: 'ok', message: `Saved "${title}" as a draft — review and publish it from your Drafts.`, draftId: saved?.id };
    } catch (e) {
      return { error: 'error', message: e?.message ?? 'Unable to save the draft.' };
    }
  }

  // ── Actions that operate on an existing, owned event ─────────────────────────
  if (NEEDS_EVENT.has(action) && !eventId) return { error: 'bad_request', message: 'Missing event id.' };
  const { data: rows, error } = await sb.rpc('get_events');
  if (error) return { error: 'error', message: error.message };
  const row = (rows ?? []).find((r) => r.id === eventId);
  if (!row) return { error: 'not_found', message: 'Event not found.' };
  if (row.hostId !== user.id) return { error: 'not_owner', message: ERROR_MESSAGES.not_owner };
  const item = mapEventRow(row, user.id);
  if (item.status === 'cancelled' || item.status === 'completed') {
    return { error: 'locked', message: 'This event can no longer be edited.' };
  }

  if (action === 'update_event') {
    const p = payload ?? {};
    for (const n of ['maxCapacity', 'hypeThreshold', 'earlyPrice', 'greenlitPrice']) {
      if (p[n] != null && (!Number.isFinite(Number(p[n])) || Number(p[n]) < 0)) return { error: 'bad_value', message: `${n} must be non-negative.` };
    }
    const early = p.earlyPrice != null ? Number(p.earlyPrice) : null;
    const greenlit = p.greenlitPrice != null ? Number(p.greenlitPrice) : null;
    const priceOf = (name) => item.statuses.find((s) => s.statusName === name)?.price;
    const statuses = item.statuses.map((s) => ({
      statusName: s.statusName,
      qty: s.qty,
      price: s.statusName === 'early_bird' && early != null ? early
        : s.statusName === 'greenlit' && greenlit != null ? greenlit
          : s.price,
    }));

    // Merge only the provided fields onto the current event (update_event replaces all).
    const result = await updateEvent(sb, {
      id: eventId,
      title: p.title ?? item.title,
      description: p.description ?? item.description,
      location: p.venue ?? item.location,
      address: p.address ?? item.address,
      startsAt: p.startDate ?? item.startsAt,
      endsAt: p.endDate ?? item.endsAt,
      deadlineAt: p.deadline ?? item.deadlineAt,
      image: item.image,
      hypeThreshold: p.hypeThreshold ?? item.hypeThreshold,
      maxCapacity: p.maxCapacity ?? item.maxCapacity,
      statuses,
      restrictToUniversity: !!item.restrictedUniversity,
      hypeDrivenPricing: item.hypeDrivenPricing,
      basePrice: item.basePrice,
      maxPrice: item.maxPrice,
    });
    if (result?.error) return { error: result.error, message: msg(result.error, 'Unable to update the event.') };

    const changes = [];
    const push = (label, from, to) => changes.push({ label, from: String(from ?? '—'), to: String(to ?? '—') });
    if (p.title != null) push('Title', item.title, p.title);
    if (p.description != null) push('Description', '(previous)', '(updated)');
    if (p.venue != null) push('Venue', item.location, p.venue);
    if (p.address != null) push('Address', item.address, p.address);
    if (p.startDate != null) push('Start', item.startsAt, p.startDate);
    if (p.endDate != null) push('End', item.endsAt, p.endDate);
    if (p.deadline != null) push('Deadline', item.deadlineAt, p.deadline);
    if (p.maxCapacity != null) push('Capacity', item.maxCapacity, p.maxCapacity);
    if (p.hypeThreshold != null) push('Hype threshold', item.hypeThreshold, p.hypeThreshold);
    if (early != null) push('Early bird price', money(priceOf('early_bird')), money(early));
    if (greenlit != null) push('Greenlit price', money(priceOf('greenlit')), money(greenlit));
    if (changes.length) {
      const { data: me } = await sb.from('USER').select('email, username, role').eq('id', user.id).single();
      notifyEventUpdated({ eventTitle: p.title ?? item.title, changes, organiser: me?.email ? me : null, backers: [] });
    }
    return { status: 'ok', message: `Updated "${p.title ?? item.title}".` };
  }

  if (action === 'invite_coorganiser') {
    const identifier = String(payload?.identifier ?? '').trim();
    if (!identifier) return { error: 'identifier_required', message: 'Provide an email or username.' };
    const r = await inviteCoOrganiser(sb, eventId, identifier);
    if (r?.error) return { error: r.error, message: msg(r.error, 'Unable to invite co-organiser.') };
    if (r?.inviteeEmail) {
      notifyCoOrganiserInvite({ email: r.inviteeEmail, username: r.inviteeUsername, inviterName: r.ownerUsername, eventTitle: r.eventTitle, eventId: r.eventId });
    }
    return { status: 'ok', message: `Invited ${identifier} as a co-organiser of "${item.title}".` };
  }

  return { error: 'invalid_action', message: 'Unknown action.' };
}

export const ACTION_WHITELIST = ACTIONS;
