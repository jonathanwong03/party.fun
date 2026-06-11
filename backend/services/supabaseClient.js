import { createClient } from '@supabase/supabase-js';

// The backend never uses the service-role key. Instead it forwards the caller's
// access token to Supabase so every request runs as that user and Row Level
// Security (plus the SECURITY DEFINER RPC functions) enforce access — exactly as
// they would for a direct frontend call.

function env() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in backend/.env');
  }
  return { url, anonKey };
}

// A client scoped to one user's JWT. Queries/RPCs run as auth.uid() = that user.
export function clientForToken(token) {
  const { url, anonKey } = env();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// An anonymous client for public reads (no signed-in user). Subject to RLS for
// the `anon` role.
export function anonClient() {
  const { url, anonKey } = env();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
