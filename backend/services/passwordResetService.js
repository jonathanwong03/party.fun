import { adminClient } from './supabaseAdmin.js';
import { notifyPasswordReset } from './notificationService.js';
import { sendSms } from './smsService.js';

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
    .select('id, email, username, role, contact')
    .ilike('email', normalise(email))
    .limit(1);
  if (error) throw new Error(error.message);
  return data && data.length ? data[0] : null;
}

// Strip to digits and drop a leading Singapore country code (same rule as phoneLoginService),
// so a phone typed at the reset screen matches the mock number stored in USER.contact.
function normalisePhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length > 8 && d.startsWith('65')) d = d.slice(2);
  return d;
}

async function findUserByPhone(phone) {
  const target = normalisePhone(phone);
  if (!target) return null;
  const { data, error } = await adminClient()
    .from('USER')
    .select('id, email, username, role, contact')
    .not('contact', 'is', null);
  if (error) throw new Error(error.message);
  return (data ?? []).find((u) => normalisePhone(u.contact) === target) ?? null;
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

// `identifier` is an email (email channel, or any input containing '@') or a phone number
// (SMS channel). The code is always keyed by the resolved user's email, so verify/complete
// stay email-based; the resolved email is returned for the frontend to carry forward.
export async function requestReset(identifier, channel = 'email') {
  const id = String(identifier ?? '').trim();
  const user = id.includes('@') ? await findUser(id) : await findUserByPhone(id);
  if (!user) return { error: 'no_account' };

  // SMS delivery needs a phone on file.
  if (channel === 'sms' && !user.contact) return { error: 'no_phone' };

  const code = sixDigit();
  store.set(normalise(user.email), { code, expiresAt: Date.now() + CODE_TTL_MS, attempts: 0, userId: user.id, username: user.username });

  // Awaited so the HTTP response reflects whether the message was dispatched.
  if (channel === 'sms') {
    const result = await sendSms(user.contact, `Your party.fun password reset code is ${code}. It expires in 10 minutes.`);
    if (!result.success) return { error: 'sms_failed' };
  } else {
    await notifyPasswordReset({ email: user.email, username: user.username, role: user.role, code });
  }
  return { status: 'ok', email: user.email };
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
