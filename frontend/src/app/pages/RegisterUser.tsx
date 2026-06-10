import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthShell } from '../components/AuthShell';
import { required, emailError, confirmError } from '../components/validation';
import { registerRequest, uploadAvatar } from '../api';
import { supabase } from '../supabase';
import { PRESET_AVATARS } from '../components/media';
import type { Route } from '../components/types';

export function RegisterUser({ go }: { go: (r: Route) => void }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phone, setPhone] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [presetUrl, setPresetUrl] = useState<string | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);

  const pickAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarFile(file);
    setPresetUrl(null);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const pickPreset = (url: string) => {
    setPresetUrl(url);
    setAvatarFile(null);
    setAvatarPreview(url);
  };

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
        autoComplete="off"
        onSubmit={async (e) => {
          e.preventDefault();
          setAttempted(true);
          setSubmitError(null);
          if (hasErr) return;
          setSubmitting(true);
          try {
            // A preset avatar is a stable URL — pass it through signup metadata so the
            // DB trigger stores it (no session needed). An uploaded file is handled below.
            await registerRequest({ username, email, password, role: 'user', avatarUrl: presetUrl ?? undefined });
            // Upload the optional avatar only if signup produced a session (no email
            // confirmation). Otherwise it can be set later in Settings.
            if (avatarFile) {
              const { data: { session } } = await supabase.auth.getSession();
              if (session) {
                try { await uploadAvatar(avatarFile); } catch { /* non-blocking */ }
              }
            }
            go({ name: 'login' });
          } catch (err) {
            setSubmitError(err instanceof Error ? err.message : 'Unable to create account.');
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => avatarRef.current?.click()}
            className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-full"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="Avatar preview" className="size-full object-cover" />
            ) : (
              <Camera size={20} style={{ color: 'var(--muted-foreground)' }} />
            )}
          </button>
          <div>
            <div className="text-sm" style={{ fontWeight: 600 }}>Profile picture <span style={{ color: 'var(--muted-foreground)', fontWeight: 400 }}>(optional)</span></div>
            <button type="button" onClick={() => avatarRef.current?.click()} className="text-xs text-[#ff4d2e]" style={{ fontWeight: 600 }}>
              {avatarPreview ? 'Change photo' : 'Add a photo'}
            </button>
          </div>
          <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={pickAvatar} />
        </div>

        <div>
          <Label className="mb-2 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Or pick an avatar</Label>
          <div className="flex flex-wrap gap-2.5">
            {PRESET_AVATARS.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => pickPreset(url)}
                className="overflow-hidden rounded-full transition hover:scale-105"
                style={{ border: presetUrl === url ? '2px solid #ff4d2e' : '2px solid transparent' }}
              >
                <img src={url} alt="Avatar option" className="size-10 object-cover" />
              </button>
            ))}
          </div>
        </div>

        <Field label="Username" autoComplete="off" placeholder="jamiet" value={username} onChange={(e) => setUsername(e.target.value)} error={attempted ? errs.username : null} />
        <Field label="Email" type="email" autoComplete="off" placeholder="you@u.nus.edu" value={email} onChange={(e) => setEmail(e.target.value)} error={attempted ? errs.email : null} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password" type="password" autoComplete="new-password" placeholder="********" value={password} onChange={(e) => setPassword(e.target.value)} error={attempted ? errs.password : null} />
          <Field label="Confirm" type="password" autoComplete="new-password" placeholder="********" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={attempted ? errs.confirm : null} />
        </div>
        <Field label="Phone / Telegram (optional)" autoComplete="off" placeholder="@jamiet" value={phone} onChange={(e) => setPhone(e.target.value)} />

        {submitError && <p className="text-xs" style={{ color: '#ff9a82' }}>{submitError}</p>}

        <Button type="submit" disabled={submitting} className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 12, height: 46 }}>
          {submitting ? 'Creating…' : 'Create account'}
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
