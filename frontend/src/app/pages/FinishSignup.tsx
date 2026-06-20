import { useEffect, useState } from 'react';
import { Ticket, Megaphone } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthShell } from '../components/AuthShell';
import { fetchCurrentUser, completeOauthSignupRequest, sendWelcomeEmailRequest, type AuthUser } from '../api';
import type { Role, Route } from '../components/types';

// Shown to a brand-new Google user: pick a role + confirm a username, exactly once.
export function FinishSignup({ go, onLogin }: { go: (r: Route) => void; onLogin: (user: AuthUser) => void }) {
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<Role>('user');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const user = await fetchCurrentUser();
      if (!user) { go({ name: 'login' }); return; }
      // Already finished (e.g. opened this page directly) → straight in.
      if (user.onboarded) { onLogin(user); return; }
      setUsername(user.username ?? '');
      setReady(true);
    })();
  }, [go, onLogin]);

  if (!ready) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim()) { setError('Please choose a username.'); return; }
    setSubmitting(true);
    try {
      const user = await completeOauthSignupRequest(role, username);
      try { await sendWelcomeEmailRequest(); } catch { /* non-blocking */ }
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to finish setting up.');
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Finish setting up"
      subtitle="Choose how you'll use party.fun and pick a username."
    >
      <form className="space-y-5" onSubmit={handleSubmit} autoComplete="off">
        <div className="space-y-3">
          <RoleCard
            icon={<Ticket size={20} />}
            accent="#ff4d2e"
            title="User"
            desc="Buy tickets, track your events, and join the hype."
            active={role === 'user'}
            onClick={() => setRole('user')}
          />
          <RoleCard
            icon={<Megaphone size={20} />}
            accent="#29e07a"
            title="Organiser"
            desc="Create, manage, and launch events for your CCA or society."
            active={role === 'organiser'}
            onClick={() => setRole('organiser')}
          />
        </div>

        <div>
          <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Username</Label>
          <Input
            value={username}
            autoComplete="off"
            placeholder="Choose a username"
            onChange={(e) => setUsername(e.target.value)}
            style={{ background: 'var(--surface-2)', borderColor: error ? '#ff4d2e' : 'var(--border)', height: 44 }}
          />
        </div>

        {error && <p className="text-xs" style={{ color: '#ff9a82' }}>{error}</p>}

        <Button type="submit" disabled={submitting} className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
          {submitting ? 'Setting up…' : 'Continue'}
        </Button>
      </form>
    </AuthShell>
  );
}

function RoleCard({ icon, title, desc, onClick, accent, active }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; accent: string; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition"
      style={{ borderColor: active ? accent : 'var(--border)', background: active ? `${accent}14` : 'var(--surface-2)' }}
    >
      <div className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: `${accent}20`, color: accent }}>
        {icon}
      </div>
      <div className="flex-1">
        <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
        <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{desc}</div>
      </div>
      <span className="grid size-5 place-items-center rounded-full border" style={{ borderColor: active ? accent : 'var(--border-strong)' }}>
        {active && <span className="size-2.5 rounded-full" style={{ background: accent }} />}
      </span>
    </button>
  );
}
