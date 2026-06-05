import { useEffect, useMemo, useState } from 'react';
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
import { type EventItem, type Role, type Route } from './components/types';
import { cancelTicket, createPledge, fetchEvents, fetchProfile, resetUsers, type AuthUser, type ProfileTicket } from './api';
import { Landing } from './pages/Landing';
import { EventDetail } from './pages/EventDetail';
import { Checkout } from './pages/Checkout';
import { Confirmation } from './pages/Confirmation';
import { Login } from './pages/Login';
import { ChooseAccount } from './pages/ChooseAccount';
import { RegisterUser } from './pages/RegisterUser';
import { RegisterAdmin } from './pages/RegisterAdmin';
import { Profile } from './pages/Profile';
import { JoinedEvents } from './pages/JoinedEvents';
import { Settings } from './pages/Settings';
import { AdminDashboard } from './pages/AdminDashboard';
import { CreateEvent } from './pages/CreateEvent';

type RouteState = {
  fromProfile?: boolean;
  fromAdmin?: boolean;
  fromPast?: boolean;
  qty?: number;
  amount?: number;
  total?: number;
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
    case 'joined-events':
      return '/joined-events';
    case 'settings':
      return '/settings';
    case 'admin':
      return '/dashboard';
    case 'create-event':
      return route.draftId ? `/dashboard/drafts/${route.draftId}/edit` : '/dashboard/events/new';
    case 'edit-event':
      return `/dashboard/events/${route.id}/edit`;
  }
}

function stateForRoute(route: Route): RouteState | undefined {
  if (route.name === 'event') {
    return {
      fromProfile: route.fromProfile,
      fromAdmin: route.fromAdmin,
      fromPast: route.fromPast,
      qty: route.qty,
      amount: route.amount,
      total: route.total,
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
  if (pathname === '/joined-events') return { name: 'joined-events' };
  if (pathname === '/settings') return { name: 'settings' };
  if (pathname === '/dashboard') return { name: 'admin' };
  if (pathname === '/dashboard/events/new') return { name: 'create-event' };

  const draftMatch = pathname.match(/^\/dashboard\/drafts\/([^/]+)\/edit$/);
  if (draftMatch) return { name: 'create-event', draftId: draftMatch[1] };

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
      fromPast: state?.fromPast,
      qty: state?.qty,
      amount: state?.amount,
      total: state?.total,
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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('theme') as 'dark' | 'light') || 'dark');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  const updateUsername = (name: string) => setUser((u) => (u ? { ...u, username: name } : u));
  const [events, setEvents] = useState<EventItem[]>([]);
  const [profileTickets, setProfileTickets] = useState<ProfileTicket[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const addEvent = (e: EventItem) => setEvents((prev) => [e, ...prev]);
  const deleteEvent = (id: string) => setEvents((prev) => prev.filter((e) => e.id !== id));
  const updateEvent = (updated: EventItem) =>
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));

  const [drafts, setDrafts] = useState<EventItem[]>([]);
  // Upsert: re-saving a resumed draft replaces the existing one rather than duplicating it.
  const addDraft = (d: EventItem) =>
    setDrafts((prev) => (prev.some((p) => p.id === d.id) ? prev.map((p) => (p.id === d.id ? d : p)) : [d, ...prev]));
  const deleteDraft = (id: string) => setDrafts((prev) => prev.filter((d) => d.id !== id));

  const replaceEvent = (updated: EventItem) => {
    setEvents((prev) => prev.map((event) => (event.id === updated.id ? updated : event)));
  };

  // On every full page load, drop any registered accounts back to the two seed
  // users (there are no sessions, so created accounts shouldn't survive a refresh).
  useEffect(() => {
    resetUsers();
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadBackendState() {
      if (!role) {
        setEvents([]);
        setProfileTickets([]);
        setDataError(null);
        setLoadingData(false);
        return;
      }

      setLoadingData(true);
      setDataError(null);
      try {
        const [loadedEvents, profile] = await Promise.all([fetchEvents(role), fetchProfile(role)]);
        if (ignore) return;
        setEvents(loadedEvents);
        setProfileTickets(profile.tickets);
      } catch (error) {
        if (ignore) return;
        setDataError(error instanceof Error ? error.message : 'Unable to load app data.');
      } finally {
        if (!ignore) setLoadingData(false);
      }
    }

    loadBackendState();
    return () => {
      ignore = true;
    };
  }, [role]);

  const pledge = async (eventId: string, qty: number, amount: number) => {
    if (!role) return;
    const result = await createPledge(role, eventId, qty, amount);
    replaceEvent(result.event);
    setProfileTickets(result.profile.tickets);
  };

  const cancelEvent = async (eventId: string, qty: number, amount: number) => {
    if (!role) return;
    const result = await cancelTicket(role, eventId, qty, amount);
    replaceEvent(result.event);
    setProfileTickets(result.profile.tickets);
  };

  const myEventIds = useMemo(() => {
    const ids = new Set<string>();
    profileTickets.forEach((ticket) => {
      if (ticket.tab !== 'cancelled') ids.add(ticket.eventId);
    });
    return ids;
  }, [profileTickets]);

  const activeRoute = routeFromPath(location.pathname, (location.state ?? null) as RouteState | null);
  const isAuthPage = isAuthPath(location.pathname);
  const isAdminConsole = location.pathname.startsWith('/dashboard');

  const go = (nextRoute: Route) => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    navigate(role || isAuthPath(pathForRoute(nextRoute)) ? pathForRoute(nextRoute) : '/login', {
      state: stateForRoute(nextRoute),
    });
  };

  const handleLogin = (account: AuthUser) => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    setRole(account.role);
    setUser(account);
    navigate(account.role === 'admin' ? '/dashboard' : '/events', { replace: true });
  };

  const handleLogout = () => {
    setRole(null);
    setUser(null);
    setEvents([]);
    setProfileTickets([]);
    navigate('/login', { replace: true });
  };

  if (!role && !isAuthPage) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className={`${theme === 'dark' ? 'dark' : ''} min-h-screen pb-16 md:pb-0`} style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      {!isAuthPage && role && (
        <Navbar
          role={role}
          user={user}
          route={activeRoute}
          go={go}
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
        <BrowserRoute path="/signup/user" element={<RegisterUser go={go} />} />
        <BrowserRoute path="/signup/admin" element={<RegisterAdmin go={go} />} />
        <BrowserRoute path="/events" element={<Landing go={go} myEventIds={myEventIds} events={events} loading={loadingData} error={dataError} />} />
        <BrowserRoute path="/events/:eventId" element={<EventDetailRoute role={role} go={go} events={events} onCancelAttendance={cancelEvent} />} />
        <BrowserRoute path="/checkout/:eventId" element={<CheckoutRoute role={role} go={go} events={events} onPledge={pledge} />} />
        <BrowserRoute path="/confirmation/:eventId" element={<ConfirmationRoute role={role} go={go} events={events} />} />
        <BrowserRoute path="/profile" element={<Profile go={go} user={user} onLogout={handleLogout} />} />
        <BrowserRoute path="/joined-events" element={<JoinedEvents go={go} events={events} tickets={profileTickets} />} />
        <BrowserRoute path="/settings" element={<Settings user={user} onChangeUsername={updateUsername} theme={theme} onToggleTheme={toggleTheme} />} />
        <BrowserRoute path="/dashboard" element={<AdminDashboard route={activeRoute} go={go} events={events} onDelete={deleteEvent} drafts={drafts} onDeleteDraft={deleteDraft} />} />
        <BrowserRoute path="/dashboard/events/new" element={<CreateEvent route={activeRoute} go={go} events={events} onPublish={addEvent} onSaveDraft={addDraft} />} />
        <BrowserRoute path="/dashboard/drafts/:draftId/edit" element={<ResumeDraftRoute activeRoute={activeRoute} go={go} events={events} drafts={drafts} onPublish={addEvent} onSaveDraft={addDraft} onDeleteDraft={deleteDraft} />} />
        <BrowserRoute path="/dashboard/events/:eventId/edit" element={<EditEventRoute activeRoute={activeRoute} go={go} events={events} onDelete={deleteEvent} onUpdate={updateEvent} />} />
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
  onCancelAttendance: (id: string, qty: number, amount: number) => Promise<void>;
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
      total={state.total}
      onCancelAttendance={onCancelAttendance}
      fromProfile={state.fromProfile}
      fromAdmin={state.fromAdmin}
      fromPast={state.fromPast}
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
  onPledge: (eventId: string, qty: number, amount: number) => Promise<void>;
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
  onUpdate,
}: {
  activeRoute: Route;
  go: (r: Route) => void;
  events: EventItem[];
  onDelete: (id: string) => void;
  onUpdate: (e: EventItem) => void;
}) {
  const { eventId = '' } = useParams();
  return <CreateEvent route={activeRoute} go={go} editId={eventId} events={events} onDelete={onDelete} onUpdate={onUpdate} />;
}

function ResumeDraftRoute({
  activeRoute,
  go,
  events,
  drafts,
  onPublish,
  onSaveDraft,
  onDeleteDraft,
}: {
  activeRoute: Route;
  go: (r: Route) => void;
  events: EventItem[];
  drafts: EventItem[];
  onPublish: (e: EventItem) => void;
  onSaveDraft: (e: EventItem) => void;
  onDeleteDraft: (id: string) => void;
}) {
  const { draftId = '' } = useParams();
  return (
    <CreateEvent
      route={activeRoute}
      go={go}
      events={events}
      draftId={draftId}
      drafts={drafts}
      onPublish={onPublish}
      onSaveDraft={onSaveDraft}
      onDeleteDraft={onDeleteDraft}
    />
  );
}
