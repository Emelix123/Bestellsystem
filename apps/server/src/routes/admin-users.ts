import { mergeSettings, ROLES, type TenantSettings } from '@bestellsystem/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { auditLog, printers, tenants, users } from '../db/schema';
import { requireTenant } from '../lib/auth';
import { hashPassword, pinLookup } from '../lib/crypto';
import { badRequest, conflict, notFound } from '../lib/errors';
import { idParam, parse, pin, z } from '../lib/validate';
import { audit } from '../services/common';

const userSchema = z.object({
  name: z.string().trim().min(1).max(60),
  roles: z.array(z.enum(ROLES)).min(1, 'Mindestens eine Rolle wählen'),
  pin: pin.nullable().optional(),
  username: z.string().trim().min(3).max(50).nullable().optional(),
  password: z.string().min(8).max(200).nullable().optional(),
  active: z.boolean().default(true),
});

const settingsSchema = z
  .object({
    showPrices: z.boolean(),
    billingHelper: z.boolean(),
    deposit: z.boolean(),
    togo: z.boolean(),
    pickupPrinterId: z.number().int().positive().nullable(),
    pickupBonHeader: z.string().max(80),
    pickupBonFooter: z.string().max(200),
    pickupDisplayMinutes: z.number().int().min(1).max(120),
    waiterCanCancel: z.boolean(),
    waiterCancelMinutes: z.number().int().min(1).max(600),
    statsShowValues: z.boolean(),
  })
  .partial();

function uniqueViolation(err: unknown): string | null {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = e.code ?? e.cause?.code;
  if (code !== '23505') return null;
  return e.constraint ?? e.cause?.constraint ?? 'unique';
}

export function registerAdminUserRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/users', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const rows = await ctx.db.select().from(users).where(eq(users.tenantId, tenantId)).orderBy(asc(users.name));
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      roles: u.roles,
      active: u.active,
      hasPin: !!u.pinLookup,
      hasPassword: !!u.passwordHash,
      isSuperadmin: u.isSuperadmin,
    }));
  });

  async function buildValues(tenantId: number, body: Partial<z.infer<typeof userSchema>>) {
    const values: Partial<typeof users.$inferInsert> = {};
    if (body.name !== undefined) values.name = body.name;
    if (body.roles !== undefined) values.roles = body.roles;
    if (body.active !== undefined) values.active = body.active;
    if (body.pin !== undefined) values.pinLookup = body.pin ? pinLookup(ctx.secret, tenantId, body.pin) : null;
    if (body.username !== undefined) values.username = body.username || null;
    if (body.password !== undefined) values.passwordHash = body.password ? await hashPassword(body.password) : null;
    return values;
  }

  async function save<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const constraint = uniqueViolation(err);
      if (constraint?.includes('pin')) throw conflict('Diese PIN ist schon vergeben.');
      if (constraint?.includes('username')) throw conflict('Dieser Benutzername ist schon vergeben.');
      throw err;
    }
  }

  app.post('/api/admin/users', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const body = parse(userSchema, req.body);
    if (!body.pin && !(body.username && body.password)) {
      throw badRequest('Bitte eine PIN oder Benutzername + Passwort vergeben.');
    }
    const values = await buildValues(tenantId, body);
    const row = await save(async () => {
      const [created] = await ctx.db
        .insert(users)
        .values({ ...values, name: body.name, tenantId })
        .returning({ id: users.id });
      return created;
    });
    await audit(ctx.db, tenantId, auth, 'user.create', { id: row.id, name: body.name, roles: body.roles });
    return row;
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(userSchema.partial(), req.body);
    if (id === auth.user.id && (body.active === false || (body.roles && !body.roles.includes('admin')))) {
      throw badRequest('Sie können sich nicht selbst die Admin-Rechte entziehen.');
    }
    const values = await buildValues(tenantId, body);
    const row = await save(async () => {
      const [updated] = await ctx.db
        .update(users)
        .set(values)
        .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
        .returning({ id: users.id });
      return updated;
    });
    if (!row) throw notFound('Benutzer nicht gefunden.');
    await audit(ctx.db, tenantId, auth, 'user.update', { id, fields: Object.keys(body) });
    return { ok: true };
  });

  app.delete('/api/admin/users/:id', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    if (id === auth.user.id) throw badRequest('Sie können sich nicht selbst löschen.');
    const [row] = await ctx.db
      .delete(users)
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId), eq(users.isSuperadmin, false)))
      .returning({ id: users.id, name: users.name });
    if (!row) throw notFound('Benutzer nicht gefunden.');
    await audit(ctx.db, tenantId, auth, 'user.delete', { id, name: row.name });
    return { ok: true };
  });

  // ---------------------------------------------------------------- Einstellungen
  app.get('/api/admin/settings', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
    return { name: tenant.name, slug: tenant.slug, settings: mergeSettings(tenant.settings) };
  });

  app.put('/api/admin/settings', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const body = parse(
      z.object({ name: z.string().trim().min(2).max(100).optional(), settings: settingsSchema.default({}) }),
      req.body,
    );
    if (body.settings.pickupPrinterId) {
      const [p] = await ctx.db
        .select({ id: printers.id })
        .from(printers)
        .where(and(eq(printers.id, body.settings.pickupPrinterId), eq(printers.tenantId, tenantId)));
      if (!p) throw badRequest('Drucker für Abholbon nicht gefunden.');
    }
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
    const settings: TenantSettings = mergeSettings({ ...tenant.settings, ...body.settings });
    await ctx.db
      .update(tenants)
      .set({ settings, ...(body.name ? { name: body.name } : {}) })
      .where(eq(tenants.id, tenantId));
    await audit(ctx.db, tenantId, auth, 'settings.update', body.settings);
    ctx.hub.broadcast(tenantId, { type: 'catalog' });
    return { settings };
  });

  app.get('/api/admin/audit', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(1000).default(200) }), req.query);
    return ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.tenantId, tenantId))
      .orderBy(desc(auditLog.id))
      .limit(q.limit);
  });
}
