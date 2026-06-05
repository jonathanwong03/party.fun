import { initialUsers } from '../data/mockUsers.js';

const clone = (value) => structuredClone(value);

// Mutable in-memory user list, seeded from the mock data. Resets via resetUsers()
// (called on every frontend page load) so registered accounts don't persist.
let users = clone(initialUsers);

// Strip the password before returning a user to the client.
function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  };
}

export function authenticate(identifier, password) {
  const id = String(identifier ?? '').trim().toLowerCase();
  const user = users.find(
    (u) => u.email.toLowerCase() === id || u.username.toLowerCase() === id,
  );
  if (!user) return { status: 'not_found' };
  if (user.password !== password) return { status: 'bad_password' };
  return { status: 'ok', user: publicUser(user) };
}

export function registerUser({ username, email, password, role }) {
  const normalizedEmail = String(email ?? '').trim();
  const exists = users.find((u) => u.email.toLowerCase() === normalizedEmail.toLowerCase());
  if (exists) return { status: 'exists' };

  const user = {
    id: `user-${Date.now()}`,
    username: String(username ?? '').trim(),
    email: normalizedEmail,
    password,
    role: role === 'admin' ? 'admin' : 'user',
  };
  users.push(user);
  return { status: 'ok', user: publicUser(user) };
}

export function resetUsers() {
  users = clone(initialUsers);
}
