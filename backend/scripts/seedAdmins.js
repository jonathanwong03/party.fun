// One-off: create the pre-seeded admin accounts. Idempotent — skips any that
// already exist. Run once:  node scripts/seedAdmins.js
// (Passwords are intentionally simple for the demo.)
import 'dotenv/config';
import { adminClient } from '../services/supabaseAdmin.js';

const ADMINS = [
  { username: 'admin1', email: 'admin1@gmail.com', password: '111111' },
  { username: 'admin2', email: 'admin2@gmail.com', password: '222222' },
  { username: 'admin3', email: 'admin3@gmail.com', password: '333333' },
];

const admin = adminClient();

for (const a of ADMINS) {
  const { data: existing } = await admin.from('USER').select('id').eq('email', a.email).maybeSingle();
  if (existing) { console.log(`skip ${a.email} (already exists)`); continue; }
  const { data, error } = await admin.auth.admin.createUser({
    email: a.email,
    password: a.password,
    email_confirm: true,
    // handle_new_user reads this metadata → USER row with role='admin', onboarded=true.
    user_metadata: { username: a.username, name: a.username, role: 'admin' },
  });
  if (error) { console.error(`FAIL ${a.email}: ${error.message}`); continue; }
  console.log(`created ${a.email} (${data.user.id})`);
}
console.log('done');
