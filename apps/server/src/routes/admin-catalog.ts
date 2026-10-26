import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import type { DbOrTx } from '../db/client';
import { areas, categories, optionGroups, options, productOptionGroups, products, stations, tables } from '../db/schema';
import { requireTenant } from '../lib/auth';
import { badRequest, conflict, notFound } from '../lib/errors';
import { cents, color, idParam, optionalEventQuery, parse, z } from '../lib/validate';
import { resolveEvent } from '../services/common';

const withEvent = z.object({ eventId: z.number().int().positive().optional() });

async function owned<T extends typeof areas | typeof tables | typeof categories | typeof products | typeof optionGroups>(
  db: DbOrTx,
  table: T,
  tenantId: number,
  id: number,
  what: string,
) {
  const rows = await db
    .select()
    .from(table as typeof areas)
    .where(and(eq((table as typeof areas).id, id), eq((table as typeof areas).tenantId, tenantId)));
  if (rows.length === 0) throw notFound(`${what} nicht gefunden.`);
  return rows[0] as unknown as T['$inferSelect'];
}

function isFkViolation(err: unknown) {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === '23503';
}

// --------------------------------------------------------------- Gänge & Tische

const areaSchema = z.object({ name: z.string().trim().min(1).max(60), sort: z.number().int().optional() });
const tableSchema = z.object({
  label: z.string().trim().min(1).max(20),
  sort: z.number().int().optional(),
  areaId: z.number().int().positive().optional(),
});
const bulkTablesSchema = z.union([
  z.object({ labels: z.array(z.string().trim().min(1).max(20)).min(1).max(500) }),
  z.object({
    from: z.number().int().min(0).max(9999),
    to: z.number().int().min(0).max(9999),
    prefix: z.string().max(10).default(''),
  }),
]);

// --------------------------------------------------------------- Produkte

const productSchema = z.object({
  categoryId: z.number().int().positive(),
  stationId: z.number().int().positive(),
  name: z.string().trim().min(1).max(80),
  bonName: z.string().trim().max(40).nullable().optional(),
  priceCents: cents,
  depositCents: cents.default(0),
  color: color.nullable().optional(),
  sort: z.number().int().optional(),
  soldOut: z.boolean().optional(),
  active: z.boolean().optional(),
  optionGroupIds: z.array(z.number().int().positive()).max(20).optional(),
});

const optionGroupSchema = z.object({
  name: z.string().trim().min(1).max(60),
  multi: z.boolean().default(false),
  required: z.boolean().default(false),
  sort: z.number().int().optional(),
  options: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        name: z.string().trim().min(1).max(60),
        priceDeltaCents: z.number().int().min(-100_000).max(100_000).default(0),
      }),
    )
    .max(50)
    .default([]),
});

export function registerAdminCatalogRoutes(app: FastifyInstance, ctx: AppContext) {
  const changed = (tenantId: number) => ctx.hub.broadcast(tenantId, { type: 'catalog' });

  // ---------------------------------------------------------------- Gänge
  app.get('/api/admin/areas', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { eventId } = parse(optionalEventQuery, req.query);
    const event = await resolveEvent(ctx.db, tenantId, eventId);
    const areaRows = await ctx.db
      .select()
      .from(areas)
      .where(eq(areas.eventId, event.id))
      .orderBy(asc(areas.sort), asc(areas.id));
    const tableRows = await ctx.db
      .select()
      .from(tables)
      .where(eq(tables.eventId, event.id))
      .orderBy(asc(tables.sort), asc(tables.id));
    return areaRows.map((a) => ({
      id: a.id,
      name: a.name,
      sort: a.sort,
      tables: tableRows.filter((t) => t.areaId === a.id).map((t) => ({ id: t.id, label: t.label, sort: t.sort })),
    }));
  });

  app.post('/api/admin/areas', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const body = parse(areaSchema.merge(withEvent), req.body);
    const event = await resolveEvent(ctx.db, tenantId, body.eventId);
    const [row] = await ctx.db
      .insert(areas)
      .values({ tenantId, eventId: event.id, name: body.name, sort: body.sort ?? 999 })
      .returning();
    changed(tenantId);
    return row;
  });

  app.patch('/api/admin/areas/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(areaSchema.partial(), req.body);
    await owned(ctx.db, areas, tenantId, id, 'Gang');
    const [row] = await ctx.db.update(areas).set(body).where(eq(areas.id, id)).returning();
    changed(tenantId);
    return row;
  });

  app.delete('/api/admin/areas/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    await owned(ctx.db, areas, tenantId, id, 'Gang');
    await ctx.db.delete(areas).where(eq(areas.id, id));
    changed(tenantId);
    return { ok: true };
  });

  app.post('/api/admin/areas/:id/tables', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(bulkTablesSchema, req.body);
    const area = await owned(ctx.db, areas, tenantId, id, 'Gang');
    let labels: string[];
    if ('labels' in body) labels = body.labels;
    else {
      if (body.to < body.from) throw badRequest('"bis" muss größer als "von" sein.');
      if (body.to - body.from > 500) throw badRequest('Maximal 500 Tische auf einmal.');
      labels = Array.from({ length: body.to - body.from + 1 }, (_, i) => `${body.prefix}${body.from + i}`);
    }
    const existing = await ctx.db.select({ label: tables.label, sort: tables.sort }).from(tables).where(eq(tables.areaId, id));
    const existingLabels = new Set(existing.map((t) => t.label));
    const startSort = existing.reduce((m, t) => Math.max(m, t.sort), 0) + 1;
    const fresh = labels.filter((l) => !existingLabels.has(l));
    if (fresh.length > 0) {
      await ctx.db
        .insert(tables)
        .values(fresh.map((label, i) => ({ tenantId, eventId: area.eventId, areaId: id, label, sort: startSort + i })));
    }
    changed(tenantId);
    return { created: fresh.length, skipped: labels.length - fresh.length };
  });

  app.patch('/api/admin/tables/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(tableSchema.partial(), req.body);
    const table = await owned(ctx.db, tables, tenantId, id, 'Tisch');
    if (body.areaId) {
      const area = await owned(ctx.db, areas, tenantId, body.areaId, 'Gang');
      if (area.eventId !== table.eventId) throw badRequest('Gang gehört zu einer anderen Veranstaltung.');
    }
    const [row] = await ctx.db.update(tables).set(body).where(eq(tables.id, id)).returning();
    changed(tenantId);
    return row;
  });

  app.delete('/api/admin/tables/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    await owned(ctx.db, tables, tenantId, id, 'Tisch');
    await ctx.db.delete(tables).where(eq(tables.id, id));
    changed(tenantId);
    return { ok: true };
  });

  // ---------------------------------------------------------------- Kategorien
  const categorySchema = z.object({
    name: z.string().trim().min(1).max(60),
    color: color.default('#64748b'),
    sort: z.number().int().optional(),
  });

  app.get('/api/admin/categories', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { eventId } = parse(optionalEventQuery, req.query);
    const event = await resolveEvent(ctx.db, tenantId, eventId);
    return ctx.db
      .select()
      .from(categories)
      .where(eq(categories.eventId, event.id))
      .orderBy(asc(categories.sort), asc(categories.id));
  });

  app.post('/api/admin/categories', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const body = parse(categorySchema.merge(withEvent), req.body);
    const event = await resolveEvent(ctx.db, tenantId, body.eventId);
    const [row] = await ctx.db
      .insert(categories)
      .values({ tenantId, eventId: event.id, name: body.name, color: body.color, sort: body.sort ?? 999 })
      .returning();
    changed(tenantId);
    return row;
  });

  app.patch('/api/admin/categories/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(categorySchema.partial(), req.body);
    await owned(ctx.db, categories, tenantId, id, 'Kategorie');
    const [row] = await ctx.db.update(categories).set(body).where(eq(categories.id, id)).returning();
    changed(tenantId);
    return row;
  });

  app.delete('/api/admin/categories/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    await owned(ctx.db, categories, tenantId, id, 'Kategorie');
    try {
      await ctx.db.delete(categories).where(eq(categories.id, id));
    } catch (err) {
      if (isFkViolation(err)) throw conflict('Die Kategorie enthält noch Produkte.');
      throw err;
    }
    changed(tenantId);
    return { ok: true };
  });

  // ---------------------------------------------------------------- Produkte
  async function checkProductRefs(
    db: DbOrTx,
    tenantId: number,
    eventId: number,
    body: { categoryId?: number; stationId?: number; optionGroupIds?: number[] },
  ) {
    if (body.categoryId) {
      const c = await owned(db, categories, tenantId, body.categoryId, 'Kategorie');
      if (c.eventId !== eventId) throw badRequest('Kategorie gehört zu einer anderen Veranstaltung.');
    }
    if (body.stationId) {
      const [s] = await db
        .select()
        .from(stations)
        .where(and(eq(stations.id, body.stationId), eq(stations.tenantId, tenantId), eq(stations.eventId, eventId)));
      if (!s) throw badRequest('Station nicht gefunden.');
    }
    if (body.optionGroupIds && body.optionGroupIds.length > 0) {
      const groups = await db
        .select({ id: optionGroups.id })
        .from(optionGroups)
        .where(
          and(
            eq(optionGroups.tenantId, tenantId),
            eq(optionGroups.eventId, eventId),
            inArray(optionGroups.id, body.optionGroupIds),
          ),
        );
      if (groups.length !== new Set(body.optionGroupIds).size) throw badRequest('Optionsgruppe nicht gefunden.');
    }
  }

  async function setProductGroups(db: DbOrTx, productId: number, groupIds: number[]) {
    await db.delete(productOptionGroups).where(eq(productOptionGroups.productId, productId));
    const unique = [...new Set(groupIds)];
    if (unique.length > 0) {
      await db.insert(productOptionGroups).values(unique.map((groupId, sort) => ({ productId, groupId, sort })));
    }
  }

  app.get('/api/admin/products', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { eventId } = parse(optionalEventQuery, req.query);
    const event = await resolveEvent(ctx.db, tenantId, eventId);
    const rows = await ctx.db
      .select()
      .from(products)
      .where(eq(products.eventId, event.id))
      .orderBy(asc(products.sort), asc(products.id));
    const links = rows.length
      ? await ctx.db
          .select()
          .from(productOptionGroups)
          .where(
            inArray(
              productOptionGroups.productId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(asc(productOptionGroups.sort))
      : [];
    return rows.map((p) => ({
      ...p,
      optionGroupIds: links.filter((l) => l.productId === p.id).map((l) => l.groupId),
    }));
  });

  app.post('/api/admin/products', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const body = parse(productSchema.merge(withEvent), req.body);
    const event = await resolveEvent(ctx.db, tenantId, body.eventId);
    const row = await ctx.db.transaction(async (tx) => {
      await checkProductRefs(tx, tenantId, event.id, body);
      const { optionGroupIds, eventId: _e, ...values } = body;
      const [created] = await tx
        .insert(products)
        .values({ ...values, tenantId, eventId: event.id, sort: body.sort ?? 999 })
        .returning();
      await setProductGroups(tx, created.id, optionGroupIds ?? []);
      return created;
    });
    changed(tenantId);
    return row;
  });

  app.patch('/api/admin/products/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(productSchema.partial(), req.body);
    const row = await ctx.db.transaction(async (tx) => {
      const product = await owned(tx, products, tenantId, id, 'Produkt');
      await checkProductRefs(tx, tenantId, product.eventId, body);
      const { optionGroupIds, ...values } = body;
      const [updated] = Object.keys(values).length
        ? await tx.update(products).set(values).where(eq(products.id, id)).returning()
        : [product];
      if (optionGroupIds) await setProductGroups(tx, id, optionGroupIds);
      return updated;
    });
    changed(tenantId);
    return row;
  });

  app.delete('/api/admin/products/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    await owned(ctx.db, products, tenantId, id, 'Produkt');
    await ctx.db.delete(products).where(eq(products.id, id));
    changed(tenantId);
    return { ok: true };
  });

  // ---------------------------------------------------------------- Optionen
  app.get('/api/admin/option-groups', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { eventId } = parse(optionalEventQuery, req.query);
    const event = await resolveEvent(ctx.db, tenantId, eventId);
    const groups = await ctx.db
      .select()
      .from(optionGroups)
      .where(eq(optionGroups.eventId, event.id))
      .orderBy(asc(optionGroups.sort), asc(optionGroups.id));
    const opts = groups.length
      ? await ctx.db
          .select()
          .from(options)
          .where(
            inArray(
              options.groupId,
              groups.map((g) => g.id),
            ),
          )
          .orderBy(asc(options.sort), asc(options.id))
      : [];
    return groups.map((g) => ({ ...g, options: opts.filter((o) => o.groupId === g.id) }));
  });

  async function saveOptions(
    db: DbOrTx,
    tenantId: number,
    groupId: number,
    list: { id?: number; name: string; priceDeltaCents: number }[],
  ) {
    const keepIds = list.filter((o) => o.id).map((o) => o.id!);
    await db
      .delete(options)
      .where(
        keepIds.length
          ? and(eq(options.groupId, groupId), notInArray(options.id, keepIds))
          : eq(options.groupId, groupId),
      );
    for (const [sort, o] of list.entries()) {
      if (o.id) {
        await db
          .update(options)
          .set({ name: o.name, priceDeltaCents: o.priceDeltaCents, sort })
          .where(and(eq(options.id, o.id), eq(options.groupId, groupId)));
      } else {
        await db.insert(options).values({ tenantId, groupId, name: o.name, priceDeltaCents: o.priceDeltaCents, sort });
      }
    }
  }

  app.post('/api/admin/option-groups', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const body = parse(optionGroupSchema.merge(withEvent), req.body);
    const event = await resolveEvent(ctx.db, tenantId, body.eventId);
    const row = await ctx.db.transaction(async (tx) => {
      const [group] = await tx
        .insert(optionGroups)
        .values({
          tenantId,
          eventId: event.id,
          name: body.name,
          multi: body.multi,
          required: body.required,
          sort: body.sort ?? 999,
        })
        .returning();
      await saveOptions(tx, tenantId, group.id, body.options);
      return group;
    });
    changed(tenantId);
    return row;
  });

  app.patch('/api/admin/option-groups/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(optionGroupSchema.partial(), req.body);
    await ctx.db.transaction(async (tx) => {
      await owned(tx, optionGroups, tenantId, id, 'Optionsgruppe');
      const { options: list, ...values } = body;
      if (Object.keys(values).length) await tx.update(optionGroups).set(values).where(eq(optionGroups.id, id));
      if (list) await saveOptions(tx, tenantId, id, list);
    });
    changed(tenantId);
    return { ok: true };
  });

  app.delete('/api/admin/option-groups/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    await owned(ctx.db, optionGroups, tenantId, id, 'Optionsgruppe');
    await ctx.db.delete(optionGroups).where(eq(optionGroups.id, id));
    changed(tenantId);
    return { ok: true };
  });
}
