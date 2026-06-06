import { DEFAULT_MOCK_USER_ID } from '../data/mockPledges.js';

const VALID_ROLES = new Set(['user', 'organiser']);

export function readMockAuth(req) {
  const role = req.get('X-Mock-Role');
  const userId = req.get('X-Mock-User-Id') || DEFAULT_MOCK_USER_ID;
  return { role, userId };
}

export function requireMockRole(req, res) {
  const auth = readMockAuth(req);
  if (!auth.role) {
    res.status(401).json({ status: 'unauthenticated', message: 'Missing X-Mock-Role header.' });
    return null;
  }
  if (!VALID_ROLES.has(auth.role)) {
    res.status(403).json({ status: 'forbidden', message: 'X-Mock-Role must be user or organiser.' });
    return null;
  }
  return auth;
}
