import type { AgentDevice, BonDoc, SelectedOption, TenantSettings } from '@bestellsystem/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Systemweite Werte, z. B. das zufällig erzeugte Geheimnis für PIN-Hashes. */
export const systemValues = pgTable('system_values', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  settings: jsonb('settings').$type<Partial<TenantSettings>>().notNull().default({}),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Nur für Passwort-Login (Admins). */
    username: text('username').unique(),
    passwordHash: text('password_hash'),
    /** HMAC der PIN – erlaubt schnelles Nachschlagen ohne Klartext. */
    pinLookup: text('pin_lookup'),
    roles: text('roles').array().notNull().default(sql`'{}'::text[]`),
    isSuperadmin: boolean('is_superadmin').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_tenant_pin').on(t.tenantId, t.pinLookup)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 des Cookie-Tokens. */
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('sessions_user').on(t.userId)],
);

export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    date: date('date'),
    active: boolean('active').notNull().default(false),
    orderCounter: integer('order_counter').notNull().default(0),
    pickupCounter: integer('pickup_counter').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('events_one_active').on(t.tenantId).where(sql`${t.active}`)],
);

export const areas = pgTable('areas', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  eventId: integer('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sort: integer('sort').notNull().default(0),
});

export const tables = pgTable('tables', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  eventId: integer('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  areaId: integer('area_id')
    .notNull()
    .references(() => areas.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  sort: integer('sort').notNull().default(0),
});

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  eventId: integer('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#64748b'),
  sort: integer('sort').notNull().default(0),
});

export const printers = pgTable('printers', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').$type<'usb' | 'network' | 'simulator'>().notNull(),
  agentId: integer('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  deviceKey: text('device_key'),
  host: text('host'),
  port: integer('port').notNull().default(9100),
  widthChars: integer('width_chars').notNull().default(48),
  codepage: text('codepage').$type<'cp858' | 'cp850' | 'cp437' | 'cp1252' | 'ascii'>().notNull().default('cp437'),
  cut: boolean('cut').notNull().default(true),
  status: text('status').$type<'ok' | 'error' | 'offline' | 'unknown'>().notNull().default('unknown'),
  statusMessage: text('status_message'),
  lastSeenAt: ts('last_seen_at'),
  createdAt: createdAt(),
});

export const agents = pgTable('agents', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  hostname: text('hostname'),
  platform: text('platform'),
  version: text('version'),
  devices: jsonb('devices').$type<AgentDevice[]>().notNull().default([]),
  lastSeenAt: ts('last_seen_at'),
  createdAt: createdAt(),
});

export const stations = pgTable('stations', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  eventId: integer('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  showOnDisplay: boolean('show_on_display').notNull().default(false),
  printTrigger: text('print_trigger').$type<'on_order' | 'on_accept' | 'on_done' | 'never'>().notNull().default('on_order'),
  printerId: integer('printer_id').references(() => printers.id, { onDelete: 'set null' }),
  bonPerItem: boolean('bon_per_item').notNull().default(false),
  sort: integer('sort').notNull().default(0),
});

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  eventId: integer('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  categoryId: integer('category_id')
    .notNull()
    .references(() => categories.id, { onDelete: 'restrict' }),
  stationId: integer('station_id')
    .notNull()
    .references(() => stations.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  /** Kürzere Bezeichnung für den Bon (optional). */
  bonName: text('bon_name'),
  priceCents: integer('price_cents').notNull().default(0),
  depositCents: integer('deposit_cents').notNull().default(0),
  color: text('color'),
  sort: integer('sort').notNull().default(0),
  soldOut: boolean('sold_out').notNull().default(false),
  active: boolean('active').notNull().default(true),
});

export const optionGroups = pgTable('option_groups', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  eventId: integer('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  multi: boolean('multi').notNull().default(false),
  required: boolean('required').notNull().default(false),
  sort: integer('sort').notNull().default(0),
});

export const options = pgTable('options', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  groupId: integer('group_id')
    .notNull()
    .references(() => optionGroups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  priceDeltaCents: integer('price_delta_cents').notNull().default(0),
  sort: integer('sort').notNull().default(0),
});

export const productOptionGroups = pgTable(
  'product_option_groups',
  {
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    groupId: integer('group_id')
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'cascade' }),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.groupId] })],
);

export const orders = pgTable(
  'orders',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    kind: text('kind').$type<'table' | 'togo'>().notNull(),
    tableId: integer('table_id').references(() => tables.id, { onDelete: 'set null' }),
    // Kopien, damit alte Bestellungen lesbar bleiben, wenn Tische umbenannt werden.
    tableLabel: text('table_label'),
    areaName: text('area_name'),
    pickupNumber: integer('pickup_number'),
    waiterId: integer('waiter_id').references(() => users.id, { onDelete: 'set null' }),
    waiterName: text('waiter_name').notNull(),
    note: text('note'),
    clientRequestId: text('client_request_id').notNull(),
    createdAt: createdAt(),
    readyAt: ts('ready_at'),
    pickedUpAt: ts('picked_up_at'),
  },
  (t) => [
    uniqueIndex('orders_client_request').on(t.tenantId, t.clientRequestId),
    index('orders_event_created').on(t.eventId, t.createdAt),
    index('orders_table').on(t.tableId),
  ],
);

export const tickets = pgTable(
  'tickets',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    stationId: integer('station_id').references(() => stations.id, { onDelete: 'set null' }),
    stationName: text('station_name').notNull(),
    status: text('status').$type<'open' | 'accepted' | 'done' | 'cancelled'>().notNull().default('open'),
    /** Wurde für dieses Ticket schon ein Bon gedruckt (für Storno-Bons wichtig)? */
    printed: boolean('printed').notNull().default(false),
    createdAt: createdAt(),
    acceptedAt: ts('accepted_at'),
    doneAt: ts('done_at'),
  },
  (t) => [index('tickets_station_status').on(t.stationId, t.status), index('tickets_order').on(t.orderId)],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    ticketId: integer('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
    stationId: integer('station_id').references(() => stations.id, { onDelete: 'set null' }),
    // Kopien zum Zeitpunkt der Bestellung.
    name: text('name').notNull(),
    bonName: text('bon_name').notNull(),
    categoryName: text('category_name').notNull(),
    stationName: text('station_name').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    depositCents: integer('deposit_cents').notNull().default(0),
    qty: integer('qty').notNull(),
    cancelledQty: integer('cancelled_qty').notNull().default(0),
    options: jsonb('options').$type<SelectedOption[]>().notNull().default([]),
    note: text('note'),
  },
  (t) => [index('order_items_order').on(t.orderId), index('order_items_ticket').on(t.ticketId)],
);

export const printJobs = pgTable(
  'print_jobs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    printerId: integer('printer_id').references(() => printers.id, { onDelete: 'set null' }),
    ticketId: integer('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    orderId: integer('order_id').references(() => orders.id, { onDelete: 'set null' }),
    kind: text('kind').$type<'ticket' | 'storno' | 'pickup' | 'test' | 'reprint'>().notNull(),
    doc: jsonb('doc').$type<BonDoc>().notNull(),
    status: text('status').$type<'pending' | 'sent' | 'done' | 'cancelled'>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    createdAt: createdAt(),
    sentAt: ts('sent_at'),
    printedAt: ts('printed_at'),
  },
  (t) => [index('print_jobs_pending').on(t.status, t.printerId, t.id)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    userName: text('user_name').notNull(),
    action: text('action').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('audit_tenant_created').on(t.tenantId, t.createdAt)],
);
