import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthShell } from '../components/AuthShell';
import { requestPasswordReset } from '../api';
import { emailError } from '../components/validation';
import type { Route } from '../components/types';

export function ForgotPassword({ go }: { go: (r: Route) => void }) {
  const [email, setEmail] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const err = emailError(email);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (err) return;
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      go({ name: 'verify-code', email: email.trim() });
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Unable to send a reset code.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      maxWidthClass="max-w-xl"
      backTo={{ label: 'Back to login', onClick: () => go({ name: 'login' }) }}
      title="Forgot password"
      subtitle="Enter your email and we'll send you a 6-digit reset code."
    >
      <form className="space-y-4" onSubmit={submit} autoComplete="off">
        <div>
          <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Email</Label>
          <Input
            type="email"
            autoComplete="off"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ background: 'var(--surface-2)', borderColor: attempted && err ? '#ff4d2e' : 'var(--border)', height: 44 }}
          />
          {attempted && err && <p className="mt-1 text-xs" style={{ color: '#ff9a82' }}>{err}</p>}
        </div>
        {error && <p className="text-xs" style={{ color: '#ff9a82' }}>{error}</p>}
        <Button type="submit" disabled={submitting} className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
          {submitting ? 'Sending…' : 'Send reset code'}
        </Button>
      </form>
    </AuthShell>
  );
}
