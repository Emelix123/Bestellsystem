import { ErrorBox, Loading } from '../../components/ui';
import { useApiData } from '../../lib/useApi';
import { PageTitle } from './AdminApp';

interface Entry {
  id: number;
  userName: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

const ACTIONS: Record<string, string> = {
  'order.cancel': 'Storno',
  'event.create': 'Veranstaltung angelegt',
  'event.activate': 'Veranstaltung aktiviert',
  'event.copy': 'Veranstaltung kopiert',
  'event.delete': 'Veranstaltung gelöscht',
  'station.update': 'Station geändert',
  'printer.delete': 'Drucker gelöscht',
  'printer.redirect': 'Drucker umgeleitet',
  'printjob.cancel': 'Druckauftrag verworfen',
  'printjob.cancel-all': 'Druckaufträge verworfen',
  'agent.create': 'Druck-Agent angelegt',
  'agent.token': 'Agent-Token erneuert',
  'agent.delete': 'Druck-Agent gelöscht',
  'user.create': 'Benutzer angelegt',
  'user.update': 'Benutzer geändert',
  'user.delete': 'Benutzer gelöscht',
  'settings.update': 'Einstellungen geändert',
};

function describe(e: Entry) {
  if (e.action === 'order.cancel') {
    const items = (e.details.items as { name: string; qty: number }[] | undefined) ?? [];
    return `Bestellung #${e.details.orderNumber}: ${items.map((i) => `${i.qty}× ${i.name}`).join(', ')}${e.details.reason ? ` – ${e.details.reason}` : ''}`;
  }
  const { id: _id, ...rest } = e.details;
  const text = Object.entries(rest)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
  return text;
}

export function AuditPage() {
  const { data, error } = useApiData<Entry[]>('/api/admin/audit?limit=300');
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;
  return (
    <div>
      <PageTitle title="Protokoll" />
      <p className="mb-4 text-sm text-slate-600">Stornos und Änderungen an Einstellungen werden hier nachvollziehbar festgehalten.</p>
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Zeit</th>
              <th className="px-4 py-2">Wer</th>
              <th className="px-4 py-2">Was</th>
              <th className="px-4 py-2">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-4 py-2 tabular-nums">{new Date(e.createdAt).toLocaleString('de-DE')}</td>
                <td className="px-4 py-2">{e.userName}</td>
                <td className="px-4 py-2 font-medium">{ACTIONS[e.action] ?? e.action}</td>
                <td className="px-4 py-2 text-slate-600">{describe(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
