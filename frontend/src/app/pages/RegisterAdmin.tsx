import { useState } from 'react';
import { Shield } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthShell } from '../components/AuthShell';
import { required, emailError, confirmError } from '../components/validation';
import { registerRequest } from '../api';
import type { Route } from '../components/types';

export function RegisterAdmin({ go }: { go: (r: Route) => void }) {
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [contact, setContact] = useState('');
  const [social, setSocial] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const errs = {
    adminName: required(adminName),
    email: emailError(email),
    password: required(password),
    confirm: confirmError(password, confirm),
  };
  const hasErr = Object.values(errs).some(Boolean);

  return (
    <AuthShell
      title="Launch as an organiser"
      subtitle="Spin up events, set hype thresholds and run your CCA's calendar."
      footer={
        <>
          Already an organiser?{' '}
          <button onClick={() => go({ name: 'login' })} className="text-[#ff4d2e]" style={{ fontWeight: 600 }}>
            Login
          </button>
        </>
      }
    >
      <form
        className="space-y-4"
        autoComplete="off"
        onSubmit={async (e) => {
          e.preventDefault();
          setAttempted(true);
          setSubmitError(null);
          if (hasErr) return;
          setSubmitting(true);
          try {
            await registerRequest({ username: adminName, email, password, role: 'admin' });
            go({ name: 'login' });
          } catch (err) {
            setSubmitError(err instanceof Error ? err.message : 'Unable to create account.');
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <Field label="Admin name" autoComplete="off" placeholder="Jamie Tan" value={adminName} onChange={(e) => setAdminName(e.target.value)} error={attempted ? errs.adminName : null} />
        <Field label="Email" type="email" autoComplete="off" placeholder="organiser@u.nus.edu" value={email} onChange={(e) => setEmail(e.target.value)} error={attempted ? errs.email : null} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password" type="password" autoComplete="new-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} error={attempted ? errs.password : null} />
          <Field label="Confirm" type="password" autoComplete="new-password" placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={attempted ? errs.confirm : null} />
        </div>
        <Field label="Contact / Telegram (optional)" autoComplete="off" placeholder="@nus_emc" value={contact} onChange={(e) => setContact(e.target.value)} />
        <Field label="Social link (optional)" autoComplete="off" placeholder="instagram.com/nus.emc" value={social} onChange={(e) => setSocial(e.target.value)} />

        <div className="flex items-start gap-2 rounded-lg p-3 text-xs"
          style={{ background: 'rgba(41,224,122,0.08)', border: '1px solid rgba(41,224,122,0.25)', color: '#a6f3c8' }}>
          <Shield size={14} className="mt-0.5 shrink-0" />
          <span>Admins can create and manage events. We verify CCAs before greenlighting payouts.</span>
        </div>

        {submitError && <p className="text-xs" style={{ color: '#ff9a82' }}>{submitError}</p>}

        <Button type="submit" disabled={submitting} className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
          {submitting ? 'Creating…' : 'Create admin account'}
        </Button>
      </form>
    </AuthShell>
  );
}

function Field({ label, error, ...props }: { label: string; error?: string | null } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>{label}</Label>
      <Input {...props} style={{ background: 'var(--surface-2)', borderColor: error ? '#ff4d2e' : 'var(--border)', height: 42 }} />
      {error && <p className="mt-1 text-xs" style={{ color: '#ff9a82' }}>{error}</p>}
    </div>
  );
}
