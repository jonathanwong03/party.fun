import type { EventItem, Role } from "./components/types";
import { supabase } from "./supabase";

export type ProfileTicket = {
  bookingId: string;
  eventId: string;
  activeTicketCount: number;
  originalTicketCount: number;
  bookingStatus: string;
  tab: "upcoming" | "past" | "cancelled";
};

export type QuoteLine = {
  label: string;
  price: number;
  count: number;
  subtotal: number;
  subtotalText: string;
};

export type Quote = {
  eventId: string;
  qty: number;
  lines: QuoteLine[];
  subtotal: number;
  total: number;        // ticket total (GST-exclusive)
  subtotalText: string;
  totalText: string;
  gst: number;          // 9% GST on the ticket total
  grandTotal: number;   // total payable = total + gst
  gstText: string;
  grandTotalText: string;
  pricingModel?: 'hype_driven' | 'static';
};

export type ProfileCounts = {
  upcoming: number;
  past: number;
  cancelled: number;
};

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

export type CoOrganiserInvite = {
  id: string;
  eventId: string;
  eventTitle: string;
  ownerId: string;
  ownerUsername: string;
  ownerEmail: string | null;
  inviteeId: string;
  inviteeUsername: string;
  inviteeEmail: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  invitedAt: string;
  respondedAt: string | null;
  direction: 'incoming' | 'outgoing';
};

export type MutationResponse = {
  status: "ok";
  event: EventItem | null;
  profile: ProfileResponse;
  // Present on pledge responses: the persisted, stable confirmation reference.
  reference?: string;
};

export type MemberType = 'student' | 'instructor' | 'professor';
export type University = 'NUS' | 'NTU' | 'SMU' | 'SUSS' | 'SUTD' | 'SIM' | 'SIT';

export type AuthUser = {
  id: string;
  username: string;
  email: string;
  role: Role;
  avatarUrl?: string | null;
  telegram?: string | null;
  phone?: string | null;
  university?: string | null;
  memberType?: MemberType | null;
  orgId?: string | null;
  // True once the user has used their one-time university change in Settings.
  universityChanged?: boolean;
};

export type Attendee = {
  name: string;
  username: string;
  avatarUrl: string | null;
};
export type AttendeeDetail = {
  username: string;
  email: string;
  contact: string | null;
  socialLink: string | null;
  avatarUrl: string | null;
};

// ── HTTP helper ───────────────────────────────────────────────────────────────
// Data operations go through the Express backend, which forwards this Supabase
// access token to Supabase so RLS + the RPC functions enforce access.

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
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
export async function loginWithGoogleRequest(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) throw new Error(error.message);
}

export async function loginWithFacebookRequest(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "facebook",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) throw new Error(error.message);
}

// Phone sign-in (custom backend OTP). Step 1: the backend matches the phone against
// USER.contact and sends a 6-digit code via Twilio (redirected to the SMS override number).
export async function requestPhoneOtp(phone: string): Promise<void> {
  return postPublic('/api/phone-login/request', { phone: phone.trim() });
}

// Step 2: the backend verifies the code and returns a one-time magic-link token; we exchange
// it for a Supabase session, then load the profile.
export async function verifyPhoneOtp(phone: string, code: string): Promise<AuthUser> {
  const response = await fetch('/api/phone-login/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phone.trim(), code: code.trim() }),
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try { message = (await response.json()).message || message; } catch { /* keep default */ }
    throw new Error(message);
  }
  const { tokenHash } = (await response.json()) as { email: string; tokenHash: string };
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (error) throw new Error(error.message);
  const user = await fetchCurrentUser();
  if (!user) throw new Error("Could not load your profile.");
  return user;
}

// Load the signed-in user's profile (or null if no session). `onboarded` is false
// for a fresh OAuth account that hasn't picked a role yet.
export async function fetchCurrentUser(): Promise<(AuthUser & { onboarded: boolean }) | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data: profile, error } = await supabase
    .from("USER")
    .select("id, username, email, role, avatarUrl, socialLink, contact, onboarded, university, memberType, orgId, universityChanged")
    .eq("id", session.user.id)
    .single();
  if (error || !profile) return null;
  return {
    id: profile.id,
    username: profile.username,
    email: profile.email,
    role: profile.role as Role,
    avatarUrl: profile.avatarUrl,
    telegram: profile.socialLink,
    phone: profile.contact,
    university: profile.university,
    memberType: profile.memberType,
    orgId: profile.orgId,
    universityChanged: profile.universityChanged,
    onboarded: profile.onboarded,
  };
}

// Finish an OAuth sign-up: set the chosen role + username exactly once. Returns the
// refreshed profile, or throws a friendly error.
export async function completeOauthSignupRequest(
  role: Role,
  username: string,
  org?: { university: string; memberType: MemberType; orgId: string },
  userUniversity?: string | null,
): Promise<AuthUser> {
  const { data, error } = await supabase.rpc("complete_oauth_signup", {
    p_role: role,
    p_username: username.trim(),
    p_university: org?.university ?? userUniversity ?? null,
    p_member_type: org?.memberType ?? null,
    p_org_id: org?.orgId?.trim() ?? null,
  });
  if (error) throw new Error(error.message);
  const result = data as { status?: string; error?: string };
  if (result?.error === "username_taken") throw new Error("That username is taken.");
  if (result?.error === "org_id_taken") throw new Error("That matriculation / staff ID is already registered.");
  if (result?.error === "username_required") throw new Error("Please choose a username.");
  if (result?.error === "invalid_role") throw new Error("Please choose an account type.");
  if (result?.error === "invalid_university") throw new Error("Please choose your university.");
  if (result?.error === "invalid_member_type") throw new Error("Please choose Student, Instructor or Professor.");
  if (result?.error === "invalid_matric") throw new Error("Matriculation ID must be a letter, 8 digits, then a letter (e.g. A12345678B).");
  if (result?.error === "invalid_staff_id") throw new Error("Staff ID must be exactly 9 digits.");
  if (result?.error === "already_onboarded") throw new Error("This account is already set up. Please log in.");
  if (result?.error) throw new Error("Could not finish setting up your account.");
  const user = await fetchCurrentUser();
  if (!user) throw new Error("Could not load your profile.");
  return user;
}

export async function loginRequest(
  identifier: string,
  password: string,
): Promise<AuthUser> {
  // Allow signing in with a username as well as an email. Supabase Auth only
  // accepts an email, so resolve the email from the (publicly readable) USER
  // table when the identifier isn't an email address.
  let email = identifier.trim();
  if (!email.includes("@")) {
    // USER rows are self-only readable, so resolve username → email through a
    // SECURITY DEFINER RPC (returns just the one email for an exact username).
    const { data: resolved, error } = await supabase.rpc("email_for_username", {
      p_username: email,
    });
    if (error || !resolved)
      throw new Error("No account found for that username.");
    email = resolved as string;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new Error(error.message);

  const { data: profile, error: profileError } = await supabase
    .from("USER")
    .select("id, username, email, role, avatarUrl, socialLink, contact, university, memberType, orgId, universityChanged")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile) throw new Error("Could not load user profile.");
  // Telegram is stored in socialLink, phone number in contact.
  return {
    id: profile.id,
    username: profile.username,
    email: profile.email,
    role: profile.role as Role,
    avatarUrl: profile.avatarUrl,
    telegram: profile.socialLink,
    phone: profile.contact,
    university: profile.university,
    memberType: profile.memberType,
    orgId: profile.orgId,
    universityChanged: profile.universityChanged,
  };
}

export async function registerRequest(input: {
  username: string;
  email: string;
  password: string;
  role: Role;
  avatarUrl?: string;
  telegram?: string;
  phone?: string;
  university?: string;
  memberType?: MemberType;
  orgId?: string;
}): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        username: input.username,
        name: input.username,
        role: input.role,
        avatarUrl: input.avatarUrl ?? null,
        telegram: input.telegram ?? null,
        phone: input.phone ?? null,
        university: input.university ?? null,
        memberType: input.memberType ?? null,
        orgId: input.orgId?.trim() ?? null,
      },
    },
  });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error("Sign up failed — please try again.");
  return {
    id: data.user.id,
    username: input.username,
    email: input.email,
    role: input.role,
    avatarUrl: input.avatarUrl,
    telegram: input.telegram ?? null,
    phone: input.phone ?? null,
    university: input.university ?? null,
    memberType: input.memberType ?? null,
    orgId: input.orgId ?? null,
  };
}

// Best-effort "account created" email, sent right after signup (needs the new
// session). Safe to ignore failures — it must never block the signup flow.
export async function sendWelcomeEmailRequest(): Promise<void> {
  await apiFetch('/api/notifications/welcome', { method: 'POST' });
}

// Persist a username change (own row); reject duplicates (USER.username is unique).
export async function updateUsernameRequest(username: string): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("USER")
    .update({ username })
    .eq("id", userId);
  if (error) {
    if (error.code === "23505") throw new Error("That username is taken.");
    throw new Error(error.message);
  }
}

// Persist the user's contact details (own row): Telegram → socialLink, phone → contact.
// Empty strings are stored as NULL so the Profile line hides cleanly.
export async function updateContactRequest(
  telegram: string,
  phone: string,
): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("USER")
    .update({
      socialLink: telegram.trim() || null,
      contact: phone.trim() || null,
    })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

// One-time university change (covers switching schools or going from "not enrolled" → a choice).
// `university` is a code (e.g. 'SMU') or null for "not enrolled". Throws if already used.
export async function changeUniversityRequest(university: string | null): Promise<void> {
  const { data, error } = await supabase.rpc("change_my_university", { p_university: university });
  if (error) throw new Error(error.message);
  const result = data as { status?: string; error?: string };
  if (result?.error === "already_changed") throw new Error("You've already used your one-time university change.");
  if (result?.error === "invalid_university") throw new Error("Please choose a valid university.");
  if (result?.error === "not_authenticated") throw new Error("Please log in again.");
  if (result?.error) throw new Error("Could not update your university.");
}

// Permanently delete the signed-in user's account (blocked server-side if they host events).
export async function deleteAccountRequest(): Promise<void> {
  const { error } = await supabase.rpc("delete_my_account");
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
// `identifier` is an email (email channel) or a phone number (SMS channel). Returns the
// resolved account email so the rest of the reset flow stays email-keyed.
export async function requestPasswordReset(identifier: string, channel: 'email' | 'sms' = 'email'): Promise<{ email: string }> {
  const response = await fetch('/api/password-reset/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: identifier.trim(), channel }),
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try { message = (await response.json()).message || message; } catch { /* keep default */ }
    throw new Error(message);
  }
  const data = (await response.json()) as { email: string };
  return { email: data.email };
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
  const fromName = file.name.split(".").pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  return (file.type.split("/")[1] || "png").toLowerCase();
}

async function currentUserId(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("You must be signed in.");
  return session.user.id;
}

// Uploads/replaces the signed-in user's avatar and saves the URL on their USER row.
export async function uploadAvatar(file: File): Promise<string> {
  const userId = await currentUserId();
  const path = `${userId}/avatar.${fileExt(file)}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw new Error(error.message);
  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);
  // Cache-bust so a replaced image refreshes immediately.
  const url = `${publicUrl}?t=${Date.now()}`;
  const { error: updateError } = await supabase
    .from("USER")
    .update({ avatarUrl: url })
    .eq("id", userId);
  if (updateError) throw new Error(updateError.message);
  return url;
}

// Selects a preset avatar (a /avatars/*.svg path) as the user's profile picture.
export async function setAvatar(url: string): Promise<string> {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("USER")
    .update({ avatarUrl: url })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  return url;
}

export async function removeAvatar(): Promise<void> {
  const userId = await currentUserId();
  await supabase.storage
    .from("avatars")
    .remove([
      `${userId}/avatar.png`,
      `${userId}/avatar.jpg`,
      `${userId}/avatar.jpeg`,
      `${userId}/avatar.webp`,
      `${userId}/avatar.gif`,
    ]);
  const { error } = await supabase
    .from("USER")
    .update({ avatarUrl: null })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

// Uploads an event banner and returns its public URL (saved on the event when published).
export async function uploadEventImage(file: File): Promise<string> {
  const userId = await currentUserId();
  const path = `${userId}/${Date.now()}.${fileExt(file)}`;
  const { error } = await supabase.storage
    .from("event-images")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw new Error(error.message);
  const {
    data: { publicUrl },
  } = supabase.storage.from("event-images").getPublicUrl(path);
  return publicUrl;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export function fetchEvents(_role: Role | null): Promise<EventItem[]> {
  return apiFetch<EventItem[]>("/api/events");
}

export function fetchProfile(_role: Role): Promise<ProfileResponse> {
  return apiFetch<ProfileResponse>("/api/profile");
}

export function fetchAttendees(eventId: string): Promise<Attendee[]> {
  return apiFetch<Attendee[]>(`/api/events/${eventId}/attendees`);
}

export function fetchAttendeeDetails(
  eventId: string,
): Promise<AttendeeDetail[]> {
  return apiFetch<AttendeeDetail[]>(`/api/events/${eventId}/attendees/details`);
}

export function fetchQuote(
  _role: Role | null,
  eventId: string,
  qty: number,
): Promise<Quote> {
  return apiFetch<Quote>(`/api/checkout/${eventId}/quote?qty=${qty}`);
}

// ── User writes ───────────────────────────────────────────────────────────────
// `attemptId` is a per-checkout UUID reused across retries — the backend keys both the Stripe
// charge and the booking on it, so a retry can never double-charge. Callers should generate it
// once per checkout attempt (not per retry) and pass the same value on every retry.
export function createPledge(_role: Role, eventId: string, qty: number, _amount: number, paymentMethod: 'wallet' | 'card' = 'wallet', attemptId?: string): Promise<MutationResponse> {
  return apiFetch<MutationResponse>(`/api/checkout/${eventId}/pledge`, {
    method: 'POST',
    body: JSON.stringify({ qty, paymentMethod, attemptId: attemptId ?? crypto.randomUUID() }),
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
export function topUpWallet(amount: number, attemptId?: string): Promise<{ balance: number }> {
  return apiFetch('/api/wallet/topup', { method: 'POST', body: JSON.stringify({ amount, attemptId: attemptId ?? crypto.randomUUID() }) });
}

export function giveAwayTickets(_role: Role, bookingId: string, quantity: number): Promise<MutationResponse> {
  return apiFetch<MutationResponse>(`/api/profile/bookings/${bookingId}/give-away`, {
    method: 'POST',
    body: JSON.stringify({ quantity }),
  });
}

export function deleteBooking(
  _role: Role,
  bookingId: string,
): Promise<MutationResponse> {
  return apiFetch<MutationResponse>(`/api/profile/bookings/${bookingId}`, {
    method: "DELETE",
  });
}

// ── Organiser writes ──────────────────────────────────────────────────────────

export async function createEventRequest(event: EventItem): Promise<string> {
  if (!event.startsAt || !event.endsAt || !event.deadlineAt) {
    throw new Error("Event is missing date information.");
  }
  const data = await apiFetch<{ eventId: string }>(
    "/api/hosted-events/events",
    {
      method: "POST",
      body: JSON.stringify(event),
    },
  );
  return data.eventId;
}

export async function updateEventRequest(event: EventItem): Promise<void> {
  if (!event.startsAt || !event.endsAt || !event.deadlineAt) return;
  await apiFetch(`/api/hosted-events/events/${event.id}`, {
    method: "PATCH",
    body: JSON.stringify(event),
  });
}

export async function deleteEventRequest(eventId: string): Promise<void> {
  await apiFetch(`/api/hosted-events/events/${eventId}`, { method: "DELETE" });
}

// Soft-cancel a published event with a reason (backend refunds live pledges to wallets).
export async function cancelEventRequest(eventId: string, reason: string): Promise<void> {
  await apiFetch(`/api/hosted-events/events/${eventId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

// Hide a cancelled event from the organiser's dashboard (backers keep their record).
export async function hideEventRequest(eventId: string): Promise<void> {
  await apiFetch(`/api/hosted-events/events/${eventId}/hide`, { method: 'POST' });
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export type DayCount = { day: string; count: number };
export type AnalyticsData = {
  role: Role;
  global: {
    topEvents: { eventId: string; title: string; hostName: string; ticketsSold: number; pledgers: number; hypePct: number; status: string }[];
    pledgesByDay: DayCount[];
    statusBreakdown: { status: string; count: number }[];
    priceBuckets: { bucket: string; count: number }[];
  };
  organiser: {
    perEvent: { title: string; ticketsSold: number; capacity: number; projected: number; revenue: number }[];
    pledgesByDay: DayCount[];
    totals: { events: number; revenue: number; attendees: number };
    past: { tickets: number; revenue: number; profit: number };
  } | null;
  user: {
    pledgesByDay: DayCount[];
    spendByMonth: { month: string; amount: number }[];
    spendByDay: { day: string; amount: number }[];
    totals: { joined: number; upcoming: number; spent: number };
  };
  platform?: {
    totals: { events: number; revenue: number; attendees: number };
    topOrganisers: { name: string; events: number; tickets: number }[];
  } | null;
};

export function fetchAnalytics(): Promise<AnalyticsData> {
  return apiFetch<AnalyticsData>("/api/analytics");
}

// Backend-local ticket revenue forecast. `available:false` lets the dashboard degrade gracefully.
export type RevenueForecast = {
  available: boolean;
  attractiveness?: number;
  projectedTicketsSold?: number;
  avgTicketPrice?: number;
  projectedRevenue?: number;
  dailySales?: { dayOffset: number; tickets: number }[];
  dailyRevenue?: { dayOffset: number; revenue: number }[];
  breakdown?: Record<string, number>;
  operationalCosts?: { category: string; cost: number }[];
  totalOperationalCost?: number;
  estimatedNet?: number;
};

export function fetchRevenueForecast(eventId: string): Promise<RevenueForecast> {
  return apiFetch<RevenueForecast>(`/api/analytics/forecast/${eventId}`);
}

// ── AI agent (multi-provider; all responses tolerate {available:false}) ────

export type EventCopySuggestions = { available: boolean; names?: string[]; descriptions?: string[] };
export type RevenueTip = { title: string; detail: string; impact: 'high' | 'medium' | 'low' };
export type RevenueTips = { available: boolean; tips?: RevenueTip[] };
export type EventRecommendation = { eventId: string; title: string; cheapestPrice: number | null; reason: string };
export type EventRecommendations = { available: boolean; recommendations?: EventRecommendation[] };
export type AssistantAnswer = { available: boolean; answer?: string };
export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type AgentProposal = { id: string; action: string; eventId: string; title: string; summary: string; payload?: Record<string, unknown> };
export type AgentResult = { proposalId: string; action: string; ok: boolean; message?: string; status?: string };
export type ChatStatus = 'awaiting_confirmation' | 'done';
export type ChatReply = { available: boolean; status?: ChatStatus; reply?: string; proposals?: AgentProposal[]; results?: AgentResult[]; threadId?: string; provider?: string; model?: string; conversationId?: string | null };
export type ActionResult = { status?: string; message?: string };
export type AiModel = { provider: string; model: string; label: string; tier?: string };
export type AiModels = { available: boolean; models: AiModel[] };

export function suggestEventCopy(input: { title?: string; theme?: string; audience?: string; university?: string }): Promise<EventCopySuggestions> {
  return apiFetch<EventCopySuggestions>('/api/ai/suggest-event-copy', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchRevenueTips(eventId: string): Promise<RevenueTips> {
  return apiFetch<RevenueTips>(`/api/ai/revenue-tips/${eventId}`, { method: 'POST', body: JSON.stringify({}) });
}

export function fetchEventRecommendations(interests: string): Promise<EventRecommendations> {
  return apiFetch<EventRecommendations>('/api/ai/recommend-events', { method: 'POST', body: JSON.stringify({ interests }) });
}

export function askAssistant(question: string, history: ChatMessage[] = []): Promise<AssistantAnswer> {
  return apiFetch<AssistantAnswer>('/api/ai/ask', { method: 'POST', body: JSON.stringify({ question, history }) });
}

export function sendChat(messages: ChatMessage[], model?: { provider: string; model: string }, conversationId?: string | null, mode: 'ask' | 'auto' = 'ask'): Promise<ChatReply> {
  return apiFetch<ChatReply>('/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages, conversationId: conversationId ?? null, mode, ...(model ?? {}) }) });
}

// Confirm/reject one pending proposal, resuming the parked graph thread.
export function resumeChat(threadId: string, proposalId: string, decision: 'confirm' | 'reject', conversationId?: string | null, model?: { provider: string; model: string }): Promise<ChatReply> {
  return apiFetch<ChatReply>('/api/ai/chat/resume', { method: 'POST', body: JSON.stringify({ threadId, proposalId, decision, conversationId: conversationId ?? null, ...(model ?? {}) }) });
}

export function fetchAiModels(): Promise<AiModels> {
  return apiFetch<AiModels>('/api/ai/models');
}

export function executeAiAction(action: string, eventId: string, payload?: Record<string, unknown>): Promise<ActionResult> {
  return apiFetch<ActionResult>('/api/ai/execute-action', { method: 'POST', body: JSON.stringify({ action, eventId, payload }) });
}

export type StoredChatMessage = { role: 'user' | 'assistant'; content: string; model?: string | null };
export type AiConversation = { id: string; title: string; updatedAt: string };

export function fetchConversations(): Promise<{ conversations: AiConversation[] }> {
  return apiFetch<{ conversations: AiConversation[] }>('/api/ai/conversations');
}
export function fetchConversation(id: string): Promise<{ messages: StoredChatMessage[] }> {
  return apiFetch<{ messages: StoredChatMessage[] }>(`/api/ai/conversations/${id}`);
}
export function deleteConversation(id: string): Promise<{ status?: string }> {
  return apiFetch<{ status?: string }>(`/api/ai/conversations/${id}`, { method: 'DELETE' });
}

export type AiMemory = { id: number; content: string; category?: string | null };
export function fetchMemories(): Promise<{ memories: AiMemory[] }> {
  return apiFetch<{ memories: AiMemory[] }>('/api/ai/memory');
}
export function deleteMemory(id: number): Promise<{ status?: string }> {
  return apiFetch<{ status?: string }>(`/api/ai/memory/${id}`, { method: 'DELETE' });
}
export function clearMemories(): Promise<{ status?: string }> {
  return apiFetch<{ status?: string }>('/api/ai/memory', { method: 'DELETE' });
}

// ── Attendees & ticket check-in (organiser) ───────────────────────────────────

export type AttendeeRow = {
  eventTitle: string;
  username: string;
  email: string;
  contact: string | null;
  socialLink: string | null;
  ticketCount: number;
  status: string;
};

export function fetchAllAttendees(): Promise<AttendeeRow[]> {
  return apiFetch<AttendeeRow[]>("/api/hosted-events/attendees");
}

export type EventTicket = { qrCode: string; username: string; status: string };

export function fetchEventTickets(eventId: string): Promise<EventTicket[]> {
  return apiFetch<EventTicket[]>(`/api/hosted-events/events/${eventId}/tickets`);
}

export type CheckInResult = { status?: 'ok'; error?: string; attendee?: string; eventTitle?: string; checkedIn?: number; total?: number };

// Unified check-in: a 'PF-' code checks in one ticket; a booking token checks in all remaining.
export function checkInTicket(qr: string): Promise<CheckInResult> {
  return apiFetch<CheckInResult>("/api/hosted-events/check-in", {
    method: "POST",
    body: JSON.stringify({ qr }),
  });
}

export function fetchCoOrganiserInvites(): Promise<CoOrganiserInvite[]> {
  return apiFetch<CoOrganiserInvite[]>("/api/hosted-events/coorganiser-invites");
}

export function inviteCoOrganiserRequest(eventId: string, identifier: string): Promise<CoOrganiserInvite> {
  return apiFetch<CoOrganiserInvite>(`/api/hosted-events/events/${eventId}/coorganisers/invite`, {
    method: "POST",
    body: JSON.stringify({ identifier }),
  });
}

export function acceptCoOrganiserInviteRequest(inviteId: string): Promise<{ status: "ok"; eventId: string }> {
  return apiFetch<{ status: "ok"; eventId: string }>(`/api/hosted-events/coorganiser-invites/${inviteId}/accept`, {
    method: "POST",
  });
}

export function declineCoOrganiserInviteRequest(inviteId: string): Promise<{ status: "ok"; eventId: string }> {
  return apiFetch<{ status: "ok"; eventId: string }>(`/api/hosted-events/coorganiser-invites/${inviteId}/decline`, {
    method: "POST",
  });
}

// ── Organiser drafts (persisted per-user via the backend) ─────────────────────

export function fetchHostedSummary(): Promise<HostedSummary> {
  return apiFetch<HostedSummary>("/api/hosted-events/summary");
}

export function fetchDrafts(): Promise<EventItem[]> {
  return apiFetch<EventItem[]>("/api/hosted-events/drafts");
}

export function saveDraftRequest(draft: EventItem): Promise<EventItem> {
  return apiFetch<EventItem>("/api/hosted-events/drafts", {
    method: "POST",
    body: JSON.stringify(draft),
  });
}

export function deleteDraftRequest(id: string): Promise<void> {
  return apiFetch<void>(`/api/hosted-events/drafts/${id}`, {
    method: "DELETE",
  });
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export type AdminLicense = { username: string; licenseId: string; issued: string; validity: string };

export function fetchLicense(): Promise<AdminLicense> {
  return apiFetch<AdminLicense>("/api/admin/license");
}

export function adminCancelEvent(eventId: string, reason: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/admin/events/${eventId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

// Open the admin license certificate PDF in a new tab (auth via bearer → blob URL).
export async function openLicensePdf(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/admin/license/pdf", {
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  });
  if (!res.ok) throw new Error("Could not load license.");
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
