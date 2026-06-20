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

export type QuoteLine = { label: string; price: number; count: number; subtotal: number; subtotalText: string };

export type Quote = {
  eventId: string;
  qty: number;
  lines: QuoteLine[];
  subtotal: number;
  total: number;
  subtotalText: string;
  totalText: string;
};

export type ProfileCounts = { upcoming: number; past: number; cancelled: number };

export type ProfileResponse = {
  profile: { id: string; fullName: string; email: string; handle: string };
  tickets: ProfileTicket[];
  myEventIds: string[];
  counts: ProfileCounts;
};

export type HostedSummary = {
  revenueByEvent: Record<string, number>;
  totalRevenue: number;
  totalEvents: number;
  upcoming: number;
  confirmed: number;
};

export type MutationResponse = {
  status: 'ok';
  event: EventItem | null;
  profile: ProfileResponse;
  // Present on pledge responses: the persisted, stable confirmation reference.
  reference?: string;
};

export type AuthUser = { id: string; username: string; email: string; role: Role; avatarUrl?: string | null; telegram?: string | null; phone?: string | null };

export type Attendee = { name: string; username: string; avatarUrl: string | null };
export type AttendeeDetail = { username: string; email: string; contact: string | null; socialLink: string | null; avatarUrl: string | null };

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

export async function loginRequest(identifier: string, password: string): Promise<AuthUser> {
  // Allow signing in with a username as well as an email. Supabase Auth only
  // accepts an email, so resolve the email from the (publicly readable) USER
  // table when the identifier isn't an email address.
  let email = identifier.trim();
  if (!email.includes('@')) {
    // USER rows are self-only readable, so resolve username → email through a
    // SECURITY DEFINER RPC (returns just the one email for an exact username).
    const { data: resolved, error } = await supabase.rpc('email_for_username', { p_username: email });
    if (error || !resolved) throw new Error('No account found for that username.');
    email = resolved as string;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);

  const { data: profile, error: profileError } = await supabase
    .from('USER')
    .select('id, username, email, role, avatarUrl, socialLink, contact')
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile) throw new Error('Could not load user profile.');
  // Telegram is stored in socialLink, phone number in contact.
  return { id: profile.id, username: profile.username, email: profile.email, role: profile.role as Role, avatarUrl: profile.avatarUrl, telegram: profile.socialLink, phone: profile.contact };
}

export async function registerRequest(input: {
  username: string;
  email: string;
  password: string;
  role: Role;
  avatarUrl?: string;
  telegram?: string;
  phone?: string;
}): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: { data: { username: input.username, name: input.username, role: input.role, avatarUrl: input.avatarUrl ?? null, telegram: input.telegram ?? null, phone: input.phone ?? null } },
  });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('Sign up failed — please try again.');
  return { id: data.user.id, username: input.username, email: input.email, role: input.role, avatarUrl: input.avatarUrl, telegram: input.telegram ?? null, phone: input.phone ?? null };
}

// Best-effort "account created" email, sent right after signup (needs the new
// session). Safe to ignore failures — it must never block the signup flow.
export async function sendWelcomeEmailRequest(): Promise<void> {
  await apiFetch('/api/notifications/welcome', { method: 'POST' });
}

// Persist a username change (own row); reject duplicates (USER.username is unique).
export async function updateUsernameRequest(username: string): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase.from('USER').update({ username }).eq('id', userId);
  if (error) {
    if (error.code === '23505') throw new Error('That username is taken.');
    throw new Error(error.message);
  }
}

// Persist the user's contact details (own row): Telegram → socialLink, phone → contact.
// Empty strings are stored as NULL so the Profile line hides cleanly.
export async function updateContactRequest(telegram: string, phone: string): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase
    .from('USER')
    .update({ socialLink: telegram.trim() || null, contact: phone.trim() || null })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

// Permanently delete the signed-in user's account (blocked server-side if they host events).
export async function deleteAccountRequest(): Promise<void> {
  const { error } = await supabase.rpc('delete_my_account');
  if (error) {
    if (error.code === 'P0001' || /has_active_events|has_events/.test(error.message)) {
      throw new Error('You can only delete your account when you have no active (Early Birds or Greenlit) events.');
    }
    throw new Error(error.message);
  }
  await supabase.auth.signOut();
}

export async function logoutRequest(): Promise<void> {
  await supabase.auth.signOut();
}

// ── Password reset (custom OTP via the backend + Resend) ────────────────────────
// These are unauthenticated (the user is logged out), so they use a plain fetch.

async function postPublic(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try { message = (await response.json()).message || message; } catch { /* keep default */ }
    throw new Error(message);
  }
}

// Emails a 6-digit code (via Resend → the override inbox in dev) for any email in the DB.
export function requestPasswordReset(email: string): Promise<void> {
  return postPublic('/api/password-reset/request', { email: email.trim() });
}

// Verifies the 6-digit code for that email.
export function verifyResetCode(email: string, code: string): Promise<void> {
  return postPublic('/api/password-reset/verify', { email: email.trim(), code: code.trim() });
}

// Sets the new password once the code is verified.
export function setNewPassword(email: string, code: string, password: string): Promise<void> {
  return postPublic('/api/password-reset/complete', { email: email.trim(), code: code.trim(), password });
}

// ── Storage uploads (direct to Supabase, scoped to the user's folder) ─────────

function fileExt(file: File): string {
  const fromName = file.name.split('.').pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  return (file.type.split('/')[1] || 'png').toLowerCase();
}

async function currentUserId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');
  return session.user.id;
}

// Uploads/replaces the signed-in user's avatar and saves the URL on their USER row.
export async function uploadAvatar(file: File): Promise<string> {
  const userId = await currentUserId();
  const path = `${userId}/avatar.${fileExt(file)}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw new Error(error.message);
  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
  // Cache-bust so a replaced image refreshes immediately.
  const url = `${publicUrl}?t=${Date.now()}`;
  const { error: updateError } = await supabase.from('USER').update({ avatarUrl: url }).eq('id', userId);
  if (updateError) throw new Error(updateError.message);
  return url;
}

// Selects a preset avatar (a /avatars/*.svg path) as the user's profile picture.
export async function setAvatar(url: string): Promise<string> {
  const userId = await currentUserId();
  const { error } = await supabase.from('USER').update({ avatarUrl: url }).eq('id', userId);
  if (error) throw new Error(error.message);
  return url;
}

export async function removeAvatar(): Promise<void> {
  const userId = await currentUserId();
  await supabase.storage.from('avatars').remove([`${userId}/avatar.png`, `${userId}/avatar.jpg`, `${userId}/avatar.jpeg`, `${userId}/avatar.webp`, `${userId}/avatar.gif`]);
  const { error } = await supabase.from('USER').update({ avatarUrl: null }).eq('id', userId);
  if (error) throw new Error(error.message);
}

// Uploads an event banner and returns its public URL (saved on the event when published).
export async function uploadEventImage(file: File): Promise<string> {
  const userId = await currentUserId();
  const path = `${userId}/${Date.now()}.${fileExt(file)}`;
  const { error } = await supabase.storage.from('event-images').upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw new Error(error.message);
  const { data: { publicUrl } } = supabase.storage.from('event-images').getPublicUrl(path);
  return publicUrl;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export function fetchEvents(_role: Role | null): Promise<EventItem[]> {
  return apiFetch<EventItem[]>('/api/events');
}

export function fetchProfile(_role: Role): Promise<ProfileResponse> {
  return apiFetch<ProfileResponse>('/api/profile');
}

export function fetchAttendees(eventId: string): Promise<Attendee[]> {
  return apiFetch<Attendee[]>(`/api/events/${eventId}/attendees`);
}

export function fetchAttendeeDetails(eventId: string): Promise<AttendeeDetail[]> {
  return apiFetch<AttendeeDetail[]>(`/api/events/${eventId}/attendees/details`);
}

export function fetchQuote(_role: Role | null, eventId: string, qty: number): Promise<Quote> {
  return apiFetch<Quote>(`/api/checkout/${eventId}/quote?qty=${qty}`);
}

// ── User writes ───────────────────────────────────────────────────────────────

export function createPledge(_role: Role, eventId: string, qty: number, _amount: number, paymentMethod: 'wallet' | 'card' = 'wallet'): Promise<MutationResponse> {
  return apiFetch<MutationResponse>(`/api/checkout/${eventId}/pledge`, {
    method: 'POST',
    body: JSON.stringify({ qty, paymentMethod }),
  });
}

// ── Wallet + linked card (Stripe) ───────────────────────────────────────────────

export type WalletTxn = { id: number; type: 'topup' | 'pledge' | 'refund'; source: 'wallet' | 'card'; amount: number; balanceAfter: number; eventId: string | null; createdAt: string };
export type WalletInfo = { balance: number; card: { brand: string | null; last4: string | null } | null; transactions: WalletTxn[] };

export function fetchWallet(): Promise<WalletInfo> {
  return apiFetch<WalletInfo>('/api/wallet');
}
export function createSetupIntent(): Promise<{ clientSecret: string }> {
  return apiFetch<{ clientSecret: string }>('/api/wallet/setup-intent', { method: 'POST' });
}
export function saveCard(paymentMethodId: string): Promise<{ card: { brand: string | null; last4: string | null } }> {
  return apiFetch('/api/wallet/card', { method: 'POST', body: JSON.stringify({ paymentMethodId }) });
}
export function topUpWallet(amount: number): Promise<{ balance: number }> {
  return apiFetch('/api/wallet/topup', { method: 'POST', body: JSON.stringify({ amount }) });
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

// Soft-cancel a published event with a reason (backend refunds live pledges).
export async function cancelEventRequest(eventId: string, reason: string): Promise<void> {
  await apiFetch(`/api/hosted-events/events/${eventId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

// ── Organiser drafts (persisted per-user via the backend) ─────────────────────

export function fetchHostedSummary(): Promise<HostedSummary> {
  return apiFetch<HostedSummary>('/api/hosted-events/summary');
}

export function fetchDrafts(): Promise<EventItem[]> {
  return apiFetch<EventItem[]>('/api/hosted-events/drafts');
}

export function saveDraftRequest(draft: EventItem): Promise<EventItem> {
  return apiFetch<EventItem>('/api/hosted-events/drafts', {
    method: 'POST',
    body: JSON.stringify(draft),
  });
}

export function deleteDraftRequest(id: string): Promise<void> {
  return apiFetch<void>(`/api/hosted-events/drafts/${id}`, { method: 'DELETE' });
}
