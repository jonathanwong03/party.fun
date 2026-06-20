import { createClient } from '@supabase/supabase-js';

// A privileged Supabase client using the SERVICE-ROLE key. It bypasses RLS, so it
// is used ONLY for trusted server-side operations the signed-out user can't do
// themselves — currently the password-reset flow (look up a user by email and
// update their password via the Auth admin API). Never expose this to the client.
let cached = null;

export function adminClient() {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for the password-reset flow.');
  }
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}
