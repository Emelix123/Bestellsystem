import { formatEuro, type StatsResponse, type StatsRow } from '@bestellsystem/shared';
import { useEffect, useMemo, useState } from 'react';
import { EChart, rankingOption, timelineOption } from '../../components/EChart';
import { Card, Empty, ErrorBox, Loading, Select } from '../../components/ui';
import { cn } from '../../lib/format';
import { useApiData } from '../../lib/useApi';
import { NeedEvent, PageTitle, useAdminEvent } from './AdminApp';

type Range = 'all' | '1h' | '3h' | 'today';
type Measure = 'qty' | 'value';

function rangeQuery(range: Range) {
  const now = Date.now();
  if (range === '1h') return `&from=${new Date(now - 3_600_000).toISOString()}`;
  if (range === '3h') return `&from=${new Date(now - 3 * 3_600_000).toISOString()}`;
  if (range === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return `&from=${d.toISOString()}`;
  }
  return '';
}

const number = new Intl.NumberFormat('de-DE');

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange(v: T): void; options: [T, string][] }) {
  return (
    <div className="inline-flex rounded-xl bg-slate-200 p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn('rounded-lg px-3 py-1.5 text-sm font-semibold', value === v ? 'bg-white shadow-sm' : 'text-slate-600')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Ranking({ title, rows, measure, limit = 12 }: { title: string; rows: StatsRow[]; measure: Measure; limit?: number }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (measure === 'value' ? (b.valueCents ?? 0) - (a.valueCents ?? 0) : b.qty - a.qty)),
    [rows, measure],
  );
  const shown = sorted.slice(0, limit);
  const option = useMemo(
    () =>
      rankingOption(
        shown.map((r) => ({ label: r.label, value: measure === 'value' ? (r.valueCents ?? 0) / 100 : r.qty })),
        measure === 'value' ? (v) => formatEuro(Math.round(v * 100)) : (v) => `${number.format(v)}`,
      ),
    [shown, measure],
  );
  return (
    <Card>
      <h2 className="font-semibold">{title}</h2>
      <p className="mb-2 text-xs text-slate-500">
        {measure === 'value' ? 'Wert in Euro' : 'Stück'}
        {sorted.length > limit && ` · Top ${limit} von ${sorted.length}`}
      </p>
      {shown.length === 0 ? <Empty>Keine Daten.</Empty> : <EChart option={option} height={Math.max(120, shown.length * 30 + 24)} />}
    </Card>
  );
}

function minutes(seconds: number | null) {
  if (seconds === null) return '–';
  return `${(seconds / 60).toFixed(1).replace('.', ',')} Min.`;
}

export function StatsPage() {
  return (
    <NeedEvent>
      <Stats />
    </NeedEvent>
  );
}

function Stats() {
  const { q, eventId } = useAdminEvent();
  const [range, setRange] = useState<Range>('all');
  const [measure, setMeasure] = useState<Measure>('qty');
  const [timelineMeasure, setTimelineMeasure] = useState<'items' | 'orders'>('items');
  const [tick, setTick] = useState(0);
  const rq = useMemo(() => rangeQuery(range), [range, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error } = useApiData<StatsResponse>(`/api/admin/stats?${q}${rq}`);

  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const timeline = useMemo(
    () =>
      timelineOption(
        (data?.timeline ?? []).map((p) => ({ label: p.bucket.slice(11, 16), value: timelineMeasure === 'items' ? p.items : p.orders })),
        timelineMeasure === 'items' ? 'Stück' : 'Bestellungen',
      ),
    [data, timelineMeasure],
  );

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;
  const m: Measure = data.showValues ? measure : 'qty';
  const exportQuery = `eventId=${eventId}${rq}`;

  return (
    <div className="space-y-5">
      <PageTitle title={`Statistik – ${data.event.name}`}>
        <a className="inline-flex h-10 items-center rounded-xl bg-white px-4 text-sm font-semibold ring-1 ring-slate-300 hover:bg-slate-50" href={`/api/admin/export.xlsx?${exportQuery}`}>
          Excel
        </a>
        <a className="inline-flex h-10 items-center rounded-xl bg-white px-4 text-sm font-semibold ring-1 ring-slate-300 hover:bg-slate-50" href={`/api/admin/export.csv?${exportQuery}`}>
          CSV
        </a>
      </PageTitle>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={range} onChange={(e) => setRange(e.target.value as Range)} className="w-56">
          <option value="all">ganze Veranstaltung</option>
          <option value="today">heute</option>
          <option value="3h">letzte 3 Stunden</option>
          <option value="1h">letzte Stunde</option>
        </Select>
        {data.showValues && (
          <Segmented<Measure>
            value={measure}
            onChange={setMeasure}
            options={[
              ['qty', 'Stück'],
              ['value', 'Euro'],
            ]}
          />
        )}
        {!data.showValues && <span className="text-xs text-slate-500">Euro-Werte sind in den Einstellungen ausgeschaltet.</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Bestellungen" value={number.format(data.totals.orders)} />
        <Tile label="Positionen (Stück)" value={number.format(data.totals.items)} />
        <Tile label="Storniert (Stück)" value={number.format(data.totals.cancelledItems)} />
        {data.showValues && data.totals.valueCents !== null && <Tile label="Bestellwert" value={formatEuro(data.totals.valueCents)} />}
      </div>

      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Verlauf</h2>
            <p className="text-xs text-slate-500">{timelineMeasure === 'items' ? 'Stück' : 'Bestellungen'} pro 15 Minuten</p>
          </div>
          <Segmented<'items' | 'orders'>
            value={timelineMeasure}
            onChange={setTimelineMeasure}
            options={[
              ['items', 'Stück'],
              ['orders', 'Bestellungen'],
            ]}
          />
        </div>
        {data.timeline.length === 0 ? <Empty>Noch keine Bestellungen.</Empty> : <EChart option={timeline} height={260} />}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Ranking title="Produkte" rows={data.products} measure={m} limit={15} />
        <div className="space-y-5">
          <Ranking title="Kategorien" rows={data.categories} measure={m} />
          <Ranking title="Stationen" rows={data.stations} measure={m} />
        </div>
        <Ranking title="Bedienungen" rows={data.waiters} measure={m} />
        <Card>
          <h2 className="font-semibold">Durchlaufzeit an den Tablets</h2>
          <p className="mb-3 text-xs text-slate-500">Von der Bestellung bis „Fertig“ (nur Stationen mit Tablet)</p>
          {data.throughput.length === 0 ? (
            <Empty>Keine Daten.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1">Station</th>
                  <th className="py-1 text-right">Tickets</th>
                  <th className="py-1 text-right">Ø</th>
                  <th className="py-1 text-right">max.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.throughput.map((t) => (
                  <tr key={t.stationName}>
                    <td className="py-2">{t.stationName}</td>
                    <td className="py-2 text-right tabular-nums">{t.tickets}</td>
                    <td className="py-2 text-right tabular-nums">{minutes(t.avgSecondsToDone)}</td>
                    <td className="py-2 text-right tabular-nums">{minutes(t.maxSecondsToDone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Alle Produkte (Tabelle)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1">Produkt</th>
                <th className="py-1 text-right">Stück</th>
                <th className="py-1 text-right">Storniert</th>
                {data.showValues && <th className="py-1 text-right">Wert</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.products.map((p) => (
                <tr key={p.key}>
                  <td className="py-1.5">{p.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{number.format(p.qty)}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">{p.cancelledQty || ''}</td>
                  {data.showValues && <td className="py-1.5 text-right tabular-nums">{formatEuro(p.valueCents ?? 0)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
