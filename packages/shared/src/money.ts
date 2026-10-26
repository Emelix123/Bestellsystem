const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const plain = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1250 -> "12,50 €" */
export function formatEuro(cents: number): string {
  return euro.format(cents / 100);
}

/** 1250 -> "12,50" (für Bons, ohne Währungszeichen) */
export function formatAmount(cents: number): string {
  return plain.format(cents / 100);
}

/** "12,5" | "12.50" | "12" -> 1250. Gibt null zurück, wenn unlesbar. */
export function parseEuro(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, '').replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
