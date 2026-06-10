import { Settings as SettingsIcon, LogOut, ChevronLeft } from 'lucide-react';
import { Button } from '../components/ui/button';
import type { Route } from '../components/types';
import type { AuthUser } from '../api';

export function Profile({
  go,
  user,
  onLogout,
}: {
  go: (r: Route) => void;
  user: AuthUser | null;
  onLogout: () => void;
}) {
  const name = user?.username ?? 'Guest';
  const email = user?.email ?? '';
  const initial = name.charAt(0).toUpperCase();
  const handle = `@${name.toLowerCase()}`;

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <button
        onClick={() => go({ name: 'landing' })}
        className="mb-4 inline-flex items-center gap-1 text-sm transition hover:text-foreground"
        style={{ color: 'var(--muted-foreground)' }}
      >
        <ChevronLeft size={14} /> Back to Events
      </button>
      <div className="rounded-2xl border p-8 text-center" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{email}</div>

        <div
          className="mx-auto mt-6 grid size-24 place-items-center rounded-full"
          style={{ background: 'linear-gradient(135deg,#ff4d2e,#ffcb3c)', fontWeight: 800, fontSize: 40, color: '#0b0b0f' }}
        >
          {initial}
        </div>

        <h1 className="mt-5" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>Hi, {name}!</h1>
        <div className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          {handle}{user?.role ? ` · ${user.role}` : ''}
        </div>

        <div className="my-6 h-px" style={{ background: 'var(--border)' }} />

        <div className="flex flex-col gap-3">
          <Button
            variant="outline"
            onClick={() => go({ name: 'settings' })}
            className="w-full justify-center gap-2 border-white/15 bg-transparent hover:bg-white/5"
            style={{ borderRadius: 12, height: 48 }}
          >
            <SettingsIcon size={16} /> Settings
          </Button>

          <Button
            onClick={onLogout}
            className="w-full justify-center gap-2 bg-[#ff0a0a] text-white hover:bg-[#ff2a2a]"
            style={{ borderRadius: 12, height: 48, fontWeight: 700 }}
          >
            <LogOut size={16} /> Logout
          </Button>
        </div>
      </div>
    </div>
  );
}
