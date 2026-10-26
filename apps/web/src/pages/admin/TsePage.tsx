import type { TenantSettings } from '@bestellsystem/shared';
import { marked } from 'marked';
import { useMemo } from 'react';
import doc from '../../../../../docs/TSE-ABGRENZUNG.md?raw';
import { Button, Card, ErrorBox, Loading } from '../../components/ui';
import { cn } from '../../lib/format';
import { useApiData } from '../../lib/useApi';

type Level = 'ok' | 'warn' | 'info';

interface Check {
  level: Level;
  title: string;
  text: string;
}

/** Bewertet die aktuellen Einstellungen des Vereins gegen die Bedingungen der Abgrenzung. */
function checks(s: TenantSettings): Check[] {
  const list: Check[] = [
    {
      level: 'ok',
      title: 'Keine Zahlungserfassung',
      text: 'Das System kennt keine Zahlungen, keinen Kassenbestand, keinen Tagesabschluss und keine Kundenbelege. Die Funktionen sind nicht abschaltbar, weil sie nicht existieren.',
    },
    {
      level: 'ok',
      title: 'Keine Anbindung an eine Kasse',
      text: 'Es gibt keine Schnittstelle zu elektronischen Kassensystemen.',
    },
    {
      level: 'ok',
      title: 'Bons ohne Beträge',
      text: 'Küchen-, Theken- und Abholbons enthalten weder Preise noch Summen.',
    },
  ];
  list.push(
    s.billingHelper
      ? {
          level: 'warn',
          title: 'Rechnungshilfe ist eingeschaltet',
          text: 'Grauzone (Abschnitt 5.1): Betrag und Rückgeld werden angezeigt, aber nichts gespeichert. Für die sicherste Konfiguration unter Einstellungen ausschalten.',
        }
      : { level: 'ok', title: 'Rechnungshilfe ausgeschaltet', text: 'Sicherste Konfiguration.' },
  );
  if (s.togo) {
    list.push({
      level: s.billingHelper || s.showPrices ? 'warn' : 'info',
      title: 'To-Go ist aktiv',
      text: 'Bargeld an der To-Go-Ausgabe in einer separaten offenen Ladenkasse mit Kassenbericht führen, besser: vorab Wertmarken (Abschnitt 5.2).',
    });
  }
  if (s.showPrices) {
    list.push({ level: 'info', title: 'Preise werden angezeigt', text: 'Wie eine Speisekarte; aus unserer Sicht unkritisch (Abschnitt 5.3).' });
  }
  if (s.statsShowValues) {
    list.push({ level: 'info', title: 'Statistik in Euro', text: 'Auswertung von Bestellwerten, keine Zahlungen (Abschnitt 5.3).' });
  }
  return list;
}

const LEVEL: Record<Level, { icon: string; className: string }> = {
  ok: { icon: '✓', className: 'bg-emerald-50 text-emerald-900 ring-emerald-200' },
  warn: { icon: '!', className: 'bg-amber-50 text-amber-900 ring-amber-200' },
  info: { icon: 'i', className: 'bg-slate-50 text-slate-800 ring-slate-200' },
};

export function TsePage() {
  const { data, error } = useApiData<{ name: string; settings: TenantSettings }>('/api/admin/settings');
  const html = useMemo(
    () => (marked.parse(doc, { async: false }) as string).replace(/<a href=/g, '<a target="_blank" rel="noreferrer" href='),
    [],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-bold">TSE-Abgrenzung</h1>
        <Button variant="secondary" onClick={() => window.print()}>
          Drucken / als PDF speichern
        </Button>
      </div>

      <Card className="print:shadow-none">
        <h2 className="text-lg font-semibold">Aktuelle Konfiguration{data ? ` – ${data.name}` : ''}</h2>
        <p className="mb-3 text-sm text-slate-500">Geprüft am {new Date().toLocaleString('de-DE')}</p>
        {error && <ErrorBox>{error}</ErrorBox>}
        {!data && !error && <Loading />}
        {data && (
          <ul className="space-y-2">
            {checks(data.settings).map((c) => (
              <li key={c.title} className={cn('flex gap-3 rounded-xl p-3 ring-1', LEVEL[c.level].className)}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold ring-1 ring-current">
                  {LEVEL[c.level].icon}
                </span>
                <span>
                  <span className="block font-semibold">{c.title}</span>
                  <span className="block text-sm">{c.text}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="print:shadow-none print:ring-0">
        <article className="doc-prose" dangerouslySetInnerHTML={{ __html: html }} />
      </Card>
    </div>
  );
}
