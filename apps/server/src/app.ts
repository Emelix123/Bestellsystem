import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { Config } from './config';
import type { AppContext } from './context';
import type { Db } from './db/client';
import { systemValues } from './db/schema';
import { loadAuth } from './lib/auth';
import { randomToken } from './lib/crypto';
import { HttpError } from './lib/errors';
import { Hub } from './lib/hub';
import { makeTimeFormatter } from './lib/time';
import { registerAdminCatalogRoutes } from './routes/admin-catalog';
import { registerAdminEventRoutes } from './routes/admin-events';
import { registerAdminPrintingRoutes } from './routes/admin-printing';
import { registerAdminUserRoutes } from './routes/admin-users';
import { registerAuthRoutes } from './routes/auth';
import { registerOrderRoutes } from './routes/orders';
import { registerStatsRoutes } from './routes/stats';
import { registerSuperRoutes } from './routes/super';
import { registerWsRoutes } from './routes/ws';
import { AgentHub } from './services/agents';
import { PrintService } from './services/printing';

const DOWNLOADS: Record<string, string> = {
  'agent.mjs': 'text/javascript; charset=utf-8',
  'install-agent.sh': 'text/plain; charset=utf-8',
  'install-agent.ps1': 'text/plain; charset=utf-8',
};

const DOWNLOAD_MISSING =
  'Die Dateien des Druck-Agenten fehlen auf dem Server. Bitte im Projektordner "npm run build" ausfuehren ' +
  'und den Server neu starten (mit Docker: "docker compose up -d --build").';

async function loadSecret(db: Db): Promise<string> {
  const [row] = await db.select().from(systemValues).where(eq(systemValues.key, 'secret'));
  if (row) return row.value;
  await db.insert(systemValues).values({ key: 'secret', value: randomToken(32) }).onConflictDoNothing();
  const [again] = await db.select().from(systemValues).where(eq(systemValues.key, 'secret'));
  return again.value;
}

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
}

export async function buildApp(db: Db, config: Config, opts: { logger?: boolean } = {}): Promise<BuiltApp> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  const hub = new Hub();
  const agentHub = new AgentHub(db);
  const printing = new PrintService(db, hub, agentHub, app.log);
  const ctx: AppContext = {
    db,
    config,
    secret: await loadSecret(db),
    hub,
    agentHub,
    printing,
    formatTime: makeTimeFormatter(config.timezone),
  };

  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/')) req.auth = await loadAuth(ctx, req);
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    if (err.statusCode && err.statusCode < 500) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    req.log.error({ err }, 'Unerwarteter Fehler');
    reply.code(500).send({ error: 'Interner Fehler. Bitte erneut versuchen.' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  registerAuthRoutes(app, ctx);
  registerSuperRoutes(app, ctx);
  registerAdminEventRoutes(app, ctx);
  registerAdminCatalogRoutes(app, ctx);
  registerAdminPrintingRoutes(app, ctx);
  registerAdminUserRoutes(app, ctx);
  registerOrderRoutes(app, ctx);
  registerStatsRoutes(app, ctx);
  registerWsRoutes(app, ctx);

  // Druck-Agent und Installationsskripte zum Herunterladen (siehe Admin → Drucker).
  // Eigene Route statt Fallback auf die Web-App: Fehlt eine Datei, bekommt das
  // Installationsskript eine klare Fehlermeldung statt der HTML-Startseite.
  app.get('/downloads/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    const type = DOWNLOADS[file];
    const filePath = type && config.agentDownloads ? path.join(config.agentDownloads, file) : null;
    if (!type || !filePath || !fs.existsSync(filePath)) {
      reply.code(404).type('text/plain; charset=utf-8');
      return type ? DOWNLOAD_MISSING : 'Datei nicht gefunden.';
    }
    reply.type(type).header('Cache-Control', 'no-cache');
    return fs.createReadStream(filePath);
  });

  // Gebaute Web-Oberfläche ausliefern (Single-Page-App).
  if (config.webDist && fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'Nicht gefunden.' });
        return;
      }
      reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => {
    printing.stop();
    hub.stop();
    agentHub.stop();
  });

  return { app, ctx };
}

export async function startBackground(ctx: AppContext) {
  ctx.hub.start();
  ctx.agentHub.start();
  await ctx.printing.start();
}
