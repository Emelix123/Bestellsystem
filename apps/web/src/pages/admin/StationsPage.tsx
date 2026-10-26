import { PRINT_TRIGGER_LABELS, type PrinterDto, type PrintTrigger, type StationDto } from '@bestellsystem/shared';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useApiData } from '../../lib/useApi';
import { NeedEvent, PageTitle, useAdminEvent } from './AdminApp';
import { moveInList } from './TablesPage';

type Draft = Omit<StationDto, 'id' | 'sort'> & { id?: number };

const WHEN: Record<PrintTrigger, string> = {
  on_order: 'sofort',
  on_accept: 'beim Annehmen',
  on_done: 'beim Fertigmelden',
  never: '',
};

export function describeStation(s: Pick<StationDto, 'showOnDisplay' | 'printTrigger'>, printerName: string | null) {
  if (!s.showOnDisplay) return printerName ? `Bon sofort auf „${printerName}“` : 'Kein Drucker und kein Tablet – Bestellungen landen nirgends!';
  const print = s.printTrigger === 'never' || !printerName ? 'ohne Bon' : `Bon ${WHEN[s.printTrigger]} auf „${printerName}“`;
  return `Warteschlange am Tablet, ${print}`;
}

export function StationsPage() {
  return (
    <NeedEvent>
      <Stations />
    </NeedEvent>
  );
}

function Stations() {
  const { q, eventId } = useAdminEvent();
  const { data, error, reload } = useApiData<StationDto[]>(`/api/admin/stations?${q}`);
  const printers = useApiData<PrinterDto[]>('/api/admin/printers');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data || !printers.data) return <Loading />;
  const printerName = (id: number | null) => printers.data!.find((p) => p.id === id)?.name ?? null;

  const save = async () => {
    const { id, ...body } = draft!;
    const payload = { ...body, printTrigger: body.showOnDisplay ? body.printTrigger : ('on_order' as PrintTrigger) };
    try {
      if (id) await api.patch(`/api/admin/stations/${id}`, payload);
      else await api.post('/api/admin/stations', { ...payload, eventId });
      setDraft(null);
      await reload();
    } catch (err) {
      setDialogError(errorMessage(err));
    }
  };

  return (
    <div>
      <PageTitle title="Stationen">
        <Button
          onClick={() => {
            setDialogError(null);
            setDraft({ name: '', showOnDisplay: false, printTrigger: 'on_order', printerId: printers.data![0]?.id ?? null, bonPerItem: false });
          }}
        >
          Neue Station
        </Button>
      </PageTitle>
      <p className="mb-4 text-sm text-slate-600">
        Eine Station ist der Ort, an dem Bestellungen ankommen (Küche, Getränke, Bier …). Hier wird eingestellt, ob es eine
        Warteschlange am Tablet gibt und wann der Bon gedruckt wird. Jedes Produkt gehört zu genau einer Station.
      </p>
      <div className="space-y-3">
        {data.map((s, index) => (
          <Card key={s.id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold">{s.name}</span>
                {s.showOnDisplay && <Badge tone="blue">Tablet</Badge>}
                {s.bonPerItem && <Badge>Bon pro Stück</Badge>}
              </div>
              <div className="text-sm text-slate-600">{describeStation(s, printerName(s.printerId))}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={async () => (await moveInList(data, index, -1, 'stations')) && reload()}>
              ↑
            </Button>
            <Button size="sm" variant="ghost" onClick={async () => (await moveInList(data, index, 1, 'stations')) && reload()}>
              ↓
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setDialogError(null);
                setDraft({ ...s });
              }}
            >
              Bearbeiten
            </Button>
          </Card>
        ))}
        {data.length === 0 && <Empty>Noch keine Stationen. Typisch: Küche, Getränke, Bier.</Empty>}
      </div>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Station bearbeiten' : 'Neue Station'}
        footer={
          <>
            {draft?.id && (
              <Button
                variant="ghost"
                className="text-red-700"
                onClick={async () => {
                  if (!confirm('Station löschen?')) return;
                  try {
                    await api.delete(`/api/admin/stations/${draft.id}`);
                    setDraft(null);
                    await reload();
                  } catch (err) {
                    setDialogError(errorMessage(err));
                  }
                }}
              >
                Löschen
              </Button>
            )}
            <Button onClick={save} disabled={!draft?.name.trim()}>
              Speichern
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <Field label="Name">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="z. B. Küche" autoFocus />
            </Field>
            <Field label="Drucker">
              <Select
                value={draft.printerId ?? ''}
                onChange={(e) => setDraft({ ...draft, printerId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">– kein Drucker –</option>
                {printers.data!.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Toggle
              checked={draft.showOnDisplay}
              onChange={(showOnDisplay) =>
                setDraft({ ...draft, showOnDisplay, printTrigger: showOnDisplay ? (draft.printTrigger === 'on_order' ? 'on_done' : draft.printTrigger) : 'on_order' })
              }
              label="Warteschlange am Tablet"
              description="Bestellungen erscheinen am Tablet und werden dort angenommen / fertig gemeldet."
            />
            {draft.showOnDisplay && (
              <Field label="Bon drucken">
                <Select value={draft.printTrigger} onChange={(e) => setDraft({ ...draft, printTrigger: e.target.value as PrintTrigger })}>
                  {(['on_order', 'on_accept', 'on_done', 'never'] as const).map((t) => (
                    <option key={t} value={t}>
                      {PRINT_TRIGGER_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Toggle
              checked={draft.bonPerItem}
              onChange={(bonPerItem) => setDraft({ ...draft, bonPerItem })}
              label="Ein Bon pro Stück"
              description="z. B. ein Zettel pro Teller statt einem Sammelbon."
            />
            <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{describeStation(draft, printerName(draft.printerId))}</div>
            {dialogError && <ErrorBox>{dialogError}</ErrorBox>}
          </div>
        )}
      </Modal>
    </div>
  );
}
