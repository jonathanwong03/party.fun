import { notifyAccountCreated } from '../services/notificationService.js';

// Sends the "account created" welcome email. Called by the frontend right after a
// successful signup (the caller is authenticated by the just-issued session).
export async function postWelcome(req, res) {
  const { data: me } = await req.supabase
    .from('USER')
    .select('email, username, role')
    .eq('id', req.user.id)
    .single();

  if (me?.email) {
    notifyAccountCreated({ email: me.email, username: me.username, role: me.role });
  }
  res.json({ status: 'ok' });
}
