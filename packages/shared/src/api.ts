import type { BonDoc } from './bon';
import type {
  Codepage,
  OrderKind,
  PrintJobKind,
  PrintJobStatus,
  PrinterStatus,
  PrinterType,
  PrintTrigger,
  Role,
  TenantSettings,
  TicketStatus,
} from './types';

// ---------------------------------------------------------------- Sitzung

export interface SessionUser {
  id: number;
  name: string;
  roles: Role[];
  isSuperadmin: boolean;
}

export interface SessionTenant {
  id: number;
  name: string;
  slug: string;
  settings: TenantSettings;
}

export interface EventSummary {
  id: number;
  name: string;
  date: string | null;
  active: boolean;
}

export interface MeResponse {
  user: SessionUser;
  tenant: SessionTenant | null;
  activeEvent: EventSummary | null;
}

export interface PublicTenant {
  name: string;
  slug: string;
}

// ---------------------------------------------------------------- Katalog

export interface CatalogTable {
  id: number;
  label: string;
}

export interface CatalogArea {
  id: number;
  name: string;
  tables: CatalogTable[];
}

export interface CatalogCategory {
  id: number;
  name: string;
  color: string;
}

export interface CatalogOption {
  id: number;
  name: string;
  priceDeltaCents: number;
}

export interface CatalogOptionGroup {
  id: number;
  name: string;
  /** true = mehrere Optionen wählbar (Checkbox), false = genau eine (Radio). */
  multi: boolean;
  required: boolean;
  options: CatalogOption[];
}

export interface CatalogProduct {
  id: number;
  categoryId: number;
  stationId: number;
  name: string;
  priceCents: number;
  depositCents: number;
  color: string | null;
  soldOut: boolean;
  optionGroupIds: number[];
}

export interface CatalogStation {
  id: number;
  name: string;
}

export interface Catalog {
  event: EventSummary;
  areas: CatalogArea[];
  categories: CatalogCategory[];
  products: CatalogProduct[];
  optionGroups: CatalogOptionGroup[];
  stations: CatalogStation[];
  settings: TenantSettings;
}

// ---------------------------------------------------------------- Bestellungen

export interface OrderItemInput {
  productId: number;
  qty: number;
  optionIds: number[];
  note?: string;
}

export interface CreateOrderInput {
  /** Vom Gerät erzeugte UUID – verhindert Doppelbestellungen bei Netzproblemen. */
  clientRequestId: string;
  kind: OrderKind;
  tableId?: number;
  note?: string;
  items: OrderItemInput[];
}

export interface SelectedOption {
  group: string;
  name: string;
  priceDeltaCents: number;
}

export interface OrderItemDto {
  id: number;
  productId: number | null;
  stationId: number | null;
  ticketId: number | null;
  name: string;
  qty: number;
  cancelledQty: number;
  /** Einzelpreis inkl. Optionen, ohne Pfand. */
  unitPriceCents: number;
  depositCents: number;
  options: SelectedOption[];
  note: string | null;
}

export interface TicketRef {
  id: number;
  stationId: number | null;
  stationName: string;
  status: TicketStatus;
}

export type TogoState = 'preparing' | 'ready' | 'picked_up';

export interface OrderDto {
  id: number;
  number: number;
  kind: OrderKind;
  tableId: number | null;
  tableLabel: string | null;
  areaName: string | null;
  pickupNumber: number | null;
  waiterId: number | null;
  waiterName: string;
  note: string | null;
  createdAt: string;
  readyAt: string | null;
  pickedUpAt: string | null;
  items: OrderItemDto[];
  tickets: TicketRef[];
}

export interface CancelItemsInput {
  items: { orderItemId: number; qty: number }[];
  reason?: string;
}

// ---------------------------------------------------------------- Stationen

export interface TicketItemDto {
  id: number;
  name: string;
  qty: number;
  cancelledQty: number;
  options: string[];
  note: string | null;
}

export interface TicketDto {
  id: number;
  orderId: number;
  orderNumber: number;
  stationId: number | null;
  stationName: string;
  status: TicketStatus;
  kind: OrderKind;
  areaName: string | null;
  tableLabel: string | null;
  pickupNumber: number | null;
  waiterName: string;
  orderNote: string | null;
  createdAt: string;
  acceptedAt: string | null;
  doneAt: string | null;
  items: TicketItemDto[];
}

export interface StationDto {
  id: number;
  name: string;
  showOnDisplay: boolean;
  printTrigger: PrintTrigger;
  printerId: number | null;
  bonPerItem: boolean;
  sort: number;
}

export interface PickupBoard {
  tenantName: string;
  preparing: number[];
  ready: number[];
}

// ---------------------------------------------------------------- Drucker

export interface AgentDevice {
  /** Stabile Kennung, z. B. "usb:04b8:0e28:SERIAL" – bleibt beim Umstecken gleich. */
  key: string;
  path: string;
  description: string;
}

export interface AgentDto {
  id: number;
  name: string;
  connected: boolean;
  hostname: string | null;
  version: string | null;
  lastSeenAt: string | null;
  devices: AgentDevice[];
}

export interface PrinterDto {
  id: number;
  name: string;
  type: PrinterType;
  agentId: number | null;
  deviceKey: string | null;
  host: string | null;
  port: number;
  widthChars: number;
  codepage: Codepage;
  cut: boolean;
  status: PrinterStatus;
  statusMessage: string | null;
  lastSeenAt: string | null;
  pendingJobs: number;
}

export interface PrintJobDto {
  id: number;
  printerId: number | null;
  printerName: string;
  kind: PrintJobKind;
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  printedAt: string | null;
  doc: BonDoc;
  widthChars: number;
  codepage: Codepage;
}

// ---------------------------------------------------------------- Statistik

export interface StatsRow {
  key: string;
  label: string;
  qty: number;
  cancelledQty: number;
  valueCents: number | null;
}

export interface StatsTimelinePoint {
  /** ISO-Zeitpunkt des Beginns des 15-Minuten-Fensters. */
  bucket: string;
  orders: number;
  items: number;
}

export interface StatsThroughput {
  stationName: string;
  tickets: number;
  avgSecondsToDone: number | null;
  maxSecondsToDone: number | null;
}

export interface StatsResponse {
  event: EventSummary;
  showValues: boolean;
  totals: { orders: number; items: number; cancelledItems: number; valueCents: number | null };
  products: StatsRow[];
  categories: StatsRow[];
  stations: StatsRow[];
  waiters: StatsRow[];
  timeline: StatsTimelinePoint[];
  throughput: StatsThroughput[];
}

// ---------------------------------------------------------------- Live-Updates (Browser)

export type WsMessage =
  | { type: 'ticket'; ticket: TicketDto }
  | { type: 'order'; order: OrderDto }
  | { type: 'catalog' }
  | { type: 'product'; productId: number; soldOut: boolean }
  | { type: 'printer'; printerId: number; status: PrinterStatus; statusMessage: string | null }
  | { type: 'printjob'; jobId: number; printerId: number | null; status: PrintJobStatus; lastError: string | null }
  | { type: 'agent'; agentId: number; connected: boolean }
  | { type: 'pickup' };

// ---------------------------------------------------------------- Druck-Agent-Protokoll

export type AgentToServer =
  | { type: 'hello'; version: string; hostname: string; devices: AgentDevice[] }
  | { type: 'devices'; devices: AgentDevice[] }
  | { type: 'result'; jobId: number; ok: boolean; error?: string }
  /** Der Schreibvorgang hängt (Drucker aus / Papier leer). Ergebnis folgt später. */
  | { type: 'blocked'; jobId: number; message: string };

export type ServerToAgent =
  | { type: 'welcome'; agentId: number; name: string }
  | { type: 'job'; jobId: number; deviceKey: string; data: string };
