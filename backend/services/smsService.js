// Twilio SMS sender with a mock-mode fallback, mirroring emailProcessor.js. When the
// Twilio credentials are unset (local dev), the message is logged to the console instead
// of sent, so the reset flow is testable without a Twilio account.
//
// Required env (backend/.env) for real sends:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID.

const SEND_TIMEOUT_MS = 10_000;

const isSet = (v) => typeof v === 'string' && v.trim() !== '' && !v.startsWith('xxxx');

/**
 * Send an SMS via the Twilio REST API.
 * @param {string} to   E.164 phone number (e.g. +6591234567)
 * @param {string} body Message text
 * @returns {Promise<{ success: boolean, mock?: boolean, messageId?: string, error?: string }>}
 */
export async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const messagingService = process.env.TWILIO_MESSAGING_SERVICE_SID;

  // Dev override: redirect every SMS to one real number (registered phones are mock and
  // can't receive SMS). Mirrors NOTIFICATION_OVERRIDE_EMAIL for email.
  const override = process.env.SMS_OVERRIDE_NUMBER;
  if (override && override.trim()) {
    if (to && to !== override.trim()) {
      console.log(`[SmsService] Override active: redirecting SMS from ${to} to ${override.trim()}`);
    }
    to = override.trim();
  }

  if (!to) return { success: false, error: 'no_recipient' };

  if (!isSet(sid) || !isSet(token) || !isSet(messagingService)) {
    // MOCK MODE — no Twilio creds configured.
    console.log('\n=================== MOCK SMS SENT ===================');
    console.log(`To:   ${to}`);
    console.log(`Body: ${body}`);
    console.log('====================================================\n');
    return { success: true, mock: true, messageId: `mock-sms-${Date.now()}` };
  }

  const form = new URLSearchParams();
  form.set('To', to);
  form.set('Body', body);
  form.set('MessagingServiceSid', messagingService);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data?.message || `Twilio error (${res.status})` };
    }
    console.log(`[SmsService] SMS sent to ${to} (SID: ${data.sid})`);
    return { success: true, messageId: data.sid };
  } catch (err) {
    return { success: false, error: err?.message || 'SMS send failed' };
  } finally {
    clearTimeout(timeout);
  }
}
