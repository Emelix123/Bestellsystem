export const ROLES = ['admin', 'waiter', 'togo', 'station'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  waiter: 'Bedienung',
  togo: 'To-Go',
  station: 'Station / Küche',
};

export const PRINT_TRIGGERS = ['on_order', 'on_accept', 'on_done', 'never'] as const;
export type PrintTrigger = (typeof PRINT_TRIGGERS)[number];
export const PRINT_TRIGGER_LABELS: Record<PrintTrigger, string> = {
  on_order: 'sofort bei Bestellung',
  on_accept: 'beim Annehmen am Tablet',
  on_done: 'beim Fertigmelden am Tablet',
  never: 'nie (nur Tablet)',
};

export const PRINTER_TYPES = ['usb', 'network', 'simulator'] as const;
export type PrinterType = (typeof PRINTER_TYPES)[number];
export const PRINTER_TYPE_LABELS: Record<PrinterType, string> = {
  usb: 'Am Rechner angeschlossen (Druck-Agent: Raspberry Pi / Linux / Windows)',
  network: 'Netzwerk (TCP 9100)',
  simulator: 'Simulator (nur Vorschau)',
};

export const CODEPAGES = ['cp437', 'cp850', 'cp858', 'cp1252', 'ascii'] as const;
export type Codepage = (typeof CODEPAGES)[number];
export const CODEPAGE_LABELS: Record<Codepage, string> = {
  cp437: 'PC437 – Standard, klappt bei fast allen Druckern',
  cp850: 'PC850',
  cp858: 'PC858 (mit €, bei vielen Nachbauten falsche Zeichen)',
  cp1252: 'Windows-1252',
  ascii: 'Nur ASCII (ae/oe/ue) – wenn nichts anderes klappt',
};

export type PrinterStatus = 'ok' | 'error' | 'offline' | 'unknown';
export type TicketStatus = 'open' | 'accepted' | 'done' | 'cancelled';
export type OrderKind = 'table' | 'togo';
export type PrintJobKind = 'ticket' | 'storno' | 'pickup' | 'test' | 'reprint';
export type PrintJobStatus = 'pending' | 'sent' | 'done' | 'cancelled';

export const PRINT_JOB_KIND_LABELS: Record<PrintJobKind, string> = {
  ticket: 'Bon',
  storno: 'Storno',
  pickup: 'Abholbon',
  test: 'Testdruck',
  reprint: 'Nachdruck',
};

/**
 * Einstellungen pro Verein. Alles, was sich zwischen Vereinen unterscheidet und
 * keine eigene Tabelle braucht, landet hier.
 */
export interface TenantSettings {
  /** Preise in Bedien- und To-Go-Oberfläche anzeigen. */
  showPrices: boolean;
  /** Rechnungshilfe für die Bedienung (reiner Rechner, speichert nichts). */
  billingHelper: boolean;
  /** Pfand-Feld an Produkten und Pfand in der Rechnungshilfe. */
  deposit: boolean;
  /** To-Go-Oberfläche mit Abholnummern. */
  togo: boolean;
  /** Drucker für den Abholbon des Gastes (null = kein Abholbon). */
  pickupPrinterId: number | null;
  /** Kopfzeile auf dem Abholbon, z. B. Vereinsname. */
  pickupBonHeader: string;
  /** Fußzeile auf dem Abholbon. */
  pickupBonFooter: string;
  /** Wie lange eine fertige Abholnummer auf dem Monitor stehen bleibt. */
  pickupDisplayMinutes: number;
  /** Bedienung darf eigene Positionen stornieren. */
  waiterCanCancel: boolean;
  /** Zeitfenster für Storno durch die Bedienung (Minuten). */
  waiterCancelMinutes: number;
  /** Werte in Euro in der Statistik anzeigen und exportieren. */
  statsShowValues: boolean;
}

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  showPrices: true,
  billingHelper: false,
  deposit: false,
  togo: false,
  pickupPrinterId: null,
  pickupBonHeader: '',
  pickupBonFooter: 'Bitte auf den Abholmonitor achten.',
  pickupDisplayMinutes: 10,
  waiterCanCancel: true,
  waiterCancelMinutes: 5,
  statsShowValues: false,
};

export function mergeSettings(partial: Partial<TenantSettings> | null | undefined): TenantSettings {
  return { ...DEFAULT_TENANT_SETTINGS, ...(partial ?? {}) };
}
