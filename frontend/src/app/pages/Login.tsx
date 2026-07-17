import { useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthShell } from '../components/AuthShell';
import { GoogleIcon } from '../components/GoogleIcon';
import { loginRequest, loginWithGoogleRequest, loginWithFacebookRequest, requestPhoneOtp, verifyPhoneOtp, type AuthUser } from '../api';
import { useResendCooldown } from '../hooks/useResendCooldown';
import type { Route } from '../components/types';


export function Login({ go, onLogin }: { go: (r: Route) => void; onLogin: (user: AuthUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [facebookSubmitting, setFacebookSubmitting] = useState(false);
  // Phone sign-in (existing accounts only): 'phone' = entering number, 'code' = entering OTP.
  const [mode, setMode] = useState<'password' | 'phone' | 'code'>('password');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [phoneSubmitting, setPhoneSubmitting] = useState(false);
  const { remaining: resendIn, start: startResend } = useResendCooldown(30);

  // OAuth buttons stay in a "Redirecting…" state on purpose — the browser is navigating away to
  // Google/Facebook, so we never reset the flag on success. But if the user presses browser-back,
  // the page is restored from the bfcache with that frozen state and the button looks stuck. Reset
  // the flags whenever the page is shown again from the cache.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) { setGoogleSubmitting(false); setFacebookSubmitting(false); }
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

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

  const handleGoogleLogin = async () => {
    setError(null);
    setGoogleSubmitting(true);
    try {
      await loginWithGoogleRequest();
      // Browser redirects to Google here; nothing else runs until they return.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in with Google.');
      setGoogleSubmitting(false);
    }
  };

  const handleFacebookLogin = async () => {
    setError(null);
    setFacebookSubmitting(true);
    try {
      await loginWithFacebookRequest();
      // Browser redirects to Facebook here.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in with Facebook.');
      setFacebookSubmitting(false);
    }
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPhoneSubmitting(true);
    try {
      await requestPhoneOtp(phone);
      setMode('code');
      startResend();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send the code.');
    } finally {
      setPhoneSubmitting(false);
    }
  };

  const handleResendCode = async () => {
    if (resendIn > 0) return;
    setError(null);
    try {
      await requestPhoneOtp(phone);
      startResend();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resend the code.');
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPhoneSubmitting(true);
    try {
      const user = await verifyPhoneOtp(phone, code);
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code is incorrect.');
    } finally {
      setPhoneSubmitting(false);
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
      {mode === 'password' && (
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
      )}

      {mode === 'phone' && (
        <form className="space-y-4" onSubmit={handleSendCode} autoComplete="off">
          <div>
            <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Phone number</Label>
            <Input
              type="tel"
              placeholder="+6591234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 44 }}
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>Use the phone number saved on your account, in international format.</p>
          </div>
          {error && <p className="text-xs" style={{ color: '#ff9a82' }}>{error}</p>}
          <Button type="submit" disabled={phoneSubmitting} className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
            {phoneSubmitting ? 'Sending…' : 'Send code'}
          </Button>
          <button type="button" onClick={() => { setError(null); setMode('password'); }} className="w-full text-center text-xs text-[#ff4d2e]" style={{ fontWeight: 600 }}>
            Back to password login
          </button>
        </form>
      )}

      {mode === 'code' && (
        <form className="space-y-4" onSubmit={handleVerifyCode} autoComplete="off">
          <div>
            <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>6-digit code</Label>
            <Input
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 44 }}
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>Sent by SMS to {phone}.</p>
          </div>
          {error && <p className="text-xs" style={{ color: '#ff9a82' }}>{error}</p>}
          <Button type="submit" disabled={phoneSubmitting} className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
            {phoneSubmitting ? 'Verifying…' : 'Verify & sign in'}
          </Button>
          <p className="text-center text-xs" style={{ color: 'var(--muted-foreground)' }}>
            Didn't get the code?{' '}
            <button type="button" onClick={handleResendCode} disabled={resendIn > 0} className="text-[#ff4d2e] disabled:opacity-50" style={{ fontWeight: 600 }}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </button>
          </p>
          <button type="button" onClick={() => { setError(null); setMode('phone'); }} className="w-full text-center text-xs text-[#ff4d2e]" style={{ fontWeight: 600 }}>
            Use a different number
          </button>
        </form>
      )}

      <div className="mt-4 flex items-center gap-2">
        <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
        <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>or</span>
        <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
      </div>

      {mode === 'password' && (
        <Button
          type="button"
          onClick={() => { setError(null); setMode('phone'); }}
          variant="outline"
          className="mt-4 w-full"
          style={{ borderRadius: 12, height: 46 }}
        >
          <span className="inline-flex items-center justify-center gap-2">Continue with phone number <Phone size={18} /></span>
        </Button>
      )}

      <Button
        type="button"
        onClick={handleGoogleLogin}
        disabled={googleSubmitting}
        variant="outline"
        className="mt-3 w-full"
        style={{ borderRadius: 12, height: 46 }}
      >
        {googleSubmitting ? 'Redirecting…' : (
          <span className="inline-flex items-center justify-center gap-2">Continue with Google <GoogleIcon /></span>
        )}
      </Button>

      <Button
        type="button"
        onClick={handleFacebookLogin}
        disabled={facebookSubmitting}
        variant="outline"
        className="mt-3 w-full"
        style={{ borderRadius: 12, height: 46 }}
      >
        {facebookSubmitting ? 'Redirecting…' : (
          <span className="inline-flex items-center justify-center gap-2">Continue with Facebook <FacebookIcon /></span>
        )}
      </Button>
    </AuthShell>
  );
}

function FacebookIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}