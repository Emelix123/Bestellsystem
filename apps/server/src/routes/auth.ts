import { mergeSettings, type MeResponse, type PublicTenant } from '@bestellsystem/shared';
import { and, asc, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { sessions, tenants, users } from '../db/schema';
import { createSession, destroySession, LoginLimiter, requireSuperadmin, requireUser } from '../lib/auth';
import { hashPassword, pinLookup, verifyPassword } from '../lib/crypto';
import { conflict, HttpError, notFound } from '../lib/errors';
import { parse, pin, z } from '../lib/validate';
import { eventSummary, getActiveEvent } from '../services/common';
import { seedDemoData } from '../services/demo';

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'verein'
  );
}

const setupSchema = z.object({
  tenantName: z.string().trim().min(2).max(100),
  adminName: z.string().trim().min(2).max(100),
  username: z.string().trim().min(3).max(50),
  password: z.string().min(8).max(200),
  demo: z.boolean().default(false),
});

export async function needsSetup(ctx: AppContext) {
  const [row] = await ctx.db.select({ n: count() }).from(users).where(eq(users.isSuperadmin, true));
  return row.n === 0;
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  const limiter = new LoginLimiter();

  app.get('/api/setup', async () => ({ needsSetup: await needsSetup(ctx) }));

  app.post('/api/setup', async (req, reply) => {
    if (!(await needsSetup(ctx))) throw conflict('Das System ist bereits eingerichtet.');
    const body = parse(setupSchema, req.body);
    const result = await ctx.db.transaction(async (tx) => {
      // Sperre gegen doppeltes Einrichten bei gleichzeitigen Anfragen.
      await tx.execute('LOCK TABLE users IN EXCLUSIVE MODE');
      const [existing] = await tx.select({ n: count() }).from(users).where(eq(users.isSuperadmin, true));
      if (existing.n > 0) throw conflict('Das System ist bereits eingerichtet.');
      const [tenant] = await tx
        .insert(tenants)
        .values({ name: body.tenantName, slug: slugify(body.tenantName) })
        .returning();
      const [user] = await tx
        .insert(users)
        .values({
          tenantId: tenant.id,
          name: body.adminName,
          username: body.username,
          passwordHash: await hashPassword(body.password),
          roles: ['admin'],
          isSuperadmin: true,
        })
        .returning();
      if (body.demo) await seedDemoData(tx, ctx, tenant.id);
      return { tenant, user };
    });
    await createSession(ctx, reply, result.user, result.tenant.id);
    return { ok: true };
  });

  app.get('/api/public/tenants', async (): Promise<PublicTenant[]> => {
    return ctx.db.select({ name: tenants.name, slug: tenants.slug }).from(tenants).orderBy(asc(tenants.name));
  });

  app.post('/api/auth/pin', async (req, reply) => {
    const body = parse(z.object({ tenantSlug: z.string(), pin }), req.body);
    const key = `pin:${req.ip}`;
    limiter.check(key);
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.slug, body.tenantSlug));
    if (!tenant) throw notFound('Verein nicht gefunden.');
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenant.id),
          eq(users.pinLookup, pinLookup(ctx.secret, tenant.id, body.pin)),
          eq(users.active, true),
        ),
      );
    if (!user) {
      limiter.fail(key);
      throw new HttpError(401, 'PIN unbekannt.');
    }
    limiter.reset(key);
    await createSession(ctx, reply, user, tenant.id);
    return { ok: true };
  });

  app.post('/api/auth/password', async (req, reply) => {
    const body = parse(z.object({ username: z.string().trim(), password: z.string() }), req.body);
    const key = `pw:${req.ip}`;
    limiter.check(key);
    const [user] = await ctx.db.select().from(users).where(eq(users.username, body.username));
    if (!user || !user.active || !user.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
      limiter.fail(key);
      throw new HttpError(401, 'Benutzername oder Passwort falsch.');
    }
    limiter.reset(key);
    await createSession(ctx, reply, user, user.tenantId);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(ctx, req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req): Promise<MeResponse> => {
    const auth = requireUser(req);
    const user = {
      id: auth.user.id,
      name: auth.user.name,
      roles: auth.user.roles as MeResponse['user']['roles'],
      isSuperadmin: auth.user.isSuperadmin,
    };
    if (auth.tenantId === null) return { user, tenant: null, activeEvent: null };
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, auth.tenantId));
    if (!tenant) return { user, tenant: null, activeEvent: null };
    const event = await getActiveEvent(ctx.db, tenant.id);
    return {
      user,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, settings: mergeSettings(tenant.settings) },
      activeEvent: event ? eventSummary(event) : null,
    };
  });

  /** Super-Admin wechselt den Verein, in dem er arbeitet. */
  app.post('/api/auth/tenant', async (req) => {
    const auth = requireSuperadmin(req);
    const body = parse(z.object({ tenantId: z.number().int().positive() }), req.body);
    const [tenant] = await ctx.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, body.tenantId));
    if (!tenant) throw notFound('Verein nicht gefunden.');
    await ctx.db.update(sessions).set({ tenantId: tenant.id }).where(eq(sessions.id, auth.sessionId));
    return { ok: true };
  });
}
