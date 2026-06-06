import { Home, Search, Ticket, User } from 'lucide-react';
import type { Role, Route } from './types';

export function MobileNav({
  role,
  route,
  go,
}: {
  role: Role;
  route: Route;
  go: (r: Route) => void;
}) {
  const items = [
    { icon: Home, label: 'Home', target: { name: 'landing' } as Route, active: route.name === 'landing' },
    { icon: Search, label: 'Search', target: { name: 'landing' } as Route, active: false },
    { icon: Ticket, label: 'My Tickets', target: { name: 'joined-events' } as Route, active: route.name === 'joined-events' },
    { icon: User, label: 'Account', target: role === 'organiser' ? ({ name: 'organiser' } as Route) : ({ name: 'profile' } as Route), active: route.name === 'profile' || route.name === 'organiser' },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t md:hidden"
      style={{ background: 'rgba(11,11,20,0.92)', borderColor: 'var(--border)', backdropFilter: 'blur(20px)' }}
    >
      <div className="flex items-center justify-around px-2 pb-safe">
        {items.map(({ icon: Icon, label, target, active }) => (
          <button
            key={label}
            onClick={() => go(target)}
            className="flex flex-col items-center gap-0.5 px-4 py-3 transition"
            style={{ color: active ? '#ff4d2e' : 'var(--muted-foreground)' }}
          >
            <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
            <span className="text-[10px]" style={{ fontWeight: active ? 700 : 400 }}>{label}</span>
            {active && <span className="size-1 rounded-full" style={{ background: '#ff4d2e' }} />}
          </button>
        ))}
      </div>
    </nav>
  );
}
