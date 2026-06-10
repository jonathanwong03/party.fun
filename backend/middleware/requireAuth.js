import { clientForToken, anonClient } from '../services/supabaseClient.js';

function bearer(req) {
  const header = req.get('Authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

// Validates the Supabase access token, attaches the user-scoped Supabase client
// (req.supabase) plus the caller's id/role (req.user). Rejects with 401 if the
// token is missing or invalid.
export async function requireAuth(req, res, next) {
  const token = bearer(req);
  if (!token) {
    res.status(401).json({ status: 'unauthenticated', message: 'Missing bearer token.' });
    return;
  }

  const sb = clientForToken(token);
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) {
    res.status(401).json({ status: 'unauthenticated', message: 'Invalid or expired token.' });
    return;
  }

  // App role lives in the USER table (the JWT's `role` claim is the Postgres role).
  const { data: profile } = await sb
    .from('USER')
    .select('role')
    .eq('id', data.user.id)
    .single();

  req.supabase = sb;
  req.user = { id: data.user.id, role: profile?.role ?? 'user' };
  next();
}

// For public reads: use the caller's client if signed in, else an anonymous one.
// Never rejects.
export async function optionalAuth(req, res, next) {
  const token = bearer(req);
  if (!token) {
    req.supabase = anonClient();
    req.user = null;
    next();
    return;
  }

  const sb = clientForToken(token);
  const { data } = await sb.auth.getUser();
  req.supabase = sb;
  req.user = data?.user ? { id: data.user.id } : null;
  next();
}
