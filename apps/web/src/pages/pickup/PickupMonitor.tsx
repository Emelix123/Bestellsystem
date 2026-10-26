import type { PickupBoard } from '@bestellsystem/shared';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/format';

/** Abholmonitor für einen Fernseher an der To-Go-Ausgabe. Braucht keine Anmeldung. */
export function PickupMonitor() {
  const { slug } = useParams();
  const [board, setBoard] = useState<PickupBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<number[]>([]);
  const previous = useRef<number[]>([]);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const data = await api.get<PickupBoard>(`/api/public/pickup/${slug}`, { timeoutMs: 5000 });
        if (stopped) return;
        const newlyReady = data.ready.filter((n) => !previous.current.includes(n));
        previous.current = data.ready;
        if (newlyReady.length) {
          setFresh(newlyReady);
          window.setTimeout(() => setFresh([]), 8000);
        }
        setBoard(data);
        setError(null);
      } catch (err) {
        if (!stopped) setError(errorMessage(err));
      }
    };
    void load();
    const t = window.setInterval(load, 3000);
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [slug]);

  return (
    <div className="flex min-h-full flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between px-8 py-5">
        <h1 className="text-3xl font-black">{board?.tenantName ?? 'Abholung'}</h1>
        {error && <span className="rounded-full bg-red-600 px-3 py-1 text-sm">Verbindung unterbrochen</span>}
      </header>
      <main className="grid flex-1 grid-cols-1 gap-6 px-8 pb-8 md:grid-cols-[1fr_2fr]">
        <section className="rounded-3xl bg-slate-900 p-6">
          <h2 className="mb-4 text-2xl font-bold text-slate-400">In Zubereitung</h2>
          <div className="flex flex-wrap gap-3">
            {board?.preparing.map((n) => (
              <span key={n} className="rounded-2xl bg-slate-800 px-5 py-3 text-4xl font-black tabular-nums text-slate-300">
                {n}
              </span>
            ))}
          </div>
        </section>
        <section className="rounded-3xl bg-emerald-950 p-6 ring-2 ring-emerald-500">
          <h2 className="mb-4 text-3xl font-bold text-emerald-400">Bitte abholen</h2>
          <div className="flex flex-wrap gap-4">
            {board?.ready.map((n) => (
              <span
                key={n}
                className={cn(
                  'rounded-3xl bg-emerald-500 px-8 py-5 text-7xl font-black tabular-nums text-emerald-950',
                  fresh.includes(n) && 'animate-pulse ring-8 ring-white',
                )}
              >
                {n}
              </span>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
