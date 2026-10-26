import { formatEuro, parseEuro, type StationDto } from '@bestellsystem/shared';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Toggle, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useApiData } from '../../lib/useApi';
import { NeedEvent, PageTitle, useAdminEvent } from './AdminApp';
import { moveInList } from './TablesPage';

interface Category {
  id: number;
  name: string;
  color: string;
}

interface Product {
  id: number;
  categoryId: number;
  stationId: number;
  name: string;
  bonName: string | null;
  priceCents: number;
  depositCents: number;
  color: string | null;
  soldOut: boolean;
  active: boolean;
  optionGroupIds: number[];
}

interface OptionGroup {
  id: number;
  name: string;
}

const COLORS = ['#ea580c', '#dc2626', '#ca8a04', '#16a34a', '#0d9488', '#0284c7', '#4f46e5', '#9333ea', '#db2777', '#64748b'];

function euroText(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function ProductsPage() {
  return (
    <NeedEvent>
      <Products />
    </NeedEvent>
  );
}

function Products() {
  const toast = useToast();
  const { me } = useSession();
  const depositEnabled = me?.tenant?.settings.deposit ?? false;
  const { q, eventId } = useAdminEvent();
  const categories = useApiData<Category[]>(`/api/admin/categories?${q}`);
  const products = useApiData<Product[]>(`/api/admin/products?${q}`);
  const stations = useApiData<StationDto[]>(`/api/admin/stations?${q}`);
  const groups = useApiData<OptionGroup[]>(`/api/admin/option-groups?${q}`);
  const [catDialog, setCatDialog] = useState<{ id?: number; name: string; color: string } | null>(null);
  const [prodDialog, setProdDialog] = useState<(Omit<Product, 'id' | 'priceCents' | 'depositCents'> & { id?: number; price: string; deposit: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadAll = async () => {
    await Promise.all([categories.reload(), products.reload()]);
  };
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await reloadAll();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      toast({ tone: 'error', text: errorMessage(err) });
      return false;
    }
  };

  const loadError = categories.error ?? products.error ?? stations.error;
  if (loadError) return <ErrorBox>{loadError}</ErrorBox>;
  if (!categories.data || !products.data || !stations.data || !groups.data) return <Loading />;
  const cats = categories.data;
  const stationList = stations.data;

  const newProduct = (categoryId: number) => {
    setError(null);
    setProdDialog({
      categoryId,
      stationId: stationList[0]?.id ?? 0,
      name: '',
      bonName: '',
      price: '',
      deposit: '0,00',
      color: null,
      soldOut: false,
      active: true,
      optionGroupIds: [],
    });
  };

  const saveProduct = async () => {
    const d = prodDialog!;
    const priceCents = parseEuro(d.price);
    const depositCents = parseEuro(d.deposit || '0');
    if (priceCents === null || depositCents === null) {
      setError('Preis bitte als Zahl eingeben, z. B. 4,50');
      return;
    }
    const body = {
      eventId,
      categoryId: d.categoryId,
      stationId: d.stationId,
      name: d.name,
      bonName: d.bonName || null,
      priceCents,
      depositCents,
      color: d.color,
      soldOut: d.soldOut,
      active: d.active,
      optionGroupIds: d.optionGroupIds,
    };
    if (await run(() => (d.id ? api.patch(`/api/admin/products/${d.id}`, body) : api.post('/api/admin/products', body)))) {
      setProdDialog(null);
    }
  };

  return (
    <div>
      <PageTitle title="Produkte">
        <Button variant="secondary" onClick={() => setCatDialog({ name: '', color: COLORS[cats.length % COLORS.length] })}>
          Neue Kategorie
        </Button>
      </PageTitle>
      {stationList.length === 0 && (
        <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          Zuerst unter „Stationen“ mindestens eine Station anlegen (z. B. Küche, Getränke) – jedes Produkt braucht eine.
        </div>
      )}
      <div className="space-y-5">
        {cats.map((cat, catIndex) => {
          const list = products.data!.filter((p) => p.categoryId === cat.id);
          return (
            <Card key={cat.id} className="p-0">
              <div className="flex flex-wrap items-center gap-2 rounded-t-2xl px-4 py-3 text-white" style={{ backgroundColor: cat.color }}>
                <h2 className="flex-1 text-lg font-bold">{cat.name}</h2>
                <Button size="sm" variant="ghost" className="text-white hover:bg-white/20" onClick={() => run(() => moveInList(cats, catIndex, -1, 'categories'))}>
                  ↑
                </Button>
                <Button size="sm" variant="ghost" className="text-white hover:bg-white/20" onClick={() => run(() => moveInList(cats, catIndex, 1, 'categories'))}>
                  ↓
                </Button>
                <Button size="sm" variant="ghost" className="text-white hover:bg-white/20" onClick={() => setCatDialog({ ...cat })}>
                  Bearbeiten
                </Button>
                <Button size="sm" variant="secondary" onClick={() => newProduct(cat.id)} disabled={stationList.length === 0}>
                  + Produkt
                </Button>
              </div>
              <ul className="divide-y divide-slate-100">
                {list.map((p, index) => (
                  <li key={p.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2', !p.active && 'opacity-50')}>
                    <div className="min-w-40 flex-1">
                      <div className="font-semibold">
                        {p.name}
                        {p.bonName && <span className="ml-2 text-xs font-normal text-slate-500">Bon: {p.bonName}</span>}
                      </div>
                      <div className="flex flex-wrap gap-1 text-xs text-slate-500">
                        <span>{stationList.find((s) => s.id === p.stationId)?.name ?? '?'}</span>
                        {p.optionGroupIds.map((g) => (
                          <Badge key={g}>{groups.data!.find((x) => x.id === g)?.name}</Badge>
                        ))}
                        {!p.active && <Badge tone="slate">ausgeblendet</Badge>}
                      </div>
                    </div>
                    <div className="w-20 text-right font-semibold tabular-nums">{formatEuro(p.priceCents)}</div>
                    {depositEnabled && (
                      <div className="w-24 text-right text-xs text-slate-500">{p.depositCents ? `+${formatEuro(p.depositCents)} Pfand` : ''}</div>
                    )}
                    <Toggle
                      checked={p.soldOut}
                      label="aus"
                      onChange={(soldOut) => run(() => api.patch(`/api/admin/products/${p.id}`, { soldOut }))}
                    />
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => run(() => moveInList(list, index, -1, 'products'))}>
                        ↑
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => run(() => moveInList(list, index, 1, 'products'))}>
                        ↓
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setError(null);
                          setProdDialog({ ...p, bonName: p.bonName ?? '', price: euroText(p.priceCents), deposit: euroText(p.depositCents) });
                        }}
                      >
                        Bearbeiten
                      </Button>
                    </div>
                  </li>
                ))}
                {list.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">Noch keine Produkte.</li>}
              </ul>
            </Card>
          );
        })}
        {cats.length === 0 && <Empty>Noch keine Kategorien. Lege z. B. „Essen“, „Alkoholfrei“ und „Bier“ an.</Empty>}
      </div>

      <Modal
        open={catDialog !== null}
        onClose={() => setCatDialog(null)}
        title={catDialog?.id ? 'Kategorie bearbeiten' : 'Neue Kategorie'}
        footer={
          <>
            {catDialog?.id && (
              <Button
                variant="ghost"
                className="text-red-700"
                onClick={async () => {
                  if (await run(() => api.delete(`/api/admin/categories/${catDialog.id}`))) setCatDialog(null);
                }}
              >
                Löschen
              </Button>
            )}
            <Button
              disabled={!catDialog?.name.trim()}
              onClick={async () => {
                const body = { eventId, name: catDialog!.name, color: catDialog!.color };
                if (
                  await run(() =>
                    catDialog!.id ? api.patch(`/api/admin/categories/${catDialog!.id}`, body) : api.post('/api/admin/categories', body),
                  )
                )
                  setCatDialog(null);
              }}
            >
              Speichern
            </Button>
          </>
        }
      >
        {catDialog && (
          <div className="space-y-4">
            <Field label="Name">
              <Input value={catDialog.name} onChange={(e) => setCatDialog({ ...catDialog, name: e.target.value })} autoFocus />
            </Field>
            <ColorPicker value={catDialog.color} onChange={(color) => setCatDialog({ ...catDialog, color })} />
          </div>
        )}
      </Modal>

      <Modal
        open={prodDialog !== null}
        onClose={() => setProdDialog(null)}
        title={prodDialog?.id ? 'Produkt bearbeiten' : 'Neues Produkt'}
        footer={
          <>
            {prodDialog?.id && (
              <Button
                variant="ghost"
                className="text-red-700"
                onClick={async () => {
                  if (confirm('Produkt löschen? Alte Bestellungen bleiben in der Statistik erhalten.') && (await run(() => api.delete(`/api/admin/products/${prodDialog.id}`))))
                    setProdDialog(null);
                }}
              >
                Löschen
              </Button>
            )}
            <Button disabled={!prodDialog?.name.trim()} onClick={saveProduct}>
              Speichern
            </Button>
          </>
        }
      >
        {prodDialog && (
          <div className="space-y-4">
            <Field label="Name">
              <Input value={prodDialog.name} onChange={(e) => setProdDialog({ ...prodDialog, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Kurzname für den Bon (optional)">
              <Input value={prodDialog.bonName ?? ''} onChange={(e) => setProdDialog({ ...prodDialog, bonName: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Preis (€)">
                <Input inputMode="decimal" value={prodDialog.price} onChange={(e) => setProdDialog({ ...prodDialog, price: e.target.value })} placeholder="4,50" />
              </Field>
              {depositEnabled && (
                <Field label="Pfand (€)">
                  <Input inputMode="decimal" value={prodDialog.deposit} onChange={(e) => setProdDialog({ ...prodDialog, deposit: e.target.value })} />
                </Field>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kategorie">
                <Select value={prodDialog.categoryId} onChange={(e) => setProdDialog({ ...prodDialog, categoryId: Number(e.target.value) })}>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Station (wohin der Bon geht)">
                <Select value={prodDialog.stationId} onChange={(e) => setProdDialog({ ...prodDialog, stationId: Number(e.target.value) })}>
                  {stationList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {groups.data.length > 0 && (
              <div>
                <div className="mb-1 text-sm font-medium text-slate-700">Optionen (z. B. Beilage, Soße)</div>
                <div className="flex flex-wrap gap-2">
                  {groups.data.map((g) => {
                    const on = prodDialog.optionGroupIds.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() =>
                          setProdDialog({
                            ...prodDialog,
                            optionGroupIds: on ? prodDialog.optionGroupIds.filter((x) => x !== g.id) : [...prodDialog.optionGroupIds, g.id],
                          })
                        }
                        className={cn('rounded-xl px-3 py-2 text-sm font-semibold ring-1', on ? 'bg-slate-900 text-white ring-slate-900' : 'ring-slate-300')}
                      >
                        {g.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <Toggle checked={prodDialog.active} onChange={(active) => setProdDialog({ ...prodDialog, active })} label="Sichtbar für die Bedienung" />
            <Toggle checked={prodDialog.soldOut} onChange={(soldOut) => setProdDialog({ ...prodDialog, soldOut })} label="Ausverkauft" />
            {error && <ErrorBox>{error}</ErrorBox>}
          </div>
        )}
      </Modal>
    </div>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange(c: string): void }) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-slate-700">Farbe</div>
      <div className="flex flex-wrap gap-2">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn('h-10 w-10 rounded-full ring-offset-2', value === c && 'ring-2 ring-slate-900')}
            style={{ backgroundColor: c }}
            aria-label={c}
          />
        ))}
      </div>
    </div>
  );
}
