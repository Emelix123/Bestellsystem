import type { FastifyInstance, InjectOptions } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app';
import { loadConfig, type Config } from '../config';
import type { AppContext } from '../context';
import { createDb, runMigrations } from '../db/client';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface TestEnv {
  app: FastifyInstance;
  ctx: AppContext;
  close(): Promise<void>;
}

/** Frische Test-Datenbank pro Testdatei (Tests laufen nacheinander). */
export async function createTestEnv(overrides: Partial<Config> = {}): Promise<TestEnv> {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://bestell:bestell@localhost:5432/bestell_test';
  const { db, pool } = createDb(url);
  await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await runMigrations(db, path.resolve(here, '../../drizzle'));
  const config = { ...loadConfig(), databaseUrl: url, webDist: null, timezone: 'Europe/Berlin', ...overrides };
  const { app, ctx } = await buildApp(db, config, { logger: false });
  await app.ready();
  return {
    app,
    ctx,
    async close() {
      await app.close();
      await pool.end();
    },
  };
}

/** Kleiner HTTP-Client mit Cookie – simuliert ein angemeldetes Gerät. */
export class Client {
  cookie = '';

  constructor(private app: FastifyInstance) {}

  async request<T = any>(method: InjectOptions['method'], url: string, body?: unknown) {
    const res = await this.app.inject({
      method,
      url,
      payload: body as InjectOptions['payload'],
      headers: this.cookie ? { cookie: this.cookie } : {},
    });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      this.cookie = first.split(';')[0];
    }
    let json: T | undefined;
    try {
      json = res.json() as T;
    } catch {
      json = undefined;
    }
    return { status: res.statusCode, body: json as T, raw: res };
  }

  get<T = any>(url: string) {
    return this.request<T>('GET', url);
  }
  post<T = any>(url: string, body?: unknown) {
    return this.request<T>('POST', url, body ?? {});
  }
  patch<T = any>(url: string, body: unknown) {
    return this.request<T>('PATCH', url, body);
  }
  put<T = any>(url: string, body: unknown) {
    return this.request<T>('PUT', url, body);
  }
  delete<T = any>(url: string) {
    return this.request<T>('DELETE', url);
  }
}

export async function loginPin(app: FastifyInstance, tenantSlug: string, pin: string) {
  const client = new Client(app);
  const res = await client.post('/api/auth/pin', { tenantSlug, pin });
  if (res.status !== 200) throw new Error(`PIN-Login fehlgeschlagen: ${JSON.stringify(res.body)}`);
  return client;
}

let counter = 0;
export function requestId() {
  return `test-${Date.now()}-${++counter}`;
}
