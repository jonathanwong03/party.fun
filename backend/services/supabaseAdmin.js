import { createClient } from '@supabase/supabase-js';

// A privileged Supabase client using the SERVICE-ROLE key. It bypasses RLS, so it is used ONLY
// for trusted server-side operations that either have no signed-in user to act as, or must not
// trust one: card payments (create_pledge_card) and wallet top-ups (wallet_topup), admin
// moderation, the deadline scheduler, Stripe refunds & reconciliation, ticket PDFs, and the
// phone/password-reset OTP flows. Never expose this to the client.
let cached = null;

export function adminClient() {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Hit at runtime when a service-role path (card pledge, top-up, admin, scheduler) runs
    // without the key — the single easiest env var to forget on a fresh deploy.
    throw new Error('SUPABASE_SERVICE_ROLE_KEY (and SUPABASE_URL) must be set — it is required for card payments, wallet top-ups, admin moderation, the scheduler and refunds.');
  }
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}
