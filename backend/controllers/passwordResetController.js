import { requestReset, verifyReset, completeReset } from '../services/passwordResetService.js';

const MESSAGES = {
  no_account: 'No account found for that email.',
  no_phone: 'No phone number is saved on this account.',
  sms_failed: 'Unable to send the SMS code. Try email instead.',
  invalid_code: 'That code is incorrect.',
  expired_code: 'That code has expired. Request a new one.',
  too_many_attempts: 'Too many attempts. Request a new code.',
  weak_password: 'Password must be at least 6 characters.',
};
const msg = (code, fallback) => MESSAGES[code] ?? fallback;

export async function postRequest(req, res) {
  const channel = req.body?.channel === 'sms' ? 'sms' : 'email';
  const result = await requestReset(req.body?.email ?? '', channel);
  if (result.error) {
    res.status(result.error === 'no_account' ? 404 : 400).json({ status: result.error, message: msg(result.error, 'Unable to send a reset code.') });
    return;
  }
  res.json({ status: 'ok', email: result.email });
}

export function postVerify(req, res) {
  const result = verifyReset(req.body?.email ?? '', req.body?.code ?? '');
  if (result.error) {
    res.status(400).json({ status: result.error, message: msg(result.error, 'That code is invalid.') });
    return;
  }
  res.json({ status: 'ok' });
}

export async function postComplete(req, res) {
  const result = await completeReset(req.body?.email ?? '', req.body?.code ?? '', req.body?.password ?? '');
  if (result.error) {
    res.status(400).json({ status: result.error, message: msg(result.error, 'Unable to reset password.') });
    return;
  }
  res.json({ status: 'ok' });
}
