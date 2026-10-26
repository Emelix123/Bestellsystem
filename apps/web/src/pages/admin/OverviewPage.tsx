import type { AgentDto, PrinterDto } from '@bestellsystem/shared';
import { Link } from 'react-router';
import { Badge, Card, ErrorBox, Loading } from '../../components/ui';
import { useLive } from '../../lib/live';
import { useApiData } from '../../lib/useApi';
import { PageTitle } from './AdminApp';

interface Overview {
  tenantName: string;
  event: { id: number; name: string } | null;
  printers: PrinterDto[];
  agents: AgentDto[];
  stations: { id: number; name: string; open: number; accepted: number; problem: string | null }[];
  orders: { orders: number; lastHour: number };
  warnings: string[];
}

export function printerTone(status: PrinterDto['status']) {
  return status === 'ok' ? 'green' : status === 'unknown' ? 'slate' : 'red';
}

export const PRINTER_STATUS_LABEL: Record<PrinterDto['status'], string> = {
  ok: 'bereit',
  error: 'Fehler',
  offline: 'offline',
  unknown: 'unbekannt',
};

export function OverviewPage() {
  const { data, error, reload } = useApiData<Overview>('/api/admin/overview');
  useLive(
    (msg) => {
      if (['printer', 'agent', 'ticket', 'catalog'].includes(msg.type)) void reload();
    },
    () => void reload(),
  );
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-6">
      <PageTitle title={data.event ? data.event.name : 'Übersicht'} />
      {data.warnings.length > 0 && (
        <div className="space-y-2">
          {data.warnings.map((w) => (
            <div key={w} className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
              {w}
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <div className="text-sm text-slate-500">Bestellungen gesamt</div>
          <div className="text-4xl font-bold tabular-nums">{data.orders.orders}</div>
        </Card>
        <Card>
          <div className="text-sm text-slate-500">in der letzten Stunde</div>
          <div className="text-4xl font-bold tabular-nums">{data.orders.lastHour}</div>
        </Card>
        <Card>
          <div className="text-sm text-slate-500">Druckaufträge wartend</div>
          <div className="text-4xl font-bold tabular-nums">{data.printers.reduce((s, p) => s + p.pendingJobs, 0)}</div>
        </Card>
      </div>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Stationen</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.stations.map((s) => (
            <Card key={s.id}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{s.name}</span>
                {s.problem && <Badge tone="amber">Hinweis</Badge>}
              </div>
              <div className="mt-1 text-sm text-slate-600">
                {s.open} offen · {s.accepted} in Arbeit
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Drucker</h2>
          <Link to="/admin/drucker" className="text-sm font-medium text-sky-700">
            verwalten →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.printers.map((p) => (
            <Card key={p.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{p.name}</span>
                <Badge tone={printerTone(p.status)}>{PRINTER_STATUS_LABEL[p.status]}</Badge>
              </div>
              {p.statusMessage && <div className="mt-1 text-sm text-red-700">{p.statusMessage}</div>}
              <div className="mt-1 text-xs text-slate-500">{p.pendingJobs} Aufträge wartend</div>
            </Card>
          ))}
          {data.printers.length === 0 && <p className="text-sm text-slate-500">Noch keine Drucker angelegt.</p>}
        </div>
      </section>
    </div>
  );
}
