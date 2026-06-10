import type { EventItem, EventStatus, Role, StatusName } from './components/types';
import { supabase } from './supabase';

export type ProfileTicket = {
  bookingId: string;
  eventId: string;
  activeTicketCount: number;
  originalTicketCount: number;
  bookingStatus: string;
  tab: 'upcoming' | 'past' | 'cancelled';
};

export type QuoteLine = { label: string; price: number; count: number };

export type Quote = {
  eventId: string;
  qty: number;
  lines: QuoteLine[];
  subtotal: number;
  total: number;
};

export type ProfileResponse = {
  profile: { id: string; fullName: string; email: string; handle: string };
  tickets: ProfileTicket[];
  myEventIds: string[];
};

export type MutationResponse = {
  status: 'ok';
  event: EventItem | null;
  profile: ProfileResponse;
};

export type AuthUser = { id: string; username: string; email: string; role: Role };

// ── Auth ────────────────────────────────────────────────────────────────────

export async function loginRequest(email: string, password: string): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);

  const { data: profile, error: profileError } = await supabase
    .from('USER')
    .select('id, username, email, role')
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile) throw new Error('Could not load user profile.');
  return { id: profile.id, username: profile.username, email: profile.email, role: profile.role as Role };
}

export async function registerRequest(input: {
  username: string;
  email: string;
  password: string;
  role: Role;
}): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: { data: { username: input.username, name: input.username, role: input.role } },
  });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('Sign up failed — please try again.');
  return { id: data.user.id, username: input.username, email: input.email, role: input.role };
}

export async function logoutRequest(): Promise<void> {
  await supabase.auth.signOut();
}

// ── Event mapping ────────────────────────────────────────────────────────────

function sgDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', ...opts }).format(new Date(iso));
}

function mapRow(row: any, userId: string | null): EventItem {
  const statuses: { statusName: string; price: number; ticketCapacity: number; sold: number }[] =
    Array.isArray(row.statuses) ? row.statuses : [];
  const LABELS: Record<string, string> = { early_bird: 'Early Birds', greenlit: 'Greenlit' };

  const eb = statuses.find((s) => s.statusName === 'early_bird');
  const activeName = eb && eb.sold >= eb.ticketCapacity ? 'greenlit' : 'early_bird';
  const current = statuses.find((s) => s.statusName === activeName) ?? statuses[0];

  const activeTicketCount: number = row.active_ticket_count ?? 0;
  const hypeThreshold: number = row.hypeThreshold ?? 1;
  const maxCapacity: number = row.maxCapacity ?? 0;

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
    location: row.location ?? '',
    description: row.description ?? '',
    image: row.imageUrl ?? '',
    price: current?.price ?? 0,
    statusLabel: LABELS[activeName] ?? 'Early Birds',
    hypePercentage: Math.min(100, Math.round((activeTicketCount / hypeThreshold) * 100)),
    hypeThreshold,
    activeTicketCount,
    maxCapacity,
    spotsLeft: Math.max(0, maxCapacity - activeTicketCount),
    status: (row.derived_status ?? 'early_bird') as EventStatus,
    deadline: row.deadlineAt
      ? sgDate(row.deadlineAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
      : '',
    statuses: statuses.map((s) => ({
      statusName: s.statusName as StatusName,
      label: LABELS[s.statusName] ?? s.statusName,
      price: s.price,
      qty: s.ticketCapacity,
      sold: s.sold,
    })),
    mine: userId != null ? row.hostId === userId : undefined,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function fetchEvents(_role: Role | null): Promise<EventItem[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user.id ?? null;
  const { data, error } = await supabase.rpc('get_events');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => mapRow(row, userId));
}

export async function fetchProfile(_role: Role): Promise<ProfileResponse> {
  const { data, error } = await supabase.rpc('get_profile');
  if (error) throw new Error(error.message);
  return data as ProfileResponse;
}

export async function fetchQuote(_role: Role | null, eventId: string, qty: number): Promise<Quote> {
  const { data, error } = await supabase.rpc('get_quote', { p_event_id: eventId, p_qty: qty });
  if (error) throw new Error(error.message);
  if (data?.error) {
    throw new Error(data.error === 'not_enough_tickets' ? 'Not enough tickets available.' : data.error);
  }
  return data as Quote;
}

// ── User writes ──────────────────────────────────────────────────────────────

export async function createPledge(role: Role, eventId: string, qty: number, _amount: number): Promise<MutationResponse> {
  const { data, error } = await supabase.rpc('create_pledge', { p_event_id: eventId, p_qty: qty });
  if (error) throw new Error(error.message);
  if (data?.error) {
    const msgs: Record<string, string> = {
      own_event: 'You cannot pledge for your own event.',
      active_booking_exists: 'You already have active tickets for this event.',
      not_enough_tickets: 'Not enough tickets available.',
    };
    throw new Error(msgs[data.error] ?? data.error);
  }
  const [events, profile] = await Promise.all([fetchEvents(role), fetchProfile(role)]);
  return { status: 'ok', event: events.find((e) => e.id === eventId) ?? null, profile };
}

export async function giveAwayTickets(role: Role, bookingId: string, quantity: number): Promise<MutationResponse> {
  const { data: bk } = await supabase.from('BOOKINGS').select('eventId').eq('id', Number(bookingId)).single();
  const eventId: string | undefined = bk?.eventId;

  const { data, error } = await supabase.rpc('give_away_tickets', {
    p_booking_id: Number(bookingId),
    p_quantity: quantity,
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);

  const [events, profile] = await Promise.all([fetchEvents(role), fetchProfile(role)]);
  return { status: 'ok', event: eventId ? (events.find((e) => e.id === eventId) ?? null) : null, profile };
}

export async function deleteBooking(role: Role, bookingId: string): Promise<MutationResponse> {
  const { data: bk } = await supabase.from('BOOKINGS').select('eventId').eq('id', Number(bookingId)).single();
  const eventId: string | undefined = bk?.eventId;

  const { data, error } = await supabase.rpc('soft_delete_booking', { p_booking_id: Number(bookingId) });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);

  const [events, profile] = await Promise.all([fetchEvents(role), fetchProfile(role)]);
  return { status: 'ok', event: eventId ? (events.find((e) => e.id === eventId) ?? null) : null, profile };
}

// ── Organiser writes ─────────────────────────────────────────────────────────

export async function createEventRequest(event: EventItem): Promise<string> {
  if (!event.startsAt || !event.endsAt || !event.deadlineAt) {
    throw new Error('Event is missing date information.');
  }
  const eb = event.statuses.find((s) => s.statusName === 'early_bird');
  const gl = event.statuses.find((s) => s.statusName === 'greenlit');

  const { data, error } = await supabase.rpc('create_event', {
    p_title:             event.title,
    p_description:       event.description,
    p_location:          event.location,
    p_start_date:        event.startsAt,
    p_end_date:          event.endsAt,
    p_image_url:         event.image ?? '',
    p_hype_threshold:    event.hypeThreshold,
    p_max_capacity:      event.maxCapacity,
    p_deadline:          event.deadlineAt,
    p_early_price:       eb?.price ?? 0,
    p_early_capacity:    eb?.qty ?? 0,
    p_greenlit_price:    gl?.price ?? 0,
    p_greenlit_capacity: gl?.qty ?? 0,
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data.eventId as string;
}

export async function updateEventRequest(event: EventItem): Promise<void> {
  if (!event.startsAt || !event.endsAt || !event.deadlineAt) return;
  const eb = event.statuses.find((s) => s.statusName === 'early_bird');
  const gl = event.statuses.find((s) => s.statusName === 'greenlit');

  const { data, error } = await supabase.rpc('update_event', {
    p_event_id:          event.id,
    p_title:             event.title,
    p_description:       event.description,
    p_location:          event.location,
    p_start_date:        event.startsAt,
    p_end_date:          event.endsAt,
    p_image_url:         event.image ?? '',
    p_hype_threshold:    event.hypeThreshold,
    p_max_capacity:      event.maxCapacity,
    p_deadline:          event.deadlineAt,
    p_early_price:       eb?.price ?? 0,
    p_early_capacity:    eb?.qty ?? 0,
    p_greenlit_price:    gl?.price ?? 0,
    p_greenlit_capacity: gl?.qty ?? 0,
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
}

export async function deleteEventRequest(eventId: string): Promise<void> {
  const { data, error } = await supabase.rpc('delete_event', { p_event_id: eventId });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
}
