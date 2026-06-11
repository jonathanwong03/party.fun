// Supabase-backed data service. Every function receives a user-scoped Supabase
// client (`sb`) so the existing RLS policies and SECURITY DEFINER RPC functions
// enforce access. The backend is a thin, authenticated pass-through to those RPCs;
// the business logic stays in Postgres where it already works atomically.

const LABELS = { early_bird: 'Early Birds', greenlit: 'Greenlit' };

function sgDate(iso, opts) {
  return new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', ...opts }).format(new Date(iso));
}

const money = (n) => `$${Number(n).toFixed(2)}`;
// "Thursday, 18 June"
const sgLong = (iso) => sgDate(iso, { weekday: 'long', day: 'numeric', month: 'long' });
// "12:02pm"
const sgClock = (iso) => sgDate(iso, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s/g, '').toLowerCase();

// Maps a raw `get_events` row into the EventItem shape the frontend renders.
function mapRow(row, userId) {
  const statuses = Array.isArray(row.statuses) ? row.statuses : [];

  const eb = statuses.find((s) => s.statusName === 'early_bird');
  const activeName = eb && eb.sold >= eb.ticketCapacity ? 'greenlit' : 'early_bird';
  const current = statuses.find((s) => s.statusName === activeName) ?? statuses[0];

  const activeTicketCount = row.active_ticket_count ?? 0;
  const hypeThreshold = row.hypeThreshold ?? 1;
  const maxCapacity = row.maxCapacity ?? 0;

  return {
    id: row.id,
    hostId: row.hostId,
    title: row.title ?? '',
    organiser: row.organiser_name ?? 'Unknown',
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
    description: row.description ?? '',
    image: row.imageUrl ?? '',
    price: current?.price ?? 0,
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
    })),
    mine: userId != null ? row.hostId === userId : undefined,
  };
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function listEvents(sb, userId) {
  const { data, error } = await sb.rpc('get_events');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapRow(row, userId));
}

export async function getEvent(sb, eventId, userId) {
  const events = await listEvents(sb, userId);
  return events.find((e) => e.id === eventId) ?? null;
}

export async function quotePledge(sb, eventId, qty) {
  const { data, error } = await sb.rpc('get_quote', { p_event_id: eventId, p_qty: Number(qty) });
  if (error) throw new Error(error.message);
  if (!data || data.error) return data; // { error: 'not_enough_tickets' } passes through
  const lines = (data.lines ?? []).map((l) => {
    const subtotal = Number(l.price) * Number(l.count);
    return { ...l, subtotal, subtotalText: money(subtotal) };
  });
  return { ...data, lines, subtotalText: money(data.subtotal), totalText: money(data.total) };
}

export async function getProfile(sb) {
  const { data, error } = await sb.rpc('get_profile');
  if (error) throw new Error(error.message);
  const tickets = data?.tickets ?? [];
  const counts = {
    upcoming: tickets.filter((t) => t.tab === 'upcoming').length,
    past: tickets.filter((t) => t.tab === 'past').length,
    cancelled: tickets.filter((t) => t.tab === 'cancelled').length,
  };
  return { ...data, counts };
}

// Organiser dashboard summary: per-event net revenue (host-only RPC) + aggregate
// counts derived from the backend event statuses.
export async function getHostedSummary(sb, userId) {
  const [revRes, events] = await Promise.all([sb.rpc('get_hosted_revenue'), listEvents(sb, userId)]);
  if (revRes.error) throw new Error(revRes.error.message);
  const rev = revRes.data ?? { events: [], totalRevenue: 0 };
  const mine = events.filter((e) => e.hostId === userId);
  const revenueByEvent = {};
  for (const r of rev.events ?? []) revenueByEvent[r.eventId] = Number(r.revenue);
  return {
    revenueByEvent,
    totalRevenue: Number(rev.totalRevenue ?? 0),
    totalEvents: mine.length,
    upcoming: mine.filter((e) => e.status !== 'cancelled').length,
    confirmed: mine.filter((e) => e.status === 'greenlit').length,
  };
}

// Public attendee list: name, username, avatarUrl of users with active tickets.
export async function getEventAttendees(sb, eventId) {
  const { data, error } = await sb.rpc('get_event_attendees', { p_event_id: eventId });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Host-only attendee list with contact details. The RPC raises (errcode 42501)
// if the caller is not the event's host; surface that as a forbidden result.
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
  const [events, profile] = await Promise.all([listEvents(sb, userId), getProfile(sb)]);
  return {
    event: eventId ? events.find((e) => e.id === eventId) ?? null : null,
    profile,
  };
}

// ── User writes ────────────────────────────────────────────────────────────

export async function createPledge(sb, userId, eventId, qty) {
  const { data, error } = await sb.rpc('create_pledge', { p_event_id: eventId, p_qty: Number(qty) });
  if (error) throw new Error(error.message);
  if (data?.error) return { error: data.error };
  return mutationResult(sb, userId, eventId);
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

export async function listDrafts(sb) {
  const { data, error } = await sb.from('EVENT_DRAFTS').select('id, payload').order('updatedAt', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(asDraft);
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
    return asDraft(data);
  }
  const { data, error } = await sb
    .from('EVENT_DRAFTS')
    .insert({ userId, payload: draft })
    .select('id, payload')
    .single();
  if (error) throw new Error(error.message);
  return asDraft(data);
}

export async function deleteDraft(sb, id) {
  const { error } = await sb.from('EVENT_DRAFTS').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Organiser writes ───────────────────────────────────────────────────────

export async function createEvent(sb, e) {
  const { data, error } = await sb.rpc('create_event', eventRpcArgs(e));
  if (error) throw new Error(error.message);
  if (data?.error) return { error: data.error };
  return { eventId: data.eventId };
}

export async function updateEvent(sb, e) {
  const { data, error } = await sb.rpc('update_event', { p_event_id: e.id, ...eventRpcArgs(e) });
  if (error) throw new Error(error.message);
  if (data?.error) return { error: data.error };
  return { status: 'ok' };
}

export async function deleteEvent(sb, eventId) {
  const { data, error } = await sb.rpc('delete_event', { p_event_id: eventId });
  if (error) throw new Error(error.message);
  if (data?.error) return { error: data.error };
  return { status: 'ok' };
}

function eventRpcArgs(e) {
  const statuses = Array.isArray(e.statuses) ? e.statuses : [];
  const eb = statuses.find((s) => s.statusName === 'early_bird');
  const gl = statuses.find((s) => s.statusName === 'greenlit');
  return {
    p_title: e.title,
    p_description: e.description,
    p_location: e.location,
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
  };
}
