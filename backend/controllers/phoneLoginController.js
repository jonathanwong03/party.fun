import { requestPhoneLogin, verifyPhoneLogin } from '../services/phoneLoginService.js';

const MESSAGES = {
  no_phone_account: 'No account is registered with that phone number.',
  sms_failed: 'Unable to send the SMS code. Try another sign-in method.',
  invalid_code: 'That code is incorrect.',
  expired_code: 'That code has expired. Request a new one.',
  too_many_attempts: 'Too many attempts. Request a new code.',
};
const msg = (code, fallback) => MESSAGES[code] ?? fallback;

export async function postRequest(req, res) {
  const result = await requestPhoneLogin(req.body?.phone ?? '');
  if (result.error) {
    res.status(result.error === 'no_phone_account' ? 404 : 400).json({ status: result.error, message: msg(result.error, 'Unable to send a login code.') });
    return;
  }
  res.json({ status: 'ok' });
}

export async function postVerify(req, res) {
  const result = await verifyPhoneLogin(req.body?.phone ?? '', req.body?.code ?? '');
  if (result.error) {
    res.status(400).json({ status: result.error, message: msg(result.error, 'That code is invalid.') });
    return;
  }
  res.json({ status: 'ok', email: result.email, tokenHash: result.tokenHash });
}
