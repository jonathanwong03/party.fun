import { useMemo, useState } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { MOCK_EVENTS, PLEDGED_EVENT_IDS, type EventItem, type Role, type Route } from './components/types';
import { Landing } from './pages/Landing';
import { EventDetail } from './pages/EventDetail';
import { Checkout } from './pages/Checkout';
import { Confirmation } from './pages/Confirmation';
import { Login } from './pages/Login';
import { ChooseAccount } from './pages/ChooseAccount';
import { RegisterUser } from './pages/RegisterUser';
import { RegisterAdmin } from './pages/RegisterAdmin';
import { Profile } from './pages/Profile';
import { AdminDashboard } from './pages/AdminDashboard';
import { CreateEvent } from './pages/CreateEvent';

function isAuthRoute(route: Route) {
  return (
    route.name === 'login' ||
    route.name === 'choose-account' ||
    route.name === 'register-user' ||
    route.name === 'register-admin'
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'login' });
  const [role, setRole] = useState<Role | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [addedTickets, setAddedTickets] = useState<{ eventId: string; qty: number; amount: number }[]>([]);
  const addTicket = (t: { eventId: string; qty: number; amount: number }) =>
    setAddedTickets((prev) => [t, ...prev.filter((p) => p.eventId !== t.eventId)]);

  const [events, setEvents] = useState<EventItem[]>(MOCK_EVENTS);
  const addEvent = (e: EventItem) => setEvents((prev) => [e, ...prev]);
  const deleteEvent = (id: string) => setEvents((prev) => prev.filter((e) => e.id !== id));

  // Events already in "My Events" (pre-pledged base + anything just pledged this session).
  // These are hidden from the "All Events" browse list so the same event can't be pledged twice.
  const myEventIds = useMemo(
    () => new Set<string>([...PLEDGED_EVENT_IDS, ...addedTickets.map((t) => t.eventId)]),
    [addedTickets],
  );

  const go = (r: Route) => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    setRoute(role || isAuthRoute(r) ? r : { name: 'login' });
  };

  const handleLogin = (nextRole: Role) => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    setRole(nextRole);
    setRoute({ name: nextRole === 'admin' ? 'admin' : 'landing' });
  };

  const activeRoute = role || isAuthRoute(route) ? route : { name: 'login' };
  const isAuthPage = isAuthRoute(activeRoute);

  const isAdminConsole = activeRoute.name === 'admin' || activeRoute.name === 'create-event' || activeRoute.name === 'edit-event';

  return (
    <div className="dark min-h-screen pb-16 md:pb-0" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      {!isAuthPage && role && (
        <Navbar
          role={role}
          route={activeRoute}
          go={go}
          onLogout={() => {
            setRole(null);
            setRoute({ name: 'login' });
          }}
          onMenuClick={() => setSidebarOpen(true)}
        />
      )}
      {!isAuthPage && role && (
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          role={role}
          route={activeRoute}
          go={go}
        />
      )}

      {activeRoute.name === 'landing' && <Landing go={go} myEventIds={myEventIds} />}
      {activeRoute.name === 'event' && role && <EventDetail id={activeRoute.id} role={role} go={go} fromProfile={activeRoute.fromProfile} fromAdmin={activeRoute.fromAdmin} />}
      {activeRoute.name === 'checkout' && role && <Checkout id={activeRoute.id} role={role} go={go} />}
      {activeRoute.name === 'confirmation' && role && (
        <Confirmation id={activeRoute.id} qty={activeRoute.qty} role={role} go={go} onAdd={addTicket} />
      )}
      {activeRoute.name === 'login' && <Login go={go} onLogin={handleLogin} />}
      {activeRoute.name === 'choose-account' && <ChooseAccount go={go} />}
      {activeRoute.name === 'register-user' && <RegisterUser go={go} onLogin={handleLogin} />}
      {activeRoute.name === 'register-admin' && <RegisterAdmin go={go} onLogin={handleLogin} />}
      {activeRoute.name === 'profile' && <Profile go={go} added={addedTickets} />}
      {activeRoute.name === 'admin' && <AdminDashboard route={activeRoute} go={go} events={events} onDelete={deleteEvent} />}
      {activeRoute.name === 'create-event' && <CreateEvent route={activeRoute} go={go} events={events} onPublish={addEvent} />}
      {activeRoute.name === 'edit-event' && <CreateEvent route={activeRoute} go={go} editId={activeRoute.id} events={events} onDelete={deleteEvent} />}

      {!isAuthPage && !isAdminConsole && role && (
        <MobileNav role={role} route={activeRoute} go={go} />
      )}
    </div>
  );
}
