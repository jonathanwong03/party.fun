import { useMemo, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route as BrowserRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router';
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

type RouteState = {
  fromProfile?: boolean;
  fromAdmin?: boolean;
  qty?: number;
  amount?: number;
};

function pathForRoute(route: Route) {
  switch (route.name) {
    case 'landing':
      return '/events';
    case 'event':
      return `/events/${route.id}`;
    case 'checkout':
      return `/checkout/${route.id}`;
    case 'confirmation':
      return `/confirmation/${route.id}`;
    case 'login':
      return '/login';
    case 'choose-account':
      return '/signup';
    case 'register-user':
      return '/signup/user';
    case 'register-admin':
      return '/signup/admin';
    case 'profile':
      return '/profile';
    case 'admin':
      return '/dashboard';
    case 'create-event':
      return '/dashboard/events/new';
    case 'edit-event':
      return `/dashboard/events/${route.id}/edit`;
  }
}

function stateForRoute(route: Route): RouteState | undefined {
  if (route.name === 'event') {
    return {
      fromProfile: route.fromProfile,
      fromAdmin: route.fromAdmin,
      qty: route.qty,
      amount: route.amount,
    };
  }

  if (route.name === 'confirmation') {
    return { qty: route.qty };
  }

  return undefined;
}

function isAuthPath(pathname: string) {
  return pathname === '/' || pathname === '/login' || pathname === '/signup' || pathname === '/signup/user' || pathname === '/signup/admin';
}

function routeFromPath(pathname: string, state: RouteState | null): Route {
  if (pathname === '/' || pathname === '/login') return { name: 'login' };
  if (pathname === '/signup') return { name: 'choose-account' };
  if (pathname === '/signup/user') return { name: 'register-user' };
  if (pathname === '/signup/admin') return { name: 'register-admin' };
  if (pathname === '/events') return { name: 'landing' };
  if (pathname === '/profile') return { name: 'profile' };
  if (pathname === '/dashboard') return { name: 'admin' };
  if (pathname === '/dashboard/events/new') return { name: 'create-event' };

  const checkoutMatch = pathname.match(/^\/checkout\/([^/]+)$/);
  if (checkoutMatch) return { name: 'checkout', id: checkoutMatch[1] };

  const confirmationMatch = pathname.match(/^\/confirmation\/([^/]+)$/);
  if (confirmationMatch) return { name: 'confirmation', id: confirmationMatch[1], qty: state?.qty ?? 1 };

  const editMatch = pathname.match(/^\/dashboard\/events\/([^/]+)\/edit$/);
  if (editMatch) return { name: 'edit-event', id: editMatch[1] };

  const eventMatch = pathname.match(/^\/events\/([^/]+)$/);
  if (eventMatch) {
    return {
      name: 'event',
      id: eventMatch[1],
      fromProfile: state?.fromProfile,
      fromAdmin: state?.fromAdmin,
      qty: state?.qty,
      amount: state?.amount,
    };
  }

  return { name: 'login' };
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [role, setRole] = useState<Role | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [addedTickets, setAddedTickets] = useState<{ eventId: string; qty: number; amount: number }[]>([]);

  const [events, setEvents] = useState<EventItem[]>(MOCK_EVENTS);
  const addEvent = (e: EventItem) => setEvents((prev) => [e, ...prev]);
  const deleteEvent = (id: string) => setEvents((prev) => prev.filter((e) => e.id !== id));

  const [cancelledTickets, setCancelledTickets] = useState<{ eventId: string; qty: number; amount: number }[]>([]);

  const pledge = (eventId: string, qty: number, amount: number) => {
    setAddedTickets((prev) => (prev.some((p) => p.eventId === eventId) ? prev : [{ eventId, qty, amount }, ...prev]));
    setCancelledTickets((prev) => prev.filter((p) => p.eventId !== eventId));
    setEvents((prev) => prev.map((e) => (e.id === eventId ? applyPledge(e, qty) : e)));
  };

  const cancelEvent = (eventId: string, qty: number, amount: number) => {
    setEvents((prev) => prev.map((e) => (e.id === eventId ? reversePledge(e, qty) : e)));
    setAddedTickets((prev) => prev.filter((p) => p.eventId !== eventId));
    setCancelledTickets((prev) => [{ eventId, qty, amount }, ...prev.filter((p) => p.eventId !== eventId)]);
  };

  const myEventIds = useMemo(() => {
    const ids = new Set<string>([...PLEDGED_EVENT_IDS, ...addedTickets.map((t) => t.eventId)]);
    cancelledTickets.forEach((c) => ids.delete(c.eventId));
    return ids;
  }, [addedTickets, cancelledTickets]);

  const activeRoute = routeFromPath(location.pathname, (location.state ?? null) as RouteState | null);
  const isAuthPage = isAuthPath(location.pathname);
  const isAdminConsole = location.pathname.startsWith('/dashboard');

  const go = (nextRoute: Route) => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    navigate(role || isAuthPath(pathForRoute(nextRoute)) ? pathForRoute(nextRoute) : '/login', {
      state: stateForRoute(nextRoute),
    });
  };

  const handleLogin = (nextRole: Role) => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    setRole(nextRole);
    navigate(nextRole === 'admin' ? '/dashboard' : '/events', { replace: true });
  };

  const handleLogout = () => {
    setRole(null);
    navigate('/login', { replace: true });
  };

  if (!role && !isAuthPage) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="dark min-h-screen pb-16 md:pb-0" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      {!isAuthPage && role && (
        <Navbar
          role={role}
          route={activeRoute}
          go={go}
          onLogout={handleLogout}
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

      <Routes>
        <BrowserRoute path="/" element={<Login go={go} onLogin={handleLogin} />} />
        <BrowserRoute path="/login" element={<Login go={go} onLogin={handleLogin} />} />
        <BrowserRoute path="/signup" element={<ChooseAccount go={go} />} />
        <BrowserRoute path="/signup/user" element={<RegisterUser go={go} onLogin={handleLogin} />} />
        <BrowserRoute path="/signup/admin" element={<RegisterAdmin go={go} onLogin={handleLogin} />} />
        <BrowserRoute path="/events" element={<Landing go={go} myEventIds={myEventIds} />} />
        <BrowserRoute path="/events/:eventId" element={<EventDetailRoute role={role} go={go} events={events} onCancelAttendance={cancelEvent} />} />
        <BrowserRoute path="/checkout/:eventId" element={<CheckoutRoute role={role} go={go} events={events} onPledge={pledge} />} />
        <BrowserRoute path="/confirmation/:eventId" element={<ConfirmationRoute role={role} go={go} events={events} />} />
        <BrowserRoute path="/profile" element={<Profile go={go} added={addedTickets} events={events} cancelled={cancelledTickets} />} />
        <BrowserRoute path="/dashboard" element={<AdminDashboard route={activeRoute} go={go} events={events} onDelete={deleteEvent} />} />
        <BrowserRoute path="/dashboard/events/new" element={<CreateEvent route={activeRoute} go={go} events={events} onPublish={addEvent} />} />
        <BrowserRoute path="/dashboard/events/:eventId/edit" element={<EditEventRoute activeRoute={activeRoute} go={go} events={events} onDelete={deleteEvent} />} />
        <BrowserRoute path="*" element={<Navigate to={role ? '/events' : '/login'} replace />} />
      </Routes>

      {!isAuthPage && !isAdminConsole && role && (
        <MobileNav role={role} route={activeRoute} go={go} />
      )}
    </div>
  );
}

function EventDetailRoute({
  role,
  go,
  events,
  onCancelAttendance,
}: {
  role: Role | null;
  go: (r: Route) => void;
  events: EventItem[];
  onCancelAttendance: (id: string, qty: number, amount: number) => void;
}) {
  const { eventId = '' } = useParams();
  const location = useLocation();
  const state = (location.state ?? {}) as RouteState;

  if (!role) return <Navigate to="/login" replace />;

  return (
    <EventDetail
      id={eventId}
      role={role}
      go={go}
      events={events}
      qty={state.qty}
      amount={state.amount}
      onCancelAttendance={onCancelAttendance}
      fromProfile={state.fromProfile}
      fromAdmin={state.fromAdmin}
    />
  );
}

function CheckoutRoute({
  role,
  go,
  events,
  onPledge,
}: {
  role: Role | null;
  go: (r: Route) => void;
  events: EventItem[];
  onPledge: (eventId: string, qty: number, amount: number) => void;
}) {
  const { eventId = '' } = useParams();

  if (!role) return <Navigate to="/login" replace />;

  return <Checkout id={eventId} role={role} go={go} events={events} onPledge={onPledge} />;
}

function ConfirmationRoute({
  role,
  go,
  events,
}: {
  role: Role | null;
  go: (r: Route) => void;
  events: EventItem[];
}) {
  const { eventId = '' } = useParams();
  const location = useLocation();
  const state = (location.state ?? {}) as RouteState;

  if (!role) return <Navigate to="/login" replace />;

  return <Confirmation id={eventId} qty={state.qty ?? 1} role={role} go={go} events={events} />;
}

function EditEventRoute({
  activeRoute,
  go,
  events,
  onDelete,
}: {
  activeRoute: Route;
  go: (r: Route) => void;
  events: EventItem[];
  onDelete: (id: string) => void;
}) {
  const { eventId = '' } = useParams();
  return <CreateEvent route={activeRoute} go={go} editId={eventId} events={events} onDelete={onDelete} />;
}
