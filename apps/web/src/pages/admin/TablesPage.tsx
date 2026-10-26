import { useState } from 'react';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useApiData } from '../../lib/useApi';
import { NeedEvent, PageTitle, useAdminEvent } from './AdminApp';

interface AdminArea {
  id: number;
  name: string;
  sort: number;
  tables: { id: number; label: string; sort: number }[];
}

export async function moveInList<T extends { id: number }>(list: T[], index: number, dir: -1 | 1, entity: string) {
  const target = index + dir;
  if (target < 0 || target >= list.length) return false;
  const ids = list.map((x) => x.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  await api.post('/api/admin/reorder', { entity, ids });
  return true;
}

export function TablesPage() {
  return (
    <NeedEvent>
      <Tables />
    </NeedEvent>
  );
}

function Tables() {
  const toast = useToast();
  const { q, eventId } = useAdminEvent();
  const { data: areas, error, reload } = useApiData<AdminArea[]>(`/api/admin/areas?${q}`);
  const [areaDialog, setAreaDialog] = useState<{ id?: number; name: string } | null>(null);
  const [bulk, setBulk] = useState<{ area: AdminArea; from: string; to: string; prefix: string } | null>(null);
  const [tableDialog, setTableDialog] = useState<{ id: number; label: string } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) toast({ tone: 'success', text: success });
      await reload();
      return true;
    } catch (err) {
      setDialogError(errorMessage(err));
      toast({ tone: 'error', text: errorMessage(err) });
      return false;
    }
  };

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!areas) return <Loading />;

  return (
    <div>
      <PageTitle title="Gänge & Tische">
        <Button onClick={() => setAreaDialog({ name: '' })}>Neuer Gang</Button>
      </PageTitle>
      <p className="mb-4 text-sm text-slate-600">
        Die Bedienung wählt zuerst den Gang (oder Bereich, z. B. „Terrasse“) und dann den Tisch.
      </p>
      <div className="space-y-4">
        {areas.map((area, index) => (
          <Card key={area.id}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="flex-1 text-lg font-semibold">
                {area.name} <span className="text-sm font-normal text-slate-500">({area.tables.length} Tische)</span>
              </h2>
              <Button size="sm" variant="ghost" onClick={() => run(() => moveInList(areas, index, -1, 'areas'))} aria-label="nach oben">
                ↑
              </Button>
              <Button size="sm" variant="ghost" onClick={() => run(() => moveInList(areas, index, 1, 'areas'))} aria-label="nach unten">
                ↓
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setBulk({ area, from: '1', to: '10', prefix: '' })}>
                Tische hinzufügen
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAreaDialog({ id: area.id, name: area.name })}>
                Umbenennen
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-700"
                onClick={() => confirm(`Gang "${area.name}" mit allen Tischen löschen?`) && run(() => api.delete(`/api/admin/areas/${area.id}`))}
              >
                Löschen
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {area.tables.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setDialogError(null);
                    setTableDialog({ id: t.id, label: t.label });
                  }}
                  className="min-w-12 rounded-xl bg-slate-100 px-3 py-2 font-semibold hover:bg-slate-200"
                >
                  {t.label}
                </button>
              ))}
              {area.tables.length === 0 && <span className="text-sm text-slate-500">Noch keine Tische.</span>}
            </div>
          </Card>
        ))}
        {areas.length === 0 && <Empty>Noch keine Gänge. Lege z. B. „Gang A“ an und füge Tische 1–20 hinzu.</Empty>}
      </div>

      <Modal
        open={areaDialog !== null}
        onClose={() => setAreaDialog(null)}
        title={areaDialog?.id ? 'Gang umbenennen' : 'Neuer Gang'}
        footer={
          <Button
            disabled={!areaDialog?.name.trim()}
            onClick={async () => {
              const ok = await run(() =>
                areaDialog!.id
                  ? api.patch(`/api/admin/areas/${areaDialog!.id}`, { name: areaDialog!.name })
                  : api.post('/api/admin/areas', { eventId, name: areaDialog!.name }),
              );
              if (ok) setAreaDialog(null);
            }}
          >
            Speichern
          </Button>
        }
      >
        <Field label="Name">
          <Input
            value={areaDialog?.name ?? ''}
            onChange={(e) => setAreaDialog((d) => d && { ...d, name: e.target.value })}
            placeholder="z. B. Gang A"
            autoFocus
          />
        </Field>
      </Modal>

      <Modal
        open={bulk !== null}
        onClose={() => setBulk(null)}
        title={`Tische für ${bulk?.area.name ?? ''}`}
        footer={
          <Button
            onClick={async () => {
              let result: { created: number; skipped: number } | null = null;
              const ok = await run(async () => {
                result = await api.post(`/api/admin/areas/${bulk!.area.id}/tables`, {
                  from: Number(bulk!.from),
                  to: Number(bulk!.to),
                  prefix: bulk!.prefix,
                });
              });
              if (ok && result) {
                const r = result as { created: number; skipped: number };
                toast({ tone: 'success', text: `${r.created} Tische angelegt${r.skipped ? `, ${r.skipped} gab es schon` : ''}` });
                setBulk(null);
              }
            }}
          >
            Anlegen
          </Button>
        }
      >
        {bulk && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Vorsilbe">
              <Input value={bulk.prefix} onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })} placeholder="z. B. T" />
            </Field>
            <Field label="von">
              <Input inputMode="numeric" value={bulk.from} onChange={(e) => setBulk({ ...bulk, from: e.target.value })} />
            </Field>
            <Field label="bis">
              <Input inputMode="numeric" value={bulk.to} onChange={(e) => setBulk({ ...bulk, to: e.target.value })} />
            </Field>
            <p className="col-span-3 text-sm text-slate-500">
              Ergebnis: {bulk.prefix}
              {bulk.from} … {bulk.prefix}
              {bulk.to}
            </p>
          </div>
        )}
      </Modal>

      <Modal
        open={tableDialog !== null}
        onClose={() => setTableDialog(null)}
        title="Tisch"
        footer={
          <>
            <Button
              variant="ghost"
              className="text-red-700"
              onClick={async () => {
                if (await run(() => api.delete(`/api/admin/tables/${tableDialog!.id}`))) setTableDialog(null);
              }}
            >
              Löschen
            </Button>
            <Button
              onClick={async () => {
                if (await run(() => api.patch(`/api/admin/tables/${tableDialog!.id}`, { label: tableDialog!.label })))
                  setTableDialog(null);
              }}
            >
              Speichern
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Bezeichnung">
            <Input value={tableDialog?.label ?? ''} onChange={(e) => setTableDialog((d) => d && { ...d, label: e.target.value })} />
          </Field>
          {dialogError && <ErrorBox>{dialogError}</ErrorBox>}
        </div>
      </Modal>
    </div>
  );
}
