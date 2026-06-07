import bcrypt from 'bcryptjs';
import { initialUsers } from '../data/mockUsers.js';
import { initialAuthUsers } from '../data/mockAuthUsers.js';

const clone = (value) => structuredClone(value);
let users = clone(initialUsers);
// auth.users simulation: credentials only, keyed by the same id as the profile.
let authUsers = clone(initialAuthUsers);

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
  };
}

export async function authenticate(identifier, password) {
  const id = String(identifier ?? '').trim().toLowerCase();
  // Match the profile by email/username, then verify the credential held in the auth store.
  const user = users.find(
    (candidate) => candidate.email.toLowerCase() === id || candidate.username.toLowerCase() === id,
  );
  if (!user) return { status: 'not_found' };
  const credential = authUsers.find((auth) => auth.id === user.id);
  if (!credential || !(await bcrypt.compare(String(password ?? ''), credential.passwordHash))) {
    return { status: 'bad_password' };
  }
  return { status: 'ok', user: publicUser(user) };
}

export async function registerUser({ username, email, password, role }) {
  const normalizedEmail = String(email ?? '').trim();
  if (users.some((user) => user.email.toLowerCase() === normalizedEmail.toLowerCase())) {
    return { status: 'exists' };
  }

  // Mirror the Supabase signup-trigger flow: create an auth.users credential row AND a profile row.
  const id = `user-${Date.now()}`;
  authUsers.push({ id, email: normalizedEmail, passwordHash: await bcrypt.hash(String(password), 10) });
  const user = {
    id,
    name: String(username ?? '').trim(),
    username: String(username ?? '').trim(),
    email: normalizedEmail,
    role: role === 'organiser' ? 'organiser' : 'user',
    contact: null,
    socialLink: null,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  return { status: 'ok', user: publicUser(user) };
}

export function resetUsers() {
  users = clone(initialUsers);
  authUsers = clone(initialAuthUsers);
}
