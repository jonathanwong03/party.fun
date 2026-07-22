import { useEffect, useState } from 'react';
import { Ticket, Megaphone } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { AuthShell } from '../components/AuthShell';
import { fetchCurrentUser, completeOauthSignupRequest, sendWelcomeEmailRequest, type AuthUser } from '../api';
import { matricError } from './RegisterOrganiser';
import { UNIVERSITIES, universityLabel, MATRIC_HINT } from '../components/universities';
import type { Role, Route } from '../components/types';

// Two audiences, one screen:
//   * a brand-new Google user picking a role + username for the first time, and
//   * an EXISTING account that predates the students-only rule — the 20260721
//     migration set onboarded = false on those, and App.tsx routes them here until
//     they supply a university + matriculation number.
// Every account is a current student, so both fields are required for both roles.
export function FinishSignup({ go, onLogin }: { go: (r: Route) => void; onLogin: (user: AuthUser) => void }) {
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<Role>('user');
  const [username, setUsername] = useState('');
  const [university, setUniversity] = useState('');
  const [matricNumber, setMatricNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const user = await fetchCurrentUser();
      if (!user) { go({ name: 'login' }); return; }
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
    if (!university) { setError('Please choose your university.'); return; }
    const idErr = matricError(matricNumber);
    if (idErr) { setError(`Matriculation number: ${idErr}`); return; }
    setSubmitting(true);
    try {
      const user = await completeOauthSignupRequest(role, username, university, matricNumber.trim());
      try { await sendWelcomeEmailRequest(); } catch { /* non-blocking */ }
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to finish setting up.');
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Finish setting up" subtitle="Complete setup to get $20 added to your in-app wallet.">
      <form className="space-y-5" onSubmit={handleSubmit} autoComplete="off">
        <div className="space-y-3">
          <RoleCard icon={<Ticket size={20} />} accent="#ff4d2e" title="User" desc="Buy tickets, track your events, and join the hype." active={role === 'user'} onClick={() => setRole('user')} />
          <RoleCard icon={<Megaphone size={20} />} accent="#29e07a" title="Organiser" desc="Create and manage events, with $20 ready in your wallet." active={role === 'organiser'} onClick={() => setRole('organiser')} />
        </div>

        <div>
          <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Username</Label>
          <Input value={username} autoComplete="off" placeholder="Choose a username" onChange={(e) => setUsername(e.target.value)} style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 44 }} />
        </div>

        <div>
          <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Which university are you from?</Label>
          <Select value={university} onValueChange={setUniversity}>
            <SelectTrigger style={{ background: 'var(--surface-2)' }}><SelectValue placeholder="Select your university" /></SelectTrigger>
            <SelectContent>
              {UNIVERSITIES.map((u) => <SelectItem key={u.code} value={u.code}>{universityLabel(u.code)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Matriculation number</Label>
          <Input
            value={matricNumber}
            autoComplete="off"
            placeholder="e.g. A12345678B"
            onChange={(e) => setMatricNumber(e.target.value.toUpperCase())}
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 44 }}
          />
          <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>{MATRIC_HINT}. party.fun is for current university students.</p>
        </div>

        {error && <p className="text-xs" style={{ color: 'var(--status-red)' }}>{error}</p>}

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
      <div className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: `${accent}20`, color: accent }}>{icon}</div>
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
