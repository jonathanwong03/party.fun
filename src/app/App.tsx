import { useState } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import type { Role, Route } from './components/types';
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

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'landing' });
  const [role, setRole] = useState<Role>('guest');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [addedTickets, setAddedTickets] = useState<{ eventId: string; qty: number; amount: number }[]>([]);
  const addTicket = (t: { eventId: string; qty: number; amount: number }) =>
    setAddedTickets((prev) => [t, ...prev.filter((p) => p.eventId !== t.eventId)]);

  const go = (r: Route) => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    setRoute(r);
  };

  const isAuthPage =
    route.name === 'login' ||
    route.name === 'choose-account' ||
    route.name === 'register-user' ||
    route.name === 'register-admin';

  const isAdminConsole = route.name === 'admin' || route.name === 'create-event' || route.name === 'edit-event';

  return (
    <div className="dark min-h-screen pb-16 md:pb-0" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      {!isAuthPage && (
        <Navbar
          role={role}
          route={route}
          go={go}
          onLogout={() => setRole('guest')}
          onMenuClick={() => setSidebarOpen(true)}
        />
      )}
      {!isAuthPage && (
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          role={role}
          route={route}
          go={go}
        />
      )}

      {route.name === 'landing' && <Landing go={go} />}
      {route.name === 'event' && <EventDetail id={route.id} role={role} go={go} fromProfile={route.fromProfile} fromAdmin={route.fromAdmin} />}
      {route.name === 'checkout' && <Checkout id={route.id} role={role} go={go} />}
      {route.name === 'confirmation' && (
        <Confirmation id={route.id} qty={route.qty} role={role} go={go} onAdd={addTicket} />
      )}
      {route.name === 'login' && <Login go={go} onLogin={setRole} />}
      {route.name === 'choose-account' && <ChooseAccount go={go} />}
      {route.name === 'register-user' && <RegisterUser go={go} onLogin={setRole} />}
      {route.name === 'register-admin' && <RegisterAdmin go={go} onLogin={setRole} />}
      {route.name === 'profile' && <Profile go={go} added={addedTickets} />}
      {route.name === 'admin' && <AdminDashboard route={route} go={go} />}
      {route.name === 'create-event' && <CreateEvent route={route} go={go} />}
      {route.name === 'edit-event' && <CreateEvent route={route} go={go} editId={route.id} />}

      {!isAuthPage && !isAdminConsole && (
        <MobileNav role={role} route={route} go={go} />
      )}
    </div>
  );
}
