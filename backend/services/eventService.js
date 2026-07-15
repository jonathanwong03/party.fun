// Supabase-backed data service. Every function receives a user-scoped Supabase
// client (`sb`) so the existing RLS policies and SECURITY DEFINER RPC functions
// enforce access. The backend is a thin, authenticated pass-through to those RPCs;
// the business logic stays in Postgres where it already works atomically.

import { quoteTotal, ticketPrice, validateHypePricingConfig } from '../utils/pricingCalculator.js';
import { syncEventEmbedding } from './ai/eventEmbeddings.js';
import { syncDraftEmbedding, deleteDraftEmbedding } from './ai/draftEmbeddings.js';
import { cacheGetJson, cacheSetJson, cacheDel, cacheDelByPrefix, withCache } from './cache.js';

export const dependencies = {
  syncEventEmbedding,
  syncDraftEmbedding,
  deleteDraftEmbedding,
};


const LABELS = { early_bird: 'Early Birds', greenlit: 'Greenlit' };

// Public event listing is read-hot (every Landing load) but write-hot too (hype
// counts change on each pledge), so we use a short TTL plus explicit invalidation
// on writes. RLS makes the mapped rows viewer-specific (mine/canEdit/…), so anon
// callers share one key while signed-in callers are keyed by user id.
const EVENTS_TTL_S = 45;
const eventsCacheKey = (userId) => (userId == null ? 'events:list:anon' : `events:list:u:${userId}`);
const rawEventsCacheKey = (userId) => (userId == null ? 'events:raw:anon' : `events:raw:u:${userId}`);

// Raw get_events rows, cached in Redis with the same 45s TTL + write-invalidation as
// the mapped listEvents cache. The AI agent's tools need the RAW RPC shape
// (derived_status, active_ticket_count, statuses[].ticketCapacity, hostId, …), which
// differs from the mapped EventItem, so this is a separate cache entry. Cache-first,
// Supabase on miss — and fails open to Supabase when Redis is off (via cacheGetJson).
export async function listEventsRaw(sb, userId) {
  const cacheKey = rawEventsCacheKey(userId);
  const cached = await cacheGetJson(cacheKey);
  if (cached != null) return cached;
  const { data, error } = await sb.rpc('get_events');
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  await cacheSetJson(cacheKey, rows, EVENTS_TTL_S);
  return rows;
}

// Drop every cached event list (mapped + raw) and the shared read caches that reflect
// event / hype / attendee / revenue / analytics changes, so the next read (UI or agent)
// is fresh after a mutation. Short TTLs bound anything a broad prefix-clear misses.
async function invalidateEventCaches() {
  await Promise.all([
    cacheDel('events:list:anon'),
    cacheDelByPrefix('events:list:u:'),
    cacheDelByPrefix('events:raw:'),
    cacheDelByPrefix('data:attendees:'),
    cacheDelByPrefix('data:hostsummary:'),
    cacheDelByPrefix('data:hostrev:'),
    cacheDelByPrefix('data:profile:'),
    cacheDelByPrefix('data:analytics:'),
    cacheDelByPrefix('data:allattendees:'),
    cacheDelByPrefix('data:calculator:'),
    cacheDelByPrefix('data:invites:'),
  ]);
}

function sgDate(iso, opts) {
  return new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', ...opts }).format(new Date(iso));
}

const money = (n) => `$${Number(n).toFixed(2)}`;
// "Thursday, 18 June"
const sgLong = (iso) => sgDate(iso, { weekday: 'long', day: 'numeric', month: 'long' });
// "12:02pm"
const sgClock = (iso) => sgDate(iso, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s/g, '').toLowerCase();

// Maps a raw `get_events` row into the EventItem shape the frontend renders.
export function mapEventRow(row, userId) {
  const statuses = Array.isArray(row.statuses) ? row.statuses : [];

  const eb = statuses.find((s) => s.statusName === 'early_bird');
  const activeName = eb && eb.sold >= eb.ticketCapacity ? 'greenlit' : 'early_bird';
  const current = statuses.find((s) => s.statusName === activeName) ?? statuses[0];

  const activeTicketCount = row.active_ticket_count ?? 0;
  const hypeThreshold = row.hypeThreshold ?? 1;
  const maxCapacity = row.maxCapacity ?? 0;
  const hypeDrivenPricing = Boolean(row.hypeDrivenPricing ?? row.hype_driven_pricing);
  const basePrice = row.basePrice ?? row.base_price ?? null;
  const maxPrice = row.maxPrice ?? row.max_price ?? null;

  let currentDynamicPrice = row.current_dynamic_price ?? row.currentDynamicPrice ?? null;
  if (currentDynamicPrice == null && hypeDrivenPricing && basePrice != null && maxPrice != null) {
    try {
      currentDynamicPrice = roundMoney(ticketPrice(activeTicketCount, {
        basePrice: Number(basePrice),
        maxPrice: Number(maxPrice),
        maxCapacity,
      }));
    } catch {
      currentDynamicPrice = null;
    }
  } else if (currentDynamicPrice != null) {
    currentDynamicPrice = roundMoney(currentDynamicPrice);
  }

  const staticPrice = current?.price ?? 0;
  const displayPrice = hypeDrivenPricing && currentDynamicPrice != null ? currentDynamicPrice : staticPrice;

  return {
    id: row.id,
    hostId: row.hostId,
    title: row.title ?? '',
    organiser: row.organiser_name ?? 'Unknown',
    hostUniversity: row.host_university ?? '',
    restrictedUniversity: row.restricted_university ?? '',
    canAttendUniversity: row.viewer_can_attend !== false,
    date: row.startDate ? sgDate(row.startDate, { weekday: 'short', month: 'short', day: 'numeric' }) : '',
    time: row.startDate ? sgDate(row.startDate, { hour: 'numeric', minute: '2-digit', hour12: true }) : '',
    endTime: row.endDate ? sgDate(row.endDate, { hour: 'numeric', minute: '2-digit', hour12: true }) : '',
    endDate: row.endDate ? sgDate(row.endDate, { weekday: 'short', month: 'short', day: 'numeric' }) : '',
    startsAt: row.startDate ?? '',
    endsAt: row.endDate ?? '',
    deadlineAt: row.deadlineAt ?? '',
    // Long date + compact time strings for the detail page cards.
    startLong: row.startDate ? sgLong(row.startDate) : '',
    startClock: row.startDate ? sgClock(row.startDate) : '',
    endLong: row.endDate ? sgLong(row.endDate) : '',
    endClock: row.endDate ? sgClock(row.endDate) : '',
    location: row.location ?? '',
    address: row.address ?? '',
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    description: row.description ?? '',
    image: row.imageUrl ?? '',
    price: displayPrice,
    statusLabel: LABELS[activeName] ?? 'Early Birds',
    hypePercentage: Math.min(100, Math.round((activeTicketCount / hypeThreshold) * 100)),
    // Uncapped fill ratio for the "most hyped" pick (106% beats 105% though both display 100%).
    hypeRatio: hypeThreshold > 0 ? activeTicketCount / hypeThreshold : 0,
    hypeThreshold,
    activeTicketCount,
    maxCapacity,
    spotsLeft: Math.max(0, maxCapacity - activeTicketCount),
    status: row.derived_status ?? 'early_bird',
    deadline: row.deadlineAt
      ? sgDate(row.deadlineAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
      : '',
    statuses: statuses.map((s) => ({
      statusName: s.statusName,
      label: LABELS[s.statusName] ?? s.statusName,
      price: s.price,
      qty: s.ticketCapacity,
      sold: s.sold,
      // Tier fill % computed in the backend; the frontend renders the bar from this.
      fillPct: s.ticketCapacity > 0 ? (s.sold / s.ticketCapacity) * 100 : 0,
    })),
    mine: userId != null ? row.hostId === userId : undefined,
    hostHidden: row.hostHidden ?? false,
    hypeDrivenPricing,
    basePrice: basePrice != null ? Number(basePrice) : null,
    maxPrice: maxPrice != null ? Number(maxPrice) : null,
    currentDynamicPrice,
    hype_driven_pricing: hypeDrivenPricing,
    base_price: basePrice != null ? Number(basePrice) : null,
    max_price: maxPrice != null ? Number(maxPrice) : null,
    current_dynamic_price: currentDynamicPrice,
    isCoOrganiser: !!row.isCoOrganiser,
    canEdit: !!row.canEdit,
    canCheckIn: !!row.canCheckIn,
    canViewAttendees: !!row.canViewAttendees,
    canCancel: !!row.canCancel,
    canDelete: !!row.canDelete,
  };
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function listEvents(sb, userId) {
  const cacheKey = eventsCacheKey(userId);
  const cached = await cacheGetJson(cacheKey);
  if (cached != null) return cached;

  const { data, error } = await sb.rpc('get_events');
  if (error) throw new Error(error.message);
  const events = (data ?? []).map((row) => mapEventRow(row, userId));
  // Backend picks the single "most hyped" still-open event (highest hype ratio) so
  // the Landing page renders the feature card without recomputing the winner.
  let featured = null;
  for (const e of events) {
    if (e.mine || e.status === 'cancelled' || e.status === 'completed') continue;
    if (!featured || (e.hypeRatio ?? 0) > (featured.hypeRatio ?? 0)) featured = e;
  }
  if (featured) featured.featured = true;
  await cacheSetJson(cacheKey, events, EVENTS_TTL_S);
  return events;
}

export async function getEvent(sb, eventId, userId) {
  const events = await listEvents(sb, userId);
  return events.find((e) => e.id === eventId) ?? null;
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

// Ticket prices are GST-INCLUSIVE: the buyer pays the ticket total, with no separate GST
// line anywhere (quote, checkout, booking). See migrations/20260716_remove_gst.sql.

function pricingContextFromRow(row) {
  if (!row) return null;
  return {
    eventId: row.id,
    hypeDrivenPricing: Boolean(row.hypeDrivenPricing ?? row.hype_driven_pricing),
    basePrice: row.basePrice ?? row.base_price,
    maxPrice: row.maxPrice ?? row.max_price,
    maxCapacity: row.maxCapacity ?? row.max_capacity ?? 0,
    activeTicketCount: row.active_ticket_count ?? 0,
  };
}

async function fetchPricingContext(sb, eventId) {
  const { data, error } = await sb.rpc('get_events');
  if (error) throw new Error(error.message);
  const row = (data ?? []).find((item) => item.id === eventId);
  return pricingContextFromRow(row);
}

export function buildHypeDrivenQuote(eventId, qty, context) {
  const normalizedQty = Math.max(1, Math.floor(Number(qty) || 1));
  const config = {
    basePrice: Number(context.basePrice),
    maxPrice: Number(context.maxPrice),
    maxCapacity: Number(context.maxCapacity),
  };
  const validation = validateHypePricingConfig(config);
  if (validation.error) return { error: 'invalid_hype_pricing' };

  try {
    const curve = quoteTotal(context.activeTicketCount, normalizedQty, config);
    const lines = curve.unitPrices.map((price, index) => {
      const rounded = roundMoney(price);
      return {
        label: `Ticket ${context.activeTicketCount + index + 1}`,
        price: rounded,
        count: 1,
        subtotal: rounded,
        subtotalText: money(rounded),
      };
    });
    const subtotal = roundMoney(curve.total);
    return {
      eventId,
      qty: normalizedQty,
      pricingModel: 'hype_driven',
      activeTicketCount: context.activeTicketCount,
      lines,
      subtotal,
      total: subtotal,
      subtotalText: money(subtotal),
      totalText: money(subtotal),
    };
  } catch (err) {
    if (err.message === 'quote exceeds maxCapacity') {
      return { error: 'not_enough_tickets' };
    }
    throw err;
  }
}

export async function quotePledge(sb, eventId, qty) {
  const context = await fetchPricingContext(sb, eventId);
  if (!context) return null;

  if (context.hypeDrivenPricing) {
    return buildHypeDrivenQuote(eventId, qty, context);
  }

  const { data, error } = await sb.rpc('get_quote', { p_event_id: eventId, p_qty: Number(qty) });
  if (error) throw new Error(error.message);
  if (!data || data.error) return data; // { error: 'not_enough_tickets' } passes through
  const lines = (data.lines ?? []).map((l) => {
    const subtotal = Number(l.price) * Number(l.count);
    return { ...l, subtotal, subtotalText: money(subtotal) };
  });
  return { ...data, lines, subtotalText: money(data.subtotal), totalText: money(data.total) };
}

// RLS-scoped to the caller (auth.uid()); cache per-user so one user's cache never
// serves another's data. `userId` optional — omitted → live (keeps old callers/tests).
export async function getProfile(sb, userId = null) {
  const load = async () => {
    const { data, error } = await sb.rpc('get_profile');
    if (error) throw new Error(error.message);
    const tickets = data?.tickets ?? [];
    const counts = {
      upcoming: tickets.filter((t) => t.tab === 'upcoming').length,
      past: tickets.filter((t) => t.tab === 'past').length,
      cancelled: tickets.filter((t) => t.tab === 'cancelled').length,
    };
    return { ...data, counts };
  };
  return userId ? withCache(`data:profile:u:${userId}`, 30, load) : load();
}

// Per-event net revenue (host-only RPC) as { byEvent, total }, cached per-user.
// Shared by getHostedSummary AND the AI agent so both hit the same entry.
export async function hostedRevenue(sb, userId) {
  return withCache(`data:hostrev:u:${userId}`, 60, async () => {
    const { data, error } = await sb.rpc('get_hosted_revenue');
    if (error) throw new Error(error.message);
    const rev = data ?? { events: [], totalRevenue: 0 };
    const byEvent = {};
    for (const r of rev.events ?? []) byEvent[r.eventId] = Number(r.revenue);
    return { byEvent, total: Number(rev.totalRevenue ?? 0) };
  });
}

// Organiser dashboard summary: per-event net revenue + aggregate counts derived from
// the backend event statuses. Cached per-user.
export async function getHostedSummary(sb, userId) {
  return withCache(`data:hostsummary:u:${userId}`, 45, async () => {
    const [rev, events] = await Promise.all([hostedRevenue(sb, userId), listEvents(sb, userId)]);
    const mine = events.filter((e) => e.hostId === userId || e.isCoOrganiser);
    return {
      revenueByEvent: rev.byEvent,
      totalRevenue: rev.total,
      totalEvents: mine.length,
      upcoming: mine.filter((e) => e.status !== 'cancelled').length,
      confirmed: mine.filter((e) => e.status === 'greenlit').length,
    };
  });
}

// Public attendee list: name, username, avatarUrl of the distinct users with active tickets.
// One buyer of many tickets is still one attendee — no padding. Public → cache per-event.
export async function getEventAttendees(sb, eventId) {
  return withCache(`data:attendees:e:${eventId}`, 30, async () => {
    const { data, error } = await sb.rpc('get_event_attendees', { p_event_id: eventId });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
}

// Host-only attendee list with contact details (PII). The RPC raises (errcode 42501)
// if the caller is not the event's host; surface that as a forbidden result.
// NOT cached: a per-event cache could serve host-only contacts to a non-host, and a
// per-user cache buys little for this rare, host-only read — keep it live.
export async function getEventAttendeesPrivate(sb, eventId) {
  const { data, error } = await sb.rpc('get_event_attendees_private', { p_event_id: eventId });
  if (error) {
    if (error.code === '42501' || /not_host/.test(error.message)) return { error: 'forbidden' };
    throw new Error(error.message);
  }
  return { attendees: data ?? [] };
}

// Re-reads events + profile after a mutation so the frontend can refresh in one round-trip.
async function mutationResult(sb, userId, eventId) {
  await invalidateEventCaches(); // the mutation changed event data; re-read below is fresh
  const [events, profile] = await Promise.all([listEvents(sb, userId), getProfile(sb)]);
  return {
    event: eventId ? events.find((e) => e.id === eventId) ?? null : null,
    profile,
  };
}

// ── User writes ────────────────────────────────────────────────────────────

export async function createPledge(sb, userId, eventId, qty, paymentMethod = 'wallet', paymentIntentId = null, chargedAmount = null, idempotencyKey = null) {
  const { data, error } = await sb.rpc('create_pledge', {
    p_event_id: eventId,
    p_qty: Number(qty),
    p_payment_method: paymentMethod,
    p_payment_intent_id: paymentIntentId,
    p_charged_amount: chargedAmount != null ? Number(chargedAmount) : null,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(error.message);
  if (data?.error) return { error: data.error };
  const result = await mutationResult(sb, userId, eventId);
  // Surface the booking reference + charged amount for the confirmation page, plus the
  // booking id/QR token and whether this pledge just greenlit the event (for emails).
  // `idempotent` is true when a retry returned the original booking (no new charge).
  return { ...result, reference: data?.reference, amount: data?.amount, bookingId: data?.bookingId, qrToken: data?.qrToken, greenlitNow: data?.greenlitNow, idempotent: data?.idempotent ?? false };
}

async function eventIdForBooking(sb, bookingId) {
  const { data } = await sb.from('BOOKINGS').select('eventId').eq('id', bookingId).single();
  return data?.eventId;
}

export async function giveAwayTickets(sb, userId, bookingId, quantity) {
  const eventId = await eventIdForBooking(sb, bookingId);
  const { data, error } = await sb.rpc('give_away_tickets', {
    p_booking_id: bookingId,
    p_quantity: Number(quantity),
  });
  if (error) throw new Error(error.message);
  if (data?.error) return { error: data.error };
  return mutationResult(sb, userId, eventId);
}

export async function deleteBooking(sb, userId, bookingId) {
  const eventId = await eventIdForBooking(sb, bookingId);
  const { data, error } = await sb.rpc('soft_delete_booking', { p_booking_id: bookingId });
  if (error) throw new Error(error.message);
  if (data?.error) return { error: data.error };
  return mutationResult(sb, userId, eventId);
}

// ── Drafts (per-organiser, RLS owner-only; payload is the EventItem JSON) ────

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const asDraft = (row) => ({ ...row.payload, id: row.id });

// Per-organiser (RLS owner-only); cache per-user. `userId` optional → live when omitted.
export async function listDrafts(sb, userId = null) {
  const load = async () => {
    const { data, error } = await sb.from('EVENT_DRAFTS').select('id, payload').order('updatedAt', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(asDraft);
  };
  return userId ? withCache(`data:drafts:u:${userId}`, 60, load) : load();
}

export async function saveDraft(sb, userId, draft) {
  if (isUuid(draft.id)) {
    const { data, error } = await sb
      .from('EVENT_DRAFTS')
      .update({ payload: draft, updatedAt: new Date().toISOString() })
      .eq('id', draft.id)
      .select('id, payload')
      .single();
    if (error) throw new Error(error.message);
    const saved = asDraft(data);
    dependencies.syncDraftEmbedding(sb, saved.id, userId, saved);
    await cacheDel(`data:drafts:u:${userId}`);
    return saved;
  }
  const { data, error } = await sb
    .from('EVENT_DRAFTS')
    .insert({ userId, payload: draft })
    .select('id, payload')
    .single();
  if (error) throw new Error(error.message);
  const saved = asDraft(data);
  dependencies.syncDraftEmbedding(sb, saved.id, userId, saved);
  return saved;
}

export async function deleteDraft(sb, id) {
  const { error } = await sb.from('EVENT_DRAFTS').delete().eq('id', id);
  if (error) throw new Error(error.message);
  dependencies.deleteDraftEmbedding(sb, id);
  await cacheDelByPrefix('data:drafts:');
}

// ── Organiser writes ───────────────────────────────────────────────────────

export async function createEvent(sb, e) {
  const { data, error } = await sb.rpc('create_event', eventRpcArgs(e));
  if (error) throw new Error(error.message);
  if (data?.error) return { error: data.error };
  await invalidateEventCaches();
  dependencies.syncEventEmbedding(sb, data.eventId, e); // fire-and-forget (semantic search/recommendation)
  return { eventId: data.eventId };
}

export async function updateEvent(sb, e) {
  const { data, error } = await sb.rpc('update_event', { p_event_id: e.id, ...eventRpcArgs(e) });
  if (error) throw new Error(error.message);
  if (data?.error) return { error: data.error };
  await invalidateEventCaches();
  dependencies.syncEventEmbedding(sb, e.id, e); // re-embed on edit
  return { status: 'ok' };
}


export async function deleteEvent(sb, eventId) {
  const { data, error } = await sb.rpc('delete_event', { p_event_id: eventId });
  if (error) throw new Error(error.message);
  if (data?.error) return { error: data.error };
  await invalidateEventCaches();
  return { status: 'ok' };
}

// Soft-cancel a published event: marks it cancelled, records the reason, and
// refunds live pledges (all handled atomically in the cancel_event RPC).
export async function cancelEvent(sb, eventId, reason) {
  const { data, error } = await sb.rpc('cancel_event', { p_event_id: eventId, p_reason: reason });
  if (error) throw new Error(error.message);
  if (data?.error) return { error: data.error };
  await invalidateEventCaches();
  return { status: 'ok' };
}

// Hide a (cancelled) event from the organiser's own dashboard; backers keep their record.
export async function hideEvent(sb, eventId) {
  const { data, error } = await sb.rpc('hide_event', { p_event_id: eventId });
  if (error) throw new Error(error.message);
  if (data?.error) return { error: data.error };
  await invalidateEventCaches();
  return { status: 'ok' };
}

// Per-user (RLS); cache per-user. `userId` optional → live when omitted.
export async function listCoOrganiserInvites(sb, userId = null) {
  const load = async () => {
    const { data, error } = await sb.rpc('get_coorganiser_invites');
    if (error) throw new Error(error.message);
    return data ?? [];
  };
  return userId ? withCache(`data:invites:u:${userId}`, 60, load) : load();
}

// Organiser dashboards + all-attendees, keyed per-user and cached. Read-only RPCs
// that were previously called straight from their controllers.
export async function getAnalytics(sb, userId) {
  return withCache(`data:analytics:u:${userId}`, 45, async () => {
    const { data, error } = await sb.rpc('get_analytics');
    if (error) throw new Error(error.message);
    return data ?? {};
  });
}

export async function getAllAttendees(sb, userId) {
  return withCache(`data:allattendees:u:${userId}`, 45, async () => {
    const { data, error } = await sb.rpc('get_all_attendees');
    if (error) throw new Error(error.message);
    return data ?? [];
  });
}

// The caller's university (rarely changes; used by the AI to pick a venue). Cached per-user.
export async function getUserUniversity(sb, userId) {
  if (!userId) return '';
  return withCache(`data:umeta:u:${userId}`, 600, async () => {
    const { data } = await sb.from('USER').select('university').eq('id', userId).single();
    return data?.university || '';
  });
}

export async function inviteCoOrganiser(sb, eventId, identifier) {
  const { data, error } = await sb.rpc('invite_coorganiser', {
    p_event_id: eventId,
    p_identifier: identifier,
  });
  if (error) throw new Error(error.message);
  await cacheDelByPrefix('data:invites:');
  return data;
}

export async function respondCoOrganiserInvite(sb, inviteId, action) {
  const { data, error } = await sb.rpc('respond_coorganiser_invite', {
    p_invite_id: inviteId,
    p_action: action,
  });
  if (error) throw new Error(error.message);
  // Co-organiser membership changes canEdit on events + the invite list for both users.
  await invalidateEventCaches();
  return data;
}

function eventRpcArgs(e) {
  const statuses = Array.isArray(e.statuses) ? e.statuses : [];
  const eb = statuses.find((s) => s.statusName === 'early_bird');
  const gl = statuses.find((s) => s.statusName === 'greenlit');
  return {
    p_title: e.title,
    p_description: e.description,
    p_location: e.location,
    p_address: e.address ?? '',
    p_latitude: e.latitude ?? null,
    p_longitude: e.longitude ?? null,
    p_start_date: e.startsAt,
    p_end_date: e.endsAt,
    p_image_url: e.image ?? '',
    p_hype_threshold: e.hypeThreshold,
    p_max_capacity: e.maxCapacity,
    p_deadline: e.deadlineAt,
    p_early_price: eb?.price ?? 0,
    p_early_capacity: eb?.qty ?? 0,
    p_greenlit_price: gl?.price ?? 0,
    p_greenlit_capacity: gl?.qty ?? 0,
    p_restrict_university: !!e.restrictToUniversity,
    // Hype-driven pricing: base = early-bird price (curve floor), max = ceiling at capacity.
    p_hype_driven: !!e.hypeDrivenPricing,
    p_base_price: e.hypeDrivenPricing ? (e.basePrice ?? eb?.price ?? null) : null,
    p_max_price: e.hypeDrivenPricing ? (e.maxPrice ?? null) : null,
    // Backward-compatible RPC argument. Operational costs are outside app scope.
    p_costs: {},
  };
}
