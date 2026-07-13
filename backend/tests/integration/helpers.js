// Integration-test harness for the payment RPCs (create_pledge / wallet_topup).
//
// These tests exercise the REAL Postgres functions + unique indexes, which the mock-
// based unit tests can't. They run ONLY when a test database is configured, and MUST
// point at a disposable Supabase BRANCH or a local `supabase start` DB — never the
// production project (they create/delete auth users and rows).
//
// Required env vars:
//   TEST_SUPABASE_URL
//   TEST_SUPABASE_SERVICE_ROLE_KEY   (admin API — create users, seed, cleanup)
//   TEST_SUPABASE_ANON_KEY           (defaults to SUPABASE_ANON_KEY) — used to sign in
//                                     test users so RPCs run under their auth.uid().
import { createClient } from '@supabase/supabase-js';

const URL = process.env.TEST_SUPABASE_URL;
const SERVICE = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.TEST_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

// The whole integration suite skips (with a reason) unless all three are present.
export const integrationSkip = (URL && SERVICE && ANON)
  ? false
  : 'set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY / TEST_SUPABASE_ANON_KEY (point at a Supabase branch) to run';

export function admin() {
  return createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}

function anon() {
  return createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Create a confirmed test auth user (the handle_new_user trigger creates the USER row
// and a $20 signup bonus), set its role/onboarded, and return a user-scoped Supabase
// client whose requests run as that user (so auth.uid() and RLS apply in the RPCs).
export async function makeUser({ role = 'user' } = {}) {
  const a = admin();
  const email = `itest+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test-Password-123!';
  const { data, error } = await a.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser: ${error.message}`);
  const id = data.user.id;
  const { error: upErr } = await a.from('USER').update({ role, onboarded: true }).eq('id', id);
  if (upErr) throw new Error(`set role: ${upErr.message}`);

  const { data: session, error: signErr } = await anon().auth.signInWithPassword({ email, password });
  if (signErr) throw new Error(`signIn: ${signErr.message}`);
  const token = session.session.access_token;
  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { id, email, client };
}

export async function deleteUser(id) {
  if (!id) return;
  try { await admin().auth.admin.deleteUser(id); } catch { /* best-effort cleanup */ }
}

// Directly set / read a wallet balance (admin) for deterministic wallet tests.
export async function setWalletBalance(id, balance) {
  const { error } = await admin().from('USER').update({ walletBalance: balance }).eq('id', id);
  if (error) throw new Error(`setWalletBalance: ${error.message}`);
}
export async function getWalletBalance(id) {
  const { data, error } = await admin().from('USER').select('walletBalance').eq('id', id).single();
  if (error) throw new Error(`getWalletBalance: ${error.message}`);
  return Number(data?.walletBalance ?? 0);
}

// Count active bookings for (user,event) — the invariant most tests assert on.
export async function countBookings(userId, eventId) {
  const { data, error } = await admin()
    .from('BOOKINGS')
    .select('id')
    .eq('userId', userId)
    .eq('eventId', eventId)
    .is('deletedAt', null);
  if (error) throw new Error(`countBookings: ${error.message}`);
  return (data ?? []).length;
}

// A future ISO date `days` from now at `hour` (SGT), for event dates.
export function futureIso(days, hour = 19) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
