// Client-side idle-timeout: sign the user out after 30 minutes of inactivity.
// The Supabase session itself still persists in localStorage (and its token keeps
// refreshing), so reopening the app within 30 min of the last activity stays logged in;
// past 30 min idle, the next load (or the periodic check) signs out.
//
// `lastActivity` is updated only by genuine user interaction and by explicit logins
// (resetActivity) — NOT by page reloads — so the idle clock survives a browser restart.

import { supabase } from './supabase';

export const IDLE_LIMIT_MS = 30 * 60 * 1000; // 30 minutes
const STORAGE_KEY = 'pf.lastActivity';
const CHECK_INTERVAL_MS = 30 * 1000; // re-check every 30s
const WRITE_THROTTLE_MS = 10 * 1000; // at most one localStorage write / 10s

function getLast(): number {
  const v = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// Call after a successful login to start the idle clock fresh.
export function resetActivity(): void {
  localStorage.setItem(STORAGE_KEY, String(Date.now()));
}

let lastWrite = 0;
function markActivity(): void {
  const now = Date.now();
  if (now - lastWrite < WRITE_THROTTLE_MS) return;
  lastWrite = now;
  localStorage.setItem(STORAGE_KEY, String(now));
}

async function enforce(): Promise<void> {
  const last = getLast();
  if (!last) return;
  if (Date.now() - last > IDLE_LIMIT_MS) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) await supabase.auth.signOut(); // triggers App's onAuthStateChange cleanup
    localStorage.removeItem(STORAGE_KEY);
  }
}

// Run the idle check ONCE and await its completion (incl. any sign-out). Call this on
// app load BEFORE restoring the session, so a >30-min-idle user is signed out first and
// the app renders the clean logged-out events page instead of flashing a stale-auth 401.
export async function enforceIdleNow(): Promise<void> {
  await enforce();
}

let installed = false;
export function installIdleTimeout(): void {
  if (installed) return;
  installed = true;

  // On load: if a session exists with no timestamp yet (e.g. just signed in via OAuth),
  // seed it; otherwise enforce the idle limit immediately.
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session && !getLast()) resetActivity();
    else void enforce();
  });

  // Clear the clock on explicit sign-out so a future login starts fresh.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') localStorage.removeItem(STORAGE_KEY);
  });

  (['mousedown', 'keydown', 'scroll', 'touchstart'] as const).forEach((e) =>
    window.addEventListener(e, markActivity, { passive: true }),
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void enforce();
  });

  setInterval(() => void enforce(), CHECK_INTERVAL_MS);
}
