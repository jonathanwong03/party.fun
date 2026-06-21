import { adminClient } from './supabaseAdmin.js';
import { notifyPasswordReset } from './notificationService.js';

// Custom password-reset OTP. The 6-digit code is generated here and emailed via
// Resend (so it honours NOTIFICATION_OVERRIDE_EMAIL in dev), then the password is
// updated with the service-role Auth admin API. Codes live in memory only.
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

// email (lowercased) -> { code, expiresAt, attempts, userId, username }
const store = new Map();

const normalise = (email) => (email ?? '').trim().toLowerCase();
const sixDigit = () => String(Math.floor(100000 + Math.random() * 900000));

async function findUser(email) {
  const { data, error } = await adminClient()
    .from('USER')
    .select('id, email, username, role')
    .ilike('email', normalise(email))
    .limit(1);
  if (error) throw new Error(error.message);
  return data && data.length ? data[0] : null;
}

// Validate a stored code; returns the entry on success or an error string.
function checkCode(email, code) {
  const key = normalise(email);
  const entry = store.get(key);
  if (!entry) return { error: 'invalid_code' };
  if (Date.now() > entry.expiresAt) { store.delete(key); return { error: 'expired_code' }; }
  if (entry.attempts >= MAX_ATTEMPTS) { store.delete(key); return { error: 'too_many_attempts' }; }
  if (entry.code !== String(code ?? '').trim()) {
    entry.attempts += 1;
    return { error: 'invalid_code' };
  }
  return { entry };
}

export async function requestReset(email) {
  const user = await findUser(email);
  if (!user) return { error: 'no_account' };

  const code = sixDigit();
  store.set(normalise(email), { code, expiresAt: Date.now() + CODE_TTL_MS, attempts: 0, userId: user.id, username: user.username });

  // Awaited so the HTTP response reflects whether the email was dispatched.
  await notifyPasswordReset({ email: user.email, username: user.username, role: user.role, code });
  return { status: 'ok' };
}

export function verifyReset(email, code) {
  const result = checkCode(email, code);
  if (result.error) return { error: result.error };
  return { status: 'ok' };
}

export async function completeReset(email, code, password) {
  if (!password || String(password).length < 6) return { error: 'weak_password' };
  const result = checkCode(email, code);
  if (result.error) return { error: result.error };

  const { error } = await adminClient().auth.admin.updateUserById(result.entry.userId, { password });
  if (error) return { error: error.message };

  store.delete(normalise(email));
  return { status: 'ok' };
}
