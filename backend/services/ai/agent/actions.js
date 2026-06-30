import { mapEventRow, updateEvent, inviteCoOrganiser } from '../../eventService.js';
import { notifyEventUpdated, notifyCoOrganiserInvite } from '../../notificationService.js';

// Executes a user-CONFIRMED agent action. Runs through the caller's own
// (user-scoped) Supabase client so RLS + the RPCs re-enforce ownership/validation;
// we also re-check ownership here. Never trusts the proposal blindly.

const ACTIONS = new Set(['adjust_pricing', 'invite_coorganiser']);

const ERROR_MESSAGES = {
  price_order: 'Greenlit price must be higher than the Early Birds price.',
  hype_pricing_invalid: 'Set a max price higher than the base price.',
  pricing_locked: "The pricing system can't be changed after event creation.",
  not_owner: 'You can only manage events you host.',
  not_found: 'Event not found.',
  invitee_not_found: 'No organiser account found for that email or username.',
  invite_self: "You can't invite yourself as a co-organiser.",
};
const msg = (code, fallback) => ERROR_MESSAGES[code] ?? fallback;
const money = (n) => `$${Number(n ?? 0).toFixed(2)}`;

export async function executeAction({ sb, user, action, eventId, payload }) {
  if (!ACTIONS.has(action)) return { error: 'invalid_action', message: 'Unknown action.' };
  if (!eventId) return { error: 'bad_request', message: 'Missing event id.' };

  const { data: rows, error } = await sb.rpc('get_events');
  if (error) return { error: 'error', message: error.message };
  const row = (rows ?? []).find((r) => r.id === eventId);
  if (!row) return { error: 'not_found', message: 'Event not found.' };
  if (row.hostId !== user.id) return { error: 'not_owner', message: ERROR_MESSAGES.not_owner };
  const item = mapEventRow(row, user.id);
  if (item.status === 'cancelled' || item.status === 'completed') {
    return { error: 'locked', message: 'This event can no longer be edited.' };
  }

  if (action === 'adjust_pricing') {
    const early = payload?.earlyPrice != null ? Number(payload.earlyPrice) : null;
    const greenlit = payload?.greenlitPrice != null ? Number(payload.greenlitPrice) : null;
    if (early == null && greenlit == null) return { error: 'no_change', message: 'No new price provided.' };
    if (early != null && (!Number.isFinite(early) || early < 0)) return { error: 'bad_price', message: 'Prices must be non-negative.' };
    if (greenlit != null && (!Number.isFinite(greenlit) || greenlit < 0)) return { error: 'bad_price', message: 'Prices must be non-negative.' };

    const priceOf = (name) => item.statuses.find((s) => s.statusName === name)?.price;
    const statuses = item.statuses.map((s) => ({
      statusName: s.statusName,
      qty: s.qty,
      price: s.statusName === 'early_bird' && early != null ? early
        : s.statusName === 'greenlit' && greenlit != null ? greenlit
          : s.price,
    }));

    const result = await updateEvent(sb, {
      id: eventId,
      title: item.title,
      description: item.description,
      location: item.location,
      address: item.address,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      deadlineAt: item.deadlineAt,
      image: item.image,
      hypeThreshold: item.hypeThreshold,
      maxCapacity: item.maxCapacity,
      statuses,
      restrictToUniversity: !!item.restrictedUniversity,
      hypeDrivenPricing: item.hypeDrivenPricing,
      basePrice: item.basePrice,
      maxPrice: item.maxPrice,
    });
    if (result?.error) return { error: result.error, message: msg(result.error, 'Unable to update pricing.') };

    const changes = [];
    if (early != null) changes.push({ label: 'Early bird price', from: money(priceOf('early_bird')), to: money(early) });
    if (greenlit != null) changes.push({ label: 'Greenlit price', from: money(priceOf('greenlit')), to: money(greenlit) });
    const { data: me } = await sb.from('USER').select('email, username, role').eq('id', user.id).single();
    notifyEventUpdated({ eventTitle: item.title, changes, organiser: me?.email ? me : null, backers: [] });

    return { status: 'ok', message: `Updated pricing for "${item.title}".` };
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
