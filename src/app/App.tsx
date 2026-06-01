import { useMemo, useState } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { MOCK_EVENTS, PLEDGED_EVENT_IDS, applyPledge, reversePledge, type EventItem, type Role, type Route } from './components/types';
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

  const [events, setEvents] = useState<EventItem[]>(MOCK_EVENTS);
  const addEvent = (e: EventItem) => setEvents((prev) => [e, ...prev]);
  const deleteEvent = (id: string) => setEvents((prev) => prev.filter((e) => e.id !== id));

  const [cancelledTickets, setCancelledTickets] = useState<{ eventId: string; qty: number; amount: number }[]>([]);

  // Commit a confirmed pledge: record the ticket (for "My Events" + Landing hiding), remove it
  // from the cancelled list, and bump the event's backers / active tier / hype.
  const pledge = (eventId: string, qty: number, amount: number) => {
    setAddedTickets((prev) => (prev.some((p) => p.eventId === eventId) ? prev : [{ eventId, qty, amount }, ...prev]));
    setCancelledTickets((prev) => prev.filter((p) => p.eventId !== eventId));
    setEvents((prev) => prev.map((e) => (e.id === eventId ? applyPledge(e, qty) : e)));
  };

  // Cancel attendance: reverse the pledge stats, drop it from upcoming, and record it as a
  // cancelled/refunded ticket. It stays in "My Events" (Cancelled tab) and returns to All Events.
  const cancelEvent = (eventId: string, qty: number, amount: number) => {
    setEvents((prev) => prev.map((e) => (e.id === eventId ? reversePledge(e, qty) : e)));
    setAddedTickets((prev) => prev.filter((p) => p.eventId !== eventId));
    setCancelledTickets((prev) => [{ eventId, qty, amount }, ...prev.filter((p) => p.eventId !== eventId)]);
  };

  // Events in "My Events" upcoming (pre-pledged base + anything pledged this session), minus any
  // the user has cancelled. Hidden from the "All Events" browse list; cancelled events reappear there.
  const myEventIds = useMemo(() => {
    const ids = new Set<string>([...PLEDGED_EVENT_IDS, ...addedTickets.map((t) => t.eventId)]);
    cancelledTickets.forEach((c) => ids.delete(c.eventId));
    return ids;
  }, [addedTickets, cancelledTickets]);

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
      {activeRoute.name === 'event' && role && <EventDetail id={activeRoute.id} role={role} go={go} events={events} qty={activeRoute.qty} amount={activeRoute.amount} onCancelAttendance={cancelEvent} fromProfile={activeRoute.fromProfile} fromAdmin={activeRoute.fromAdmin} />}
      {activeRoute.name === 'checkout' && role && <Checkout id={activeRoute.id} role={role} go={go} events={events} onPledge={pledge} />}
      {activeRoute.name === 'confirmation' && role && (
        <Confirmation id={activeRoute.id} qty={activeRoute.qty} role={role} go={go} events={events} />
      )}
      {activeRoute.name === 'login' && <Login go={go} onLogin={handleLogin} />}
      {activeRoute.name === 'choose-account' && <ChooseAccount go={go} />}
      {activeRoute.name === 'register-user' && <RegisterUser go={go} onLogin={handleLogin} />}
      {activeRoute.name === 'register-admin' && <RegisterAdmin go={go} onLogin={handleLogin} />}
      {activeRoute.name === 'profile' && <Profile go={go} added={addedTickets} events={events} cancelled={cancelledTickets} />}
      {activeRoute.name === 'admin' && <AdminDashboard route={activeRoute} go={go} events={events} onDelete={deleteEvent} />}
      {activeRoute.name === 'create-event' && <CreateEvent route={activeRoute} go={go} events={events} onPublish={addEvent} />}
      {activeRoute.name === 'edit-event' && <CreateEvent route={activeRoute} go={go} editId={activeRoute.id} events={events} onDelete={deleteEvent} />}

      {!isAuthPage && !isAdminConsole && role && (
        <MobileNav role={role} route={activeRoute} go={go} />
      )}
    </div>
  );
}
