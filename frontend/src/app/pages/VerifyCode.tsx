import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthShell } from '../components/AuthShell';
import { requestPasswordReset, verifyResetCode } from '../api';
import type { Route } from '../components/types';

export function VerifyCode({ go, email }: { go: (r: Route) => void; email: string }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resent, setResent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await verifyResetCode(email, code);
      go({ name: 'reset-confirm', email, code: code.trim() });
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'That code is invalid or has expired.');
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setError(null);
    setResent(false);
    try {
      await requestPasswordReset(email);
      setResent(true);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Unable to resend the code.');
    }
  };

  return (
    <AuthShell
      maxWidthClass="max-w-xl"
      backTo={{ label: 'Back', onClick: () => go({ name: 'forgot-password' }) }}
      title="Check your email"
      subtitle={`We sent a 6-digit code to ${email}. Enter it below to continue.`}
    >
      <form className="space-y-4" onSubmit={submit} autoComplete="off">
        <div>
          <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>6-digit code</Label>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={{ background: 'var(--surface-2)', borderColor: error ? '#ff4d2e' : 'var(--border)', height: 52, fontSize: 22, letterSpacing: '0.5em', textAlign: 'center', fontWeight: 700 }}
          />
        </div>
        {error && <p className="text-xs" style={{ color: '#ff9a82' }}>{error}</p>}
        {resent && <p className="text-xs" style={{ color: '#29e07a' }}>A new code has been sent.</p>}
        <Button type="submit" disabled={submitting} className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
          {submitting ? 'Verifying…' : 'Verify code'}
        </Button>
        <p className="text-center text-xs" style={{ color: 'var(--muted-foreground)' }}>
          Didn't get the email?{' '}
          <button type="button" onClick={resend} className="text-[#ff4d2e]" style={{ fontWeight: 600 }}>Resend code</button>
        </p>
      </form>
    </AuthShell>
  );
}
