import { useEffect, useState } from 'react';
import { Ticket, Megaphone } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { AuthShell } from '../components/AuthShell';
import { fetchCurrentUser, completeOauthSignupRequest, sendWelcomeEmailRequest, type AuthUser, type MemberType } from '../api';
import { memberIdError } from './RegisterOrganiser';
import { UNIVERSITIES, universityLabel } from '../components/universities';
import type { Role, Route } from '../components/types';

// Sentinel for the "I'm not enrolled into a university" option (stored as NULL).
const NOT_ENROLLED = 'none';

// Shown to a brand-new Google user: pick a role + confirm a username, exactly once.
// Organisers must also supply their university + matriculation/staff ID.
export function FinishSignup({ go, onLogin }: { go: (r: Route) => void; onLogin: (user: AuthUser) => void }) {
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<Role>('user');
  const [username, setUsername] = useState('');
  const [university, setUniversity] = useState('');
  const [memberType, setMemberType] = useState<MemberType | ''>('');
  const [orgId, setOrgId] = useState('');
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

  const idLabel = memberType === 'student' ? 'Matriculation ID' : memberType ? 'Staff ID' : 'Matriculation / Staff ID';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim()) { setError('Please choose a username.'); return; }
    if (role === 'organiser') {
      if (!university) { setError('Please choose your university.'); return; }
      if (!memberType) { setError('Please choose Student, Instructor or Professor.'); return; }
      const idErr = memberIdError(memberType, orgId);
      if (idErr) { setError(`${idLabel}: ${idErr}`); return; }
    } else if (!university) {
      setError('Please choose your university (or "I\'m not enrolled").'); return;
    }
    setSubmitting(true);
    try {
      const org = role === 'organiser' ? { university, memberType: memberType as MemberType, orgId: orgId.trim() } : undefined;
      const userUniversity = role === 'user' ? (university === NOT_ENROLLED ? null : university) : undefined;
      const user = await completeOauthSignupRequest(role, username, org, userUniversity);
      try { await sendWelcomeEmailRequest(); } catch { /* non-blocking */ }
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to finish setting up.');
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Finish setting up" subtitle="Choose how you'll use party.fun and pick a username.">
      <form className="space-y-5" onSubmit={handleSubmit} autoComplete="off">
        <div className="space-y-3">
          <RoleCard icon={<Ticket size={20} />} accent="#ff4d2e" title="User" desc="Buy tickets, track your events, and join the hype." active={role === 'user'} onClick={() => setRole('user')} />
          <RoleCard icon={<Megaphone size={20} />} accent="#29e07a" title="Organiser" desc="Create and manage events (university members only)." active={role === 'organiser'} onClick={() => setRole('organiser')} />
        </div>

        <div>
          <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Username</Label>
          <Input value={username} autoComplete="off" placeholder="Choose a username" onChange={(e) => setUsername(e.target.value)} style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 44 }} />
        </div>

        {role === 'user' && (
          <div>
            <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Which university are you from?</Label>
            <Select value={university} onValueChange={setUniversity}>
              <SelectTrigger style={{ background: 'var(--surface-2)' }}><SelectValue placeholder="Select your university" /></SelectTrigger>
              <SelectContent>
                {UNIVERSITIES.map((u) => <SelectItem key={u.code} value={u.code}>{universityLabel(u.code)}</SelectItem>)}
                <SelectItem value={NOT_ENROLLED}>I'm not enrolled into a university</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>Used to access events restricted to a university's members. You can change this once later.</p>
          </div>
        )}

        {role === 'organiser' && (
          <>
            <div>
              <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>University</Label>
              <Select value={university} onValueChange={setUniversity}>
                <SelectTrigger style={{ background: 'var(--surface-2)' }}><SelectValue placeholder="Select your university" /></SelectTrigger>
                <SelectContent>
                  {UNIVERSITIES.map((u) => <SelectItem key={u.code} value={u.code}>{universityLabel(u.code)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>I am a</Label>
                <Select value={memberType} onValueChange={(v) => setMemberType(v as MemberType)}>
                  <SelectTrigger style={{ background: 'var(--surface-2)' }}><SelectValue placeholder="Select role" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="student">Student</SelectItem>
                    <SelectItem value="instructor">Instructor</SelectItem>
                    <SelectItem value="professor">Professor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>{idLabel}</Label>
                <Input value={orgId} autoComplete="off" placeholder={memberType === 'student' ? 'e.g. A12345678B' : 'e.g. 912345678'} onChange={(e) => setOrgId(e.target.value)} style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 44 }} />
              </div>
            </div>
          </>
        )}

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
