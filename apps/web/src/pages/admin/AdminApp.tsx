import type { EventSummary } from '@bestellsystem/shared';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import { TopBar } from '../../components/TopBar';
import { Select } from '../../components/ui';
import { cn } from '../../lib/format';
import { useLive } from '../../lib/live';
import { useSession } from '../../lib/session';
import { storage } from '../../lib/storage';
import { useApiData } from '../../lib/useApi';
import { AuditPage } from './AuditPage';
import { EventsPage } from './EventsPage';
import { OptionsPage } from './OptionsPage';
import { OverviewPage } from './OverviewPage';
import { PrintersPage } from './PrintersPage';
import { PrintJobsPage } from './PrintJobsPage';
import { ProductsPage } from './ProductsPage';
import { SettingsPage } from './SettingsPage';
import { StationsPage } from './StationsPage';
import { StatsPage } from './StatsPage';
import { TablesPage } from './TablesPage';
import { TenantsPage } from './TenantsPage';
import { UsersPage } from './UsersPage';

interface AdminEventContext {
  events: EventSummary[];
  eventId: number | null;
  event: EventSummary | null;
  setEventId(id: number): void;
  reloadEvents(): Promise<void>;
  /** Query-Parameter für veranstaltungsbezogene API-Aufrufe. */
  q: string;
}

const EventContext = createContext<AdminEventContext | null>(null);

export function useAdminEvent() {
  const ctx = useContext(EventContext);
  if (!ctx) throw new Error('AdminApp fehlt');
  return ctx;
}

const NAV: { to: string; label: string; superadmin?: boolean }[] = [
  { to: '/admin', label: 'Übersicht' },
  { to: '/admin/veranstaltungen', label: 'Veranstaltungen' },
  { to: '/admin/tische', label: 'Gänge & Tische' },
  { to: '/admin/produkte', label: 'Produkte' },
  { to: '/admin/optionen', label: 'Optionen' },
  { to: '/admin/stationen', label: 'Stationen' },
  { to: '/admin/drucker', label: 'Drucker' },
  { to: '/admin/druckauftraege', label: 'Druckaufträge' },
  { to: '/admin/benutzer', label: 'Benutzer' },
  { to: '/admin/einstellungen', label: 'Einstellungen' },
  { to: '/admin/statistik', label: 'Statistik' },
  { to: '/admin/protokoll', label: 'Protokoll' },
  { to: '/admin/vereine', label: 'Vereine', superadmin: true },
];

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function AdminApp() {
  const { me } = useSession();
  const { data: events, reload } = useApiData<EventSummary[]>('/api/admin/events');
  const [eventId, setEventIdState] = useState<number | null>(() => storage.get<number | null>('admin-event', null));
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!events) return;
    if (!events.some((e) => e.id === eventId)) {
      const active = events.find((e) => e.active) ?? events[0];
      setEventIdState(active?.id ?? null);
    }
  }, [events, eventId]);

  useLive((msg) => {
    if (msg.type === 'catalog') void reload();
  });

  const setEventId = (id: number) => {
    storage.set('admin-event', id);
    setEventIdState(id);
  };
  const event = events?.find((e) => e.id === eventId) ?? null;
  const ctx: AdminEventContext = {
    events: events ?? [],
    eventId,
    event,
    setEventId,
    reloadEvents: reload,
    q: eventId ? `eventId=${eventId}` : '',
  };

  const nav = (
    <nav className="space-y-1 p-3">
      {NAV.filter((n) => !n.superadmin || me?.user.isSuperadmin).map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/admin'}
          onClick={() => setMenuOpen(false)}
          className={({ isActive }) =>
            cn(
              'block rounded-xl px-3 py-2 text-sm font-medium',
              isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-200',
            )
          }
        >
          {n.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <EventContext.Provider value={ctx}>
      <div className="flex min-h-full flex-col">
        <TopBar
          title="Admin"
          subtitle={me?.tenant?.name}
          right={
            <button
              type="button"
              className="rounded-xl px-3 py-2 text-sm font-semibold hover:bg-white/10 lg:hidden"
              onClick={() => setMenuOpen((o) => !o)}
            >
              Menü
            </button>
          }
        />
        <div className="flex flex-1">
          <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white lg:block">
            <EventPicker />
            {nav}
          </aside>
          {menuOpen && (
            <div className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" onClick={() => setMenuOpen(false)}>
              <aside className="h-full w-64 overflow-y-auto bg-white pt-14" onClick={(e) => e.stopPropagation()}>
                <EventPicker />
                {nav}
              </aside>
            </div>
          )}
          <main className="min-w-0 flex-1 p-4 lg:p-6">
            <Routes>
              <Route index element={<OverviewPage />} />
              <Route path="veranstaltungen" element={<EventsPage />} />
              <Route path="tische" element={<TablesPage />} />
              <Route path="produkte" element={<ProductsPage />} />
              <Route path="optionen" element={<OptionsPage />} />
              <Route path="stationen" element={<StationsPage />} />
              <Route path="drucker" element={<PrintersPage />} />
              <Route path="druckauftraege" element={<PrintJobsPage />} />
              <Route path="benutzer" element={<UsersPage />} />
              <Route path="einstellungen" element={<SettingsPage />} />
              <Route path="statistik" element={<StatsPage />} />
              <Route path="protokoll" element={<AuditPage />} />
              <Route path="vereine" element={<TenantsPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </EventContext.Provider>
  );
}

function EventPicker() {
  const { events, eventId, setEventId } = useAdminEvent();
  if (events.length === 0) return null;
  return (
    <div className="border-b border-slate-200 p-3">
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Bearbeite Veranstaltung</label>
      <Select value={eventId ?? ''} onChange={(e) => setEventId(Number(e.target.value))} className="text-sm">
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
            {e.active ? ' (aktiv)' : ''}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function NeedEvent({ children }: { children: ReactNode }) {
  const { eventId } = useAdminEvent();
  if (!eventId) {
    return (
      <div className="rounded-2xl bg-amber-50 p-4 text-amber-900 ring-1 ring-amber-200">
        Bitte zuerst unter „Veranstaltungen“ eine Veranstaltung anlegen.
      </div>
    );
  }
  return <>{children}</>;
}
