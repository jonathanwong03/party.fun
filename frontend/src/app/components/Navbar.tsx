import { Logo } from './Logo';
import { LogOut, Menu, User as UserIcon } from 'lucide-react';
import type { Role, Route } from './types';

export function Navbar({
  role,
  route,
  go,
  onLogout,
  onMenuClick,
}: {
  role: Role;
  route: Route;
  go: (r: Route) => void;
  onLogout: () => void;
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

  const initial = role === 'admin' ? 'A' : role === 'user' ? 'J' : '';

  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur-xl"
      style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.75)' }}
    >
      <div className="mx-auto flex h-16 max-w-[1536px] items-center justify-between px-6">
        <div className="flex items-center gap-3">
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

        <nav className="hidden items-center gap-1 md:flex">
          {navItem('All Events', { name: 'landing' }, route.name === 'landing')}
          {(role === 'user' || role === 'admin') && navItem('Joined Events', { name: 'profile' }, route.name === 'profile')}
          {role === 'admin' && navItem('Hosted Events', { name: 'admin' }, route.name === 'admin')}
        </nav>

        <div className="flex items-center gap-3">
          {(role === 'user' || role === 'admin') && (
            <>
              <button
                type="button"
                onClick={() => go({ name: 'profile' })}
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm text-[#f5f5f7] transition hover:bg-white/5"
                style={{ fontWeight: 600 }}
              >
                <UserIcon size={15} color="#f5f5f7" /> Profile
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm text-white transition hover:bg-white/5"
                style={{ fontWeight: 600 }}
              >
                <LogOut size={15} color="#ffffff" /> Logout
              </button>
              <div
                className="grid size-8 place-items-center rounded-full text-sm text-white"
                style={{ background: '#ff4d2e', fontWeight: 600 }}
              >
                {initial}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
