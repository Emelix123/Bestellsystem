import { describe, expect, it } from 'vitest';
import { bonToPlainText, buildCodepageTestBon, buildTicketBon, layoutBon } from './bon';
import { encodeText, normalizeText } from './codepage';
import { renderEscPos } from './escpos';
import { formatEuro, parseEuro } from './money';

describe('Codetabellen', () => {
  it('kodiert Umlaute und Euro in PC858', () => {
    expect(encodeText('äöüÄÖÜß€', 'cp858')).toEqual([0x84, 0x94, 0x81, 0x8e, 0x99, 0x9a, 0xe1, 0xd5]);
  });

  it('ersetzt das Euro-Zeichen, wenn die Codetabelle es nicht kennt', () => {
    expect(normalizeText('5 €', 'cp437')).toBe('5 EUR');
    expect(encodeText('5 €', 'cp437')).toEqual([...'5 EUR'].map((c) => c.charCodeAt(0)));
  });

  it('schreibt Umlaute im ASCII-Modus aus', () => {
    expect(normalizeText('Größe Spätzle Café', 'ascii')).toBe('Groesse Spaetzle Cafe');
  });

  it('kodiert Windows-1252', () => {
    expect(encodeText('ä€', 'cp1252')).toEqual([0xe4, 0x80]);
  });

  it('ersetzt Unbekanntes durch ein Fragezeichen statt Datenmüll', () => {
    expect(normalizeText('Bier 🍺', 'cp858')).toBe('Bier ?');
  });
});

describe('Bon-Layout', () => {
  const profile = { widthChars: 32, codepage: 'cp858' as const };

  it('bricht lange Zeilen am Wort um und berücksichtigt die Schriftgröße', () => {
    const lines = layoutBon({ lines: [{ t: 'text', text: 'Schweinebraten mit Knödel und Soße', size: 2 }] }, profile);
    expect(lines.map((l) => l.text)).toEqual(['Schweinebraten', 'mit Knödel und', 'Soße']);
    expect(lines.every((l) => l.text.length <= 16)).toBe(true);
  });

  it('setzt Spalten links/rechts auf volle Breite', () => {
    const [line] = layoutBon({ lines: [{ t: 'cols', left: 'Anna', right: '19:42' }] }, profile);
    expect(line.text).toHaveLength(32);
    expect(line.text.startsWith('Anna')).toBe(true);
    expect(line.text.endsWith('19:42')).toBe(true);
  });

  it('zentriert über Einrückung', () => {
    const [line] = layoutBon({ lines: [{ t: 'text', text: 'KÜCHE', align: 'center', size: 2 }] }, profile);
    expect(line.indent).toBe(5);
  });

  it('baut einen Küchenbon mit Tisch, Positionen und Notizen', () => {
    const doc = buildTicketBon({
      stationName: 'Küche',
      location: { kind: 'table', areaName: 'Gang A', tableLabel: '12' },
      orderNumber: 7,
      waiterName: 'Anna',
      time: '19:42',
      items: [{ qty: 2, name: 'Schnitzel', options: ['Pommes'], note: 'ohne Zitrone' }],
    });
    const text = bonToPlainText(doc, profile);
    expect(text).toContain('KÜCHE');
    expect(text).toContain('Tisch 12');
    expect(text).toContain('2x Schnitzel');
    expect(text).toContain('+ Pommes');
    expect(text).toContain('! ohne Zitrone');
    expect(text).toContain('Bestellung #7');
  });
});

describe('ESC/POS', () => {
  it('initialisiert, setzt Codetabelle und schneidet', () => {
    const bytes = renderEscPos({ lines: [{ t: 'text', text: 'Bier' }] }, { widthChars: 32, codepage: 'cp858', cut: true });
    expect(Array.from(bytes.slice(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect(Array.from(bytes.slice(-3))).toEqual([0x1d, 0x56, 0x01]);
    expect(Buffer.from(bytes).includes(Buffer.from('Bier\n'))).toBe(true);
  });

  it('setzt doppelte Größe und wieder zurück', () => {
    const bytes = Array.from(
      renderEscPos({ lines: [{ t: 'text', text: 'X', size: 2 }] }, { widthChars: 32, codepage: 'ascii', cut: false }),
    );
    expect(bytes).toContain(0x11);
    const idx = bytes.indexOf(0x11);
    expect(bytes.slice(idx - 2, idx + 1)).toEqual([0x1d, 0x21, 0x11]);
    expect(bytes.slice(-6, -3)).toEqual([0x1d, 0x21, 0x00]);
  });

  it('invertiert nicht die Einrückung', () => {
    const bytes = Array.from(
      renderEscPos(
        { lines: [{ t: 'text', text: 'AB', align: 'right', invert: true }] },
        { widthChars: 6, codepage: 'ascii', cut: false },
      ),
    );
    const start = bytes.indexOf(0x20);
    expect(bytes.slice(start, start + 7)).toEqual([0x20, 0x20, 0x20, 0x20, 0x1d, 0x42, 0x01]);
  });
});

describe('Zeichensatz-Test', () => {
  it('druckt jede Zeile in ihrem eigenen Zeichensatz', () => {
    const bytes = Buffer.from(
      renderEscPos(buildCodepageTestBon('Küche'), { widthChars: 48, codepage: 'cp858', cut: true }),
    );
    // Wechsel auf PC437 (0), PC850 (2), PC858 (19) und Windows-1252 (16)
    for (const table of [0, 2, 19, 16]) expect(bytes.includes(Buffer.from([0x1b, 0x74, table]))).toBe(true);
    // "Ü" einmal als PC437/850/858-Byte 0x9A, einmal als Windows-1252-Byte 0xDC
    expect(bytes.includes(Buffer.from([0x8e, 0x99, 0x9a]))).toBe(true);
    expect(bytes.includes(Buffer.from([0xc4, 0xd6, 0xdc]))).toBe(true);
    const text = bonToPlainText(buildCodepageTestBon('Küche'), { widthChars: 48, codepage: 'cp858' });
    expect(text).toContain('ZEICHENSATZ-TEST');
    expect(text).toContain('Kueche'); // Kopf in reinem ASCII
    expect(text).toContain('Nur ASCII:\nKueche Getraenke');
  });

  it('griechisch gelesenes PC858 erklärt "KYCHE"', () => {
    // Fehlerbild aus dem Praxistest: Drucker legt ESC t 19 als griechische Tabelle aus.
    expect(Buffer.from(encodeText('KÜCHE GETRÄNKE', 'cp858')).toString('latin1')).toBe('K\x9aCHE GETR\x8eNKE');
  });
});

describe('Geldbeträge', () => {
  it('formatiert und liest Euro', () => {
    expect(formatEuro(1250).replace(/\s/g, ' ')).toBe('12,50 €');
    expect(parseEuro('12,5')).toBe(1250);
    expect(parseEuro('3')).toBe(300);
    expect(parseEuro('abc')).toBeNull();
  });
});
