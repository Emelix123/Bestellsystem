import type { Catalog, OrderDto } from '@bestellsystem/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router';
import { OrderHistory } from '../../components/OrderHistory';
import { OrderScreen, type SendResult } from '../../components/OrderScreen';
import { linesFromCart, linesFromOrder, SentSheet } from '../../components/SentSheet';
import { TopBar } from '../../components/TopBar';
import { Empty, ErrorBox, Loading } from '../../components/ui';
import { api } from '../../lib/api';
import { useCatalog } from '../../lib/catalog';
import { useLive } from '../../lib/live';
import { storage } from '../../lib/storage';

const RECENT_KEY = 'recent-tables';

function findTable(catalog: Catalog, tableId: number) {
  for (const area of catalog.areas) {
    const table = area.tables.find((t) => t.id === tableId);
    if (table) return { area, table };
  }
  return null;
}

function rememberTable(tableId: number) {
  const list = storage.get<number[]>(RECENT_KEY, []).filter((id) => id !== tableId);
  storage.set(RECENT_KEY, [tableId, ...list].slice(0, 8));
}

function NoCatalog({ error }: { error: string | null }) {
  return (
    <div className="min-h-full">
      <TopBar title="Bedienung" back="/" />
      <div className="p-4">{error ? <ErrorBox>{error}</ErrorBox> : <Loading />}</div>
    </div>
  );
}

function AreaPicker({ catalog }: { catalog: Catalog }) {
  const recent = storage
    .get<number[]>(RECENT_KEY, [])
    .map((id) => findTable(catalog, id))
    .filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <div className="min-h-full">
      <TopBar
        title="Gang wählen"
        subtitle={catalog.event.name}
        right={
          <Link to="/bedienung/meine" className="rounded-xl px-3 py-2 text-sm font-semibold hover:bg-white/10">
            Meine
          </Link>
        }
      />
      <main className="mx-auto max-w-3xl space-y-6 p-4">
        {recent.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Zuletzt</h2>
            <div className="flex flex-wrap gap-2">
              {recent.map(({ area, table }) => (
                <Link
                  key={table.id}
                  to={`/bedienung/tisch/${table.id}`}
                  className="rounded-2xl bg-white px-4 py-3 font-semibold shadow-sm ring-1 ring-slate-200 active:scale-95"
                >
                  {area.name} · {table.label}
                </Link>
              ))}
            </div>
          </section>
        )}
        <section className="grid gap-3 sm:grid-cols-2">
          {catalog.areas.map((area) => (
            <Link
              key={area.id}
              to={`/bedienung/gang/${area.id}`}
              className="flex items-center justify-between rounded-3xl bg-sky-600 p-6 text-white shadow-md active:scale-[0.98]"
            >
              <span className="text-2xl font-bold">{area.name}</span>
              <span className="text-sm text-white/80">{area.tables.length} Tische</span>
            </Link>
          ))}
        </section>
        {catalog.areas.length === 0 && <Empty>Noch keine Gänge/Tische angelegt (Admin → Tische).</Empty>}
      </main>
    </div>
  );
}

function TablePicker({ catalog }: { catalog: Catalog }) {
  const { areaId } = useParams();
  const area = catalog.areas.find((a) => a.id === Number(areaId));
  if (!area) return <NoCatalog error="Gang nicht gefunden." />;
  return (
    <div className="min-h-full">
      <TopBar title={area.name} subtitle="Tisch wählen" back="/bedienung" />
      <main className="mx-auto grid max-w-3xl grid-cols-3 gap-3 p-4 min-[480px]:grid-cols-4 md:grid-cols-6">
        {area.tables.map((t) => (
          <Link
            key={t.id}
            to={`/bedienung/tisch/${t.id}`}
            className="flex aspect-square items-center justify-center rounded-2xl bg-white text-2xl font-bold shadow-sm ring-1 ring-slate-200 active:scale-95 active:bg-slate-100"
          >
            {t.label}
          </Link>
        ))}
      </main>
    </div>
  );
}

function TableOrder({ catalog }: { catalog: Catalog }) {
  const { tableId } = useParams();
  const navigate = useNavigate();
  const found = findTable(catalog, Number(tableId));
  const [sent, setSent] = useState<SendResult | null>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (found) rememberTable(found.table.id);
  }, [found]);

  if (!found) return <NoCatalog error="Tisch nicht gefunden – evtl. im Admin-Bereich geändert." />;
  const { area, table } = found;
  const label = `${area.name} · Tisch ${table.label}`;

  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        title={`Tisch ${table.label}`}
        subtitle={area.name}
        back={`/bedienung/gang/${area.id}`}
        right={
          <Link
            to={`/bedienung/tisch/${table.id}/verlauf`}
            className="rounded-xl px-3 py-2 text-sm font-semibold hover:bg-white/10"
          >
            Verlauf
          </Link>
        }
      />
      <OrderScreen
        key={formKey}
        catalog={catalog}
        kind="table"
        tableId={table.id}
        label={label}
        draftKey={`draft-table-${table.id}`}
        onSent={setSent}
      />
      {sent && (
        <SentSheet
          catalog={catalog}
          title={label}
          order={'order' in sent ? sent.order : null}
          queued={'queued' in sent}
          lines={'order' in sent ? linesFromOrder(sent.order) : linesFromCart(catalog, sent.cart)}
          primaryLabel="Anderer Tisch"
          onPrimary={() => navigate(`/bedienung/gang/${area.id}`)}
          secondaryLabel="Gleicher Tisch"
          onSecondary={() => {
            setSent(null);
            setFormKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function TableHistory({ catalog }: { catalog: Catalog }) {
  const { tableId } = useParams();
  const found = findTable(catalog, Number(tableId));
  const [orders, setOrders] = useState<OrderDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setOrders(await api.get<OrderDto[]>(`/api/orders?tableId=${tableId}&hours=12`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [tableId]);
  useEffect(() => {
    void load();
  }, [load]);
  useLive(
    (msg) => {
      if (msg.type === 'order' && msg.order.tableId === Number(tableId)) void load();
    },
    () => void load(),
  );
  if (!found) return <NoCatalog error="Tisch nicht gefunden." />;
  return (
    <div className="min-h-full">
      <TopBar title={`Verlauf Tisch ${found.table.label}`} subtitle={found.area.name} back={`/bedienung/tisch/${found.table.id}`} />
      <main className="mx-auto max-w-3xl p-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        {orders === null ? <Loading /> : <OrderHistory catalog={catalog} orders={orders} onChanged={load} />}
      </main>
    </div>
  );
}

function MyOrders({ catalog }: { catalog: Catalog }) {
  const [orders, setOrders] = useState<OrderDto[] | null>(null);
  const load = useCallback(async () => {
    setOrders(await api.get<OrderDto[]>('/api/orders?mine=true&hours=4&limit=50'));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useLive(
    (msg) => {
      if (msg.type === 'order') void load();
    },
    () => void load(),
  );
  return (
    <div className="min-h-full">
      <TopBar title="Meine Bestellungen" subtitle="letzte 4 Stunden" back="/bedienung" />
      <main className="mx-auto max-w-3xl p-4">
        {orders === null ? <Loading /> : <OrderHistory catalog={catalog} orders={orders} onChanged={load} showPlace />}
      </main>
    </div>
  );
}

export function WaiterApp() {
  const { catalog, error } = useCatalog();
  if (!catalog) return <NoCatalog error={error} />;
  return (
    <Routes>
      <Route index element={<AreaPicker catalog={catalog} />} />
      <Route path="meine" element={<MyOrders catalog={catalog} />} />
      <Route path="gang/:areaId" element={<TablePicker catalog={catalog} />} />
      <Route path="tisch/:tableId" element={<TableOrder catalog={catalog} />} />
      <Route path="tisch/:tableId/verlauf" element={<TableHistory catalog={catalog} />} />
    </Routes>
  );
}
