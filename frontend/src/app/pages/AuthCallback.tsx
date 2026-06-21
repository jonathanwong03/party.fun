import { useEffect, useRef } from 'react';
import { Logo } from '../components/Logo';
import { fetchCurrentUser, type AuthUser } from '../api';
import type { Route } from '../components/types';

// Landing spot after Google redirects back. Supabase parses the session from the
// URL, then we route: no session → login, un-onboarded → finish setup, else in.
export function AuthCallback({ go, onLogin }: { go: (r: Route) => void; onLogin: (user: AuthUser) => void }) {
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    (async () => {
      try {
        const user = await fetchCurrentUser();
        if (!user) { go({ name: 'login' }); return; }
        if (!user.onboarded) { go({ name: 'finish-signup' }); return; }
        onLogin(user);
      } catch {
        go({ name: 'login' });
      }
    })();
  }, [go, onLogin]);

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="flex flex-col items-center gap-4">
        <Logo size={32} />
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Signing you in…</p>
      </div>
    </div>
  );
}
