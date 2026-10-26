import type { Role } from '@bestellsystem/shared';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import { sessions, users } from '../db/schema';
import { randomToken, sha256 } from './crypto';
import { forbidden, HttpError, unauthorized } from './errors';

export const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export type UserRow = typeof users.$inferSelect;

export interface AuthInfo {
  sessionId: string;
  user: UserRow;
  /** Verein, in dem gerade gearbeitet wird (bei Super-Admins umschaltbar). */
  tenantId: number | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthInfo | null;
  }
}

export async function createSession(ctx: AppContext, reply: FastifyReply, user: UserRow, tenantId: number | null) {
  const token = randomToken();
  const id = sha256(token);
  await ctx.db.insert(sessions).values({
    id,
    userId: user.id,
    tenantId,
    expiresAt: new Date(Date.now() + SESSION_DAYS * DAY),
  });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.secureCookies,
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession(ctx: AppContext, req: FastifyRequest, reply: FastifyReply) {
  if (req.auth) await ctx.db.delete(sessions).where(eq(sessions.id, req.auth.sessionId));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function loadAuth(ctx: AppContext, req: FastifyRequest): Promise<AuthInfo | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const id = sha256(token);
  const [row] = await ctx.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
  if (!row || !row.user.active) return null;
  // Gleitende Gültigkeit: aktive Geräte bleiben angemeldet.
  if (row.session.expiresAt.getTime() - Date.now() < (SESSION_DAYS - 1) * DAY) {
    await ctx.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_DAYS * DAY) })
      .where(eq(sessions.id, id));
  }
  return { sessionId: id, user: row.user, tenantId: row.session.tenantId };
}

export function requireUser(req: FastifyRequest): AuthInfo {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function hasRole(auth: AuthInfo, ...roles: Role[]): boolean {
  if (auth.user.isSuperadmin) return true;
  if (auth.user.roles.includes('admin')) return true;
  return roles.some((r) => auth.user.roles.includes(r));
}

/** Angemeldet, einem Verein zugeordnet und (optional) mit einer der Rollen. */
export function requireTenant(req: FastifyRequest, ...roles: Role[]): { auth: AuthInfo; tenantId: number } {
  const auth = requireUser(req);
  if (auth.tenantId === null) throw new HttpError(409, 'Bitte zuerst einen Verein auswählen.');
  if (roles.length > 0 && !hasRole(auth, ...roles)) throw forbidden();
  return { auth, tenantId: auth.tenantId };
}

export function requireSuperadmin(req: FastifyRequest): AuthInfo {
  const auth = requireUser(req);
  if (!auth.user.isSuperadmin) throw forbidden();
  return auth;
}

/** Einfache Bremse gegen PIN-Raten: max. 10 Fehlversuche pro Minute und IP. */
export class LoginLimiter {
  private failures = new Map<string, { count: number; resetAt: number }>();

  check(key: string) {
    const entry = this.failures.get(key);
    if (entry && entry.resetAt > Date.now() && entry.count >= 10) {
      throw new HttpError(429, 'Zu viele Fehlversuche. Bitte eine Minute warten.');
    }
  }

  fail(key: string) {
    const now = Date.now();
    const entry = this.failures.get(key);
    if (!entry || entry.resetAt < now) this.failures.set(key, { count: 1, resetAt: now + 60_000 });
    else entry.count++;
  }

  reset(key: string) {
    this.failures.delete(key);
  }
}
