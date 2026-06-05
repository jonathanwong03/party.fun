import { createPlaceholderHandler } from '../utils/apiPlaceholder.js';
import { authenticate, registerUser, resetUsers } from '../services/userMemoryService.js';

const authNote = {
  note: 'Basic mock auth backed by the in-memory user list. No sessions yet.',
};

export const getLogin = createPlaceholderHandler('login', authNote);
export const getRegister = createPlaceholderHandler('register', authNote);
export const getLogout = createPlaceholderHandler('logout', authNote);
export const postLogout = createPlaceholderHandler('logout', authNote);

export function postLogin(req, res) {
  const { identifier, email, username, password } = req.body ?? {};
  const result = authenticate(identifier || email || username, password);

  if (result.status === 'not_found') {
    res.status(404).json({ status: 'not_found', message: 'User not found.' });
    return;
  }
  if (result.status === 'bad_password') {
    res.status(401).json({ status: 'bad_password', message: 'Incorrect password.' });
    return;
  }
  res.json({ status: 'ok', user: result.user });
}

export function postRegister(req, res) {
  const { username, email, password, role } = req.body ?? {};
  if (!username || !email || !password) {
    res.status(400).json({ status: 'invalid', message: 'Username, email and password are required.' });
    return;
  }

  const result = registerUser({ username, email, password, role });
  if (result.status === 'exists') {
    res.status(409).json({ status: 'exists', message: 'An account with that email already exists.' });
    return;
  }
  res.status(201).json({ status: 'ok', user: result.user });
}

export function postReset(_req, res) {
  resetUsers();
  res.json({ status: 'ok' });
}
