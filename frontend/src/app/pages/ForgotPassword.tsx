import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthShell } from '../components/AuthShell';
import { requestPasswordReset } from '../api';
import { emailError } from '../components/validation';
import type { Route } from '../components/types';

export function ForgotPassword({ go }: { go: (r: Route) => void }) {
  const [identifier, setIdentifier] = useState('');
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Validate an email in email mode, a phone number in SMS mode.
  const phoneDigits = identifier.replace(/\D/g, '');
  const err = channel === 'sms'
    ? (phoneDigits.length < 6 ? 'Enter a valid phone number.' : null)
    : emailError(identifier);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (err) return;
    setError(null);
    setSubmitting(true);
    try {
      const { email } = await requestPasswordReset(identifier, channel);
      go({ name: 'verify-code', email, channel });
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
      subtitle="We'll send you a 6-digit reset code by email or SMS."
    >
      <form className="space-y-4" onSubmit={submit} autoComplete="off">
        <div>
          <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>{channel === 'sms' ? 'Phone number' : 'Email'}</Label>
          <Input
            type={channel === 'sms' ? 'tel' : 'email'}
            autoComplete="off"
            placeholder={channel === 'sms' ? '+6591234567' : 'you@example.com'}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            style={{ background: 'var(--surface-2)', borderColor: attempted && err ? '#ff4d2e' : 'var(--border)', height: 44 }}
          />
          {attempted && err && <p className="mt-1 text-xs" style={{ color: 'var(--status-red)' }}>{err}</p>}
        </div>
        <div>
          <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Send code via</Label>
          <div className="flex gap-2">
            {(['email', 'sms'] as const).map((c) => {
              const active = channel === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setChannel(c); setAttempted(false); setError(null); }}
                  className="flex-1 rounded-lg border py-2 text-sm transition"
                  style={{
                    borderColor: active ? '#ff4d2e' : 'var(--border)',
                    background: active ? 'rgba(255,77,46,0.08)' : 'var(--surface-2)',
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  {c === 'email' ? 'Email' : 'SMS to phone'}
                </button>
              );
            })}
          </div>
        </div>
        {error && <p className="text-xs" style={{ color: 'var(--status-red)' }}>{error}</p>}
        <Button type="submit" disabled={submitting} className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
          {submitting ? 'Sending…' : 'Send reset code'}
        </Button>
      </form>
    </AuthShell>
  );
}
