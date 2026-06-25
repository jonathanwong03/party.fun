import { Logo } from './Logo';
import { Menu, Settings as SettingsIcon, Wallet as WalletIcon } from 'lucide-react';
import type { Role, Route } from './types';
import type { AuthUser } from '../api';

export function Navbar({
  role,
  user,
  route,
  go,
  walletBalance,
  onMenuClick,
}: {
  role: Role | null;
  user: AuthUser | null;
  route: Route;
  go: (r: Route) => void;
  walletBalance?: number | null;
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

  const initial = user?.username?.charAt(0).toUpperCase() ?? (role === 'organiser' ? 'A' : role === 'user' ? 'J' : '');

  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur-xl"
      style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.92)' }}
    >
      <div className="mx-auto grid h-16 max-w-[1536px] grid-cols-[1fr_auto_1fr] items-center px-6">
        <div className="flex items-center gap-3 justify-self-start">
          {role && (
            <button
              type="button"
              onClick={onMenuClick}
              aria-label="Open menu"
              className="grid size-9 place-items-center rounded-full hover:bg-white/5"
            >
              <Menu size={20} color="#ffffff" />
            </button>
          )}
          <button onClick={() => go({ name: 'landing' })} className="flex items-center">
            <Logo />
          </button>
        </div>

        <nav className="hidden items-center gap-1 justify-self-center md:flex">
          {navItem('All Events', { name: 'landing' }, route.name === 'landing')}
          {(role === 'user' || role === 'organiser') && navItem('Joined Events', { name: 'joined-events' }, route.name === 'joined-events')}
          {role === 'organiser' && navItem('Hosted Events', { name: 'hosted-events' }, route.name === 'hosted-events')}
          {role === 'admin' && navItem('Manage Events', { name: 'manage-events' }, route.name === 'manage-events')}
        </nav>

        <div className="flex items-center gap-2 justify-self-end">
          {role ? (
            <>
              {role !== 'admin' && (
                <button
                  type="button"
                  aria-label="Wallet"
                  onClick={() => go({ name: 'wallet' })}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 text-sm text-white transition hover:bg-white/10"
                  style={{ height: 36, background: 'rgba(255,255,255,0.06)', fontWeight: 600 }}
                >
                  <WalletIcon size={15} color="#ffffff" />
                  {walletBalance != null ? `$${walletBalance.toFixed(2)}` : 'Wallet'}
                </button>
              )}
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
                className="grid size-8 place-items-center overflow-hidden rounded-full text-sm text-white transition hover:opacity-90"
                style={{ background: '#ff4d2e', fontWeight: 600 }}
              >
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="Profile" referrerPolicy="no-referrer" className="size-full object-cover" />
                ) : (
                  initial
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => go({ name: 'login' })}
              className="rounded-full bg-[#ff4d2e] px-4 py-1.5 text-sm text-white transition hover:bg-[#ff6647]"
              style={{ fontWeight: 600 }}
            >
              Login
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
