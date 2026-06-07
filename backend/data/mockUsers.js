// Profile table — simulates Supabase's public.USER. Credentials are NOT stored here;
// they live in mockAuthUsers.js (the auth.users simulation), keyed by the same id.
// In real Supabase each id is the auth.users UUID.
export const initialUsers = [
  {
    id: 'mock-user-jamie',
    name: 'Jamie Tan',
    username: 'Jamie',
    email: 'jamie@u.nus.edu',
    role: 'user',
    contact: '@jamiet',
    socialLink: null,
    createdAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'mock-organiser-smu',
    name: 'SMU Photography Society',
    username: 'organiser',
    email: 'organiser@smu.edu.sg',
    role: 'organiser',
    contact: '@smuphotosoc',
    socialLink: null,
    createdAt: '2026-06-01T00:00:00.000Z',
  },
  ...[
    ['host-nus-emc', 'NUS Electronic Music Club'],
    ['host-ntu-cultural', 'NTU Cultural Council'],
    ['host-sutd-dev', 'SUTD Dev Society'],
    ['host-nus-adventure', 'NUS Adventure Club'],
    ['host-smu-writers', 'SMU Writers Guild'],
    ['seed-community', 'Seed Community'],
  ].map(([id, name]) => ({
    id,
    name,
    username: id,
    email: `${id}@example.invalid`,
    role: id === 'seed-community' ? 'user' : 'organiser',
    contact: null,
    socialLink: null,
    createdAt: '2026-06-01T00:00:00.000Z',
  })),
];
