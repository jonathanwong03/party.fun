import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthShell } from '../components/AuthShell';
import { setNewPassword } from '../api';
import { required, confirmError } from '../components/validation';
import type { Route } from '../components/types';

export function ResetPassword({ go, email, code }: { go: (r: Route) => void; email: string; code: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const errs = { password: required(password), confirm: confirmError(password, confirm) };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (Object.values(errs).some(Boolean)) return;
    setError(null);
    setSubmitting(true);
    try {
      await setNewPassword(email, code, password);
      setDone(true);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Unable to update your password. Restart the reset flow and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <AuthShell maxWidthClass="max-w-xl" title="Password updated" subtitle="Your password has been changed. Sign in with your new password.">
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-xl p-4" style={{ background: 'rgba(41,224,122,0.08)', border: '1px solid rgba(41,224,122,0.25)' }}>
            <CheckCircle2 size={20} style={{ color: '#29e07a' }} />
            <span className="text-sm" style={{ color: '#a6f3c8' }}>All set — you can log in now.</span>
          </div>
          <Button onClick={() => go({ name: 'login' })} className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
            Back to login
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell maxWidthClass="max-w-xl" title="Set a new password" subtitle="Create a new password for your account. Make sure it differs from your old one.">
      <form className="space-y-4" onSubmit={submit} autoComplete="off">
        <div>
          <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>New password</Label>
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ background: 'var(--surface-2)', borderColor: attempted && errs.password ? '#ff4d2e' : 'var(--border)', height: 44 }}
          />
          {attempted && errs.password && <p className="mt-1 text-xs" style={{ color: '#ff9a82' }}>{errs.password}</p>}
        </div>
        <div>
          <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Confirm new password</Label>
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={{ background: 'var(--surface-2)', borderColor: attempted && errs.confirm ? '#ff4d2e' : 'var(--border)', height: 44 }}
          />
          {attempted && errs.confirm && <p className="mt-1 text-xs" style={{ color: '#ff9a82' }}>{errs.confirm}</p>}
        </div>
        {error && <p className="text-xs" style={{ color: '#ff9a82' }}>{error}</p>}
        <Button type="submit" disabled={submitting} className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
          {submitting ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </AuthShell>
  );
}
