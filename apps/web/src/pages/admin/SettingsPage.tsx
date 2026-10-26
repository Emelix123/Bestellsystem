import type { PrinterDto, TenantSettings } from '@bestellsystem/shared';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorBox, Field, Input, Loading, Select, Toggle, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useApiData } from '../../lib/useApi';
import { PageTitle } from './AdminApp';

export function SettingsPage() {
  const toast = useToast();
  const { refresh, me } = useSession();
  const { data, error } = useApiData<{ name: string; slug: string; settings: TenantSettings }>('/api/admin/settings');
  const printers = useApiData<PrinterDto[]>('/api/admin/printers');
  const [name, setName] = useState('');
  const [s, setS] = useState<TenantSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setName(data.name);
      setS(data.settings);
    }
  }, [data]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!s || !printers.data) return <Loading />;
  const set = <K extends keyof TenantSettings>(key: K, value: TenantSettings[K]) => setS({ ...s, [key]: value });

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/admin/settings', { name, settings: s });
      await refresh();
      toast({ tone: 'success', text: 'Gespeichert' });
    } catch (err) {
      toast({ tone: 'error', text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <PageTitle title="Einstellungen">
        <Button onClick={save} disabled={saving}>
          Speichern
        </Button>
      </PageTitle>

      <Card className="space-y-3">
        <h2 className="font-semibold">Verein</h2>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <p className="text-xs text-slate-500">
          Kürzel für Anmeldung und Abholmonitor: <code>{data?.slug}</code> – Abholmonitor:{' '}
          <code>
            {window.location.origin}/abholung/{me?.tenant?.slug}
          </code>
        </p>
      </Card>

      <Card className="divide-y divide-slate-100">
        <h2 className="pb-2 font-semibold">Bedienung</h2>
        <Toggle checked={s.showPrices} onChange={(v) => set('showPrices', v)} label="Preise anzeigen" description="Preise und Summen in der Bedien- und To-Go-Oberfläche." />
        <Toggle
          checked={s.billingHelper}
          onChange={(v) => set('billingHelper', v)}
          label="Rechnungshilfe"
          description="Rechner für Summe, getrennt zahlen, Pfand und Rückgeld. Speichert nichts und erfasst keine Zahlungen."
        />
        <Toggle checked={s.deposit} onChange={(v) => set('deposit', v)} label="Pfand" description="Pfandbetrag pro Produkt und Pfand-Rückgabe in der Rechnungshilfe." />
        <Toggle checked={s.waiterCanCancel} onChange={(v) => set('waiterCanCancel', v)} label="Bedienung darf eigene Bestellungen stornieren" />
        {s.waiterCanCancel && (
          <div className="py-2">
            <Field label="Zeitfenster für Storno durch die Bedienung (Minuten)">
              <Input type="number" min={1} max={600} value={s.waiterCancelMinutes} onChange={(e) => set('waiterCancelMinutes', Number(e.target.value) || 5)} />
            </Field>
          </div>
        )}
      </Card>

      <Card className="divide-y divide-slate-100">
        <h2 className="pb-2 font-semibold">To-Go</h2>
        <Toggle checked={s.togo} onChange={(v) => set('togo', v)} label="To-Go aktiv" description="Bestellungen zum Mitnehmen mit Abholnummer und Abholmonitor." />
        {s.togo && (
          <div className="space-y-3 py-3">
            <Field label="Drucker für den Abholbon (Zettel für den Gast)">
              <Select value={s.pickupPrinterId ?? ''} onChange={(e) => set('pickupPrinterId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">– kein Abholbon –</option>
                {printers.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Kopfzeile auf dem Abholbon">
              <Input value={s.pickupBonHeader} onChange={(e) => set('pickupBonHeader', e.target.value)} placeholder="z. B. Sommerfest TSV" />
            </Field>
            <Field label="Fußzeile auf dem Abholbon">
              <Input value={s.pickupBonFooter} onChange={(e) => set('pickupBonFooter', e.target.value)} />
            </Field>
            <Field label="Fertige Nummern so lange am Monitor zeigen (Minuten)">
              <Input type="number" min={1} max={120} value={s.pickupDisplayMinutes} onChange={(e) => set('pickupDisplayMinutes', Number(e.target.value) || 10)} />
            </Field>
          </div>
        )}
      </Card>

      <Card className="divide-y divide-slate-100">
        <h2 className="pb-2 font-semibold">Statistik</h2>
        <Toggle
          checked={s.statsShowValues}
          onChange={(v) => set('statsShowValues', v)}
          label="Werte in Euro anzeigen und exportieren"
          description="Ohne diese Einstellung zeigt die Statistik nur Stückzahlen."
        />
      </Card>

      <Button onClick={save} disabled={saving} size="lg">
        Speichern
      </Button>
    </div>
  );
}
