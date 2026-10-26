import type { EventSummary } from '@bestellsystem/shared';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useSession } from '../../lib/session';
import { PageTitle, useAdminEvent } from './AdminApp';

type Dialog = { mode: 'new' } | { mode: 'edit'; event: EventSummary } | { mode: 'copy'; event: EventSummary } | null;

export function EventsPage() {
  const toast = useToast();
  const { refresh } = useSession();
  const { events, reloadEvents, setEventId } = useAdminEvent();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open = (d: Dialog) => {
    setDialog(d);
    setError(null);
    if (d?.mode === 'edit') {
      setName(d.event.name);
      setDate(d.event.date ?? '');
    } else if (d?.mode === 'copy') {
      setName(`${d.event.name} (Kopie)`);
      setDate('');
    } else {
      setName('');
      setDate('');
    }
  };

  const save = async () => {
    try {
      const body = { name, date: date || null };
      if (dialog?.mode === 'new') {
        const created = await api.post<EventSummary>('/api/admin/events', body);
        setEventId(created.id);
      } else if (dialog?.mode === 'edit') await api.patch(`/api/admin/events/${dialog.event.id}`, body);
      else if (dialog?.mode === 'copy') {
        const created = await api.post<EventSummary>(`/api/admin/events/${dialog.event.id}/copy`, body);
        setEventId(created.id);
      }
      setDialog(null);
      await reloadEvents();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      toast({ tone: 'success', text: success });
      await reloadEvents();
      await refresh();
    } catch (err) {
      toast({ tone: 'error', text: errorMessage(err) });
    }
  };

  return (
    <div>
      <PageTitle title="Veranstaltungen">
        <Button onClick={() => open({ mode: 'new' })}>Neue Veranstaltung</Button>
      </PageTitle>
      <p className="mb-4 text-sm text-slate-600">
        Produkte, Preise, Tische und Stationen gehören zu einer Veranstaltung. Für das nächste Fest einfach kopieren und
        anpassen. Bestellt wird immer in der <strong>aktiven</strong> Veranstaltung.
      </p>
      <div className="space-y-3">
        {events.map((e) => (
          <Card key={e.id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{e.name}</span>
                {e.active && <Badge tone="green">aktiv</Badge>}
              </div>
              <div className="text-sm text-slate-500">{e.date ? new Date(e.date).toLocaleDateString('de-DE') : 'ohne Datum'}</div>
            </div>
            {!e.active && (
              <Button size="sm" variant="success" onClick={() => run(() => api.post(`/api/admin/events/${e.id}/activate`), 'Veranstaltung aktiviert')}>
                Aktivieren
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => open({ mode: 'edit', event: e })}>
              Bearbeiten
            </Button>
            <Button size="sm" variant="secondary" onClick={() => open({ mode: 'copy', event: e })}>
              Kopieren
            </Button>
            {!e.active && (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-700"
                onClick={() =>
                  confirm(`"${e.name}" mit allen Bestellungen endgültig löschen?`) &&
                  run(() => api.delete(`/api/admin/events/${e.id}`), 'Gelöscht')
                }
              >
                Löschen
              </Button>
            )}
          </Card>
        ))}
      </div>

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog?.mode === 'new' ? 'Neue Veranstaltung' : dialog?.mode === 'copy' ? 'Veranstaltung kopieren' : 'Veranstaltung bearbeiten'}
        footer={
          <Button onClick={save} disabled={!name.trim()}>
            Speichern
          </Button>
        }
      >
        <div className="space-y-4">
          {dialog?.mode === 'copy' && (
            <p className="text-sm text-slate-600">Kopiert Gänge, Tische, Kategorien, Produkte, Optionen und Stationen – keine Bestellungen.</p>
          )}
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Datum (optional)">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {error && <ErrorBox>{error}</ErrorBox>}
        </div>
      </Modal>
    </div>
  );
}
