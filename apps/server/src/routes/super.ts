import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { tenants, users } from '../db/schema';
import { requireSuperadmin } from '../lib/auth';
import { hashPassword } from '../lib/crypto';
import { badRequest, conflict, notFound } from '../lib/errors';
import { idParam, parse, z } from '../lib/validate';
import { seedDemoData } from '../services/demo';
import { slugify } from './auth';

const tenantSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/, 'Kürzel: nur a-z, 0-9 und Bindestrich')
    .optional(),
});

const createTenantSchema = tenantSchema.extend({
  adminName: z.string().trim().min(2).max(100),
  username: z.string().trim().min(3).max(50),
  password: z.string().min(8).max(200),
  demo: z.boolean().default(false),
});

/** Vereine verwalten – nur für Super-Admins (Betreiber der Installation). */
export function registerSuperRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/super/tenants', async (req) => {
    requireSuperadmin(req);
    return ctx.db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        createdAt: tenants.createdAt,
        users: sql<number>`(select count(*)::int from ${users} where ${users.tenantId} = ${tenants.id})`,
      })
      .from(tenants)
      .orderBy(asc(tenants.name));
  });

  app.post('/api/super/tenants', async (req) => {
    requireSuperadmin(req);
    const body = parse(createTenantSchema, req.body);
    const slug = body.slug ?? slugify(body.name);
    return ctx.db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
      if (dup) throw conflict(`Das Kürzel "${slug}" ist schon vergeben.`);
      const [dupUser] = await tx.select({ id: users.id }).from(users).where(eq(users.username, body.username));
      if (dupUser) throw conflict('Benutzername ist schon vergeben.');
      const [tenant] = await tx.insert(tenants).values({ name: body.name, slug }).returning();
      await tx.insert(users).values({
        tenantId: tenant.id,
        name: body.adminName,
        username: body.username,
        passwordHash: await hashPassword(body.password),
        roles: ['admin'],
      });
      if (body.demo) await seedDemoData(tx, ctx, tenant.id);
      return { id: tenant.id };
    });
  });

  app.patch('/api/super/tenants/:id', async (req) => {
    requireSuperadmin(req);
    const { id } = parse(idParam, req.params);
    const body = parse(tenantSchema.partial(), req.body);
    if (body.slug) {
      const [dup] = await ctx.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, body.slug));
      if (dup && dup.id !== id) throw conflict(`Das Kürzel "${body.slug}" ist schon vergeben.`);
    }
    const [row] = await ctx.db.update(tenants).set(body).where(eq(tenants.id, id)).returning({ id: tenants.id });
    if (!row) throw notFound();
    return { ok: true };
  });

  app.delete('/api/super/tenants/:id', async (req) => {
    const auth = requireSuperadmin(req);
    const { id } = parse(idParam, req.params);
    if (auth.user.tenantId === id) throw badRequest('Den eigenen Verein kann man nicht löschen.');
    const [row] = await ctx.db.delete(tenants).where(eq(tenants.id, id)).returning({ id: tenants.id });
    if (!row) throw notFound();
    return { ok: true };
  });
}
