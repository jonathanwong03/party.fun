import type { EventItem, Role } from './components/types';

export type ProfileTicket = {
  eventId: string;
  qty: number;
  amount: number;
  tab: 'upcoming' | 'past' | 'cancelled';
  ticketStatus: string;
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

const MOCK_USER_ID = 'mock-user-jamie';

async function apiFetch<T>(path: string, role: Role | null, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);

  if (role) {
    headers.set('X-Mock-Role', role);
    headers.set('X-Mock-User-Id', MOCK_USER_ID);
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

async function authFetch(path: string, body: unknown): Promise<{ user: AuthUser }> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || 'Request failed.');
  }
  return data as { user: AuthUser };
}

export async function loginRequest(identifier: string, password: string): Promise<AuthUser> {
  const { user } = await authFetch('/api/auth/login', { identifier, password });
  return user;
}

export async function registerRequest(input: {
  username: string;
  email: string;
  password: string;
  role: Role;
}): Promise<AuthUser> {
  const { user } = await authFetch('/api/auth/register', input);
  return user;
}

// Wipe any registered accounts back to the two seed users. Called on every full
// page load so created accounts don't survive a refresh. Fire-and-forget.
export function resetUsers(): void {
  fetch('/api/auth/reset', { method: 'POST' }).catch(() => {});
}

export function fetchEvents(role: Role | null) {
  return apiFetch<EventItem[]>('/api/events', role);
}

export function fetchProfile(role: Role) {
  return apiFetch<ProfileResponse>('/api/profile', role);
}

export function createPledge(role: Role, eventId: string, qty: number, amount: number) {
  return apiFetch<MutationResponse>(`/api/checkout/${eventId}/pledge`, role, {
    method: 'POST',
    body: JSON.stringify({ qty, amount }),
  });
}

export function cancelTicket(role: Role, eventId: string, qty: number, amount: number) {
  return apiFetch<MutationResponse>(`/api/profile/tickets/${eventId}/cancel`, role, {
    method: 'POST',
    body: JSON.stringify({ qty, amount }),
  });
}
