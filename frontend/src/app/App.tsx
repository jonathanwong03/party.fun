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
import { giveAwayTickets, deleteBooking, createPledge, fetchEvents, fetchProfile, logoutRequest, createEventRequest, updateEventRequest, deleteEventRequest, cancelEventRequest, hideEventRequest, deleteAccountRequest, fetchDrafts, saveDraftRequest, deleteDraftRequest, fetchWallet, type AuthUser, type ProfileTicket, type ProfileCounts } from './api';

const EMPTY_COUNTS: ProfileCounts = { upcoming: 0, past: 0, cancelled: 0 };
import { supabase } from './supabase';
import { Landing } from './pages/Landing';
import { EventDetail } from './pages/EventDetail';
import { Checkout } from './pages/Checkout';
import { Confirmation } from './pages/Confirmation';
import { Login } from './pages/Login';
import { ForgotPassword } from './pages/ForgotPassword';
import { VerifyCode } from './pages/VerifyCode';
import { ResetConfirm } from './pages/ResetConfirm';
import { ResetPassword } from './pages/ResetPassword';
import { ChooseAccount } from './pages/ChooseAccount';
import { AuthCallback } from './pages/AuthCallback';
import { FinishSignup } from './pages/FinishSignup';
import { RegisterUser } from './pages/RegisterUser';
import { RegisterOrganiser } from './pages/RegisterOrganiser';
import { Profile } from './pages/Profile';
import { JoinedEvents } from './pages/JoinedEvents';
import { Settings } from './pages/Settings';
import { WalletPage } from './pages/WalletPage';
import { OrganiserHostedEvents } from './pages/OrganiserHostedEvents';
import { CreateEvent } from './pages/CreateEvent';
import { Attendees } from './pages/Attendees';

type RouteState = {
  fromProfile?: boolean;
  fromOrganiser?: boolean;
  fromPast?: boolean;
  bookingId?: string;
  qty?: number;
  lines?: { label: string; count: number; subtotalText: string }[];
  reference?: string;
  tab?: 'created' | 'drafts';
  email?: string;
  code?: string;
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
    case 'attendees':
      return `/events/${route.id}/attendees`;
    case 'login':
      return '/login';
    case 'forgot-password':
      return '/forgot-password';
    case 'verify-code':
      return '/forgot-password/verify';
    case 'reset-confirm':
      return '/forgot-password/confirm';
    case 'reset-password':
      return '/forgot-password/reset';
    case 'choose-account':
      return '/signup';
    case 'auth-callback':
      return '/auth/callback';
    case 'finish-signup':
      return '/signup/finish';
    case 'register-user':
      return '/signup/user';
    case 'register-organiser':
      return '/signup/organiser';
    case 'profile':
      return '/profile';
    case 'joined-events':
      return '/joined-events';
    case 'settings':
      return '/settings';
    case 'wallet':
      return '/wallet';
    case 'hosted-events':
      return '/hosted-events';
    case 'create-event':
      return route.draftId ? `/hosted-events/drafts/${route.draftId}/edit` : '/hosted-events/events/new';
    case 'edit-event':
      return `/hosted-events/events/${route.id}/edit`;
  }
}

function stateForRoute(route: Route): RouteState | undefined {
  if (route.name === 'event') {
    return {
      fromProfile: route.fromProfile,
      fromOrganiser: route.fromOrganiser,
      fromPast: route.fromPast,
      bookingId: route.bookingId,
      qty: route.qty,
    };
  }

  if (route.name === 'confirmation') {
    return { qty: route.qty, lines: route.lines, reference: route.reference };
  }

  if (route.name === 'checkout') {
    return { qty: route.qty };
  }

  if (route.name === 'hosted-events') {
    return route.tab ? { tab: route.tab } : undefined;
  }

  if (route.name === 'verify-code') {
    return { email: route.email };
  }

  if (route.name === 'reset-confirm' || route.name === 'reset-password') {
    return { email: route.email, code: route.code };
  }

  return undefined;
}

function isAuthPath(pathname: string) {
  return pathname === '/' || pathname === '/login' || pathname === '/signup' || pathname === '/signup/user' || pathname === '/signup/organiser'
    || pathname === '/signup/finish' || pathname === '/auth/callback'
    || pathname.startsWith('/forgot-password');
}

// Pages a signed-out guest may view: the All Events list and any event detail.
function isPublicPath(pathname: string) {
  return pathname === '/events' || /^\/events\/[^/]+$/.test(pathname);
}

function routeFromPath(pathname: string, state: RouteState | null): Route {
  if (pathname === '/' || pathname === '/login') return { name: 'login' };
  if (pathname === '/forgot-password') return { name: 'forgot-password' };
  if (pathname === '/forgot-password/verify') return { name: 'verify-code', email: state?.email ?? '' };
  if (pathname === '/forgot-password/confirm') return { name: 'reset-confirm', email: state?.email ?? '', code: state?.code ?? '' };
  if (pathname === '/forgot-password/reset') return { name: 'reset-password', email: state?.email ?? '', code: state?.code ?? '' };
  if (pathname === '/signup') return { name: 'choose-account' };
  if (pathname === '/auth/callback') return { name: 'auth-callback' };
  if (pathname === '/signup/finish') return { name: 'finish-signup' };
  if (pathname === '/signup/user') return { name: 'register-user' };
  if (pathname === '/signup/organiser') return { name: 'register-organiser' };
  if (pathname === '/events') return { name: 'landing' };
  if (pathname === '/profile') return { name: 'profile' };
  if (pathname === '/joined-events') return { name: 'joined-events' };
  if (pathname === '/settings') return { name: 'settings' };
  if (pathname === '/wallet') return { name: 'wallet' };
  if (pathname === '/hosted-events') return { name: 'hosted-events', tab: state?.tab };
  if (pathname === '/hosted-events/events/new') return { name: 'create-event' };

  const draftMatch = pathname.match(/^\/hosted-events\/drafts\/([^/]+)\/edit$/);
  if (draftMatch) return { name: 'create-event', draftId: draftMatch[1] };

  const checkoutMatch = pathname.match(/^\/checkout\/([^/]+)$/);
  if (checkoutMatch) return { name: 'checkout', id: checkoutMatch[1], qty: state?.qty };

  const confirmationMatch = pathname.match(/^\/confirmation\/([^/]+)$/);
  if (confirmationMatch) return { name: 'confirmation', id: confirmationMatch[1], qty: state?.qty ?? 1, lines: state?.lines, reference: state?.reference };

  const attendeesMatch = pathname.match(/^\/events\/([^/]+)\/attendees$/);
  if (attendeesMatch) return { name: 'attendees', id: attendeesMatch[1] };

  const editMatch = pathname.match(/^\/hosted-events\/events\/([^/]+)\/edit$/);
  if (editMatch) return { name: 'edit-event', id: editMatch[1] };

  const eventMatch = pathname.match(/^\/events\/([^/]+)$/);
  if (eventMatch) {
    return {
      name: 'event',
      id: eventMatch[1],
      fromProfile: state?.fromProfile,
      fromOrganiser: state?.fromOrganiser,
      fromPast: state?.fromPast,
      bookingId: state?.bookingId,
      qty: state?.qty,
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
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('theme') as 'dark' | 'light') || 'dark');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  const updateUsername = (name: string) => setUser((u) => (u ? { ...u, username: name } : u));
  const updateAvatar = (url: string | null) => setUser((u) => (u ? { ...u, avatarUrl: url } : u));
  const updateContact = (telegram: string | null, phone: string | null) => setUser((u) => (u ? { ...u, telegram, phone } : u));
  const [events, setEvents] = useState<EventItem[]>([]);
  const [profileTickets, setProfileTickets] = useState<ProfileTicket[]>([]);
  const [profileCounts, setProfileCounts] = useState<ProfileCounts>(EMPTY_COUNTS);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const refreshWallet = () => { fetchWallet().then((w) => setWalletBalance(w.balance)).catch(() => {}); };
  const addEvent = async (e: EventItem) => {
    setEvents((prev) => [e, ...prev]);
    try {
      await createEventRequest(e);
      // Re-fetch so the rendered event uses backend-authoritative values
      // (maxCapacity, hypeThreshold, spotsLeft, hype, featured) and the real id.
      setEvents(await fetchEvents(role));
    } catch {
      setEvents((prev) => prev.filter((ev) => ev.id !== e.id));
    }
  };

  const deleteEvent = async (id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    try { await deleteEventRequest(id); } catch { /* already removed from state */ }
  };

  // Soft-cancel: the event stays in the list (rendered as CANCELLED), so re-fetch
  // rather than removing it optimistically.
  const cancelEvent = async (id: string, reason: string) => {
    try {
      await cancelEventRequest(id, reason);
      setEvents(await fetchEvents(role));
    } catch { /* leave state as-is on failure */ }
  };

  // Hide a cancelled event from the organiser dashboard (optimistic remove, then persist).
  const hideEvent = async (id: string) => {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, hostHidden: true } : e)));
    try { await hideEventRequest(id); } catch { setEvents(await fetchEvents(role)); }
  };

  const updateEvent = async (updated: EventItem) => {
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    try {
      await updateEventRequest(updated);
      setEvents(await fetchEvents(role)); // reconcile with backend-computed values
    } catch { /* state already updated */ }
  };

  const [drafts, setDrafts] = useState<EventItem[]>([]);
  // Optimistic local upsert for instant UI, then persist to Supabase and reconcile
  // the server-assigned id (new drafts arrive with a temporary client id).
  const addDraft = async (d: EventItem) => {
    setDrafts((prev) => (prev.some((p) => p.id === d.id) ? prev.map((p) => (p.id === d.id ? d : p)) : [d, ...prev]));
    try {
      await saveDraftRequest(d);
      setDrafts(await fetchDrafts());
    } catch { /* keep optimistic copy on failure */ }
  };
  const deleteDraft = async (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    try { await deleteDraftRequest(id); } catch { /* already removed from state */ }
  };

  const replaceEvent = (updated: EventItem) => {
    setEvents((prev) => prev.map((event) => (event.id === updated.id ? updated : event)));
  };

  // Restore session on page load and keep role/user in sync with Supabase Auth.
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const { data: profile } = await supabase
          .from('USER')
          .select('id, username, email, role, avatarUrl, socialLink, contact, onboarded')
          .eq('id', session.user.id)
          .single();
        if (profile && profile.onboarded) {
          setRole(profile.role as Role);
          setUser({ id: profile.id, username: profile.username, email: profile.email, role: profile.role as Role, avatarUrl: profile.avatarUrl, telegram: profile.socialLink, phone: profile.contact });
        } else if (profile && !profile.onboarded && location.pathname !== '/auth/callback') {
          // A signed-in OAuth user who never picked a role → resume finish-setup.
          navigate('/signup/finish', { replace: true });
        }
      }
      setSessionLoaded(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setRole(null);
        setUser(null);
        setEvents([]);
        setProfileTickets([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadBackendState() {
      // Events are public, so they load for guests too; the profile only loads when signed in.
      setLoadingData(true);
      setDataError(null);
      try {
        const loadedEvents = await fetchEvents(role);
        if (ignore) return;
        setEvents(loadedEvents);
        if (role) {
          const profile = await fetchProfile(role);
          if (ignore) return;
          setProfileTickets(profile.tickets);
          setProfileCounts(profile.counts);
        } else {
          setProfileTickets([]);
          setProfileCounts(EMPTY_COUNTS);
        }
        if (role === 'organiser') {
          const loadedDrafts = await fetchDrafts();
          if (ignore) return;
          setDrafts(loadedDrafts);
        } else {
          setDrafts([]);
        }
        if (role) refreshWallet(); else setWalletBalance(null);
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

  const pledge = async (eventId: string, qty: number, amount: number, paymentMethod: 'wallet' | 'card' = 'wallet'): Promise<string | undefined> => {
    if (!role) return undefined;
    const result = await createPledge(role, eventId, qty, amount, paymentMethod);
    if (result.event) replaceEvent(result.event);
    setProfileTickets(result.profile.tickets);
    setProfileCounts(result.profile.counts);
    refreshWallet(); // wallet pledge debits the balance
    return result.reference;
  };

  const giveAway = async (bookingId: string, quantity: number) => {
    if (!role) return;
    const result = await giveAwayTickets(role, bookingId, quantity);
    if (result.event) replaceEvent(result.event);
    setProfileTickets(result.profile.tickets);
    setProfileCounts(result.profile.counts);
  };

  const removeBooking = async (bookingId: string) => {
    if (!role) return;
    const result = await deleteBooking(role, bookingId);
    if (result.event) replaceEvent(result.event);
    setProfileTickets(result.profile.tickets);
    setProfileCounts(result.profile.counts);
  };

  // Active and buyer-cancelled purchases remain visible in All Events, but cannot be purchased again.
  const purchasedEventIds = useMemo(
    () => new Set(profileTickets.filter((ticket) => ticket.tab === 'upcoming' || ticket.tab === 'cancelled').map((ticket) => ticket.eventId)),
    [profileTickets],
  );

  const activeRoute = routeFromPath(location.pathname, (location.state ?? null) as RouteState | null);
  const isAuthPage = isAuthPath(location.pathname);
  const isOrganiserConsole = location.pathname.startsWith('/hosted-events');

  const go = (nextRoute: Route) => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    const target = pathForRoute(nextRoute);
    navigate(role || isAuthPath(target) || isPublicPath(target) ? target : '/login', {
      state: stateForRoute(nextRoute),
    });
  };

  const handleLogin = (account: AuthUser) => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    setRole(account.role);
    setUser(account);
    navigate('/events', { replace: true });
  };

  const handleLogout = async () => {
    await logoutRequest();
    setRole(null);
    setUser(null);
    setEvents([]);
    setProfileTickets([]);
    localStorage.removeItem('party_fun_user_id');
    navigate('/login', { replace: true });
  };

  // Deletes the account (throws if the user still hosts events) then signs out.
  const handleDeleteAccount = async () => {
    await deleteAccountRequest();
    setRole(null);
    setUser(null);
    setEvents([]);
    setProfileTickets([]);
    navigate('/login', { replace: true });
  };

  if (!sessionLoaded) return null;
  if (!role && !isAuthPage && !isPublicPath(location.pathname)) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className={`${theme === 'dark' ? 'dark' : ''} min-h-screen pb-16 md:pb-0`} style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      {!isAuthPage && (
        <Navbar
          role={role}
          user={user}
          route={activeRoute}
          go={go}
          walletBalance={walletBalance}
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
        <BrowserRoute path="/" element={<Navigate to="/events" replace />} />
        <BrowserRoute path="/login" element={<Login go={go} onLogin={handleLogin} />} />
        <BrowserRoute path="/forgot-password" element={<ForgotPassword go={go} />} />
        <BrowserRoute path="/forgot-password/verify" element={<VerifyCodeRoute go={go} />} />
        <BrowserRoute path="/forgot-password/confirm" element={<ResetConfirmRoute go={go} />} />
        <BrowserRoute path="/forgot-password/reset" element={<ResetPasswordRoute go={go} />} />
        <BrowserRoute path="/signup" element={<ChooseAccount go={go} />} />
        <BrowserRoute path="/auth/callback" element={<AuthCallback go={go} onLogin={handleLogin} />} />
        <BrowserRoute path="/signup/finish" element={<FinishSignup go={go} onLogin={handleLogin} />} />
        <BrowserRoute path="/signup/user" element={<RegisterUser go={go} />} />
        <BrowserRoute path="/signup/organiser" element={<RegisterOrganiser go={go} />} />
        <BrowserRoute path="/events" element={<Landing go={go} purchasedEventIds={purchasedEventIds} events={events} loading={loadingData} error={dataError} />} />
        <BrowserRoute path="/events/:eventId" element={<EventDetailRoute role={role} go={go} events={events} purchasedEventIds={purchasedEventIds} onGiveAway={giveAway} />} />
        <BrowserRoute path="/events/:eventId/attendees" element={<AttendeesRoute role={role} go={go} events={events} />} />
        <BrowserRoute path="/checkout/:eventId" element={<CheckoutRoute role={role} go={go} events={events} onPledge={pledge} />} />
        <BrowserRoute path="/confirmation/:eventId" element={<ConfirmationRoute role={role} go={go} events={events} />} />
        <BrowserRoute path="/profile" element={<Profile go={go} user={user} onLogout={handleLogout} />} />
        <BrowserRoute path="/joined-events" element={<JoinedEvents go={go} events={events} tickets={profileTickets} counts={profileCounts} onDelete={removeBooking} />} />
        <BrowserRoute path="/settings" element={<Settings user={user} go={go} onChangeUsername={updateUsername} onChangeAvatar={updateAvatar} onChangeContact={updateContact} onDeleteAccount={handleDeleteAccount} theme={theme} onToggleTheme={toggleTheme} />} />
        <BrowserRoute path="/wallet" element={role ? <WalletPage go={go} onBalance={setWalletBalance} /> : <Navigate to="/login" replace />} />
        <BrowserRoute path="/hosted-events" element={<OrganiserHostedEvents route={activeRoute} go={go} events={events} onCancel={cancelEvent} onHide={hideEvent} drafts={drafts} onDeleteDraft={deleteDraft} />} />
        <BrowserRoute path="/hosted-events/events/new" element={<CreateEvent route={activeRoute} go={go} events={events} onPublish={addEvent} onSaveDraft={addDraft} />} />
        <BrowserRoute path="/hosted-events/drafts/:draftId/edit" element={<ResumeDraftRoute activeRoute={activeRoute} go={go} events={events} drafts={drafts} onPublish={addEvent} onSaveDraft={addDraft} onDeleteDraft={deleteDraft} />} />
        <BrowserRoute path="/hosted-events/events/:eventId/edit" element={<EditEventRoute activeRoute={activeRoute} go={go} events={events} onCancel={cancelEvent} onUpdate={updateEvent} />} />
        <BrowserRoute path="*" element={<Navigate to="/events" replace />} />
      </Routes>

      {!isAuthPage && !isOrganiserConsole && role && (
        <MobileNav role={role} route={activeRoute} go={go} />
      )}
    </div>
  );
}

function EventDetailRoute({
  role,
  go,
  events,
  purchasedEventIds,
  onGiveAway,
}: {
  role: Role | null;
  go: (r: Route) => void;
  events: EventItem[];
  purchasedEventIds: Set<string>;
  onGiveAway: (bookingId: string, quantity: number) => Promise<void>;
}) {
  const { eventId = '' } = useParams();
  const location = useLocation();
  const state = (location.state ?? {}) as RouteState;

  return (
    <EventDetail
      id={eventId}
      role={role}
      go={go}
      events={events}
      purchasedEventIds={purchasedEventIds}
      qty={state.qty}
      bookingId={state.bookingId}
      onGiveAway={onGiveAway}
      fromProfile={state.fromProfile}
      fromOrganiser={state.fromOrganiser}
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
  onPledge: (eventId: string, qty: number, amount: number, paymentMethod?: 'wallet' | 'card') => Promise<string | undefined>;
}) {
  const { eventId = '' } = useParams();
  const location = useLocation();
  const state = (location.state ?? {}) as RouteState;

  if (!role) return <Navigate to="/login" replace />;

  return <Checkout id={eventId} role={role} go={go} events={events} qty={state.qty} onPledge={onPledge} />;
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

  return <Confirmation id={eventId} qty={state.qty ?? 1} lines={state.lines} reference={state.reference} role={role} go={go} events={events} />;
}

function VerifyCodeRoute({ go }: { go: (r: Route) => void }) {
  const location = useLocation();
  const email = (location.state as RouteState | null)?.email;
  // Direct hits / refreshes lose the email in router state — send back to step 1.
  if (!email) return <Navigate to="/forgot-password" replace />;
  return <VerifyCode go={go} email={email} />;
}

function ResetConfirmRoute({ go }: { go: (r: Route) => void }) {
  const location = useLocation();
  const { email, code } = (location.state as RouteState | null) ?? {};
  if (!email || !code) return <Navigate to="/forgot-password" replace />;
  return <ResetConfirm go={go} email={email} code={code} />;
}

function ResetPasswordRoute({ go }: { go: (r: Route) => void }) {
  const location = useLocation();
  const { email, code } = (location.state as RouteState | null) ?? {};
  if (!email || !code) return <Navigate to="/forgot-password" replace />;
  return <ResetPassword go={go} email={email} code={code} />;
}

function AttendeesRoute({
  role,
  go,
  events,
}: {
  role: Role | null;
  go: (r: Route) => void;
  events: EventItem[];
}) {
  const { eventId = '' } = useParams();
  if (!role) return <Navigate to="/login" replace />;
  return <Attendees id={eventId} go={go} events={events} />;
}

function EditEventRoute({
  activeRoute,
  go,
  events,
  onCancel,
  onUpdate,
}: {
  activeRoute: Route;
  go: (r: Route) => void;
  events: EventItem[];
  onCancel: (id: string, reason: string) => void;
  onUpdate: (e: EventItem) => void;
}) {
  const { eventId = '' } = useParams();
  return <CreateEvent route={activeRoute} go={go} editId={eventId} events={events} onCancel={onCancel} onUpdate={onUpdate} />;
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
