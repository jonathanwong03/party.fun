import { Logo } from './Logo';
import { Menu, Settings as SettingsIcon } from 'lucide-react';
import type { Role, Route } from './types';
import type { AuthUser } from '../api';

export function Navbar({
  role,
  user,
  route,
  go,
  onMenuClick,
}: {
  role: Role;
  user: AuthUser | null;
  route: Route;
  go: (r: Route) => void;
  onMenuClick: () => void;
}) {
  const navItem = (label: string, target: Route, _active: boolean) => (
    <button
      key={label}
      onClick={() => go(target)}
      className="rounded-full px-4 py-1.5 text-sm text-white transition hover:bg-[#ff4d2e1f]"
      style={{ fontWeight: 600 }}
    >
      {label}
    </button>
  );

  const initial = user?.username?.charAt(0).toUpperCase() ?? (role === 'admin' ? 'A' : role === 'user' ? 'J' : '');

  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur-xl"
      style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.75)' }}
    >
      <div className="mx-auto grid h-16 max-w-[1536px] grid-cols-[1fr_auto_1fr] items-center px-6">
        <div className="flex items-center gap-3 justify-self-start">
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open menu"
            className="grid size-9 place-items-center rounded-full hover:bg-white/5"
          >
            <Menu size={20} color="#ffffff" />
          </button>
          <button onClick={() => go({ name: 'landing' })} className="flex items-center">
            <Logo />
          </button>
        </div>

        <nav className="hidden items-center gap-1 justify-self-center md:flex">
          {navItem('All Events', { name: 'landing' }, route.name === 'landing')}
          {(role === 'user' || role === 'admin') && navItem('Joined Events', { name: 'joined-events' }, route.name === 'joined-events')}
          {role === 'admin' && navItem('Hosted Events', { name: 'admin' }, route.name === 'admin')}
        </nav>

        <div className="flex items-center gap-2 justify-self-end">
          {(role === 'user' || role === 'admin') && (
            <>
              <button
                type="button"
                aria-label="Settings"
                onClick={() => go({ name: 'settings' })}
                className="grid size-9 place-items-center rounded-full text-white transition hover:bg-white/5"
              >
                <SettingsIcon size={18} color="#f5f5f7" />
              </button>
              <button
                type="button"
                aria-label="Profile"
                onClick={() => go({ name: 'profile' })}
                className="grid size-8 place-items-center rounded-full text-sm text-white transition hover:opacity-90"
                style={{ background: '#ff4d2e', fontWeight: 600 }}
              >
                {initial}
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
