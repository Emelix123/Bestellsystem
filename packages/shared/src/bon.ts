import { normalizeText } from './codepage';
import { CODEPAGES, type Codepage } from './types';

/**
 * Ein Bon wird als einfaches Dokument beschrieben und erst kurz vor dem Druck
 * in ESC/POS übersetzt. Dieselbe Beschreibung erzeugt auch die Vorschau im
 * Browser (Druck-Simulator), damit Vorschau und Papier identisch aussehen.
 */
export type BonSize = 1 | 2 | 3;
export type BonAlign = 'left' | 'center' | 'right';

export type BonLine =
  | { t: 'text'; text: string; align?: BonAlign; bold?: boolean; size?: BonSize; invert?: boolean }
  | { t: 'cols'; left: string; right: string; bold?: boolean; size?: BonSize }
  | { t: 'sep'; char?: string }
  | { t: 'feed'; n?: number }
  /** Zeichensatz für die folgenden Zeilen wechseln (nur für den Zeichensatz-Test). */
  | { t: 'codepage'; codepage: Codepage };

export interface BonDoc {
  lines: BonLine[];
}

export interface BonProfile {
  /** Zeichen pro Zeile in Normalschrift (58 mm ≈ 32, 80 mm ≈ 48). */
  widthChars: number;
  codepage: Codepage;
}

/** Eine fertig umbrochene Druckzeile. */
export interface LaidOutLine {
  /** Leerzeichen vor dem Text (Ausrichtung, wird nie invertiert). */
  indent: number;
  text: string;
  size: BonSize;
  bold: boolean;
  invert: boolean;
  /** Zeichensatz, in dem diese Zeile gedruckt wird. */
  codepage: Codepage;
}

function wrap(text: string, width: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/ +/).filter((w) => w.length > 0);
    if (words.length === 0) {
      result.push('');
      continue;
    }
    let line = '';
    for (let word of words) {
      while (word.length > width) {
        if (line) {
          result.push(line);
          line = '';
        }
        result.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (!word) continue;
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ' ' + word;
      else {
        result.push(line);
        line = word;
      }
    }
    if (line) result.push(line);
  }
  return result;
}

function indentFor(text: string, width: number, how: BonAlign): number {
  const free = Math.max(0, width - text.length);
  if (how === 'right') return free;
  if (how === 'center') return Math.floor(free / 2);
  return 0;
}

/**
 * Bricht das Dokument für eine bestimmte Papierbreite um. Ausrichtung wird mit
 * Leerzeichen gemacht statt mit Druckerbefehlen – das funktioniert auf allen
 * Druckern gleich, auch bei günstigen Nachbauten.
 */
export function layoutBon(doc: BonDoc, profile: BonProfile): LaidOutLine[] {
  const out: LaidOutLine[] = [];
  let codepage = profile.codepage;
  for (const line of doc.lines) {
    switch (line.t) {
      case 'codepage':
        codepage = line.codepage;
        break;
      case 'text': {
        const size = line.size ?? 1;
        const width = Math.max(1, Math.floor(profile.widthChars / size));
        const text = normalizeText(line.text, codepage);
        for (const part of wrap(text, width)) {
          out.push({
            indent: indentFor(part, width, line.align ?? 'left'),
            text: part,
            size,
            bold: !!line.bold,
            invert: !!line.invert,
            codepage,
          });
        }
        break;
      }
      case 'cols': {
        const size = line.size ?? 1;
        const width = Math.max(1, Math.floor(profile.widthChars / size));
        const left = normalizeText(line.left, codepage);
        const right = normalizeText(line.right, codepage);
        const leftLines = wrap(left, right ? Math.max(1, width - right.length - 1) : width);
        leftLines.forEach((l, i) => {
          const isLast = i === leftLines.length - 1;
          const text = isLast && right ? l + ' '.repeat(Math.max(1, width - l.length - right.length)) + right : l;
          out.push({ indent: 0, text, size, bold: !!line.bold, invert: false, codepage });
        });
        break;
      }
      case 'sep':
        out.push({ indent: 0, text: (line.char ?? '-').repeat(profile.widthChars), size: 1, bold: false, invert: false, codepage });
        break;
      case 'feed':
        for (let i = 0; i < (line.n ?? 1); i++) out.push({ indent: 0, text: '', size: 1, bold: false, invert: false, codepage });
        break;
    }
  }
  return out;
}

/** Reine Textdarstellung, z. B. für Logs und Tests. */
export function bonToPlainText(doc: BonDoc, profile: BonProfile): string {
  return layoutBon(doc, profile)
    .map((l) => (' '.repeat(l.indent) + l.text).trimEnd())
    .join('\n');
}

// ---------------------------------------------------------------------------
// Bausteine für konkrete Bons
// ---------------------------------------------------------------------------

export type BonLocation =
  | { kind: 'table'; areaName: string; tableLabel: string }
  | { kind: 'togo'; pickupNumber: number };

export interface BonItem {
  qty: number;
  name: string;
  options: string[];
  note?: string | null;
}

export interface TicketBonInput {
  stationName: string;
  location: BonLocation;
  orderNumber: number;
  waiterName: string;
  time: string;
  items: BonItem[];
  orderNote?: string | null;
  /** z. B. "NACHDRUCK" oder "STORNO" – wird invers hervorgehoben. */
  banner?: string;
  /** z. B. "1/3" bei "ein Bon pro Stück". */
  part?: string;
}

export function locationLabel(location: BonLocation): string {
  return location.kind === 'table'
    ? `${location.areaName} · Tisch ${location.tableLabel}`
    : `Abholnr. ${location.pickupNumber}`;
}

export function buildTicketBon(input: TicketBonInput): BonDoc {
  const lines: BonLine[] = [];
  if (input.banner) {
    lines.push({ t: 'text', text: ` ${input.banner} `, align: 'center', size: 2, bold: true, invert: true });
  }
  lines.push({ t: 'text', text: input.stationName.toUpperCase(), align: 'center', size: 2, bold: true });
  if (input.location.kind === 'table') {
    lines.push({ t: 'text', text: input.location.areaName, align: 'center', size: 2 });
    lines.push({ t: 'text', text: `Tisch ${input.location.tableLabel}`, align: 'center', size: 3, bold: true });
  } else {
    lines.push({ t: 'text', text: 'TO-GO', align: 'center', size: 2 });
    lines.push({ t: 'text', text: `Nr. ${input.location.pickupNumber}`, align: 'center', size: 3, bold: true });
  }
  lines.push({ t: 'cols', left: input.waiterName, right: input.time });
  lines.push({ t: 'cols', left: `Bestellung #${input.orderNumber}`, right: input.part ?? '' });
  lines.push({ t: 'sep' });
  for (const item of input.items) {
    lines.push({ t: 'text', text: `${item.qty}x ${item.name}`, size: 2, bold: true });
    for (const opt of item.options) lines.push({ t: 'text', text: `   + ${opt}`, bold: true });
    if (item.note) lines.push({ t: 'text', text: ` ! ${item.note} `, bold: true, invert: true });
  }
  if (input.orderNote) {
    lines.push({ t: 'sep' });
    lines.push({ t: 'text', text: `Notiz: ${input.orderNote}`, bold: true });
  }
  lines.push({ t: 'sep' });
  return { lines };
}

export interface PickupBonInput {
  header: string;
  pickupNumber: number;
  orderNumber: number;
  time: string;
  items: BonItem[];
  footer: string;
}

export function buildPickupBon(input: PickupBonInput): BonDoc {
  const lines: BonLine[] = [];
  if (input.header) lines.push({ t: 'text', text: input.header, align: 'center', bold: true });
  lines.push({ t: 'text', text: 'Ihre Abholnummer', align: 'center' });
  lines.push({ t: 'text', text: String(input.pickupNumber), align: 'center', size: 3, bold: true });
  lines.push({ t: 'cols', left: `Bestellung #${input.orderNumber}`, right: input.time });
  lines.push({ t: 'sep' });
  for (const item of input.items) {
    lines.push({ t: 'text', text: `${item.qty}x ${item.name}` });
    for (const opt of item.options) lines.push({ t: 'text', text: `   + ${opt}` });
  }
  lines.push({ t: 'sep' });
  if (input.footer) lines.push({ t: 'text', text: input.footer, align: 'center' });
  return { lines };
}

export function buildTestBon(input: { printerName: string; profile: BonProfile; time: string }): BonDoc {
  return {
    lines: [
      { t: 'text', text: ' TESTDRUCK ', align: 'center', size: 2, bold: true, invert: true },
      { t: 'text', text: input.printerName, align: 'center', size: 2, bold: true },
      { t: 'cols', left: 'Zeit', right: input.time },
      { t: 'cols', left: 'Zeichen pro Zeile', right: String(input.profile.widthChars) },
      { t: 'cols', left: 'Codetabelle', right: input.profile.codepage },
      { t: 'sep' },
      { t: 'text', text: 'Umlaute: äöü ÄÖÜ ß' },
      { t: 'text', text: 'Euro: 12,50 €' },
      { t: 'text', text: 'Groß', size: 2 },
      { t: 'text', text: 'Sehr groß', size: 3 },
      { t: 'text', text: ' Invers ', invert: true },
      { t: 'sep' },
      { t: 'text', text: '1234567890'.repeat(8).slice(0, input.profile.widthChars) },
      { t: 'text', text: 'Die Zeile oben muss genau eine Zeile füllen.', align: 'center' },
    ],
  };
}

const CODEPAGE_SHORT: Record<Codepage, string> = {
  cp437: 'PC437',
  cp850: 'PC850',
  cp858: 'PC858',
  cp1252: 'Windows-1252',
  ascii: 'Nur ASCII',
};

/**
 * Druckt dieselbe Zeile mit Umlauten in jedem Zeichensatz. Günstige Bondrucker
 * nummerieren ihre Zeichensätze unterschiedlich – so sieht man auf einen Blick,
 * welche Einstellung bei genau diesem Drucker stimmt.
 */
export function buildCodepageTestBon(printerName: string): BonDoc {
  const sample = 'Küche Getränke ÄÖÜ äöü ß';
  const lines: BonLine[] = [
    // Kopf und Anleitung immer in reinem ASCII – lesbar, egal was der Drucker kann.
    { t: 'codepage', codepage: 'ascii' },
    { t: 'text', text: ' ZEICHENSATZ-TEST ', align: 'center', size: 2, bold: true, invert: true },
    { t: 'text', text: printerName, align: 'center', bold: true },
    { t: 'text', text: 'Welche Zeile zeigt die Umlaute richtig?' },
    { t: 'sep' },
  ];
  for (const codepage of CODEPAGES) {
    lines.push({ t: 'codepage', codepage });
    lines.push({ t: 'text', text: `${CODEPAGE_SHORT[codepage]}:`, bold: true });
    lines.push({ t: 'text', text: `  ${sample}${codepage === 'cp858' || codepage === 'cp1252' ? ' €' : ''}` });
  }
  lines.push(
    { t: 'codepage', codepage: 'ascii' },
    { t: 'sep' },
    { t: 'text', text: 'Den Namen der richtigen Zeile im Admin unter Drucker > Bearbeiten > Zeichensatz einstellen.' },
  );
  return { lines };
}
