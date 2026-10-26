import { formatEuro, type Catalog, type OrderDto, type TicketStatus } from '@bestellsystem/shared';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { cn, orderPlace, timeOf } from '../lib/format';
import { BillingHelper } from './BillingHelper';
import { depositValues, linesFromOrder } from './SentSheet';
import { Badge, Button, Empty, ErrorBox, Field, Input, Modal, Stepper, useToast } from './ui';

const STATUS: Record<TicketStatus, { label: string; tone: 'slate' | 'amber' | 'green' | 'red' }> = {
  open: { label: 'offen', tone: 'amber' },
  accepted: { label: 'in Arbeit', tone: 'amber' },
  done: { label: 'fertig', tone: 'green' },
  cancelled: { label: 'storniert', tone: 'red' },
};

function CancelDialog({ order, onClose, onDone }: { order: OrderDto; onClose(): void; onDone(): void }) {
  const toast = useToast();
  const [qty, setQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = order.items.filter((i) => i.qty - i.cancelledQty > 0);
  const selected = Object.entries(qty).filter(([, q]) => q > 0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/orders/${order.id}/cancel`, {
        items: selected.map(([id, q]) => ({ orderItemId: Number(id), qty: q })),
        reason: reason.trim() || undefined,
      });
      toast({ tone: 'success', text: 'Storniert – die Station bekommt einen Storno-Bon.' });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Storno – Bestellung #${order.number}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="danger" onClick={submit} disabled={busy || selected.length === 0}>
            Stornieren
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <ul className="divide-y divide-slate-100">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{i.name}</div>
                {i.options.length > 0 && <div className="text-xs text-slate-500">+ {i.options.map((o) => o.name).join(', ')}</div>}
              </div>
              <span className="text-xs text-slate-400">von {i.qty - i.cancelledQty}</span>
              <Stepper value={qty[i.id] ?? 0} max={i.qty - i.cancelledQty} onChange={(v) => setQty((q) => ({ ...q, [i.id]: v }))} />
            </li>
          ))}
        </ul>
        <Field label="Grund (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. falsch eingegeben" />
        </Field>
      </div>
    </Modal>
  );
}

export function OrderHistory({
  catalog,
  orders,
  onChanged,
  showPlace,
}: {
  catalog: Catalog;
  orders: OrderDto[];
  onChanged(): void;
  showPlace?: boolean;
}) {
  const [cancel, setCancel] = useState<OrderDto | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [billing, setBilling] = useState(false);
  const { billingHelper, showPrices, deposit } = catalog.settings;

  if (orders.length === 0) return <Empty>Keine Bestellungen in den letzten Stunden.</Empty>;

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const billingOrders = orders.filter((o) => selected.includes(o.id));

  return (
    <div className="space-y-3 pb-24">
      {orders.map((o) => {
        const total = o.items.reduce(
          (s, i) => s + (i.qty - i.cancelledQty) * (i.unitPriceCents + (deposit ? i.depositCents : 0)),
          0,
        );
        const open = o.items.some((i) => i.qty - i.cancelledQty > 0);
        return (
          <div
            key={o.id}
            className={cn(
              'rounded-2xl bg-white p-4 shadow-sm ring-1',
              selected.includes(o.id) ? 'ring-2 ring-slate-900' : 'ring-slate-200',
            )}
          >
            <div className="flex items-start gap-3">
              {billingHelper && open && (
                <input
                  type="checkbox"
                  className="mt-1 h-6 w-6 accent-slate-900"
                  checked={selected.includes(o.id)}
                  onChange={() => toggle(o.id)}
                  aria-label="Für Rechnungshilfe auswählen"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-bold">{timeOf(o.createdAt)}</span>
                  <span className="text-sm text-slate-500">#{o.number}</span>
                  {showPlace && <span className="text-sm font-semibold">{orderPlace(o)}</span>}
                  <span className="text-sm text-slate-500">{o.waiterName}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {o.tickets.map((t) => (
                    <Badge key={t.id} tone={STATUS[t.status].tone}>
                      {t.stationName}: {STATUS[t.status].label}
                    </Badge>
                  ))}
                </div>
                <ul className="mt-2 space-y-0.5 text-sm">
                  {o.items.map((i) => (
                    <li key={i.id} className={cn(i.qty === i.cancelledQty && 'text-slate-400 line-through')}>
                      {i.qty === i.cancelledQty ? i.qty : i.qty - i.cancelledQty}× {i.name}
                      {i.options.length > 0 && <span className="text-slate-500"> ({i.options.map((x) => x.name).join(', ')})</span>}
                      {i.cancelledQty > 0 && i.qty !== i.cancelledQty && (
                        <span className="text-red-600"> ({i.cancelledQty} storniert)</span>
                      )}
                      {i.note && <span className="text-amber-700"> ! {i.note}</span>}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col items-end gap-2">
                {showPrices && <span className="font-semibold tabular-nums">{formatEuro(total)}</span>}
                {open && (
                  <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setCancel(o)}>
                    Storno
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {billingHelper && selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-3xl">
            <Button size="xl" block onClick={() => setBilling(true)}>
              Rechnungshilfe ({selected.length} Bestellung{selected.length > 1 ? 'en' : ''})
            </Button>
          </div>
        </div>
      )}

      {billing && (
        <Modal open onClose={() => setBilling(false)} title="Rechnungshilfe">
          <BillingHelper
            lines={billingOrders.flatMap(linesFromOrder)}
            depositEnabled={deposit}
            depositValues={depositValues(catalog)}
          />
        </Modal>
      )}

      {cancel && (
        <CancelDialog
          order={cancel}
          onClose={() => setCancel(null)}
          onDone={() => {
            setCancel(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
