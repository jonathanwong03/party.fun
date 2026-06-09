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
  profile: {
    id: string;
    fullName: string;
    email: string;
    handle: string;
  };
  tickets: ProfileTicket[];
  myEventIds: string[];
};

type MutationResponse = {
  status: 'ok';
  event: EventItem;
  profile: ProfileResponse;
};

async function apiFetch<T>(path: string, role: Role | null, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);

  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }

  if (role) {
    headers.set('X-Mock-Role', role);
  }

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export type AuthUser = { id: string; username: string; email: string; role: Role };

export async function loginRequest(email: string, password: string): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);

  const { data: profile, error: profileError } = await supabase
    .from('USER')
    .select('id, username, email, role')
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile) throw new Error('Could not load user profile.');

  return {
    id: profile.id,
    username: profile.username,
    email: profile.email,
    role: profile.role as Role,
  };
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
    options: {
      data: {
        username: input.username,
        name: input.username,
        role: input.role,
      },
    },
  });

  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('Sign up failed — please try again.');

  return {
    id: data.user.id,
    username: input.username,
    email: input.email,
    role: input.role,
  };
}

export async function logoutRequest(): Promise<void> {
  await supabase.auth.signOut();
}

export function fetchEvents(role: Role | null) {
  return apiFetch<EventItem[]>('/api/events', role);
}

export function fetchProfile(role: Role) {
  return apiFetch<ProfileResponse>('/api/profile', role);
}

export function fetchQuote(role: Role | null, eventId: string, qty: number) {
  return apiFetch<Quote>(`/api/checkout/${eventId}/quote?qty=${qty}`, role);
}

export function createPledge(role: Role, eventId: string, qty: number, amount: number) {
  return apiFetch<MutationResponse>(`/api/checkout/${eventId}/pledge`, role, {
    method: 'POST',
    body: JSON.stringify({ qty, amount }),
  });
}

export function giveAwayTickets(role: Role, bookingId: string, quantity: number) {
  return apiFetch<MutationResponse>(`/api/profile/bookings/${bookingId}/give-away`, role, {
    method: 'POST',
    body: JSON.stringify({ quantity }),
  });
}

export function deleteBooking(role: Role, bookingId: string) {
  return apiFetch<MutationResponse>(`/api/profile/bookings/${bookingId}`, role, {
    method: 'DELETE',
  });
}
