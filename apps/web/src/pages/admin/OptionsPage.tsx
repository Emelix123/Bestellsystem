import { formatEuro, parseEuro } from '@bestellsystem/shared';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Toggle, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useApiData } from '../../lib/useApi';
import { NeedEvent, PageTitle, useAdminEvent } from './AdminApp';

interface Group {
  id: number;
  name: string;
  multi: boolean;
  required: boolean;
  options: { id: number; name: string; priceDeltaCents: number }[];
}

interface Draft {
  id?: number;
  name: string;
  multi: boolean;
  required: boolean;
  options: { id?: number; name: string; price: string }[];
}

export function OptionsPage() {
  return (
    <NeedEvent>
      <Options />
    </NeedEvent>
  );
}

function Options() {
  const toast = useToast();
  const { q, eventId } = useAdminEvent();
  const { data, error, reload } = useApiData<Group[]>(`/api/admin/option-groups?${q}`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;

  const save = async () => {
    const d = draft!;
    const options = [];
    for (const o of d.options.filter((o) => o.name.trim())) {
      const raw = o.price.trim() || '0';
      const negative = raw.startsWith('-') || raw.startsWith('−');
      const cents = parseEuro(raw.replace(/^[-−+]/, ''));
      if (cents === null) {
        setDialogError(`Preis bei "${o.name}" ist keine Zahl.`);
        return;
      }
      options.push({ id: o.id, name: o.name.trim(), priceDeltaCents: negative ? -cents : cents });
    }
    const body = { eventId, name: d.name, multi: d.multi, required: d.required, options };
    try {
      if (d.id) await api.patch(`/api/admin/option-groups/${d.id}`, body);
      else await api.post('/api/admin/option-groups', body);
      setDraft(null);
      await reload();
    } catch (err) {
      setDialogError(errorMessage(err));
    }
  };

  return (
    <div>
      <PageTitle title="Optionen">
        <Button
          onClick={() => {
            setDialogError(null);
            setDraft({ name: '', multi: false, required: false, options: [{ name: '', price: '' }] });
          }}
        >
          Neue Optionsgruppe
        </Button>
      </PageTitle>
      <p className="mb-4 text-sm text-slate-600">
        Optionsgruppen wie „Beilage“ (eine Auswahl, Pflicht) oder „Soße“ (mehrere möglich) werden im Produkt zugeordnet und
        erscheinen auf dem Bon. Aufpreise sind möglich, auch negative (z. B. −0,50 € für Brötchen statt Pommes).
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {data.map((g) => (
          <Card key={g.id}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="flex-1 text-lg font-semibold">{g.name}</h2>
              {g.required && <Badge tone="amber">Pflicht</Badge>}
              <Badge>{g.multi ? 'mehrere' : 'eine'}</Badge>
            </div>
            <ul className="mb-3 space-y-1 text-sm">
              {g.options.map((o) => (
                <li key={o.id} className="flex justify-between">
                  <span>{o.name}</span>
                  {o.priceDeltaCents !== 0 && <span className="tabular-nums text-slate-500">{o.priceDeltaCents > 0 ? '+' : '−'}{formatEuro(Math.abs(o.priceDeltaCents))}</span>}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setDialogError(null);
                  setDraft({
                    id: g.id,
                    name: g.name,
                    multi: g.multi,
                    required: g.required,
                    options: g.options.map((o) => ({
                      id: o.id,
                      name: o.name,
                      price: o.priceDeltaCents ? (o.priceDeltaCents / 100).toFixed(2).replace('.', ',') : '',
                    })),
                  });
                }}
              >
                Bearbeiten
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-700"
                onClick={async () => {
                  if (!confirm(`Optionsgruppe "${g.name}" löschen?`)) return;
                  try {
                    await api.delete(`/api/admin/option-groups/${g.id}`);
                    await reload();
                  } catch (err) {
                    toast({ tone: 'error', text: errorMessage(err) });
                  }
                }}
              >
                Löschen
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {data.length === 0 && <Empty>Noch keine Optionen angelegt.</Empty>}

      <Modal open={draft !== null} onClose={() => setDraft(null)} title={draft?.id ? 'Optionsgruppe bearbeiten' : 'Neue Optionsgruppe'} footer={<Button onClick={save} disabled={!draft?.name.trim()}>Speichern</Button>}>
        {draft && (
          <div className="space-y-4">
            <Field label="Name der Gruppe">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="z. B. Beilage" autoFocus />
            </Field>
            <Toggle checked={draft.required} onChange={(required) => setDraft({ ...draft, required })} label="Pflichtauswahl" description="Bedienung muss etwas auswählen" />
            <Toggle checked={draft.multi} onChange={(multi) => setDraft({ ...draft, multi })} label="Mehrfachauswahl" description="z. B. mehrere Soßen" />
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">Auswahlmöglichkeiten</div>
              <div className="space-y-2">
                {draft.options.map((o, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={o.name}
                      placeholder="Name"
                      onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                    />
                    <Input
                      className="w-28"
                      inputMode="decimal"
                      placeholder="± €"
                      value={o.price}
                      onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })}
                    />
                    <Button variant="ghost" onClick={() => setDraft({ ...draft, options: draft.options.filter((_, j) => j !== i) })} aria-label="entfernen">
                      ×
                    </Button>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => setDraft({ ...draft, options: [...draft.options, { name: '', price: '' }] })}>
                + Auswahl
              </Button>
            </div>
            {dialogError && <ErrorBox>{dialogError}</ErrorBox>}
          </div>
        )}
      </Modal>
    </div>
  );
}
