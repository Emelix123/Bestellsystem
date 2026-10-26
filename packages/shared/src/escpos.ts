import { layoutBon, type BonDoc, type BonProfile } from './bon';
import { CODEPAGE_ESC_T, encodeText } from './codepage';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export interface EscPosProfile extends BonProfile {
  /** Papier nach dem Druck abschneiden (Drucker mit Schneidwerk). */
  cut: boolean;
  /** Leerzeilen vor dem Schnitt, damit nichts abgeschnitten wird. */
  feedLines?: number;
}

/**
 * Übersetzt einen Bon in ESC/POS-Bytes. Verwendet bewusst nur Befehle, die
 * praktisch alle Bondrucker verstehen (Epson-kompatibel): Init, Codetabelle,
 * Schriftgröße, Fett, Invers, Vorschub, Schnitt.
 */
export function renderEscPos(doc: BonDoc, profile: EscPosProfile): Uint8Array {
  const out: number[] = [ESC, 0x40]; // ESC @ – Drucker zurücksetzen
  const table = CODEPAGE_ESC_T[profile.codepage];
  if (table !== null) out.push(ESC, 0x74, table); // ESC t n – Codetabelle

  let currentSize = 1;
  let currentBold = false;
  const setSize = (size: number) => {
    if (size === currentSize) return;
    const n = ((size - 1) << 4) | (size - 1);
    out.push(GS, 0x21, n); // GS ! n – Breite/Höhe
    currentSize = size;
  };
  const setBold = (bold: boolean) => {
    if (bold === currentBold) return;
    out.push(ESC, 0x45, bold ? 1 : 0); // ESC E n
    currentBold = bold;
  };

  for (const line of layoutBon(doc, profile)) {
    setSize(line.size);
    setBold(line.bold);
    for (let i = 0; i < line.indent; i++) out.push(0x20);
    if (line.invert) out.push(GS, 0x42, 1); // GS B 1 – weiß auf schwarz
    out.push(...encodeText(line.text, profile.codepage));
    if (line.invert) out.push(GS, 0x42, 0);
    out.push(LF);
  }

  setSize(1);
  setBold(false);
  out.push(ESC, 0x64, profile.feedLines ?? 4); // ESC d n – n Zeilen Vorschub
  if (profile.cut) out.push(GS, 0x56, 0x01); // GS V 1 – Teilschnitt
  return Uint8Array.from(out);
}
