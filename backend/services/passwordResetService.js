import { adminClient } from './supabaseAdmin.js';
import { notifyPasswordReset } from './notificationService.js';
import { sendSms } from './smsService.js';
import { makeCodeStore } from './codeStore.js';

// Custom password-reset OTP. The 6-digit code is generated here and emailed via
// Resend (so it honours NOTIFICATION_OVERRIDE_EMAIL in dev), then the password is
// updated with the service-role Auth admin API. Codes live in Redis when configured,
// else in memory.
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

// Injectable seam so unit tests can stub Supabase/Resend/SMS and inspect the code store.
// `store` is Redis-backed when REDIS_URL is set, in-memory otherwise (see codeStore.js).
export const dependencies = {
  adminClient,
  notifyPasswordReset,
  sendSms,
  store: makeCodeStore('otp:reset:', CODE_TTL_MS),
  sixDigit: () => String(Math.floor(100000 + Math.random() * 900000)),
};

const normalise = (email) => (email ?? '').trim().toLowerCase();

async function findUser(email) {
  const { data, error } = await dependencies.adminClient()
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
  const { data, error } = await dependencies.adminClient()
    .from('USER')
    .select('id, email, username, role, contact')
    .not('contact', 'is', null);
  if (error) throw new Error(error.message);
  return (data ?? []).find((u) => normalisePhone(u.contact) === target) ?? null;
}

// Validate a stored code; returns the entry on success or an error string.
async function checkCode(email, code) {
  const key = normalise(email);
  const entry = await dependencies.store.get(key);
  if (!entry) return { error: 'invalid_code' };
  if (Date.now() > entry.expiresAt) { await dependencies.store.del(key); return { error: 'expired_code' }; }
  if (entry.attempts >= MAX_ATTEMPTS) { await dependencies.store.del(key); return { error: 'too_many_attempts' }; }
  if (entry.code !== String(code ?? '').trim()) {
    entry.attempts += 1;
    await dependencies.store.set(key, entry);
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

  const code = dependencies.sixDigit();
  await dependencies.store.set(normalise(user.email), { code, expiresAt: Date.now() + CODE_TTL_MS, attempts: 0, userId: user.id, username: user.username });

  // Awaited so the HTTP response reflects whether the message was dispatched.
  if (channel === 'sms') {
    const result = await dependencies.sendSms(user.contact, `Your party.fun password reset code is ${code}. It expires in 10 minutes.`);
    if (!result.success) return { error: 'sms_failed' };
  } else {
    await dependencies.notifyPasswordReset({ email: user.email, username: user.username, role: user.role, code });
  }
  return { status: 'ok', email: user.email };
}

export async function verifyReset(email, code) {
  const result = await checkCode(email, code);
  if (result.error) return { error: result.error };
  return { status: 'ok' };
}

export async function completeReset(email, code, password) {
  if (!password || String(password).length < 6) return { error: 'weak_password' };
  const result = await checkCode(email, code);
  if (result.error) return { error: result.error };

  const { error } = await dependencies.adminClient().auth.admin.updateUserById(result.entry.userId, { password });
  if (error) return { error: error.message };

  await dependencies.store.del(normalise(email));
  return { status: 'ok' };
}
