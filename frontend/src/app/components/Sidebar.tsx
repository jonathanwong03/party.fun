import { X, CalendarRange, Bookmark, User, Settings, LayoutDashboard, CalendarPlus, BarChart3, Users, Ticket } from 'lucide-react';
import type { Role, Route } from './types';

type Item = { label: string; icon: typeof X; target: Route; active: boolean };

export function Sidebar({
  open,
  onClose,
  role,
  route,
  go,
}: {
  open: boolean;
  onClose: () => void;
  role: Role;
  route: Route;
  go: (r: Route) => void;
}) {
  const isOrganiser = role === 'organiser';
  const isAdmin = role === 'admin';

  const baseItems: Item[] = [
    { label: 'All Events', icon: CalendarRange, target: { name: 'landing' }, active: route.name === 'landing' },
    ...(isAdmin ? [] : [{ label: 'Joined Events', icon: Bookmark, target: { name: 'joined-events' }, active: route.name === 'joined-events' } as Item]),
    { label: 'Analytics', icon: BarChart3, target: { name: 'analytics' }, active: route.name === 'analytics' },
  ];

  const organiserOnly: Item[] = [
    { label: 'Hosted Events', icon: LayoutDashboard, target: { name: 'hosted-events' }, active: route.name === 'hosted-events' },
    { label: 'Create Event', icon: CalendarPlus, target: { name: 'create-event' }, active: route.name === 'create-event' },
    { label: 'Attendees', icon: Users, target: { name: 'attendees-all' }, active: route.name === 'attendees-all' },
    { label: 'Tickets', icon: Ticket, target: { name: 'tickets' }, active: route.name === 'tickets' },
  ];

  const adminOnly: Item[] = [
    { label: 'Manage Events', icon: LayoutDashboard, target: { name: 'manage-events' }, active: route.name === 'manage-events' },
    { label: 'Tickets', icon: Ticket, target: { name: 'tickets' }, active: route.name === 'tickets' },
  ];

  const tail: Item[] = [
    ...(isAdmin ? [] : [{ label: 'View Profile', icon: User, target: { name: 'profile' }, active: route.name === 'profile' } as Item]),
    { label: 'Settings', icon: Settings, target: { name: 'settings' }, active: route.name === 'settings' },
  ];

  const items = [...baseItems, ...(isOrganiser ? organiserOnly : []), ...(isAdmin ? adminOnly : []), ...tail];

  const handleClick = (target: Route) => {
    go(target);
    onClose();
  };

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className="fixed inset-0 z-40 cursor-pointer transition-opacity"
        style={{
          background: 'rgba(0,0,0,0.55)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
        }}
      />
      <aside
        className="fixed left-0 top-0 z-50 flex h-full w-[260px] flex-col transition-transform duration-300"
        style={{
          background: '#0f0f15',
          borderRightWidth: '0.609px',
          borderRightStyle: 'solid',
          borderRightColor: 'rgba(255,255,255,0.08)',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
        }}
      >
        <div className="flex h-14 items-center justify-end px-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="grid size-9 place-items-center rounded-full hover:bg-white/5"
          >
            <X size={18} color="#ffffff" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          <div className="flex flex-col gap-1">
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                onClick={() => handleClick(it.target)}
                className="flex items-center gap-2.5 whitespace-nowrap rounded-[16px] px-3 py-2.5 text-sm text-[#8a8a99] transition hover:bg-[#ff4d2e1f] hover:text-white"
                style={{
                  fontWeight: 500,
                  borderLeftWidth: '1.895px',
                  borderLeftStyle: 'solid',
                  borderLeftColor: 'transparent',
                }}
              >
                <it.icon size={16} color="#8a8a99" />
                {it.label}
              </button>
            ))}
          </div>
        </nav>
        <div
          className="m-3 rounded-[14px] p-3"
          style={{
            background: '#14141b',
            borderWidth: '0.609px',
            borderStyle: 'solid',
            borderColor: 'rgba(255,255,255,0.08)',
          }}
        >
          <div className="text-xs" style={{ color: '#8a8a99' }}>
            Need help?
          </div>
          <div className="text-sm underline" style={{ color: '#f5f5f7', fontWeight: 500 }}>
            {isOrganiser ? 'Read the organiser guide' : 'Read the attendee guide'}
          </div>
        </div>
      </aside>
    </>
  );
}
