import { LayoutDashboard, CalendarPlus, Settings, BarChart3, Users, Ticket } from 'lucide-react';
import type { Route } from './types';

export function OrganiserSidebar({ route, go }: { route: Route; go: (r: Route) => void }) {
  const items = [
    { label: 'Hosted Events', icon: LayoutDashboard, target: { name: 'hosted-events' } as Route, active: route.name === 'hosted-events' },
    { label: 'Create Event', icon: CalendarPlus, target: { name: 'create-event' } as Route, active: route.name === 'create-event' },
    { label: 'Analytics', icon: BarChart3, target: { name: 'hosted-events' } as Route, active: false },
    { label: 'Attendees', icon: Users, target: { name: 'hosted-events' } as Route, active: false },
    { label: 'Tickets', icon: Ticket, target: { name: 'hosted-events' } as Route, active: false },
    { label: 'Settings', icon: Settings, target: { name: 'hosted-events' } as Route, active: false },
  ];

  return (
    <aside
      className="hidden w-[8.75rem] shrink-0 flex-col p-3 md:flex"
      style={{
        background: '#0f0f15',
        borderRightWidth: '0.556px',
        borderRightStyle: 'solid',
        borderRightColor: 'rgba(255,255,255,0.08)',
        minHeight: 'calc(100vh - 64px)',
      }}
    >
      <div className="mb-6 px-2 pt-2">
        
      </div>
      <nav className="flex flex-col gap-1">
        {items.map((it) => (
          <button
            key={it.label}
            onClick={() => go(it.target)}
            className="flex items-center gap-2 whitespace-nowrap rounded-[14px] px-2.5 py-2 text-sm transition"
            style={{
              background: it.active ? 'rgba(255,77,46,0.12)' : 'transparent',
              color: it.active ? '#ffffff' : '#8a8a99',
              fontWeight: 500,
              borderLeftWidth: '1.667px',
              borderLeftStyle: 'solid',
              borderLeftColor: it.active ? '#ff4d2e' : 'transparent',
            }}
          ><it.icon size={16} />{it.label}</button>
        ))}
      </nav>
      <button
        onClick={() => go({ name: 'faq' })}
        className="mt-auto rounded-[14px] p-3 text-left transition hover:bg-white/5"
        style={{
          background: '#14141b',
          borderWidth: '0.556px',
          borderStyle: 'solid',
          borderColor: 'rgba(255,255,255,0.08)',
        }}
      >
        <div className="text-xs" style={{ color: '#8a8a99' }}>
          Need help?
        </div>
        <div className="text-sm underline" style={{ color: '#f5f5f7', fontWeight: 500 }}>
          See the commonly asked questions
        </div>
      </button>
    </aside>
  );
}
