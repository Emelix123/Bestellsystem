import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { TopBar } from '../components/TopBar';
import { ErrorBox } from '../components/ui';
import { can, useSession } from '../lib/session';

interface Tile {
  to: string;
  title: string;
  text: string;
  color: string;
  external?: boolean;
}

export function Home() {
  const { me } = useSession();
  const navigate = useNavigate();

  const tiles: Tile[] = [];
  if (me) {
    const isAdmin = can(me, 'admin');
    const roles = me.user.roles;
    if (isAdmin || roles.includes('waiter'))
      tiles.push({ to: '/bedienung', title: 'Bedienung', text: 'Gang und Tisch wählen, Bestellung aufnehmen', color: 'bg-sky-600' });
    if ((isAdmin || roles.includes('togo')) && me.tenant?.settings.togo)
      tiles.push({ to: '/togo', title: 'To-Go', text: 'Bestellung zum Mitnehmen mit Abholnummer', color: 'bg-orange-600' });
    if (isAdmin || roles.includes('station'))
      tiles.push({ to: '/station', title: 'Station / Küche', text: 'Warteschlange am Tablet, fertig melden', color: 'bg-emerald-600' });
    if (me.tenant?.settings.togo)
      tiles.push({
        to: `/abholung/${me.tenant.slug}`,
        title: 'Abholmonitor',
        text: 'Für Fernseher/Bildschirm an der Ausgabe',
        color: 'bg-violet-600',
      });
    if (isAdmin) tiles.push({ to: '/admin', title: 'Admin', text: 'Produkte, Tische, Drucker, Statistik', color: 'bg-slate-800' });
  }

  // Wer nur eine Aufgabe hat, landet direkt dort.
  const workTiles = tiles.filter((t) => !t.to.startsWith('/abholung'));
  useEffect(() => {
    if (workTiles.length === 1) navigate(workTiles[0].to, { replace: true });
  }, [workTiles.length, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-full">
      <TopBar title={me?.tenant?.name ?? 'Bestellsystem'} subtitle={me?.activeEvent?.name ?? 'Keine Veranstaltung aktiv'} />
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        {!me?.activeEvent && can(me, 'admin') && (
          <ErrorBox>
            Es ist keine Veranstaltung aktiv. Im Admin-Bereich unter „Veranstaltungen“ eine anlegen und aktivieren.
          </ErrorBox>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {tiles.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className={`${t.color} block rounded-3xl p-6 text-white shadow-md transition active:scale-[0.98]`}
            >
              <div className="text-2xl font-bold">{t.title}</div>
              <div className="mt-1 text-sm text-white/80">{t.text}</div>
            </Link>
          ))}
        </div>
        {tiles.length === 0 && <p className="text-slate-600">Für dieses Konto sind keine Bereiche freigeschaltet.</p>}
      </main>
    </div>
  );
}
