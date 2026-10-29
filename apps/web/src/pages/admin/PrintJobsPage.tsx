import { PRINT_JOB_KIND_LABELS, type PrinterDto, type PrintJobDto } from '@bestellsystem/shared';
import { useState } from 'react';
import { BonPreview } from '../../components/BonPreview';
import { Badge, Button, Empty, ErrorBox, Loading, Select, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { timeOf } from '../../lib/format';
import { useLive } from '../../lib/live';
import { useApiData } from '../../lib/useApi';
import { PageTitle } from './AdminApp';

const STATUS = {
  pending: { label: 'wartet', tone: 'amber' },
  sent: { label: 'wird gedruckt', tone: 'blue' },
  done: { label: 'gedruckt', tone: 'green' },
  cancelled: { label: 'verworfen', tone: 'slate' },
} as const;

/** Wie lange ein Auftrag bis zum Drucker gebraucht hat – macht Verzögerungen sichtbar. */
function Delay({ from, to }: { from: string; to: string }) {
  const seconds = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
  const text = seconds < 1 ? 'sofort' : `nach ${seconds < 10 ? seconds.toFixed(1).replace('.', ',') : Math.round(seconds)} s`;
  return <Badge tone={seconds >= 5 ? 'amber' : 'slate'}>{text}</Badge>;
}

export function PrintJobsPage() {
  const toast = useToast();
  const [printerId, setPrinterId] = useState('');
  const [status, setStatus] = useState<'all' | 'open'>('all');
  const printers = useApiData<PrinterDto[]>('/api/admin/printers');
  const jobs = useApiData<PrintJobDto[]>(`/api/admin/print-jobs?limit=60&status=${status}${printerId ? `&printerId=${printerId}` : ''}`);
  useLive(
    (msg) => {
      if (msg.type === 'printjob' || msg.type === 'ticket' || msg.type === 'order') void jobs.reload();
    },
    () => void jobs.reload(),
  );

  const act = async (job: PrintJobDto, action: 'retry' | 'cancel') => {
    try {
      await api.post(`/api/admin/print-jobs/${job.id}/${action}`);
      toast({ tone: 'success', text: action === 'retry' ? 'Wird erneut gedruckt' : 'Verworfen' });
      await jobs.reload();
    } catch (err) {
      toast({ tone: 'error', text: errorMessage(err) });
    }
  };

  return (
    <div>
      <PageTitle title="Druckaufträge">
        <Select value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'open')} className="w-44">
          <option value="all">alle</option>
          <option value="open">nur wartende</option>
        </Select>
        <Select value={printerId} onChange={(e) => setPrinterId(e.target.value)} className="w-48">
          <option value="">alle Drucker</option>
          {printers.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </PageTitle>
      <p className="mb-4 text-sm text-slate-600">
        Hier sieht man jeden Bon genau so, wie er gedruckt wird – bei Simulator-Druckern ist das der „Ausdruck“.
      </p>
      {jobs.error && <ErrorBox>{jobs.error}</ErrorBox>}
      {!jobs.data ? (
        <Loading />
      ) : jobs.data.length === 0 ? (
        <Empty>Keine Druckaufträge.</Empty>
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          {jobs.data.map((job) => (
            <div key={job.id} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{job.printerName}</span>
                <Badge>{PRINT_JOB_KIND_LABELS[job.kind]}</Badge>
                <Badge tone={STATUS[job.status].tone}>{STATUS[job.status].label}</Badge>
                <span className="text-slate-500">{timeOf(job.createdAt)}</span>
                {job.printedAt && <Delay from={job.createdAt} to={job.printedAt} />}
              </div>
              {job.lastError && job.status !== 'done' && (
                <div className="max-w-xs text-xs font-medium text-red-700">
                  {job.attempts} Fehlversuche: {job.lastError}
                </div>
              )}
              <BonPreview doc={job.doc} widthChars={job.widthChars} codepage={job.codepage} />
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => act(job, 'retry')}>
                  {job.status === 'done' || job.status === 'cancelled' ? 'Nachdrucken' : 'Jetzt versuchen'}
                </Button>
                {(job.status === 'pending' || job.status === 'sent') && (
                  <Button size="sm" variant="ghost" className="text-red-700" onClick={() => act(job, 'cancel')}>
                    Verwerfen
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
