import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthShell } from '../components/AuthShell';
import { required, emailError, confirmError } from '../components/validation';
import type { Role, Route } from '../components/types';

export function RegisterUser({ go, onLogin }: { go: (r: Route) => void; onLogin: (r: Role) => void }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phone, setPhone] = useState('');
  const [attempted, setAttempted] = useState(false);

  const errs = {
    username: required(username),
    email: emailError(email),
    password: required(password),
    confirm: confirmError(password, confirm),
  };
  const hasErr = Object.values(errs).some(Boolean);

  return (
    <AuthShell
      title="Create your account"
      subtitle="Track your tickets, get hype updates and refunds in one place."
      footer={
        <>
          Already have an account?{' '}
          <button onClick={() => go({ name: 'login' })} className="text-[#ff4d2e]" style={{ fontWeight: 600 }}>
            Login
          </button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setAttempted(true);
          if (hasErr) return;
          onLogin('user');
        }}
      >
        <Field label="Username" placeholder="jamiet" value={username} onChange={(e) => setUsername(e.target.value)} error={attempted ? errs.username : null} />
        <Field label="Email" type="email" placeholder="you@u.nus.edu" value={email} onChange={(e) => setEmail(e.target.value)} error={attempted ? errs.email : null} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password" type="password" placeholder="********" value={password} onChange={(e) => setPassword(e.target.value)} error={attempted ? errs.password : null} />
          <Field label="Confirm" type="password" placeholder="********" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={attempted ? errs.confirm : null} />
        </div>
        <Field label="Phone / Telegram (optional)" placeholder="@jamiet" value={phone} onChange={(e) => setPhone(e.target.value)} />

        <Button type="submit" className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
          Create account
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
