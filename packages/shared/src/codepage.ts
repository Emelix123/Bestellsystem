import type { Codepage } from './types';

/** Zeichen, die in PC437 und PC850/858 an derselben Stelle liegen. */
const COMMON_437_850: Record<string, number> = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ä: 0x84, à: 0x85, å: 0x86, ç: 0x87,
  ê: 0x88, ë: 0x89, è: 0x8a, ï: 0x8b, î: 0x8c, ì: 0x8d, Ä: 0x8e, Å: 0x8f,
  É: 0x90, æ: 0x91, Æ: 0x92, ô: 0x93, ö: 0x94, ò: 0x95, û: 0x96, ù: 0x97,
  ÿ: 0x98, Ö: 0x99, Ü: 0x9a, '£': 0x9c, ƒ: 0x9f,
  á: 0xa0, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ª: 0xa6, º: 0xa7,
  '¿': 0xa8, '¬': 0xaa, '½': 0xab, '¼': 0xac, '¡': 0xad, '«': 0xae, '»': 0xaf,
  ß: 0xe1, µ: 0xe6, '±': 0xf1, '°': 0xf8, '²': 0xfd,
};

const ONLY_850: Record<string, number> = {
  ø: 0x9b, Ø: 0x9d, '×': 0x9e, '®': 0xa9, Á: 0xb5, Â: 0xb6, À: 0xb7, '©': 0xb8,
  ã: 0xc6, Ã: 0xc7, Ê: 0xd2, Ë: 0xd3, È: 0xd4, Í: 0xd6, Î: 0xd7, Ï: 0xd8,
  Ì: 0xde, Ó: 0xe0, Ô: 0xe2, Ò: 0xe3, õ: 0xe4, Õ: 0xe5, Ú: 0xe9, Û: 0xea,
  Ù: 0xeb, ý: 0xec, Ý: 0xed, '§': 0xf5, '·': 0xfa, '³': 0xfc,
};

const CP1252_EXTRA: Record<string, number> = {
  '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93,
  '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99,
};

const TABLES: Record<Exclude<Codepage, 'ascii' | 'cp1252'>, Record<string, number>> = {
  cp437: COMMON_437_850,
  cp850: { ...COMMON_437_850, ...ONLY_850 },
  cp858: { ...COMMON_437_850, ...ONLY_850, '€': 0xd5 },
};

/** ESC t n – Codetabelle nach Epson-Nummerierung. */
export const CODEPAGE_ESC_T: Record<Codepage, number | null> = {
  cp437: 0,
  cp850: 2,
  cp858: 19,
  cp1252: 16,
  ascii: null,
};

/** Ersatz für Zeichen, die in der gewählten Codetabelle fehlen. */
const FALLBACK: Record<string, string> = {
  '€': 'EUR',
  '„': '"', '“': '"', '”': '"', '‚': "'", '‘': "'", '’': "'",
  '–': '-', '—': '-', '…': '...', '•': '*', '×': 'x', '·': '.',
  ' ': ' ', '\t': ' ',
};

const ASCII_GERMAN: Record<string, string> = {
  ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss',
};

function asciiFallback(ch: string): string {
  if (ASCII_GERMAN[ch]) return ASCII_GERMAN[ch];
  if (FALLBACK[ch]) return FALLBACK[ch];
  const stripped = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (stripped.length > 0 && /^[\x20-\x7e]+$/.test(stripped)) return stripped;
  return '?';
}

function supports(ch: string, codepage: Codepage): boolean {
  const code = ch.codePointAt(0)!;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (codepage === 'ascii') return false;
  if (codepage === 'cp1252') return CP1252_EXTRA[ch] !== undefined || (code >= 0xa0 && code <= 0xff);
  return TABLES[codepage][ch] !== undefined;
}

/**
 * Ersetzt alle Zeichen, die der Drucker in dieser Codetabelle nicht kann
 * (z. B. "€" -> "EUR" bei PC850). Danach entspricht ein Zeichen genau einem
 * gedruckten Zeichen – wichtig für Spalten und Zeilenumbrüche.
 */
export function normalizeText(text: string, codepage: Codepage): string {
  let out = '';
  for (const ch of text) {
    if (supports(ch, codepage)) {
      out += ch;
      continue;
    }
    const replacement = codepage === 'ascii' ? asciiFallback(ch) : (FALLBACK[ch] ?? asciiFallback(ch));
    for (const r of replacement) out += supports(r, codepage) ? r : '?';
  }
  return out;
}

/** Wandelt (bereits normalisierten) Text in Bytes der Codetabelle um. */
export function encodeText(text: string, codepage: Codepage): number[] {
  const out: number[] = [];
  for (const ch of normalizeText(text, codepage)) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) out.push(code);
    else if (codepage === 'cp1252') out.push(CP1252_EXTRA[ch] ?? code);
    else if (codepage !== 'ascii') out.push(TABLES[codepage][ch]!);
    else out.push(0x3f);
  }
  return out;
}
