import { adminClient } from './supabaseAdmin.js';
import { sendSms } from './smsService.js';
import { makeCodeStore } from './codeStore.js';

// Custom phone-OTP login. The phone a user types is matched against USER.contact (the number
// they gave at signup, which may be mock). A 6-digit code is sent via Twilio — redirected to
// SMS_OVERRIDE_NUMBER in dev — and on success we mint a Supabase session with the service-role
// admin API (generateLink). Codes live in Redis when configured, else in memory.
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

// Injectable seam so unit tests can stub Supabase/SMS and inspect the code store.
// `store` is Redis-backed when REDIS_URL is set, in-memory otherwise (see codeStore.js).
export const dependencies = {
  adminClient,
  sendSms,
  store: makeCodeStore('otp:phone:', CODE_TTL_MS),
  sixDigit: () => String(Math.floor(100000 + Math.random() * 900000)),
};

// Strip to digits and drop a leading Singapore country code so "+65 9967 6766", "6599676766"
// and "9967 6766" all compare equal.
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
    .select('id, email, contact')
    .not('contact', 'is', null);
  if (error) throw new Error(error.message);
  return (data ?? []).find((u) => normalisePhone(u.contact) === target) ?? null;
}

async function checkCode(phone, code) {
  const key = normalisePhone(phone);
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

export async function requestPhoneLogin(phone) {
  const user = await findUserByPhone(phone);
  if (!user) return { error: 'no_phone_account' };
  if (!user.email) return { error: 'no_phone_account' }; // need an email to mint the session

  const code = dependencies.sixDigit();
  await dependencies.store.set(normalisePhone(phone), { code, expiresAt: Date.now() + CODE_TTL_MS, attempts: 0, userId: user.id, email: user.email });

  const result = await dependencies.sendSms(user.contact, `Your party.fun login code is ${code}. It expires in 10 minutes.`);
  if (!result.success) return { error: 'sms_failed' };
  return { status: 'ok' };
}

export async function verifyPhoneLogin(phone, code) {
  const result = await checkCode(phone, code);
  if (result.error) return { error: result.error };

  // Mint a one-time login token for this user's email (no email is actually sent).
  const { data, error } = await dependencies.adminClient().auth.admin.generateLink({
    type: 'magiclink',
    email: result.entry.email,
  });
  if (error) return { error: error.message };

  await dependencies.store.del(normalisePhone(phone));
  return { status: 'ok', email: result.entry.email, tokenHash: data.properties.hashed_token };
}
