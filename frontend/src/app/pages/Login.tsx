import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthShell } from '../components/AuthShell';
import { loginRequest, type AuthUser } from '../api';
import type { Route } from '../components/types';

export function Login({ go, onLogin }: { go: (r: Route) => void; onLogin: (user: AuthUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await loginRequest(email, password);
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to log in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      maxWidthClass="max-w-xl"
      backTo={{ label: 'View All Events', onClick: () => go({ name: 'landing' }) }}
      title="Welcome back"
      subtitle="Sign in to track your tickets and manage your events."
      footer={
        <>
          New to party.fun?{' '}
          <button onClick={() => go({ name: 'choose-account' })} className="text-[#ff4d2e]" style={{ fontWeight: 600 }}>
            Create an account
          </button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit} autoComplete="off">
        <div>
          <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Email or username</Label>
          <Input
            name="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 44 }}
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <Label className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Password</Label>
            <button type="button" onClick={() => go({ name: 'forgot-password' })} className="text-xs text-[#ff4d2e]">Forgot?</button>
          </div>
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 44 }}
          />
        </div>
        {error && <p className="text-xs" style={{ color: '#ff9a82' }}>{error}</p>}
        <Button type="submit" disabled={submitting} className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
          {submitting ? 'Logging in…' : 'Login'}
        </Button>
      </form>
    </AuthShell>
  );
}
