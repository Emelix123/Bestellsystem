import {
  CODEPAGE_LABELS,
  CODEPAGES,
  PRINTER_TYPE_LABELS,
  type AgentDto,
  type Codepage,
  type PrinterDto,
  type PrinterType,
} from '@bestellsystem/shared';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Toggle, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useApiData } from '../../lib/useApi';
import { PageTitle } from './AdminApp';
import { PRINTER_STATUS_LABEL, printerTone } from './OverviewPage';

interface Draft {
  id?: number;
  name: string;
  type: PrinterType;
  agentId: number | null;
  deviceKey: string | null;
  host: string;
  port: number;
  widthChars: number;
  codepage: Codepage;
  cut: boolean;
}

const WIDTHS = [
  { value: 32, label: '58 mm (32 Zeichen)' },
  { value: 42, label: '80 mm, kleine Schrift (42 Zeichen)' },
  { value: 48, label: '80 mm (48 Zeichen)' },
];

export function PrintersPage() {
  const toast = useToast();
  const printers = useApiData<PrinterDto[]>('/api/admin/printers');
  const agents = useApiData<AgentDto[]>('/api/admin/agents');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [redirect, setRedirect] = useState<{ from: PrinterDto; to: number | null; switchStations: boolean } | null>(null);
  const [token, setToken] = useState<{ name: string; token: string } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  useLive(
    (msg) => {
      if (msg.type === 'printer' || msg.type === 'printjob') void printers.reload();
      if (msg.type === 'agent') {
        void agents.reload();
        void printers.reload();
      }
    },
    () => {
      void printers.reload();
      void agents.reload();
    },
  );

  if (printers.error || agents.error) return <ErrorBox>{printers.error ?? agents.error}</ErrorBox>;
  if (!printers.data || !agents.data) return <Loading />;

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) toast({ tone: 'success', text: success });
      await Promise.all([printers.reload(), agents.reload()]);
      return true;
    } catch (err) {
      setDialogError(errorMessage(err));
      toast({ tone: 'error', text: errorMessage(err) });
      return false;
    }
  };

  const save = async () => {
    const { id, ...d } = draft!;
    const body = {
      ...d,
      agentId: d.type === 'usb' ? d.agentId : null,
      deviceKey: d.type === 'usb' ? d.deviceKey : null,
      host: d.type === 'network' ? d.host : null,
    };
    if (await run(() => (id ? api.patch(`/api/admin/printers/${id}`, body) : api.post('/api/admin/printers', body)))) setDraft(null);
  };

  const agentFor = (id: number | null) => agents.data!.find((a) => a.id === id);
  const origin = window.location.origin;

  return (
    <div className="space-y-8">
      <section>
        <PageTitle title="Drucker">
          <Button
            onClick={() => {
              setDialogError(null);
              setDraft({
                name: '',
                type: agents.data!.length ? 'usb' : 'simulator',
                agentId: agents.data![0]?.id ?? null,
                deviceKey: null,
                host: '',
                port: 9100,
                widthChars: 48,
                codepage: 'cp858',
                cut: true,
              });
            }}
          >
            Neuer Drucker
          </Button>
        </PageTitle>
        <div className="space-y-3">
          {printers.data.map((p) => (
            <Card key={p.id} className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold">{p.name}</span>
                  <Badge tone={printerTone(p.status)}>{PRINTER_STATUS_LABEL[p.status]}</Badge>
                  {p.pendingJobs > 0 && <Badge tone="amber">{p.pendingJobs} wartend</Badge>}
                </div>
                <div className="text-sm text-slate-600">
                  {p.type === 'usb' && `Druck-Agent „${agentFor(p.agentId)?.name ?? '–'}“`}
                  {p.type === 'network' && `Netzwerk ${p.host}:${p.port}`}
                  {p.type === 'simulator' && 'Simulator'} · {p.widthChars} Zeichen
                </div>
                {p.statusMessage && <div className="text-sm font-medium text-red-700">{p.statusMessage}</div>}
              </div>
              <Button size="sm" variant="secondary" onClick={() => run(() => api.post(`/api/admin/printers/${p.id}/test`), 'Testdruck gesendet')}>
                Testdruck
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setRedirect({ from: p, to: null, switchStations: true })}>
                Umleiten
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setDialogError(null);
                  setDraft({ ...p, host: p.host ?? '' });
                }}
              >
                Bearbeiten
              </Button>
            </Card>
          ))}
          {printers.data.length === 0 && (
            <Empty>Noch keine Drucker. Zum Ausprobieren ohne Hardware einen „Simulator“-Drucker anlegen.</Empty>
          )}
        </div>
      </section>

      <section>
        <PageTitle title="Druck-Agenten">
          <Button
            variant="secondary"
            onClick={async () => {
              const name = prompt('Name des Agenten (z. B. "Raspi Küche")');
              if (!name) return;
              await run(async () => setToken(await api.post('/api/admin/agents', { name })));
            }}
          >
            Neuer Druck-Agent
          </Button>
        </PageTitle>
        <p className="mb-4 text-sm text-slate-600">
          Jeder Rechner, an dem direkt ein Drucker hängt – Raspberry Pi, Linux-PC oder Windows-PC – bekommt einen eigenen
          Druck-Agenten. Die Rechner können an verschiedenen Stellen stehen (Küche, Schank, Bierstand), sie müssen nur im
          selben Netz sein. Ein Agent kann mehrere Drucker bedienen.
        </p>
        <div className="space-y-3">
          {agents.data.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold">{a.name}</span>
                    <Badge tone={a.connected ? 'green' : 'red'}>{a.connected ? 'verbunden' : 'nicht verbunden'}</Badge>
                    {a.platform && <Badge>{a.platform}</Badge>}
                  </div>
                  <div className="text-sm text-slate-600">
                    {a.hostname ? `Rechner: ${a.hostname}` : 'hat sich noch nie verbunden'}
                    {a.version && ` · Version ${a.version}`}
                    {a.lastSeenAt && !a.connected && ` · zuletzt ${new Date(a.lastSeenAt).toLocaleString('de-DE')}`}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    confirm('Neuen Token erzeugen? Der alte funktioniert dann nicht mehr.') &&
                    run(async () => setToken(await api.post(`/api/admin/agents/${a.id}/token`)))
                  }
                >
                  Neuer Token
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-700"
                  onClick={() => confirm(`Agent "${a.name}" löschen?`) && run(() => api.delete(`/api/admin/agents/${a.id}`))}
                >
                  Löschen
                </Button>
              </div>
              {a.devices.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  {a.devices.map((d) => (
                    <li key={d.key}>
                      🖨 {d.description}
                      {d.problem && <span className="ml-2 font-medium text-red-700">– {d.problem}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
          {agents.data.length === 0 && <Empty>Noch kein Druck-Agent eingerichtet.</Empty>}
        </div>
      </section>

      <Modal open={token !== null} onClose={() => setToken(null)} title={`Agent „${token?.name}“ einrichten`} wide>
        {token && (
          <div className="space-y-4 text-sm">
            <p>
              Der Token wird <strong>nur jetzt</strong> angezeigt. Den passenden Befehl auf dem Rechner ausführen, an dem
              der Drucker hängt. Er installiert den Agenten als Dienst, der beim Hochfahren automatisch startet.
            </p>
            <div>
              <div className="mb-1 font-semibold">Raspberry Pi / Linux (Terminal)</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-4 text-xs text-emerald-300">
                {`curl -fsSL ${origin}/downloads/install-agent.sh | sudo bash -s -- '${origin}' '${token.token}'`}
              </pre>
            </div>
            <div>
              <div className="mb-1 font-semibold">Windows 10/11 (PowerShell „Als Administrator ausführen“)</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-4 text-xs text-emerald-300">
                {`iwr -UseBasicParsing ${origin}/downloads/install-agent.ps1 -OutFile $env:TEMP\\install-agent.ps1; if ($?) { powershell -ExecutionPolicy Bypass -File $env:TEMP\\install-agent.ps1 -ServerUrl '${origin}' -Token '${token.token}' }`}
              </pre>
              <p className="mt-1 text-xs text-slate-600">
                Unter Windows muss der Drucker vorher installiert sein (Einstellungen → Bluetooth und Geräte → Drucker), mit
                Herstellertreiber oder „Generic / Text Only“.
              </p>
            </div>
            <p className="text-slate-600">
              Danach erscheint der Agent hier als verbunden, mit seinen Druckern. Beim Drucker dann Agent und Gerät
              auswählen und einen Testdruck machen. Weitere Varianten (Docker) stehen in <code>docs/BETRIEB.md</code>.
            </p>
            <Field label="Token">
              <Input readOnly value={token.token} onFocus={(e) => e.target.select()} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={redirect !== null}
        onClose={() => setRedirect(null)}
        title={`„${redirect?.from.name}“ umleiten`}
        footer={
          <Button
            disabled={!redirect?.to}
            onClick={async () => {
              const r = redirect!;
              const ok = await run(async () => {
                const res = await api.post<{ moved: number; switchedStations: number }>(`/api/admin/printers/${r.from.id}/redirect`, {
                  targetPrinterId: r.to,
                  switchStations: r.switchStations,
                });
                toast({ tone: 'success', text: `${res.moved} Aufträge umgeleitet, ${res.switchedStations} Stationen umgestellt` });
              });
              if (ok) setRedirect(null);
            }}
          >
            Umleiten
          </Button>
        }
      >
        {redirect && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Für den Notfall: Drucker defekt oder Papier alle. Wartende Bons gehen an den anderen Drucker.</p>
            <Field label="Ziel-Drucker">
              <Select value={redirect.to ?? ''} onChange={(e) => setRedirect({ ...redirect, to: Number(e.target.value) || null })}>
                <option value="">– wählen –</option>
                {printers.data
                  .filter((p) => p.id !== redirect.from.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Toggle
              checked={redirect.switchStations}
              onChange={(switchStations) => setRedirect({ ...redirect, switchStations })}
              label="Auch künftige Bons umleiten"
              description="Stationen, die diesen Drucker nutzen, auf den Ziel-Drucker umstellen."
            />
          </div>
        )}
      </Modal>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Drucker bearbeiten' : 'Neuer Drucker'}
        footer={
          <>
            {draft?.id && (
              <Button
                variant="ghost"
                className="text-red-700"
                onClick={async () => {
                  if (confirm('Drucker löschen? Wartende Aufträge werden verworfen.') && (await run(() => api.delete(`/api/admin/printers/${draft.id}`))))
                    setDraft(null);
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
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="z. B. Bierstand" autoFocus />
            </Field>
            <Field label="Anschluss">
              <Select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as PrinterType })}>
                {(['usb', 'network', 'simulator'] as const).map((t) => (
                  <option key={t} value={t}>
                    {PRINTER_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            {draft.type === 'usb' && (
              <>
                <Field label="Druck-Agent">
                  <Select
                    value={draft.agentId ?? ''}
                    onChange={(e) => setDraft({ ...draft, agentId: e.target.value ? Number(e.target.value) : null, deviceKey: null })}
                  >
                    <option value="">– wählen –</option>
                    {agents.data!.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} {a.connected ? '' : '(nicht verbunden)'}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Drucker am Agent"
                  hint="Linux: Die Kennung bleibt beim Umstecken gleich, sofern der Drucker eine Seriennummer hat. Windows: Drucker werden über ihren Namen in Windows zugeordnet."
                >
                  <Select value={draft.deviceKey ?? ''} onChange={(e) => setDraft({ ...draft, deviceKey: e.target.value || null })}>
                    <option value="">– wählen –</option>
                    {(agentFor(draft.agentId)?.devices ?? []).map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.description}
                      </option>
                    ))}
                    {draft.deviceKey && !agentFor(draft.agentId)?.devices.some((d) => d.key === draft.deviceKey) && (
                      <option value={draft.deviceKey}>{draft.deviceKey} (derzeit nicht gefunden)</option>
                    )}
                  </Select>
                </Field>
              </>
            )}
            {draft.type === 'network' && (
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label="IP-Adresse">
                    <Input value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} placeholder="192.168.1.50" />
                  </Field>
                </div>
                <Field label="Port">
                  <Input inputMode="numeric" value={draft.port} onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) || 9100 })} />
                </Field>
              </div>
            )}
            <Field label="Papierbreite">
              <Select value={draft.widthChars} onChange={(e) => setDraft({ ...draft, widthChars: Number(e.target.value) })}>
                {WIDTHS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
                {!WIDTHS.some((w) => w.value === draft.widthChars) && <option value={draft.widthChars}>{draft.widthChars} Zeichen</option>}
              </Select>
            </Field>
            <Field label="Zeichensatz" hint="Wenn Umlaute falsch gedruckt werden, PC437 oder „Nur ASCII“ probieren (Testdruck).">
              <Select value={draft.codepage} onChange={(e) => setDraft({ ...draft, codepage: e.target.value as Codepage })}>
                {CODEPAGES.map((c) => (
                  <option key={c} value={c}>
                    {CODEPAGE_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Toggle checked={draft.cut} onChange={(cut) => setDraft({ ...draft, cut })} label="Papier abschneiden" description="Nur bei Druckern mit Schneidwerk." />
            {dialogError && <ErrorBox>{dialogError}</ErrorBox>}
          </div>
        )}
      </Modal>
    </div>
  );
}
