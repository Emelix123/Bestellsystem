import type { StationDto, TicketDto } from '@bestellsystem/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TopBar } from '../../components/TopBar';
import { Badge, Button, Empty, ErrorBox, Loading, Modal, Toggle, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useCatalog } from '../../lib/catalog';
import { cn, minutesSince, orderPlace, timeOf } from '../../lib/format';
import { useLive } from '../../lib/live';
import { storage } from '../../lib/storage';

const SELECTED_KEY = 'station-ids';
const SOUND_KEY = 'station-sound';

/** Kurzer Doppel-Piep bei neuer Bestellung (Browser erlauben Ton erst nach einem Tipp). */
class Beeper {
  private ctx: AudioContext | null = null;
  enable() {
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }
  beep() {
    const ctx = this.ctx;
    if (!ctx) return;
    const at = ctx.currentTime;
    for (const [offset, freq] of [
      [0, 880],
      [0.18, 1175],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at + offset);
      gain.gain.exponentialRampToValueAtTime(0.4, at + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + offset + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at + offset);
      osc.stop(at + offset + 0.16);
    }
  }
}

function useWakeLock() {
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const request = async () => {
      try {
        lock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<typeof lock> } }).wakeLock?.request('screen') ?? null;
      } catch {
        lock = null;
      }
    };
    void request();
    const onVisible = () => document.visibilityState === 'visible' && void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, []);
}

function StationPicker({ stations, initial, onSave }: { stations: StationDto[]; initial: number[]; onSave(ids: number[]): void }) {
  const [ids, setIds] = useState(initial.filter((id) => stations.some((s) => s.id === id)));
  return (
    <div className="min-h-full">
      <TopBar title="Station wählen" back="/" />
      <main className="mx-auto max-w-lg space-y-4 p-4">
        <p className="text-sm text-slate-600">
          Welche Stationen sollen auf diesem Tablet angezeigt werden? Mehrfachauswahl ist möglich (z. B. Getränke und Bier).
        </p>
        <div className="space-y-2">
          {stations.map((s) => (
            <label key={s.id} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <input
                type="checkbox"
                className="h-6 w-6 accent-slate-900"
                checked={ids.includes(s.id)}
                onChange={() => setIds((x) => (x.includes(s.id) ? x.filter((i) => i !== s.id) : [...x, s.id]))}
              />
              <span className="flex-1 text-lg font-semibold">{s.name}</span>
              {!s.showOnDisplay && <Badge tone="amber">nicht für Tablet eingestellt</Badge>}
            </label>
          ))}
        </div>
        {stations.length === 0 && <Empty>Keine Stationen angelegt.</Empty>}
        <Button size="xl" block disabled={ids.length === 0} onClick={() => onSave(ids)}>
          Anzeigen
        </Button>
      </main>
    </div>
  );
}

function ageClass(minutes: number) {
  if (minutes >= 10) return 'bg-red-600 text-white';
  if (minutes >= 5) return 'bg-amber-400 text-slate-950';
  return 'bg-emerald-600 text-white';
}

function TicketCard({
  ticket,
  now,
  showStation,
  canAccept,
  onAction,
}: {
  ticket: TicketDto;
  now: number;
  showStation: boolean;
  canAccept: boolean;
  onAction(ticket: TicketDto, action: 'accept' | 'done'): void;
}) {
  const minutes = minutesSince(ticket.createdAt, now);
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-lg">
      <div className={cn('flex items-center justify-between gap-2 px-4 py-2', ageClass(minutes))}>
        <div className="min-w-0">
          <div className="truncate text-xl font-black">
            {ticket.kind === 'togo' ? `TO-GO ${ticket.pickupNumber}` : `${ticket.areaName} · ${ticket.tableLabel}`}
          </div>
          <div className="text-xs font-medium opacity-90">
            {timeOf(ticket.createdAt)} · {ticket.waiterName} · #{ticket.orderNumber}
            {showStation && ` · ${ticket.stationName}`}
          </div>
        </div>
        <div className="text-right text-2xl font-black tabular-nums">{minutes}′</div>
      </div>
      <ul className="flex-1 space-y-2 px-4 py-3">
        {ticket.items.map((i) => {
          const qty = i.qty - i.cancelledQty;
          return (
            <li key={i.id} className={cn(qty === 0 && 'text-slate-400 line-through')}>
              <div className="text-xl font-bold leading-tight">
                {qty}× {i.name}
                {i.cancelledQty > 0 && qty > 0 && <span className="ml-2 text-sm text-red-600">({i.cancelledQty} storniert)</span>}
              </div>
              {i.options.length > 0 && <div className="text-base font-semibold text-slate-700">+ {i.options.join(', ')}</div>}
              {i.note && <div className="mt-0.5 inline-block rounded bg-slate-900 px-2 py-0.5 text-base font-bold text-white">! {i.note}</div>}
            </li>
          );
        })}
        {ticket.orderNote && <li className="rounded-lg bg-amber-100 px-2 py-1 font-semibold text-amber-900">Notiz: {ticket.orderNote}</li>}
      </ul>
      <div className="flex gap-2 border-t border-slate-100 p-3">
        {canAccept && ticket.status === 'open' && (
          <Button variant="secondary" size="xl" className="flex-1" onClick={() => onAction(ticket, 'accept')}>
            Annehmen
          </Button>
        )}
        {ticket.status === 'accepted' && <Badge tone="blue" className="self-center">angenommen</Badge>}
        <Button variant="success" size="xl" className="flex-[2]" onClick={() => onAction(ticket, 'done')}>
          Fertig
        </Button>
      </div>
    </div>
  );
}

function Board({ stations, selected, onChangeStations }: { stations: StationDto[]; selected: number[]; onChangeStations(): void }) {
  const toast = useToast();
  const { catalog } = useCatalog();
  const [tickets, setTickets] = useState<TicketDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(() => storage.get<boolean>(SOUND_KEY, false));
  const [showDone, setShowDone] = useState(false);
  const [showSoldOut, setShowSoldOut] = useState(false);
  const beeper = useRef(new Beeper());
  const known = useRef(new Set<number>());
  const mine = stations.filter((s) => selected.includes(s.id));
  const query = selected.join(',');
  useWakeLock();

  const load = useCallback(async () => {
    try {
      const list = await api.get<TicketDto[]>(`/api/tickets?stationIds=${query}&scope=active`);
      for (const t of list) known.current.add(t.id);
      setTickets(list);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [query]);

  useEffect(() => {
    void load();
    const reload = window.setInterval(load, 30_000);
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.clearInterval(reload);
      window.clearInterval(tick);
    };
  }, [load]);

  useEffect(() => {
    if (sound) beeper.current.enable();
  }, [sound]);

  useLive(
    (msg) => {
      if (msg.type !== 'ticket' || msg.ticket.stationId === null || !selected.includes(msg.ticket.stationId)) return;
      const t = msg.ticket;
      const active = t.status === 'open' || t.status === 'accepted';
      if (active && !known.current.has(t.id)) {
        known.current.add(t.id);
        if (sound) beeper.current.beep();
      }
      setTickets((list) => {
        if (!list) return list;
        const rest = list.filter((x) => x.id !== t.id);
        return active ? [...rest, t].sort((a, b) => a.id - b.id) : rest;
      });
    },
    () => void load(),
  );

  const act = async (ticket: TicketDto, action: 'accept' | 'done' | 'reopen' | 'reprint') => {
    if (action === 'done') setTickets((list) => list?.filter((t) => t.id !== ticket.id) ?? list);
    try {
      const updated = await api.post<TicketDto>(`/api/tickets/${ticket.id}/${action}`);
      if (action === 'accept') setTickets((list) => list?.map((t) => (t.id === updated.id ? updated : t)) ?? list);
      if (action === 'done') {
        const place = ticket.kind === 'togo' ? `To-Go ${ticket.pickupNumber}` : `${ticket.areaName} ${ticket.tableLabel}`;
        toast({ text: `${place} fertig`, tone: 'success', action: { label: 'Rückgängig', onClick: () => void act(ticket, 'reopen') }, duration: 8000 });
      }
      if (action === 'reopen') void load();
      if (action === 'reprint') toast({ text: 'Bon wird nachgedruckt', tone: 'info' });
    } catch (err) {
      toast({ text: errorMessage(err), tone: 'error' });
      void load();
    }
  };

  const summary = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tickets ?? []) {
      for (const i of t.items) {
        const qty = i.qty - i.cancelledQty;
        if (qty <= 0) continue;
        const key = i.options.length ? `${i.name} (${i.options.join(', ')})` : i.name;
        m.set(key, (m.get(key) ?? 0) + qty);
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [tickets]);

  const acceptStations = new Set(mine.filter((s) => s.printTrigger === 'on_accept').map((s) => s.id));

  return (
    <div className="flex min-h-full flex-col bg-slate-800">
      <TopBar
        title={mine.map((s) => s.name).join(' + ')}
        subtitle={`${tickets?.length ?? 0} offen`}
        right={
          <div className="flex gap-1">
            <button
              type="button"
              className={cn('rounded-xl px-3 py-2 text-sm font-semibold', sound ? 'bg-emerald-600' : 'bg-white/10')}
              onClick={() => {
                const next = !sound;
                setSound(next);
                storage.set(SOUND_KEY, next);
                if (next) {
                  beeper.current.enable();
                  beeper.current.beep();
                }
              }}
            >
              Ton {sound ? 'an' : 'aus'}
            </button>
            <button type="button" className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold" onClick={() => setShowSoldOut(true)}>
              Ausverkauft
            </button>
            <button type="button" className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold" onClick={() => setShowDone(true)}>
              Erledigt
            </button>
            <button type="button" className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold" onClick={onChangeStations}>
              Station
            </button>
          </div>
        }
      />
      {summary.length > 0 && (
        <div className="flex gap-2 overflow-x-auto bg-slate-900 px-3 py-2">
          {summary.map(([name, qty]) => (
            <span key={name} className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white">
              {qty}× {name}
            </span>
          ))}
        </div>
      )}
      <main className="flex-1 p-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        {tickets === null ? (
          <Loading />
        ) : tickets.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-xl font-semibold text-slate-400">Alles erledigt 👍</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {tickets.map((t) => (
              <TicketCard
                key={t.id}
                ticket={t}
                now={now}
                showStation={mine.length > 1}
                canAccept={t.stationId !== null && acceptStations.has(t.stationId)}
                onAction={act}
              />
            ))}
          </div>
        )}
      </main>
      {showDone && <DoneList query={query} onClose={() => setShowDone(false)} onAction={act} />}
      {showSoldOut && catalog && (
        <Modal open onClose={() => setShowSoldOut(false)} title="Ausverkauft">
          <p className="mb-3 text-sm text-slate-600">Ausverkaufte Produkte können sofort nicht mehr bestellt werden.</p>
          <div className="divide-y divide-slate-100">
            {catalog.products
              .filter((p) => selected.includes(p.stationId))
              .map((p) => (
                <Toggle
                  key={p.id}
                  checked={p.soldOut}
                  label={p.name}
                  onChange={async (soldOut) => {
                    try {
                      await api.post(`/api/products/${p.id}/sold-out`, { soldOut });
                    } catch (err) {
                      toast({ tone: 'error', text: errorMessage(err) });
                    }
                  }}
                />
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function DoneList({
  query,
  onClose,
  onAction,
}: {
  query: string;
  onClose(): void;
  onAction(t: TicketDto, action: 'reopen' | 'reprint'): Promise<void>;
}) {
  const [list, setList] = useState<TicketDto[] | null>(null);
  const load = useCallback(async () => setList(await api.get<TicketDto[]>(`/api/tickets?stationIds=${query}&scope=done&limit=30`)), [query]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Modal open onClose={onClose} title="Zuletzt erledigt" wide>
      {list === null ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty>Noch nichts erledigt.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-bold">
                  {orderPlace(t)} <span className="font-normal text-slate-500">#{t.orderNumber} · {t.doneAt && timeOf(t.doneAt)}</span>
                </div>
                <div className="truncate text-sm text-slate-600">
                  {t.items.map((i) => `${i.qty - i.cancelledQty}× ${i.name}`).join(', ')}
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => onAction(t, 'reprint')}>
                Nachdruck
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await onAction(t, 'reopen');
                  onClose();
                }}
              >
                Zurückholen
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function StationApp() {
  const [stations, setStations] = useState<StationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>(() => storage.get<number[]>(SELECTED_KEY, []));
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    try {
      setStations(await api.get<StationDto[]>('/api/stations'));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useLive((msg) => {
    if (msg.type === 'catalog') void load();
  });

  if (!stations) {
    return (
      <div className="min-h-full">
        <TopBar title="Station" back="/" />
        <div className="p-4">{error ? <ErrorBox>{error}</ErrorBox> : <Loading />}</div>
      </div>
    );
  }
  const valid = selected.filter((id) => stations.some((s) => s.id === id));
  if (picking || valid.length === 0) {
    return (
      <StationPicker
        stations={stations}
        initial={valid}
        onSave={(ids) => {
          storage.set(SELECTED_KEY, ids);
          setSelected(ids);
          setPicking(false);
        }}
      />
    );
  }
  return <Board stations={stations} selected={valid} onChangeStations={() => setPicking(true)} />;
}
