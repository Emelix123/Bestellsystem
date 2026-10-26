import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Loading, ToastProvider, useToast } from './components/ui';
import { outbox } from './lib/outbox';
import { can, SessionProvider, useSession } from './lib/session';
import { orderPlace } from './lib/format';
import type { Role } from '@bestellsystem/shared';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { PickupMonitor } from './pages/pickup/PickupMonitor';
import { Setup } from './pages/Setup';
import { StationApp } from './pages/station/StationApp';
import { TogoApp } from './pages/togo/TogoApp';
import { WaiterApp } from './pages/waiter/WaiterApp';

// Admin inkl. Diagrammen erst bei Bedarf laden – hält die App für Bedienungen schlank.
const AdminApp = lazy(() => import('./pages/admin/AdminApp').then((m) => ({ default: m.AdminApp })));

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { me, loading, offline } = useSession();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!me && offline) {
    return (
      <div className="p-8 text-center text-slate-600">
        Server nicht erreichbar. Bitte WLAN prüfen – die Seite versucht es automatisch weiter.
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles.length > 0 && !can(me, ...roles)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Meldet nachgesendete Bestellungen aus der Offline-Warteschlange. */
function OutboxNotifier() {
  const toast = useToast();
  useEffect(() => {
    outbox.onDelivered = (order) => toast({ tone: 'success', text: `Nachgesendet: ${orderPlace(order)}` });
    void outbox.flush();
    return () => {
      outbox.onDelivered = null;
    };
  }, [toast]);
  return null;
}

function SessionRefreshOnFocus() {
  const { refresh, me } = useSession();
  const navigate = useNavigate();
  useEffect(() => {
    const onExpired = () => navigate('/login');
    window.addEventListener('session-expired', onExpired);
    return () => window.removeEventListener('session-expired', onExpired);
  }, [navigate]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && me) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh, me]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <OutboxNotifier />
          <SessionRefreshOnFocus />
          <Routes>
            <Route path="/setup" element={<Setup />} />
            <Route path="/login" element={<Login />} />
            <Route path="/abholung/:slug" element={<PickupMonitor />} />
            <Route
              path="/"
              element={
                <RequireRole roles={[]}>
                  <Home />
                </RequireRole>
              }
            />
            <Route
              path="/bedienung/*"
              element={
                <RequireRole roles={['waiter']}>
                  <WaiterApp />
                </RequireRole>
              }
            />
            <Route
              path="/togo/*"
              element={
                <RequireRole roles={['togo']}>
                  <TogoApp />
                </RequireRole>
              }
            />
            <Route
              path="/station/*"
              element={
                <RequireRole roles={['station']}>
                  <StationApp />
                </RequireRole>
              }
            />
            <Route
              path="/admin/*"
              element={
                <RequireRole roles={['admin']}>
                  <Suspense fallback={<Loading />}>
                    <AdminApp />
                  </Suspense>
                </RequireRole>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
