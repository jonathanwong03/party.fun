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
import { AiAssistant } from './components/AiAssistant';
import { type EventItem, type Role, type Route } from './components/types';
import { giveAwayTickets, deleteBooking, createPledge, fetchEvents, fetchProfile, logoutRequest, createEventRequest, updateEventRequest, deleteEventRequest, cancelEventRequest, hideEventRequest, adminCancelEvent, deleteAccountRequest, fetchDrafts, saveDraftRequest, deleteDraftRequest, fetchWallet, inviteCoOrganiserRequest, type AuthUser, type ProfileTicket, type ProfileCounts } from './api';

const EMPTY_COUNTS: ProfileCounts = { upcoming: 0, past: 0, cancelled: 0 };
import { supabase } from './supabase';
import { installIdleTimeout, resetActivity } from './idle';
import { Landing } from './pages/Landing';
import { FAQ } from './pages/FAQ';
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
import { Analytics } from './pages/Analytics';
import { AllAttendees } from './pages/AllAttendees';
import { CheckIn } from './pages/CheckIn';
import { AdminManageEvents } from './pages/AdminManageEvents';
import { PendingInvites } from './pages/PendingInvites';

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
  channel?: 'email' | 'sms';
};

function pathForRoute(route: Route) {
  switch (route.name) {
    case 'landing':
      return '/events';
    case 'faq':
      return '/faq';
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
    case 'analytics':
      return '/analytics';
    case 'attendees-all':
      return '/attendees';
    case 'tickets':
      return '/tickets';
    case 'pending-invites':
      return '/pending-invites';
    case 'manage-events':
      return '/manage-events';
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
    return { email: route.email, channel: route.channel };
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
  return pathname === '/events' || pathname === '/faq' || /^\/events\/[^/]+$/.test(pathname);
}

function routeFromPath(pathname: string, state: RouteState | null): Route {
  if (pathname === '/' || pathname === '/login') return { name: 'login' };
  if (pathname === '/forgot-password') return { name: 'forgot-password' };
  if (pathname === '/forgot-password/verify') return { name: 'verify-code', email: state?.email ?? '', channel: state?.channel };
  if (pathname === '/forgot-password/confirm') return { name: 'reset-confirm', email: state?.email ?? '', code: state?.code ?? '' };
  if (pathname === '/forgot-password/reset') return { name: 'reset-password', email: state?.email ?? '', code: state?.code ?? '' };
  if (pathname === '/signup') return { name: 'choose-account' };
  if (pathname === '/auth/callback') return { name: 'auth-callback' };
  if (pathname === '/signup/finish') return { name: 'finish-signup' };
  if (pathname === '/signup/user') return { name: 'register-user' };
  if (pathname === '/signup/organiser') return { name: 'register-organiser' };
  if (pathname === '/events') return { name: 'landing' };
  if (pathname === '/faq') return { name: 'faq' };
  if (pathname === '/profile') return { name: 'profile' };
  if (pathname === '/joined-events') return { name: 'joined-events' };
  if (pathname === '/analytics') return { name: 'analytics' };
  if (pathname === '/attendees') return { name: 'attendees-all' };
  if (pathname === '/tickets') return { name: 'tickets' };
  if (pathname === '/pending-invites') return { name: 'pending-invites' };
  if (pathname === '/manage-events') return { name: 'manage-events' };
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
  const updateUniversity = (university: string | null) => setUser((u) => (u ? { ...u, university, universityChanged: true } : u));
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

  // Admin moderation cancel (mandatory reason); refetch so the list reflects the change.
  const adminCancel = async (id: string, reason: string) => {
    await adminCancelEvent(id, reason);
    setEvents(await fetchEvents(role));
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

  const refreshEvents = async () => {
    setEvents(await fetchEvents(role));
  };

  const inviteCoOrganiser = async (eventId: string, identifier: string) => {
    await inviteCoOrganiserRequest(eventId, identifier);
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
  const refreshDrafts = async () => { try { setDrafts(await fetchDrafts()); } catch { /* keep current */ } };
  // After an AI write, refresh events, drafts and wallet so edits/new drafts/top-ups/pledges/refunds show instantly.
  const onAiDataChanged = () => { refreshEvents(); refreshDrafts(); refreshWallet(); };

  const replaceEvent = (updated: EventItem) => {
    setEvents((prev) => prev.map((event) => (event.id === updated.id ? updated : event)));
  };

  // Restore session on page load and keep role/user in sync with Supabase Auth.
  useEffect(() => {
    installIdleTimeout(); // 3-hour inactivity auto sign-out
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const { data: profile } = await supabase
          .from('USER')
          .select('id, username, email, role, avatarUrl, socialLink, contact, onboarded, university, memberType, orgId, universityChanged')
          .eq('id', session.user.id)
          .single();
        if (profile && profile.onboarded) {
          setRole(profile.role as Role);
          setUser({ id: profile.id, username: profile.username, email: profile.email, role: profile.role as Role, avatarUrl: profile.avatarUrl, telegram: profile.socialLink, phone: profile.contact, university: profile.university, memberType: profile.memberType, orgId: profile.orgId, universityChanged: profile.universityChanged });
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
        if (role && role !== 'admin') refreshWallet(); else setWalletBalance(null);
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

  const pledge = async (eventId: string, qty: number, amount: number, paymentMethod: 'wallet' | 'card' = 'wallet', attemptId?: string): Promise<string | undefined> => {
    if (!role) return undefined;
    const result = await createPledge(role, eventId, qty, amount, paymentMethod, attemptId);
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
  const isOrganiserConsole = location.pathname.startsWith('/hosted-events') || location.pathname === '/pending-invites';

  const go = (nextRoute: Route) => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    const target = pathForRoute(nextRoute);
    navigate(role || isAuthPath(target) || isPublicPath(target) ? target : '/login', {
      state: stateForRoute(nextRoute),
    });
  };

  const handleLogin = (account: AuthUser) => {
    resetActivity(); // start the 3-hour idle clock fresh on every login
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
        <BrowserRoute path="/faq" element={<FAQ go={go} />} />
        <BrowserRoute path="/events/:eventId" element={<EventDetailRoute role={role} go={go} events={events} purchasedEventIds={purchasedEventIds} onGiveAway={giveAway} />} />
        <BrowserRoute path="/events/:eventId/attendees" element={<AttendeesRoute role={role} go={go} events={events} />} />
        <BrowserRoute path="/checkout/:eventId" element={<CheckoutRoute role={role} go={go} events={events} onPledge={pledge} />} />
        <BrowserRoute path="/confirmation/:eventId" element={<ConfirmationRoute role={role} go={go} events={events} />} />
        <BrowserRoute path="/profile" element={<Profile go={go} user={user} onLogout={handleLogout} />} />
        <BrowserRoute path="/joined-events" element={role === 'admin' ? <Navigate to="/events" replace /> : <JoinedEvents go={go} events={events} tickets={profileTickets} counts={profileCounts} onDelete={removeBooking} />} />
        <BrowserRoute path="/analytics" element={role ? <Analytics role={role} go={go} events={events} /> : <Navigate to="/login" replace />} />
        <BrowserRoute path="/attendees" element={role === 'organiser' ? <AllAttendees /> : <Navigate to="/events" replace />} />
        <BrowserRoute path="/tickets" element={role === 'organiser' || role === 'admin' ? <CheckIn role={role} events={events} /> : <Navigate to="/events" replace />} />
        <BrowserRoute path="/pending-invites" element={role === 'organiser' ? <PendingInvites go={go} onChanged={refreshEvents} /> : <Navigate to="/events" replace />} />
        <BrowserRoute path="/manage-events" element={role === 'admin' ? <AdminManageEvents go={go} events={events} onCancel={adminCancel} /> : <Navigate to="/events" replace />} />
        <BrowserRoute path="/settings" element={<Settings user={user} go={go} onChangeUsername={updateUsername} onChangeAvatar={updateAvatar} onChangeContact={updateContact} onChangeUniversity={updateUniversity} onDeleteAccount={handleDeleteAccount} theme={theme} onToggleTheme={toggleTheme} />} />
        <BrowserRoute path="/wallet" element={role && role !== 'admin' ? <WalletPage go={go} onBalance={setWalletBalance} /> : <Navigate to="/events" replace />} />
        <BrowserRoute path="/hosted-events" element={role === 'organiser' ? <OrganiserHostedEvents route={activeRoute} go={go} events={events} onCancel={cancelEvent} onHide={hideEvent} drafts={drafts} onDeleteDraft={deleteDraft} /> : <Navigate to="/events" replace />} />
        <BrowserRoute path="/hosted-events/events/new" element={<CreateEvent route={activeRoute} go={go} events={events} hostUniversity={user?.university} organiserName={user?.username} onPublish={addEvent} onSaveDraft={addDraft} />} />
        <BrowserRoute path="/hosted-events/drafts/:draftId/edit" element={<ResumeDraftRoute activeRoute={activeRoute} go={go} events={events} hostUniversity={user?.university} organiserName={user?.username} drafts={drafts} onPublish={addEvent} onSaveDraft={addDraft} onDeleteDraft={deleteDraft} />} />
        <BrowserRoute path="/hosted-events/events/:eventId/edit" element={<EditEventRoute activeRoute={activeRoute} go={go} events={events} hostUniversity={user?.university} organiserName={user?.username} onCancel={cancelEvent} onUpdate={updateEvent} onInvite={inviteCoOrganiser} />} />
        <BrowserRoute path="*" element={<Navigate to="/events" replace />} />
      </Routes>

      {!isAuthPage && !isOrganiserConsole && role && (
        <MobileNav role={role} route={activeRoute} go={go} />
      )}
      {!isAuthPage && role && <AiAssistant onDataChanged={onAiDataChanged} />}
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
  if (role === 'admin') return <Navigate to="/events" replace />;

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
  const st = location.state as RouteState | null;
  const email = st?.email;
  // Direct hits / refreshes lose the email in router state — send back to step 1.
  if (!email) return <Navigate to="/forgot-password" replace />;
  return <VerifyCode go={go} email={email} channel={st?.channel} />;
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
  hostUniversity,
  organiserName,
  onCancel,
  onUpdate,
  onInvite,
}: {
  activeRoute: Route;
  go: (r: Route) => void;
  events: EventItem[];
  hostUniversity?: string | null;
  organiserName?: string | null;
  onCancel: (id: string, reason: string) => void;
  onUpdate: (e: EventItem) => void;
  onInvite: (eventId: string, identifier: string) => Promise<void>;
}) {
  const { eventId = '' } = useParams();
  // Remount the form when the underlying event data changes (e.g. after an AI edit
  // refreshes `events`), so its once-at-mount field state re-seeds — no manual refresh.
  const ev = events.find((e) => e.id === eventId);
  const editKey = ev
    ? [ev.id, ev.title, ev.description, ev.location, ev.address, ev.startsAt, ev.endsAt, ev.deadlineAt, ev.maxCapacity, ev.hypeThreshold, ev.hypeDrivenPricing, ev.maxPrice, (ev.statuses || []).map((s) => `${s.price}/${s.qty}`).join(',')].join('|')
    : eventId;
  return <CreateEvent key={editKey} route={activeRoute} go={go} editId={eventId} events={events} hostUniversity={hostUniversity} organiserName={organiserName} onCancel={onCancel} onUpdate={onUpdate} onInvite={onInvite} />;
}

function ResumeDraftRoute({
  activeRoute,
  go,
  events,
  hostUniversity,
  organiserName,
  drafts,
  onPublish,
  onSaveDraft,
  onDeleteDraft,
}: {
  activeRoute: Route;
  go: (r: Route) => void;
  events: EventItem[];
  hostUniversity?: string | null;
  organiserName?: string | null;
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
      hostUniversity={hostUniversity}
      organiserName={organiserName}
      draftId={draftId}
      drafts={drafts}
      onPublish={onPublish}
      onSaveDraft={onSaveDraft}
      onDeleteDraft={onDeleteDraft}
    />
  );
}
