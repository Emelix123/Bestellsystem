import { mergeSettings, type EventSummary, type TenantSettings } from '@bestellsystem/shared';
import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { auditLog, events, tenants } from '../db/schema';
import type { AuthInfo } from '../lib/auth';
import { HttpError, notFound } from '../lib/errors';

export type EventRow = typeof events.$inferSelect;

export async function getTenantSettings(db: DbOrTx, tenantId: number): Promise<TenantSettings> {
  const [row] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  if (!row) throw notFound('Verein nicht gefunden.');
  return mergeSettings(row.settings);
}

export async function getActiveEvent(db: DbOrTx, tenantId: number): Promise<EventRow | null> {
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.active, true)));
  return row ?? null;
}

export async function requireActiveEvent(db: DbOrTx, tenantId: number): Promise<EventRow> {
  const event = await getActiveEvent(db, tenantId);
  if (!event) throw new HttpError(409, 'Es ist keine Veranstaltung aktiv. Bitte im Admin-Bereich eine aktivieren.');
  return event;
}

/** Veranstaltung aus ?eventId=… (geprüft auf den Verein) oder die aktive. */
export async function resolveEvent(db: DbOrTx, tenantId: number, eventId: number | undefined): Promise<EventRow> {
  if (eventId === undefined) return requireActiveEvent(db, tenantId);
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.tenantId, tenantId)));
  if (!row) throw notFound('Veranstaltung nicht gefunden.');
  return row;
}

export function eventSummary(event: EventRow): EventSummary {
  return { id: event.id, name: event.name, date: event.date, active: event.active };
}

export async function audit(
  db: DbOrTx,
  tenantId: number,
  auth: AuthInfo | null,
  action: string,
  details: Record<string, unknown> = {},
) {
  await db.insert(auditLog).values({
    tenantId,
    userId: auth?.user.id ?? null,
    userName: auth?.user.name ?? 'System',
    action,
    details,
  });
}
