import { formatEuro, type Catalog, type OrderDto } from '@bestellsystem/shared';
import { useState } from 'react';
import { BillingHelper, type BillingLine } from './BillingHelper';
import { optionNames, priceOf, type CartItem } from './OrderScreen';
import { Button, Modal } from './ui';

export function depositValues(catalog: Catalog) {
  return [...new Set(catalog.products.map((p) => p.depositCents).filter((v) => v > 0))].sort((a, b) => a - b);
}

/** Positionen einer Bestellung als Zeilen für die Rechnungshilfe. */
export function linesFromOrder(order: OrderDto): BillingLine[] {
  return order.items
    .filter((i) => i.qty - i.cancelledQty > 0)
    .map((i) => ({
      key: `${order.id}-${i.id}`,
      name: i.options.length ? `${i.name} (${i.options.map((o) => o.name).join(', ')})` : i.name,
      unitPriceCents: i.unitPriceCents,
      depositCents: i.depositCents,
      qty: i.qty - i.cancelledQty,
    }));
}

export function linesFromCart(catalog: Catalog, cart: CartItem[]): BillingLine[] {
  return cart.map((c) => {
    const product = catalog.products.find((p) => p.id === c.productId);
    const { unit, deposit } = priceOf(catalog, c);
    const names = optionNames(catalog, c.optionIds);
    return {
      key: c.key,
      name: `${product?.name ?? '?'}${names.length ? ` (${names.join(', ')})` : ''}`,
      unitPriceCents: unit,
      depositCents: deposit,
      qty: c.qty,
    };
  });
}

/** Bestätigung nach dem Senden, optional mit Rechnungshilfe. */
export function SentSheet({
  catalog,
  title,
  order,
  queued,
  lines,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  catalog: Catalog;
  title: string;
  order: OrderDto | null;
  queued: boolean;
  lines: BillingLine[];
  primaryLabel: string;
  onPrimary(): void;
  secondaryLabel?: string;
  onSecondary?(): void;
}) {
  const [billing, setBilling] = useState(catalog.settings.billingHelper);
  const total = lines.reduce((s, l) => s + l.qty * (l.unitPriceCents + (catalog.settings.deposit ? l.depositCents : 0)), 0);
  return (
    <Modal
      open
      onClose={onPrimary}
      title={title}
      footer={
        <>
          {secondaryLabel && onSecondary && (
            <Button variant="secondary" size="lg" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
          <Button size="lg" onClick={onPrimary}>
            {primaryLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {queued ? (
          <div className="rounded-2xl bg-amber-50 p-4 text-amber-900 ring-1 ring-amber-200">
            <div className="font-bold">Noch nicht angekommen</div>
            <div className="text-sm">
              Keine Verbindung zum Server. Die Bestellung wird automatisch nachgesendet, sobald das WLAN wieder da ist – nicht
              erneut eingeben.
            </div>
          </div>
        ) : (
          order && (
            <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
              <div className="text-lg font-bold">
                Gesendet{order.pickupNumber !== null && <> – Abholnummer {order.pickupNumber}</>}
              </div>
              <div className="text-sm">
                Bestellung #{order.number} an {order.tickets.map((t) => t.stationName).join(', ')}
              </div>
            </div>
          )
        )}
        {order?.pickupNumber != null && (
          <div className="text-center">
            <div className="text-sm text-slate-500">Abholnummer</div>
            <div className="text-7xl font-black tabular-nums">{order.pickupNumber}</div>
          </div>
        )}
        {catalog.settings.billingHelper ? (
          billing ? (
            <BillingHelper lines={lines} depositEnabled={catalog.settings.deposit} depositValues={depositValues(catalog)} />
          ) : (
            <Button variant="secondary" block onClick={() => setBilling(true)}>
              Rechnungshilfe öffnen
            </Button>
          )
        ) : (
          catalog.settings.showPrices && (
            <div className="flex justify-between rounded-2xl bg-slate-50 p-4">
              <span className="font-semibold">Summe</span>
              <span className="text-xl font-bold tabular-nums">{formatEuro(total)}</span>
            </div>
          )
        )}
      </div>
    </Modal>
  );
}
