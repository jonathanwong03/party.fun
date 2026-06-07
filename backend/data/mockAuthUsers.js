// Simulates Supabase's `auth.users` table: it holds credentials only.
// In real Supabase these ids are UUIDs and live in the managed `auth` schema; the matching
// profile rows (without passwordHash) live in `mockUsers.js` (the public.USER table), keyed
// by the same id. authenticate() looks credentials up here, then returns the profile.
const SEED_IDS = ['host-nus-emc', 'host-ntu-cultural', 'host-sutd-dev', 'host-nus-adventure', 'host-smu-writers', 'seed-community'];
const SEED_HASH = '$2b$10$invalidSeedAccountHashNotUsedForLogin000000000000000000';

export const initialAuthUsers = [
  { id: 'mock-user-jamie', email: 'jamie@u.nus.edu', passwordHash: '$2b$10$504ExS.4pQsF3ZsNrVu82exPBdFCbe11WxzgerQeBjIEQ9qT8HTOG' },
  { id: 'mock-organiser-smu', email: 'organiser@smu.edu.sg', passwordHash: '$2b$10$JCQXjH8nmZeGza0d7/EQKuzzOGVK4Z3xBKdchnfUf9x/a02o0qvXa' },
  ...SEED_IDS.map((id) => ({ id, email: `${id}@example.invalid`, passwordHash: SEED_HASH })),
];
