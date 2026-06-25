import { useState } from 'react';
import { Shield } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { AuthShell } from '../components/AuthShell';
import { required, emailError, confirmError } from '../components/validation';
import { registerRequest, sendWelcomeEmailRequest, type MemberType } from '../api';
import type { Route } from '../components/types';
import { UNIVERSITIES, universityLabel } from '../components/universities';

const MATRIC_RE = /^[A-Za-z]\d{8}[A-Za-z]$/;
const STAFF_RE = /^\d{9}$/;

// Validate the membership ID against the member type. Returns an error string or null.
export function memberIdError(memberType: MemberType | '', id: string): string | null {
  const v = id.trim();
  if (!v) return 'Required';
  if (memberType === 'student') return MATRIC_RE.test(v) ? null : 'Format: letter, 8 digits, letter (e.g. A12345678B)';
  if (memberType === 'instructor' || memberType === 'professor') return STAFF_RE.test(v) ? null : 'Staff ID must be exactly 9 digits';
  return null;
}

export function RegisterOrganiser({ go }: { go: (r: Route) => void }) {
  const [organiserName, setOrganiserName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [telegram, setTelegram] = useState('');
  const [phone, setPhone] = useState('');
  const [university, setUniversity] = useState('');
  const [memberType, setMemberType] = useState<MemberType | ''>('');
  const [orgId, setOrgId] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const idLabel = memberType === 'student' ? 'Matriculation ID' : memberType ? 'Staff ID' : 'Matriculation / Staff ID';

  const errs = {
    organiserName: required(organiserName),
    email: emailError(email),
    password: required(password),
    confirm: confirmError(password, confirm),
    university: university ? null : 'Select your university',
    memberType: memberType ? null : 'Select your role',
    orgId: memberType ? memberIdError(memberType, orgId) : 'Select your role first',
  };
  const hasErr = Object.values(errs).some(Boolean);

  return (
    <AuthShell
      title="Launch as an organiser"
      subtitle="Only university members (students, instructors and professors) can run events."
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
              university, memberType: memberType as MemberType, orgId: orgId.trim(),
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>I am a</Label>
            <Select value={memberType} onValueChange={(v) => { setMemberType(v as MemberType); }}>
              <SelectTrigger style={{ background: 'var(--surface-2)', borderColor: attempted && errs.memberType ? '#ff4d2e' : 'var(--border)', height: 42 }}>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="student">Student</SelectItem>
                <SelectItem value="instructor">Instructor</SelectItem>
                <SelectItem value="professor">Professor</SelectItem>
              </SelectContent>
            </Select>
            {attempted && errs.memberType && <p className="mt-1 text-xs" style={{ color: '#ff9a82' }}>{errs.memberType}</p>}
          </div>
          <Field
            label={idLabel}
            autoComplete="off"
            placeholder={memberType === 'student' ? 'e.g. A12345678B' : 'e.g. 912345678'}
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            error={attempted ? errs.orgId : null}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Telegram (optional)" autoComplete="off" placeholder="@yourhandle" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
          <Field label="Phone number (optional)" autoComplete="off" placeholder="e.g. +65 9123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>

        <div className="flex items-start gap-2 rounded-lg p-3 text-xs"
          style={{ background: 'rgba(41,224,122,0.08)', border: '1px solid rgba(41,224,122,0.25)', color: '#a6f3c8' }}>
          <Shield size={14} className="mt-0.5 shrink-0" />
          <span>Organisers must be verified university members. Your matriculation / staff ID is unique to your account.</span>
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
