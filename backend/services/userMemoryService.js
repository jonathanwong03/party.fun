import bcrypt from 'bcryptjs';
import { initialUsers } from '../data/mockUsers.js';

const clone = (value) => structuredClone(value);
let users = clone(initialUsers);

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
  const user = users.find(
    (candidate) => candidate.email.toLowerCase() === id || candidate.username.toLowerCase() === id,
  );
  if (!user) return { status: 'not_found' };
  if (!(await bcrypt.compare(String(password ?? ''), user.passwordHash))) return { status: 'bad_password' };
  return { status: 'ok', user: publicUser(user) };
}

export async function registerUser({ username, email, password, role }) {
  const normalizedEmail = String(email ?? '').trim();
  if (users.some((user) => user.email.toLowerCase() === normalizedEmail.toLowerCase())) {
    return { status: 'exists' };
  }

  const user = {
    id: `user-${Date.now()}`,
    name: String(username ?? '').trim(),
    username: String(username ?? '').trim(),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(String(password), 10),
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
}
