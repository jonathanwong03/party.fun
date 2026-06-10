import type { EventItem, Role } from './components/types';
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

// ── HTTP helper ───────────────────────────────────────────────────────────────
// Data operations go through the Express backend, which forwards this Supabase
// access token to Supabase so RLS + the RPC functions enforce access.

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);

  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json();
      message = body.message || message;
    } catch {
      // non-JSON error body; keep the default message
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

// ── Auth (Supabase, unchanged) ────────────────────────────────────────────────

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

// ── Reads ─────────────────────────────────────────────────────────────────────

export function fetchEvents(_role: Role | null): Promise<EventItem[]> {
  return apiFetch<EventItem[]>('/api/events');
}

export function fetchProfile(_role: Role): Promise<ProfileResponse> {
  return apiFetch<ProfileResponse>('/api/profile');
}

export function fetchQuote(_role: Role | null, eventId: string, qty: number): Promise<Quote> {
  return apiFetch<Quote>(`/api/checkout/${eventId}/quote?qty=${qty}`);
}

// ── User writes ───────────────────────────────────────────────────────────────

export function createPledge(_role: Role, eventId: string, qty: number, _amount: number): Promise<MutationResponse> {
  return apiFetch<MutationResponse>(`/api/checkout/${eventId}/pledge`, {
    method: 'POST',
    body: JSON.stringify({ qty }),
  });
}

export function giveAwayTickets(_role: Role, bookingId: string, quantity: number): Promise<MutationResponse> {
  return apiFetch<MutationResponse>(`/api/profile/bookings/${bookingId}/give-away`, {
    method: 'POST',
    body: JSON.stringify({ quantity }),
  });
}

export function deleteBooking(_role: Role, bookingId: string): Promise<MutationResponse> {
  return apiFetch<MutationResponse>(`/api/profile/bookings/${bookingId}`, { method: 'DELETE' });
}

// ── Organiser writes ──────────────────────────────────────────────────────────

export async function createEventRequest(event: EventItem): Promise<string> {
  if (!event.startsAt || !event.endsAt || !event.deadlineAt) {
    throw new Error('Event is missing date information.');
  }
  const data = await apiFetch<{ eventId: string }>('/api/hosted-events/events', {
    method: 'POST',
    body: JSON.stringify(event),
  });
  return data.eventId;
}

export async function updateEventRequest(event: EventItem): Promise<void> {
  if (!event.startsAt || !event.endsAt || !event.deadlineAt) return;
  await apiFetch(`/api/hosted-events/events/${event.id}`, {
    method: 'PATCH',
    body: JSON.stringify(event),
  });
}

export async function deleteEventRequest(eventId: string): Promise<void> {
  await apiFetch(`/api/hosted-events/events/${eventId}`, { method: 'DELETE' });
}
