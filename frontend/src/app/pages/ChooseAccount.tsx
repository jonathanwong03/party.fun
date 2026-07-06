import { useState } from 'react';
import { ArrowRight, Ticket, Megaphone } from 'lucide-react';
import { Button } from '../components/ui/button';
import { AuthShell } from '../components/AuthShell';
import { GoogleIcon } from '../components/GoogleIcon';
import { loginWithGoogleRequest } from '../api';
import type { Route } from '../components/types';

export function ChooseAccount({ go }: { go: (r: Route) => void }) {
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogle = async () => {
    setError(null);
    setGoogleSubmitting(true);
    try {
      await loginWithGoogleRequest();
      // Redirects to Google; on return, /auth/callback routes new users to finish setup.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign up with Google.');
      setGoogleSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Join party.fun"
      subtitle="Create an account and get $20 added to your in-app wallet."
      footer={
        <>
          Already have an account?{' '}
          <button onClick={() => go({ name: 'login' })} className="text-[#ff4d2e]" style={{ fontWeight: 600 }}>
            Login
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Card
          icon={<Ticket size={20} />}
          accent="#ff4d2e"
          title="User"
          desc="Get $20 in your wallet, buy tickets, and join the hype."
          onClick={() => go({ name: 'register-user' })}
        />
        <Card
          icon={<Megaphone size={20} />}
          accent="#29e07a"
          title="Organiser"
          desc="Get $20 in your wallet, then create and launch events."
          onClick={() => go({ name: 'register-organiser' })}
        />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
        <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>or</span>
        <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
      </div>

      {error && <p className="mt-3 text-xs" style={{ color: '#ff9a82' }}>{error}</p>}

      <Button
        type="button"
        onClick={handleGoogle}
        disabled={googleSubmitting}
        variant="outline"
        className="mt-4 w-full"
        style={{ borderRadius: 12, height: 46 }}
      >
        {googleSubmitting ? 'Redirecting…' : (
          <span className="inline-flex items-center justify-center gap-2">Sign up with Google <GoogleIcon /></span>
        )}
      </Button>
    </AuthShell>
  );
}

function Card({ icon, title, desc, onClick, accent }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; accent: string }) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-2xl border p-5 text-left transition hover:-translate-y-0.5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
    >
      <div className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: `${accent}20`, color: accent }}>
        {icon}
      </div>
      <div className="flex-1">
        <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
        <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{desc}</div>
      </div>
      <ArrowRight size={16} className="transition group-hover:translate-x-1" style={{ color: accent }} />
    </button>
  );
}
