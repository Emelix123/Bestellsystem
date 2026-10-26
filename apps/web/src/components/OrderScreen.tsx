import {
  formatEuro,
  type Catalog,
  type CatalogProduct,
  type CreateOrderInput,
  type OrderDto,
} from '@bestellsystem/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../lib/api';
import { cn } from '../lib/format';
import { outbox } from '../lib/outbox';
import { storage, uuid } from '../lib/storage';
import { Button, ErrorBox, Field, Input, Modal, Spinner, Stepper, Textarea, useToast } from './ui';

export interface CartItem {
  key: string;
  productId: number;
  qty: number;
  optionIds: number[];
  note: string;
}

export type SendResult = { order: OrderDto; cart: CartItem[] } | { queued: true; cart: CartItem[] };

function cartKey(productId: number, optionIds: number[], note: string) {
  return `${productId}|${[...optionIds].sort((a, b) => a - b).join(',')}|${note.trim()}`;
}

export function priceOf(catalog: Catalog, item: Pick<CartItem, 'productId' | 'optionIds'>) {
  const product = catalog.products.find((p) => p.id === item.productId);
  if (!product) return { unit: 0, deposit: 0 };
  const options = catalog.optionGroups.flatMap((g) => g.options);
  const delta = item.optionIds.reduce((s, id) => s + (options.find((o) => o.id === id)?.priceDeltaCents ?? 0), 0);
  return { unit: Math.max(0, product.priceCents + delta), deposit: product.depositCents };
}

export function optionNames(catalog: Catalog, optionIds: number[]) {
  const options = catalog.optionGroups.flatMap((g) => g.options);
  return optionIds.map((id) => options.find((o) => o.id === id)?.name).filter(Boolean) as string[];
}

/** Lange drücken öffnet die Details (Notiz/Optionen), kurz tippen fügt hinzu. */
function useLongPress(onLong: () => void, onShort: () => void) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const start = () => {
    fired.current = false;
    timer.current = window.setTimeout(() => {
      fired.current = true;
      onLong();
    }, 450);
  };
  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: start,
    onPointerUp: () => {
      cancel();
      if (!fired.current) onShort();
    },
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

function ProductTile({
  product,
  color,
  count,
  showPrice,
  onAdd,
  onDetails,
}: {
  product: CatalogProduct;
  color: string;
  count: number;
  showPrice: boolean;
  onAdd(): void;
  onDetails(): void;
}) {
  const handlers = useLongPress(onDetails, product.optionGroupIds.length > 0 ? onDetails : onAdd);
  return (
    <button
      type="button"
      disabled={product.soldOut}
      {...handlers}
      className={cn(
        'relative flex min-h-20 select-none flex-col justify-between rounded-2xl bg-white p-3 text-left shadow-sm ring-1 ring-slate-200 transition active:scale-95',
        product.soldOut && 'opacity-40',
      )}
      style={{ borderLeft: `6px solid ${product.color ?? color}` }}
    >
      <span className="line-clamp-2 text-[15px] font-semibold leading-tight">{product.name}</span>
      <span className="mt-1 flex items-center justify-between text-xs text-slate-500">
        <span>{product.soldOut ? 'ausverkauft' : showPrice ? formatEuro(product.priceCents) : ''}</span>
        {product.optionGroupIds.length > 0 && !product.soldOut && <span className="text-slate-400">…</span>}
      </span>
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-7 min-w-7 items-center justify-center rounded-full bg-slate-900 px-1.5 text-sm font-bold text-white shadow">
          {count}
        </span>
      )}
    </button>
  );
}

function OptionSheet({
  catalog,
  product,
  onClose,
  onAdd,
}: {
  catalog: Catalog;
  product: CatalogProduct;
  onClose(): void;
  onAdd(item: Omit<CartItem, 'key'>): void;
}) {
  const groups = product.optionGroupIds
    .map((id) => catalog.optionGroups.find((g) => g.id === id))
    .filter((g): g is NonNullable<typeof g> => !!g);
  const [chosen, setChosen] = useState<number[]>(() =>
    groups.filter((g) => g.required && !g.multi && g.options.length > 0).map((g) => g.options[0].id),
  );
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const missing = groups.filter((g) => g.required && !g.options.some((o) => chosen.includes(o.id)));
  const { unit } = priceOf(catalog, { productId: product.id, optionIds: chosen });

  const toggle = (groupId: number, optionId: number) => {
    const group = groups.find((g) => g.id === groupId)!;
    setChosen((c) => {
      if (group.multi) return c.includes(optionId) ? c.filter((x) => x !== optionId) : [...c, optionId];
      const others = c.filter((x) => !group.options.some((o) => o.id === x));
      return c.includes(optionId) && !group.required ? others : [...others, optionId];
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      footer={
        <Button
          size="lg"
          variant="success"
          block
          disabled={missing.length > 0}
          onClick={() => onAdd({ productId: product.id, qty, optionIds: chosen, note: note.trim() })}
        >
          {missing.length > 0 ? `Bitte wählen: ${missing[0].name}` : `${qty}× hinzufügen`}
          {missing.length === 0 && catalog.settings.showPrices && ` · ${formatEuro(unit * qty)}`}
        </Button>
      }
    >
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.id}>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="font-semibold">{g.name}</span>
              <span className="text-xs text-slate-500">
                {g.required ? 'Pflicht' : 'optional'} · {g.multi ? 'mehrere möglich' : 'eine Auswahl'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {g.options.map((o) => {
                const active = chosen.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(g.id, o.id)}
                    className={cn(
                      'rounded-xl px-4 py-3 text-sm font-semibold ring-1 transition',
                      active ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white ring-slate-300',
                    )}
                  >
                    {o.name}
                    {o.priceDeltaCents !== 0 && catalog.settings.showPrices && (
                      <span className="ml-1 font-normal opacity-70">
                        {o.priceDeltaCents > 0 ? '+' : '−'}
                        {formatEuro(Math.abs(o.priceDeltaCents))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <Field label="Notiz für die Küche / Theke">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. ohne Zwiebeln" maxLength={200} />
        </Field>
        <div className="flex items-center justify-between">
          <span className="font-semibold">Anzahl</span>
          <Stepper value={qty} min={1} onChange={setQty} size="lg" />
        </div>
      </div>
    </Modal>
  );
}

export function OrderScreen({
  catalog,
  kind,
  tableId,
  label,
  draftKey,
  onSent,
}: {
  catalog: Catalog;
  kind: 'table' | 'togo';
  tableId?: number;
  label: string;
  draftKey: string;
  onSent(result: SendResult): void;
}) {
  const toast = useToast();
  const categories = catalog.categories.filter((c) => catalog.products.some((p) => p.categoryId === c.id));
  const [categoryId, setCategoryId] = useState<number | null>(() => storage.get<number | null>('last-category', null));
  const activeCategory = categories.find((c) => c.id === categoryId) ?? categories[0];
  const [cart, setCart] = useState<CartItem[]>(() => storage.get<CartItem[]>(draftKey, []));
  const [details, setDetails] = useState<CatalogProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderNote, setOrderNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => storage.set(draftKey, cart), [draftKey, cart]);
  useEffect(() => {
    if (activeCategory) storage.set('last-category', activeCategory.id);
  }, [activeCategory]);

  // Produkte, die inzwischen ausverkauft sind oder fehlen, deutlich markieren.
  const invalid = cart.filter((c) => {
    const p = catalog.products.find((x) => x.id === c.productId);
    return !p || p.soldOut;
  });

  const add = (item: Omit<CartItem, 'key'>) => {
    const key = cartKey(item.productId, item.optionIds, item.note);
    setCart((c) => {
      const existing = c.find((x) => x.key === key);
      if (existing) return c.map((x) => (x.key === key ? { ...x, qty: Math.min(99, x.qty + item.qty) } : x));
      return [...c, { ...item, key }];
    });
  };

  const setQty = (key: string, qty: number) =>
    setCart((c) => (qty <= 0 ? c.filter((x) => x.key !== key) : c.map((x) => (x.key === key ? { ...x, qty } : x))));

  const countByProduct = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of cart) m.set(c.productId, (m.get(c.productId) ?? 0) + c.qty);
    return m;
  }, [cart]);

  const totalQty = cart.reduce((s, c) => s + c.qty, 0);
  const totals = cart.reduce(
    (acc, c) => {
      const { unit, deposit } = priceOf(catalog, c);
      return { goods: acc.goods + unit * c.qty, deposit: acc.deposit + deposit * c.qty };
    },
    { goods: 0, deposit: 0 },
  );

  const send = async () => {
    if (cart.length === 0 || sending) return;
    if (invalid.length > 0) {
      setError('Bitte ausverkaufte Produkte aus der Bestellung entfernen.');
      setCartOpen(true);
      return;
    }
    setSending(true);
    setError(null);
    const input: CreateOrderInput = {
      clientRequestId: uuid(),
      kind,
      tableId,
      note: orderNote.trim() || undefined,
      items: cart.map((c) => ({ productId: c.productId, qty: c.qty, optionIds: c.optionIds, note: c.note || undefined })),
    };
    try {
      const result = await outbox.send(input, label);
      const sentCart = cart;
      setCart([]);
      setOrderNote('');
      setCartOpen(false);
      storage.remove(draftKey);
      if ('queued' in result) {
        toast({ tone: 'error', text: 'Keine Verbindung – Bestellung wird automatisch nachgesendet.', duration: 6000 });
        onSent({ queued: true, cart: sentCart });
      } else {
        onSent({ order: result.order, cart: sentCart });
      }
    } catch (err) {
      setError(errorMessage(err));
      setCartOpen(true);
    } finally {
      setSending(false);
    }
  };

  const products = catalog.products.filter((p) => p.categoryId === activeCategory?.id);
  const showPrices = catalog.settings.showPrices;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="sticky top-14 z-20 flex gap-2 overflow-x-auto bg-slate-100/95 px-3 py-2 backdrop-blur">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategoryId(c.id)}
            className={cn(
              'shrink-0 rounded-full px-4 py-2 text-sm font-bold ring-1 transition',
              c.id === activeCategory?.id ? 'text-white ring-transparent' : 'bg-white text-slate-700 ring-slate-300',
            )}
            style={c.id === activeCategory?.id ? { backgroundColor: c.color } : undefined}
          >
            {c.name}
          </button>
        ))}
      </nav>

      <div className="grid flex-1 grid-cols-2 content-start gap-2.5 p-3 pb-28 min-[420px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {products.map((p) => (
          <ProductTile
            key={p.id}
            product={p}
            color={activeCategory?.color ?? '#64748b'}
            count={countByProduct.get(p.id) ?? 0}
            showPrice={showPrices}
            onAdd={() => add({ productId: p.id, qty: 1, optionIds: [], note: '' })}
            onDetails={() => setDetails(p)}
          />
        ))}
        {products.length === 0 && <p className="col-span-full p-6 text-center text-slate-500">Keine Produkte.</p>}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-3xl gap-2">
          <Button
            variant="secondary"
            size="xl"
            className="flex-1 justify-between"
            disabled={cart.length === 0}
            onClick={() => setCartOpen(true)}
          >
            <span>{totalQty === 0 ? 'Leer' : `${totalQty} Artikel`}</span>
            {showPrices && totalQty > 0 && <span className="tabular-nums">{formatEuro(totals.goods + totals.deposit)}</span>}
          </Button>
          <Button variant="success" size="xl" className="flex-1" disabled={cart.length === 0 || sending} onClick={send}>
            {sending ? <Spinner /> : 'Senden'}
          </Button>
        </div>
      </div>

      {details && (
        <OptionSheet
          catalog={catalog}
          product={details}
          onClose={() => setDetails(null)}
          onAdd={(item) => {
            add(item);
            setDetails(null);
          }}
        />
      )}

      <Modal
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        title={`Bestellung – ${label}`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                if (confirm('Bestellung wirklich verwerfen?')) {
                  setCart([]);
                  setCartOpen(false);
                }
              }}
            >
              Verwerfen
            </Button>
            <Button variant="success" size="lg" onClick={send} disabled={sending || cart.length === 0}>
              {sending ? <Spinner /> : 'Senden'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <ErrorBox>{error}</ErrorBox>}
          <ul className="divide-y divide-slate-100">
            {cart.map((c) => {
              const product = catalog.products.find((p) => p.id === c.productId);
              const { unit } = priceOf(catalog, c);
              const names = optionNames(catalog, c.optionIds);
              return (
                <li key={c.key} className="py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className={cn('font-semibold', (!product || product.soldOut) && 'text-red-600 line-through')}>
                        {product?.name ?? 'Unbekanntes Produkt'}
                      </div>
                      {names.length > 0 && <div className="text-sm text-slate-600">+ {names.join(', ')}</div>}
                      {c.note && <div className="text-sm font-medium text-amber-700">! {c.note}</div>}
                      {showPrices && <div className="text-xs text-slate-500">{formatEuro(unit)} / Stück</div>}
                    </div>
                    <Stepper value={c.qty} onChange={(q) => setQty(c.key, q)} />
                  </div>
                </li>
              );
            })}
          </ul>
          <Field label="Notiz zur ganzen Bestellung (optional)">
            <Textarea rows={2} value={orderNote} onChange={(e) => setOrderNote(e.target.value)} maxLength={300} />
          </Field>
          {showPrices && (
            <div className="rounded-2xl bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <span>Summe</span>
                <span className="font-semibold tabular-nums">{formatEuro(totals.goods)}</span>
              </div>
              {catalog.settings.deposit && totals.deposit > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>+ Pfand</span>
                  <span className="tabular-nums">{formatEuro(totals.deposit)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
