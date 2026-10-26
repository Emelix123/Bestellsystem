import type { Catalog, PickupBoard } from '@bestellsystem/shared';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import {
  areas,
  categories,
  optionGroups,
  options,
  orders,
  productOptionGroups,
  products,
  stations,
  tables,
  tenants,
  tickets,
} from '../db/schema';
import { hasRole, requireTenant } from '../lib/auth';
import { notFound } from '../lib/errors';
import { idParam, parse, z } from '../lib/validate';
import { eventSummary, getActiveEvent, getTenantSettings, requireActiveEvent } from '../services/common';
import { loadOrder, loadOrders, loadTickets } from '../services/dto';
import { cancelItems, createOrder, markPickedUp, ticketAction } from '../services/orders';
import { stationDto } from './admin-printing';

const createOrderSchema = z.object({
  clientRequestId: z.string().min(8).max(64),
  kind: z.enum(['table', 'togo']),
  tableId: z.number().int().positive().optional(),
  note: z.string().max(300).optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        qty: z.number().int().min(1).max(99),
        optionIds: z.array(z.number().int().positive()).max(30).default([]),
        note: z.string().max(200).optional(),
      }),
    )
    .min(1, 'Die Bestellung ist leer.')
    .max(100),
});

export async function loadCatalog(ctx: AppContext, tenantId: number): Promise<Catalog> {
  const event = await requireActiveEvent(ctx.db, tenantId);
  const settings = await getTenantSettings(ctx.db, tenantId);
  const [areaRows, tableRows, categoryRows, productRows, groupRows, stationRows] = await Promise.all([
    ctx.db.select().from(areas).where(eq(areas.eventId, event.id)).orderBy(asc(areas.sort), asc(areas.id)),
    ctx.db.select().from(tables).where(eq(tables.eventId, event.id)).orderBy(asc(tables.sort), asc(tables.id)),
    ctx.db
      .select()
      .from(categories)
      .where(eq(categories.eventId, event.id))
      .orderBy(asc(categories.sort), asc(categories.id)),
    ctx.db
      .select()
      .from(products)
      .where(and(eq(products.eventId, event.id), eq(products.active, true)))
      .orderBy(asc(products.sort), asc(products.id)),
    ctx.db
      .select()
      .from(optionGroups)
      .where(eq(optionGroups.eventId, event.id))
      .orderBy(asc(optionGroups.sort), asc(optionGroups.id)),
    ctx.db.select().from(stations).where(eq(stations.eventId, event.id)).orderBy(asc(stations.sort), asc(stations.id)),
  ]);
  const productIds = productRows.map((p) => p.id);
  const links = productIds.length
    ? await ctx.db
        .select()
        .from(productOptionGroups)
        .where(inArray(productOptionGroups.productId, productIds))
        .orderBy(asc(productOptionGroups.sort))
    : [];
  const groupIds = groupRows.map((g) => g.id);
  const optionRows = groupIds.length
    ? await ctx.db
        .select()
        .from(options)
        .where(inArray(options.groupId, groupIds))
        .orderBy(asc(options.sort), asc(options.id))
    : [];

  return {
    event: eventSummary(event),
    settings,
    areas: areaRows.map((a) => ({
      id: a.id,
      name: a.name,
      tables: tableRows.filter((t) => t.areaId === a.id).map((t) => ({ id: t.id, label: t.label })),
    })),
    categories: categoryRows.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    products: productRows.map((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      stationId: p.stationId,
      name: p.name,
      priceCents: p.priceCents,
      depositCents: settings.deposit ? p.depositCents : 0,
      color: p.color,
      soldOut: p.soldOut,
      optionGroupIds: links.filter((l) => l.productId === p.id).map((l) => l.groupId),
    })),
    optionGroups: groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      multi: g.multi,
      required: g.required,
      options: optionRows
        .filter((o) => o.groupId === g.id)
        .map((o) => ({ id: o.id, name: o.name, priceDeltaCents: o.priceDeltaCents })),
    })),
    stations: stationRows.map((s) => ({ id: s.id, name: s.name })),
  };
}

export async function loadPickupBoard(ctx: AppContext, tenantId: number): Promise<PickupBoard> {
  const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
  const event = await getActiveEvent(ctx.db, tenantId);
  const settings = await getTenantSettings(ctx.db, tenantId);
  if (!event) return { tenantName: tenant.name, preparing: [], ready: [] };
  const rows = await ctx.db
    .select({ pickupNumber: orders.pickupNumber, readyAt: orders.readyAt })
    .from(orders)
    .where(
      and(
        eq(orders.eventId, event.id),
        eq(orders.kind, 'togo'),
        isNull(orders.pickedUpAt),
        gt(orders.createdAt, sql`now() - interval '6 hours'`),
      ),
    )
    .orderBy(asc(orders.id));
  const cutoff = Date.now() - settings.pickupDisplayMinutes * 60_000;
  return {
    tenantName: tenant.name,
    preparing: rows.filter((r) => !r.readyAt).map((r) => r.pickupNumber!),
    ready: rows.filter((r) => r.readyAt && r.readyAt.getTime() > cutoff).map((r) => r.pickupNumber!),
  };
}

export function registerOrderRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/catalog', async (req) => {
    const { tenantId } = requireTenant(req);
    return loadCatalog(ctx, tenantId);
  });

  app.post('/api/orders', async (req, reply) => {
    const { auth, tenantId } = requireTenant(req, 'waiter', 'togo');
    const body = parse(createOrderSchema, req.body);
    const { order, duplicate } = await createOrder(ctx, auth, tenantId, body);
    reply.code(duplicate ? 200 : 201);
    return order;
  });

  app.get('/api/orders', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'waiter', 'togo');
    const q = parse(
      z.object({
        tableId: z.coerce.number().int().positive().optional(),
        kind: z.enum(['table', 'togo']).optional(),
        mine: z.coerce.boolean().optional(),
        hours: z.coerce.number().min(0.1).max(48).default(12),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );
    const event = await requireActiveEvent(ctx.db, tenantId);
    const conditions = [
      eq(orders.tenantId, tenantId),
      eq(orders.eventId, event.id),
      gt(orders.createdAt, new Date(Date.now() - q.hours * 3_600_000)),
    ];
    if (q.tableId) conditions.push(eq(orders.tableId, q.tableId));
    if (q.kind) conditions.push(eq(orders.kind, q.kind));
    // Bedienungen sehen nur eigene Bestellungen, außer am Tisch (Übergabe).
    if (q.mine || (!hasRole(auth, 'admin') && !q.tableId && q.kind !== 'togo')) {
      conditions.push(eq(orders.waiterId, auth.user.id));
    }
    return loadOrders(ctx.db, and(...conditions), q.limit);
  });

  app.get('/api/orders/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'waiter', 'togo', 'station');
    const { id } = parse(idParam, req.params);
    const order = await loadOrder(ctx.db, id);
    const [row] = await ctx.db.select({ tenantId: orders.tenantId }).from(orders).where(eq(orders.id, id));
    if (!order || row?.tenantId !== tenantId) throw notFound('Bestellung nicht gefunden.');
    return order;
  });

  app.post('/api/orders/:id/cancel', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'waiter', 'togo');
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        items: z
          .array(z.object({ orderItemId: z.number().int().positive(), qty: z.number().int().min(1).max(99) }))
          .min(1)
          .max(100),
        reason: z.string().max(200).optional(),
      }),
      req.body,
    );
    return cancelItems(ctx, auth, tenantId, id, body);
  });

  app.post('/api/orders/:id/picked-up', async (req) => {
    const { tenantId } = requireTenant(req, 'togo');
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ pickedUp: z.boolean().default(true) }), req.body ?? {});
    return markPickedUp(ctx, tenantId, id, body.pickedUp);
  });

  /** "Ausverkauft" darf auch die Küche setzen – die weiß es zuerst. */
  app.post('/api/products/:id/sold-out', async (req) => {
    const { tenantId } = requireTenant(req, 'station');
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ soldOut: z.boolean() }), req.body);
    const [row] = await ctx.db
      .update(products)
      .set({ soldOut: body.soldOut })
      .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
      .returning({ id: products.id });
    if (!row) throw notFound('Produkt nicht gefunden.');
    ctx.hub.broadcast(tenantId, { type: 'product', productId: id, soldOut: body.soldOut });
    return { ok: true };
  });

  // ---------------------------------------------------------------- Stationen / Tablets
  app.get('/api/stations', async (req) => {
    const { tenantId } = requireTenant(req, 'station');
    const event = await requireActiveEvent(ctx.db, tenantId);
    const rows = await ctx.db
      .select()
      .from(stations)
      .where(eq(stations.eventId, event.id))
      .orderBy(asc(stations.sort), asc(stations.id));
    return rows.map(stationDto);
  });

  app.get('/api/tickets', async (req) => {
    const { tenantId } = requireTenant(req, 'station');
    const q = parse(
      z.object({
        stationIds: z
          .string()
          .regex(/^\d+(,\d+)*$/)
          .transform((s) => s.split(',').map(Number)),
        scope: z.enum(['active', 'done']).default('active'),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      }),
      req.query,
    );
    const event = await requireActiveEvent(ctx.db, tenantId);
    const base = and(eq(tickets.tenantId, tenantId), eq(tickets.eventId, event.id), inArray(tickets.stationId, q.stationIds));
    if (q.scope === 'active') {
      return loadTickets(ctx.db, and(base, inArray(tickets.status, ['open', 'accepted'])), { limit: q.limit });
    }
    return loadTickets(ctx.db, and(base, eq(tickets.status, 'done')), { limit: q.limit, newestFirst: true });
  });

  for (const action of ['accept', 'done', 'reopen', 'reprint'] as const) {
    app.post(`/api/tickets/:id/${action}`, async (req) => {
      const { tenantId } = requireTenant(req, 'station');
      const { id } = parse(idParam, req.params);
      return ticketAction(ctx, tenantId, id, action);
    });
  }

  // ---------------------------------------------------------------- To-Go / Abholmonitor
  app.get('/api/togo/orders', async (req) => {
    const { tenantId } = requireTenant(req, 'togo');
    const event = await requireActiveEvent(ctx.db, tenantId);
    return loadOrders(
      ctx.db,
      and(
        eq(orders.eventId, event.id),
        eq(orders.kind, 'togo'),
        gt(orders.createdAt, sql`now() - interval '6 hours'`),
      ),
      100,
    );
  });

  app.get('/api/public/pickup/:slug', async (req) => {
    const { slug } = parse(z.object({ slug: z.string().max(60) }), req.params);
    const [tenant] = await ctx.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
    if (!tenant) throw notFound('Verein nicht gefunden.');
    return loadPickupBoard(ctx, tenant.id);
  });
}

