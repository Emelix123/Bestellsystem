import type { Catalog, OrderDto } from '@bestellsystem/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes } from 'react-router';
import { OrderScreen, type SendResult } from '../../components/OrderScreen';
import { linesFromCart, linesFromOrder, SentSheet } from '../../components/SentSheet';
import { TopBar } from '../../components/TopBar';
import { Button, Empty, ErrorBox, Loading, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useCatalog } from '../../lib/catalog';
import { cn, minutesSince, timeOf } from '../../lib/format';
import { useLive } from '../../lib/live';

function useTogoOrders() {
  const [orders, setOrders] = useState<OrderDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setOrders(await api.get<OrderDto[]>('/api/togo/orders'));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
  }, [load]);
  useLive(
    (msg) => {
      if (msg.type === 'order' && msg.order.kind === 'togo') {
        setOrders((list) => {
          if (!list) return list;
          const rest = list.filter((o) => o.id !== msg.order.id);
          return [msg.order, ...rest].sort((a, b) => b.id - a.id);
        });
      }
    },
    () => void load(),
  );
  return { orders, error, reload: load };
}

function Entry({ catalog, openCount }: { catalog: Catalog; openCount: number }) {
  const [sent, setSent] = useState<SendResult | null>(null);
  const [formKey, setFormKey] = useState(0);
  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        title="To-Go"
        subtitle={catalog.event.name}
        right={
          <Link to="/togo/abholung" className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20">
            Abholung{openCount > 0 && ` (${openCount})`}
          </Link>
        }
      />
      <OrderScreen key={formKey} catalog={catalog} kind="togo" label="To-Go" draftKey="draft-togo" onSent={setSent} />
      {sent && (
        <SentSheet
          catalog={catalog}
          title="To-Go-Bestellung"
          order={'order' in sent ? sent.order : null}
          queued={'queued' in sent}
          lines={'order' in sent ? linesFromOrder(sent.order) : linesFromCart(catalog, sent.cart)}
          primaryLabel="Nächste Bestellung"
          onPrimary={() => {
            setSent(null);
            setFormKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function PickupList({ orders, error, reload }: ReturnType<typeof useTogoOrders>) {
  const toast = useToast();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const mark = async (order: OrderDto, pickedUp: boolean) => {
    try {
      await api.post(`/api/orders/${order.id}/picked-up`, { pickedUp });
      if (pickedUp) {
        toast({
          text: `Nr. ${order.pickupNumber} abgeholt`,
          tone: 'success',
          action: { label: 'Rückgängig', onClick: () => void mark(order, false) },
          duration: 6000,
        });
      }
      void reload();
    } catch (err) {
      toast({ tone: 'error', text: errorMessage(err) });
    }
  };

  const open = (orders ?? []).filter((o) => !o.pickedUpAt);
  const ready = open.filter((o) => o.readyAt);
  const preparing = open.filter((o) => !o.readyAt);

  const card = (o: OrderDto) => (
    <div
      key={o.id}
      className={cn(
        'flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1',
        o.readyAt ? 'ring-2 ring-emerald-500' : 'ring-slate-200',
      )}
    >
      <div className="w-20 text-center text-4xl font-black tabular-nums">{o.pickupNumber}</div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="text-slate-500">
          {timeOf(o.createdAt)} · vor {minutesSince(o.createdAt, now)} Min.
        </div>
        <div className="truncate">
          {o.items
            .filter((i) => i.qty > i.cancelledQty)
            .map((i) => `${i.qty - i.cancelledQty}× ${i.name}`)
            .join(', ')}
        </div>
      </div>
      <Button variant={o.readyAt ? 'success' : 'secondary'} size="lg" onClick={() => mark(o, true)}>
        Abgeholt
      </Button>
    </div>
  );

  return (
    <div className="min-h-full">
      <TopBar title="Abholung" subtitle="To-Go-Bestellungen" back="/togo" />
      <main className="mx-auto max-w-3xl space-y-6 p-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        {orders === null ? (
          <Loading />
        ) : (
          <>
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Abholbereit ({ready.length})</h2>
              {ready.length ? ready.map(card) : <Empty>Nichts abholbereit.</Empty>}
            </section>
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">In Zubereitung ({preparing.length})</h2>
              {preparing.length ? preparing.map(card) : <Empty>Nichts in Zubereitung.</Empty>}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export function TogoApp() {
  const { catalog, error } = useCatalog();
  const togo = useTogoOrders();
  if (!catalog) {
    return (
      <div className="min-h-full">
        <TopBar title="To-Go" back="/" />
        <div className="p-4">{error ? <ErrorBox>{error}</ErrorBox> : <Loading />}</div>
      </div>
    );
  }
  if (!catalog.settings.togo) {
    return (
      <div className="min-h-full">
        <TopBar title="To-Go" back="/" />
        <div className="p-4">
          <ErrorBox>To-Go ist für diesen Verein nicht aktiviert (Admin → Einstellungen).</ErrorBox>
        </div>
      </div>
    );
  }
  const openCount = (togo.orders ?? []).filter((o) => !o.pickedUpAt).length;
  return (
    <Routes>
      <Route index element={<Entry catalog={catalog} openCount={openCount} />} />
      <Route path="abholung" element={<PickupList {...togo} />} />
    </Routes>
  );
}
