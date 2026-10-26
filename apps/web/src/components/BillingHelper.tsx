import { formatEuro, parseEuro } from '@bestellsystem/shared';
import { useMemo, useState } from 'react';
import { cn } from '../lib/format';
import { Input, Stepper } from './ui';

export interface BillingLine {
  key: string;
  name: string;
  unitPriceCents: number;
  depositCents: number;
  qty: number;
}

/**
 * Rechenhilfe für die Bedienung: Summe, getrennt zahlen, Pfand, Rückgeld.
 * Reiner Taschenrechner – es wird nichts gespeichert und keine Zahlung erfasst.
 */
export function BillingHelper({
  lines,
  depositEnabled,
  depositValues,
}: {
  lines: BillingLine[];
  depositEnabled: boolean;
  /** Pfandbeträge, die zurückgegeben werden können (z. B. 200 = 2,00 €). */
  depositValues: number[];
}) {
  const [selected, setSelected] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.key, l.qty])),
  );
  const [returns, setReturns] = useState<Record<number, number>>({});
  const [given, setGiven] = useState('');

  const goods = lines.reduce((s, l) => s + (selected[l.key] ?? 0) * l.unitPriceCents, 0);
  const deposit = depositEnabled ? lines.reduce((s, l) => s + (selected[l.key] ?? 0) * l.depositCents, 0) : 0;
  const returned = depositEnabled ? depositValues.reduce((s, v) => s + (returns[v] ?? 0) * v, 0) : 0;
  const total = goods + deposit - returned;
  const givenCents = parseEuro(given);
  const change = givenCents !== null ? givenCents - total : null;
  const remaining = lines.reduce((s, l) => s + (l.qty - (selected[l.key] ?? 0)) * (l.unitPriceCents + (depositEnabled ? l.depositCents : 0)), 0);

  const quick = useMemo(() => {
    if (total <= 0) return [];
    const up = (step: number) => Math.ceil(total / step) * step;
    return [...new Set([total, up(500), up(1000), up(2000), up(5000)])].slice(0, 5);
  }, [total]);

  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
        Nur Rechenhilfe – es wird nichts gespeichert. Für getrennte Rechnungen die Stückzahl pro Gast einstellen.
      </p>
      <ul className="divide-y divide-slate-100">
        {lines.map((l) => (
          <li key={l.key} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{l.name}</div>
              <div className="text-xs text-slate-500">
                {formatEuro(l.unitPriceCents)}
                {depositEnabled && l.depositCents > 0 && ` + ${formatEuro(l.depositCents)} Pfand`}
              </div>
            </div>
            <span className="text-xs text-slate-400">von {l.qty}</span>
            <Stepper value={selected[l.key] ?? 0} max={l.qty} onChange={(v) => setSelected((s) => ({ ...s, [l.key]: v }))} />
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-xl bg-slate-100 py-2 text-sm font-semibold"
          onClick={() => setSelected(Object.fromEntries(lines.map((l) => [l.key, l.qty])))}
        >
          Alles
        </button>
        <button
          type="button"
          className="flex-1 rounded-xl bg-slate-100 py-2 text-sm font-semibold"
          onClick={() => setSelected(Object.fromEntries(lines.map((l) => [l.key, 0])))}
        >
          Nichts
        </button>
      </div>

      {depositEnabled && depositValues.length > 0 && (
        <div className="rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <div className="mb-2 text-sm font-semibold text-amber-900">Pfand-Rückgabe</div>
          {depositValues.map((v) => (
            <div key={v} className="flex items-center justify-between py-1">
              <span className="text-sm">{formatEuro(v)} zurück</span>
              <Stepper value={returns[v] ?? 0} onChange={(n) => setReturns((r) => ({ ...r, [v]: n }))} />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1 rounded-2xl bg-slate-900 p-4 text-white">
        <Row label="Waren" value={goods} />
        {depositEnabled && deposit > 0 && <Row label="Pfand" value={deposit} />}
        {depositEnabled && returned > 0 && <Row label="Pfand zurück" value={-returned} />}
        <div className="flex items-baseline justify-between border-t border-white/20 pt-2">
          <span className="text-lg font-semibold">{total < 0 ? 'Auszahlen' : 'Zu zahlen'}</span>
          <span className="text-3xl font-bold tabular-nums">{formatEuro(Math.abs(total))}</span>
        </div>
        {remaining > 0 && <div className="text-right text-xs text-white/60">Rest am Tisch: {formatEuro(remaining)}</div>}
      </div>

      {total > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold">Gegeben</div>
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setGiven((q / 100).toFixed(2).replace('.', ','))}
                className={cn(
                  'rounded-xl px-3 py-2 text-sm font-semibold ring-1',
                  givenCents === q ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white ring-slate-300',
                )}
              >
                {q === total ? 'Passend' : formatEuro(q)}
              </button>
            ))}
          </div>
          <Input inputMode="decimal" placeholder="Betrag, z. B. 50" value={given} onChange={(e) => setGiven(e.target.value)} />
          {change !== null && (
            <div
              className={cn(
                'flex items-baseline justify-between rounded-2xl p-4',
                change >= 0 ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900',
              )}
            >
              <span className="font-semibold">{change >= 0 ? 'Rückgeld' : 'Es fehlen'}</span>
              <span className="text-3xl font-bold tabular-nums">{formatEuro(Math.abs(change))}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-sm text-white/80">
      <span>{label}</span>
      <span className="tabular-nums">{formatEuro(value)}</span>
    </div>
  );
}
