import { useState } from 'react';
import { Shield } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { AuthShell } from '../components/AuthShell';
import { required, emailError, confirmError } from '../components/validation';
import { registerRequest, sendWelcomeEmailRequest } from '../api';
import type { Route } from '../components/types';
import { UNIVERSITIES, universityLabel, isValidMatric, MATRIC_HINT } from '../components/universities';

// Organisers are current students too — there is no staff/professor path any more,
// so there is exactly one ID format. The rule lives in universities.ts so the forms,
// the DB constraint and validate_signup_identity can't drift apart.
export function matricError(id: string): string | null {
  const v = id.trim();
  if (!v) return 'Required';
  return isValidMatric(v) ? null : 'Format: letter, 8 digits, letter (e.g. A12345678B)';
}

export function RegisterOrganiser({ go }: { go: (r: Route) => void }) {
  const [organiserName, setOrganiserName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [telegram, setTelegram] = useState('');
  const [phone, setPhone] = useState('');
  const [university, setUniversity] = useState('');
  const [matricNumber, setMatricNumber] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const errs = {
    organiserName: required(organiserName),
    email: emailError(email),
    password: required(password),
    confirm: confirmError(password, confirm),
    university: university ? null : 'Select your university',
    matricNumber: matricError(matricNumber),
  };
  const hasErr = Object.values(errs).some(Boolean);

  return (
    <AuthShell
      title="Launch as an organiser"
      subtitle="Get $20 in your wallet when your organiser account is created."
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
            await registerRequest({
              username: organiserName, email, password, role: 'organiser',
              telegram: telegram || undefined, phone: phone || undefined,
              university, matricNumber: matricNumber.trim(),
            });
            try { await sendWelcomeEmailRequest(); } catch { /* non-blocking */ }
            go({ name: 'login' });
          } catch (err) {
            setSubmitError(err instanceof Error ? err.message : 'Unable to create account.');
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <Field label="Username" autoComplete="off" placeholder="Choose a username" value={organiserName} onChange={(e) => setOrganiserName(e.target.value)} error={attempted ? errs.organiserName : null} />
        <Field label="Email" type="email" autoComplete="off" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} error={attempted ? errs.email : null} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password" type="password" autoComplete="new-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} error={attempted ? errs.password : null} />
          <Field label="Confirm" type="password" autoComplete="new-password" placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={attempted ? errs.confirm : null} />
        </div>

        {/* University + membership */}
        <div>
          <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>University</Label>
          <Select value={university} onValueChange={setUniversity}>
            <SelectTrigger style={{ background: 'var(--surface-2)', borderColor: attempted && errs.university ? '#ff4d2e' : 'var(--border)', height: 42 }}>
              <SelectValue placeholder="Select your university" />
            </SelectTrigger>
            <SelectContent>
              {UNIVERSITIES.map((u) => <SelectItem key={u.code} value={u.code}>{universityLabel(u.code)}</SelectItem>)}
            </SelectContent>
          </Select>
          {attempted && errs.university && <p className="mt-1 text-xs" style={{ color: '#ff9a82' }}>{errs.university}</p>}
        </div>

        <div>
          <Field
            label="Matriculation number"
            autoComplete="off"
            placeholder="e.g. A12345678B"
            value={matricNumber}
            onChange={(e) => setMatricNumber(e.target.value.toUpperCase())}
            error={attempted ? errs.matricNumber : null}
          />
          <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>{MATRIC_HINT}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Telegram (optional)" autoComplete="off" placeholder="@yourhandle" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
          <Field label="Phone number (optional)" autoComplete="off" placeholder="e.g. +65 9123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>

        <div className="flex items-start gap-2 rounded-lg p-3 text-xs"
          style={{ background: 'rgba(41,224,122,0.08)', border: '1px solid rgba(41,224,122,0.25)', color: '#a6f3c8' }}>
          <Shield size={14} className="mt-0.5 shrink-0" />
          <span>Organisers must be current university students. Your matriculation number is unique to your account.</span>
        </div>

        {submitError && <p className="text-xs" style={{ color: '#ff9a82' }}>{submitError}</p>}

        <Button type="submit" disabled={submitting} className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
          {submitting ? 'Creating…' : 'Create organiser account'}
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
