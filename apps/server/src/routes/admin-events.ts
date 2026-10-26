import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import type { DbOrTx } from '../db/client';
import {
  areas,
  categories,
  events,
  optionGroups,
  options,
  productOptionGroups,
  products,
  stations,
  tables,
} from '../db/schema';
import { requireTenant } from '../lib/auth';
import { conflict, notFound } from '../lib/errors';
import { idParam, parse, z } from '../lib/validate';
import { audit, eventSummary } from '../services/common';

const eventSchema = z.object({
  name: z.string().trim().min(1).max(100),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

async function ownedEvent(db: DbOrTx, tenantId: number, id: number) {
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.tenantId, tenantId)));
  if (!row) throw notFound('Veranstaltung nicht gefunden.');
  return row;
}

/**
 * Kopiert Gänge, Tische, Kategorien, Stationen, Optionen und Produkte einer
 * Veranstaltung in eine andere. Bestellungen werden nicht kopiert.
 */
export async function copyEventStructure(tx: DbOrTx, tenantId: number, fromId: number, toId: number) {
  const areaMap = new Map<number, number>();
  for (const a of await tx.select().from(areas).where(eq(areas.eventId, fromId))) {
    const [n] = await tx
      .insert(areas)
      .values({ tenantId, eventId: toId, name: a.name, sort: a.sort })
      .returning({ id: areas.id });
    areaMap.set(a.id, n.id);
  }
  const oldTables = await tx.select().from(tables).where(eq(tables.eventId, fromId));
  if (oldTables.length > 0) {
    await tx.insert(tables).values(
      oldTables.map((t) => ({ tenantId, eventId: toId, areaId: areaMap.get(t.areaId)!, label: t.label, sort: t.sort })),
    );
  }
  const catMap = new Map<number, number>();
  for (const c of await tx.select().from(categories).where(eq(categories.eventId, fromId))) {
    const [n] = await tx
      .insert(categories)
      .values({ tenantId, eventId: toId, name: c.name, color: c.color, sort: c.sort })
      .returning({ id: categories.id });
    catMap.set(c.id, n.id);
  }
  const stationMap = new Map<number, number>();
  for (const s of await tx.select().from(stations).where(eq(stations.eventId, fromId))) {
    const { id, eventId, ...rest } = s;
    const [n] = await tx
      .insert(stations)
      .values({ ...rest, eventId: toId })
      .returning({ id: stations.id });
    stationMap.set(id, n.id);
  }
  const groupMap = new Map<number, number>();
  for (const g of await tx.select().from(optionGroups).where(eq(optionGroups.eventId, fromId))) {
    const { id, eventId, ...rest } = g;
    const [n] = await tx
      .insert(optionGroups)
      .values({ ...rest, eventId: toId })
      .returning({ id: optionGroups.id });
    groupMap.set(id, n.id);
    const opts = await tx.select().from(options).where(eq(options.groupId, id));
    if (opts.length > 0) {
      await tx
        .insert(options)
        .values(opts.map(({ id: _id, groupId: _g, ...o }) => ({ ...o, groupId: n.id })));
    }
  }
  for (const p of await tx.select().from(products).where(eq(products.eventId, fromId))) {
    const { id, eventId, categoryId, stationId, ...rest } = p;
    const [n] = await tx
      .insert(products)
      .values({
        ...rest,
        eventId: toId,
        categoryId: catMap.get(categoryId)!,
        stationId: stationMap.get(stationId)!,
        soldOut: false,
      })
      .returning({ id: products.id });
    const links = await tx.select().from(productOptionGroups).where(eq(productOptionGroups.productId, id));
    if (links.length > 0) {
      await tx
        .insert(productOptionGroups)
        .values(links.map((l) => ({ productId: n.id, groupId: groupMap.get(l.groupId)!, sort: l.sort })));
    }
  }
}

export function registerAdminEventRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/events', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const rows = await ctx.db
      .select()
      .from(events)
      .where(eq(events.tenantId, tenantId))
      .orderBy(desc(events.active), desc(events.date), desc(events.id));
    return rows.map((e) => ({ ...eventSummary(e), orderCount: e.orderCounter }));
  });

  app.post('/api/admin/events', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const body = parse(eventSchema, req.body);
    const [row] = await ctx.db
      .insert(events)
      .values({ tenantId, name: body.name, date: body.date ?? null })
      .returning();
    await audit(ctx.db, tenantId, auth, 'event.create', { id: row.id, name: row.name });
    return eventSummary(row);
  });

  app.patch('/api/admin/events/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(eventSchema.partial(), req.body);
    await ownedEvent(ctx.db, tenantId, id);
    const [row] = await ctx.db.update(events).set(body).where(eq(events.id, id)).returning();
    ctx.hub.broadcast(tenantId, { type: 'catalog' });
    return eventSummary(row);
  });

  app.post('/api/admin/events/:id/activate', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    await ctx.db.transaction(async (tx) => {
      await ownedEvent(tx, tenantId, id);
      await tx
        .update(events)
        .set({ active: false })
        .where(and(eq(events.tenantId, tenantId), ne(events.id, id)));
      await tx.update(events).set({ active: true }).where(eq(events.id, id));
      await audit(tx, tenantId, auth, 'event.activate', { id });
    });
    ctx.hub.broadcast(tenantId, { type: 'catalog' });
    return { ok: true };
  });

  app.post('/api/admin/events/:id/copy', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(eventSchema, req.body);
    const created = await ctx.db.transaction(async (tx) => {
      await ownedEvent(tx, tenantId, id);
      const [row] = await tx
        .insert(events)
        .values({ tenantId, name: body.name, date: body.date ?? null })
        .returning();
      await copyEventStructure(tx, tenantId, id, row.id);
      await audit(tx, tenantId, auth, 'event.copy', { from: id, to: row.id });
      return row;
    });
    return eventSummary(created);
  });

  app.delete('/api/admin/events/:id', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const event = await ownedEvent(ctx.db, tenantId, id);
    if (event.active) throw conflict('Die aktive Veranstaltung kann nicht gelöscht werden.');
    await ctx.db.delete(events).where(eq(events.id, id));
    await audit(ctx.db, tenantId, auth, 'event.delete', { id, name: event.name });
    return { ok: true };
  });

  /** Reihenfolge per Drag & Drop / Pfeiltasten speichern. */
  const reorderTables = { areas, tables, categories, products, stations, optionGroups } as const;
  app.post('/api/admin/reorder', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const body = parse(
      z.object({
        entity: z.enum(['areas', 'tables', 'categories', 'products', 'stations', 'optionGroups']),
        ids: z.array(z.number().int().positive()).max(1000),
      }),
      req.body,
    );
    const table = reorderTables[body.entity];
    await ctx.db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.tenantId, tenantId), inArray(table.id, body.ids.length ? body.ids : [0])));
      const ownedIds = new Set(owned.map((o) => o.id));
      for (const [index, rowId] of body.ids.entries()) {
        if (!ownedIds.has(rowId)) continue;
        await tx.update(table).set({ sort: index }).where(eq(table.id, rowId));
      }
    });
    ctx.hub.broadcast(tenantId, { type: 'catalog' });
    return { ok: true };
  });

  app.get('/api/admin/events/:id/summary', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const event = await ownedEvent(ctx.db, tenantId, id);
    const count = async (table: typeof areas | typeof tables | typeof products | typeof stations) =>
      (await ctx.db.select({ id: table.id }).from(table).where(eq(table.eventId, id))).length;
    return {
      ...eventSummary(event),
      areas: await count(areas),
      tables: await count(tables),
      products: await count(products),
      stations: await count(stations),
      orders: event.orderCounter,
    };
  });
}

