import {
  buildTestBon,
  CODEPAGES,
  PRINT_TRIGGERS,
  PRINTER_TYPES,
  type AgentDto,
  type PrinterDto,
  type PrintJobDto,
  type StationDto,
} from '@bestellsystem/shared';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import type { DbOrTx } from '../db/client';
import { agents, printers, printJobs, stations, tenants } from '../db/schema';
import { requireTenant } from '../lib/auth';
import { randomToken, sha256 } from '../lib/crypto';
import { badRequest, conflict, notFound } from '../lib/errors';
import { iso } from '../lib/time';
import { idParam, optionalEventQuery, parse, z } from '../lib/validate';
import { audit, getActiveEvent, resolveEvent } from '../services/common';

type PrinterRow = typeof printers.$inferSelect;

export async function printerDtos(db: DbOrTx, tenantId: number): Promise<PrinterDto[]> {
  const rows = await db.select().from(printers).where(eq(printers.tenantId, tenantId)).orderBy(asc(printers.name));
  const pending = await db
    .select({ printerId: printJobs.printerId, n: count() })
    .from(printJobs)
    .where(and(eq(printJobs.tenantId, tenantId), inArray(printJobs.status, ['pending', 'sent'])))
    .groupBy(printJobs.printerId);
  const pendingBy = new Map(pending.map((p) => [p.printerId, p.n]));
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    agentId: p.agentId,
    deviceKey: p.deviceKey,
    host: p.host,
    port: p.port,
    widthChars: p.widthChars,
    codepage: p.codepage,
    cut: p.cut,
    status: p.type === 'simulator' ? 'ok' : p.status,
    statusMessage: p.statusMessage,
    lastSeenAt: iso(p.lastSeenAt),
    pendingJobs: pendingBy.get(p.id) ?? 0,
  }));
}

export async function agentDtos(ctx: AppContext, tenantId: number): Promise<AgentDto[]> {
  const rows = await ctx.db.select().from(agents).where(eq(agents.tenantId, tenantId)).orderBy(asc(agents.name));
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    connected: ctx.agentHub.isConnected(a.id),
    hostname: a.hostname,
    version: a.version,
    lastSeenAt: iso(a.lastSeenAt),
    devices: ctx.agentHub.devices(a.id) ?? a.devices,
  }));
}

export function stationDto(s: typeof stations.$inferSelect): StationDto {
  return {
    id: s.id,
    name: s.name,
    showOnDisplay: s.showOnDisplay,
    printTrigger: s.printTrigger,
    printerId: s.printerId,
    bonPerItem: s.bonPerItem,
    sort: s.sort,
  };
}

const stationSchema = z.object({
  name: z.string().trim().min(1).max(60),
  showOnDisplay: z.boolean(),
  printTrigger: z.enum(PRINT_TRIGGERS),
  printerId: z.number().int().positive().nullable(),
  bonPerItem: z.boolean().default(false),
  sort: z.number().int().optional(),
});

const printerSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(PRINTER_TYPES),
  agentId: z.number().int().positive().nullable().optional(),
  deviceKey: z.string().max(200).nullable().optional(),
  host: z.string().trim().max(200).nullable().optional(),
  port: z.number().int().min(1).max(65535).default(9100),
  widthChars: z.number().int().min(16).max(80).default(48),
  codepage: z.enum(CODEPAGES).default('cp858'),
  cut: z.boolean().default(true),
});

export function registerAdminPrintingRoutes(app: FastifyInstance, ctx: AppContext) {
  async function ownedPrinter(db: DbOrTx, tenantId: number, id: number): Promise<PrinterRow> {
    const [row] = await db
      .select()
      .from(printers)
      .where(and(eq(printers.id, id), eq(printers.tenantId, tenantId)));
    if (!row) throw notFound('Drucker nicht gefunden.');
    return row;
  }

  async function checkPrinterRef(tenantId: number, printerId: number | null | undefined) {
    if (printerId) await ownedPrinter(ctx.db, tenantId, printerId);
  }

  async function checkAgentRef(tenantId: number, agentId: number | null | undefined) {
    if (!agentId) return;
    const [row] = await ctx.db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)));
    if (!row) throw badRequest('Druck-Agent nicht gefunden.');
  }

  // ---------------------------------------------------------------- Stationen
  app.get('/api/admin/stations', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { eventId } = parse(optionalEventQuery, req.query);
    const event = await resolveEvent(ctx.db, tenantId, eventId);
    const rows = await ctx.db
      .select()
      .from(stations)
      .where(eq(stations.eventId, event.id))
      .orderBy(asc(stations.sort), asc(stations.id));
    return rows.map(stationDto);
  });

  app.post('/api/admin/stations', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const body = parse(stationSchema.extend({ eventId: z.number().int().positive().optional() }), req.body);
    const event = await resolveEvent(ctx.db, tenantId, body.eventId);
    await checkPrinterRef(tenantId, body.printerId);
    const { eventId: _e, ...values } = body;
    const [row] = await ctx.db
      .insert(stations)
      .values({ ...values, tenantId, eventId: event.id, sort: body.sort ?? 999 })
      .returning();
    ctx.hub.broadcast(tenantId, { type: 'catalog' });
    return stationDto(row);
  });

  app.patch('/api/admin/stations/:id', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(stationSchema.partial(), req.body);
    await checkPrinterRef(tenantId, body.printerId);
    const [row] = await ctx.db
      .update(stations)
      .set(body)
      .where(and(eq(stations.id, id), eq(stations.tenantId, tenantId)))
      .returning();
    if (!row) throw notFound('Station nicht gefunden.');
    await audit(ctx.db, tenantId, auth, 'station.update', { id, ...body });
    ctx.hub.broadcast(tenantId, { type: 'catalog' });
    return stationDto(row);
  });

  app.delete('/api/admin/stations/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    try {
      const [row] = await ctx.db
        .delete(stations)
        .where(and(eq(stations.id, id), eq(stations.tenantId, tenantId)))
        .returning({ id: stations.id });
      if (!row) throw notFound('Station nicht gefunden.');
    } catch (err) {
      const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
      if (code === '23503') throw conflict('Der Station sind noch Produkte zugeordnet.');
      throw err;
    }
    ctx.hub.broadcast(tenantId, { type: 'catalog' });
    return { ok: true };
  });

  // ---------------------------------------------------------------- Drucker
  app.get('/api/admin/printers', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    return printerDtos(ctx.db, tenantId);
  });

  app.post('/api/admin/printers', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const body = parse(printerSchema, req.body);
    await checkAgentRef(tenantId, body.agentId);
    const [row] = await ctx.db
      .insert(printers)
      .values({ ...body, tenantId, status: body.type === 'simulator' ? 'ok' : 'unknown' })
      .returning();
    ctx.printing.kick();
    return row;
  });

  app.patch('/api/admin/printers/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(printerSchema.partial(), req.body);
    await ownedPrinter(ctx.db, tenantId, id);
    await checkAgentRef(tenantId, body.agentId);
    const [row] = await ctx.db
      .update(printers)
      .set({ ...body, status: 'unknown', statusMessage: null })
      .where(eq(printers.id, id))
      .returning();
    ctx.printing.forgetPrinter(id);
    // Wartende Aufträge sofort mit den neuen Einstellungen versuchen.
    await ctx.db
      .update(printJobs)
      .set({ nextAttemptAt: new Date() })
      .where(and(eq(printJobs.printerId, id), eq(printJobs.status, 'pending')));
    ctx.printing.kick();
    return row;
  });

  app.delete('/api/admin/printers/:id', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const printer = await ownedPrinter(ctx.db, tenantId, id);
    await ctx.db.delete(printers).where(eq(printers.id, id));
    ctx.printing.forgetPrinter(id);
    await audit(ctx.db, tenantId, auth, 'printer.delete', { id, name: printer.name });
    return { ok: true };
  });

  app.post('/api/admin/printers/:id/test', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const printer = await ownedPrinter(ctx.db, tenantId, id);
    const jobId = await ctx.printing.enqueue(ctx.db, {
      tenantId,
      printerId: id,
      kind: 'test',
      doc: buildTestBon({
        printerName: printer.name,
        profile: { widthChars: printer.widthChars, codepage: printer.codepage },
        time: ctx.formatTime(new Date()),
      }),
    });
    ctx.printing.kick();
    return { jobId };
  });

  /**
   * Drucker fällt aus: wartende Aufträge auf einen anderen Drucker umleiten und
   * optional alle Stationen der aktiven Veranstaltung mit umstellen.
   */
  app.post('/api/admin/printers/:id/redirect', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({ targetPrinterId: z.number().int().positive(), switchStations: z.boolean().default(true) }),
      req.body,
    );
    if (body.targetPrinterId === id) throw badRequest('Ziel ist derselbe Drucker.');
    await ownedPrinter(ctx.db, tenantId, id);
    await ownedPrinter(ctx.db, tenantId, body.targetPrinterId);
    const result = await ctx.db.transaction(async (tx) => {
      const moved = await tx
        .update(printJobs)
        .set({ printerId: body.targetPrinterId, nextAttemptAt: new Date(), lastError: null })
        .where(and(eq(printJobs.printerId, id), eq(printJobs.status, 'pending')))
        .returning({ id: printJobs.id });
      let switched = 0;
      if (body.switchStations) {
        const rows = await tx
          .update(stations)
          .set({ printerId: body.targetPrinterId })
          .where(and(eq(stations.tenantId, tenantId), eq(stations.printerId, id)))
          .returning({ id: stations.id });
        switched = rows.length;
      }
      await audit(tx, tenantId, auth, 'printer.redirect', { from: id, to: body.targetPrinterId, moved: moved.length, switched });
      return { moved: moved.length, switchedStations: switched };
    });
    ctx.printing.kick();
    ctx.hub.broadcast(tenantId, { type: 'catalog' });
    return result;
  });

  // ---------------------------------------------------------------- Druck-Agenten
  app.get('/api/admin/agents', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    return agentDtos(ctx, tenantId);
  });

  app.post('/api/admin/agents', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const body = parse(z.object({ name: z.string().trim().min(1).max(60) }), req.body);
    const token = randomToken();
    const [row] = await ctx.db
      .insert(agents)
      .values({ tenantId, name: body.name, tokenHash: sha256(token) })
      .returning();
    await audit(ctx.db, tenantId, auth, 'agent.create', { id: row.id, name: row.name });
    return { id: row.id, name: row.name, token };
  });

  app.post('/api/admin/agents/:id/token', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const token = randomToken();
    const [row] = await ctx.db
      .update(agents)
      .set({ tokenHash: sha256(token) })
      .where(and(eq(agents.id, id), eq(agents.tenantId, tenantId)))
      .returning();
    if (!row) throw notFound('Druck-Agent nicht gefunden.');
    ctx.agentHub.disconnect(id);
    await audit(ctx.db, tenantId, auth, 'agent.token', { id });
    return { id: row.id, name: row.name, token };
  });

  app.patch('/api/admin/agents/:id', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ name: z.string().trim().min(1).max(60) }), req.body);
    const [row] = await ctx.db
      .update(agents)
      .set(body)
      .where(and(eq(agents.id, id), eq(agents.tenantId, tenantId)))
      .returning({ id: agents.id });
    if (!row) throw notFound('Druck-Agent nicht gefunden.');
    return { ok: true };
  });

  app.delete('/api/admin/agents/:id', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const [row] = await ctx.db
      .delete(agents)
      .where(and(eq(agents.id, id), eq(agents.tenantId, tenantId)))
      .returning({ id: agents.id });
    if (!row) throw notFound('Druck-Agent nicht gefunden.');
    ctx.agentHub.disconnect(id);
    await audit(ctx.db, tenantId, auth, 'agent.delete', { id });
    return { ok: true };
  });

  // ---------------------------------------------------------------- Druckaufträge
  app.get('/api/admin/print-jobs', async (req): Promise<PrintJobDto[]> => {
    const { tenantId } = requireTenant(req, 'admin');
    const q = parse(
      z.object({
        printerId: z.coerce.number().int().positive().optional(),
        status: z.enum(['open', 'done', 'all']).default('all'),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    const conditions = [eq(printJobs.tenantId, tenantId)];
    if (q.printerId) conditions.push(eq(printJobs.printerId, q.printerId));
    if (q.status === 'open') conditions.push(inArray(printJobs.status, ['pending', 'sent']));
    if (q.status === 'done') conditions.push(eq(printJobs.status, 'done'));
    const rows = await ctx.db
      .select({ job: printJobs, printer: printers })
      .from(printJobs)
      .leftJoin(printers, eq(printers.id, printJobs.printerId))
      .where(and(...conditions))
      .orderBy(desc(printJobs.id))
      .limit(q.limit);
    return rows.map(({ job, printer }) => ({
      id: job.id,
      printerId: job.printerId,
      printerName: printer?.name ?? '(gelöscht)',
      kind: job.kind,
      status: job.status,
      attempts: job.attempts,
      lastError: job.lastError,
      createdAt: job.createdAt.toISOString(),
      printedAt: iso(job.printedAt),
      doc: job.doc,
      widthChars: printer?.widthChars ?? 48,
      codepage: printer?.codepage ?? 'cp858',
    }));
  });

  async function ownedJob(tenantId: number, id: number) {
    const [row] = await ctx.db
      .select()
      .from(printJobs)
      .where(and(eq(printJobs.id, id), eq(printJobs.tenantId, tenantId)));
    if (!row) throw notFound('Druckauftrag nicht gefunden.');
    return row;
  }

  app.post('/api/admin/print-jobs/:id/retry', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    const job = await ownedJob(tenantId, id);
    if (job.status === 'done' || job.status === 'cancelled') {
      // Fertige Aufträge werden als neuer Nachdruck angelegt.
      if (!job.printerId) throw badRequest('Der Drucker existiert nicht mehr.');
      await ctx.printing.enqueue(ctx.db, {
        tenantId,
        printerId: job.printerId,
        kind: 'reprint',
        doc: job.doc,
        ticketId: job.ticketId,
        orderId: job.orderId,
      });
    } else {
      await ctx.db
        .update(printJobs)
        .set({ status: 'pending', nextAttemptAt: new Date() })
        .where(eq(printJobs.id, id));
    }
    ctx.printing.kick();
    return { ok: true };
  });

  app.post('/api/admin/print-jobs/:id/cancel', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const { id } = parse(idParam, req.params);
    await ownedJob(tenantId, id);
    await ctx.db
      .update(printJobs)
      .set({ status: 'cancelled' })
      .where(and(eq(printJobs.id, id), inArray(printJobs.status, ['pending', 'sent'])));
    await audit(ctx.db, tenantId, auth, 'printjob.cancel', { id });
    ctx.printing.kick();
    return { ok: true };
  });

  app.post('/api/admin/print-jobs/cancel-all', async (req) => {
    const { auth, tenantId } = requireTenant(req, 'admin');
    const body = parse(z.object({ printerId: z.number().int().positive() }), req.body);
    await ownedPrinter(ctx.db, tenantId, body.printerId);
    const rows = await ctx.db
      .update(printJobs)
      .set({ status: 'cancelled' })
      .where(and(eq(printJobs.printerId, body.printerId), eq(printJobs.status, 'pending')))
      .returning({ id: printJobs.id });
    await audit(ctx.db, tenantId, auth, 'printjob.cancel-all', { printerId: body.printerId, count: rows.length });
    return { cancelled: rows.length };
  });

  // ---------------------------------------------------------------- Übersicht
  app.get('/api/admin/overview', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
    const printerList = await printerDtos(ctx.db, tenantId);
    const agentList = await agentDtos(ctx, tenantId);
    const event = await getActiveEvent(ctx.db, tenantId);
    const warnings: string[] = [];
    let stationStats: { id: number; name: string; open: number; accepted: number; problem: string | null }[] = [];
    let orderStats = { orders: 0, lastHour: 0 };
    if (!event) warnings.push('Keine Veranstaltung aktiv.');
    else {
      const stationRows = await ctx.db
        .select()
        .from(stations)
        .where(eq(stations.eventId, event.id))
        .orderBy(asc(stations.sort));
      const counts = await ctx.db.execute<{ station_id: number; status: string; n: number }>(sql`
        select station_id, status, count(*)::int as n from tickets
        where event_id = ${event.id} and status in ('open', 'accepted')
        group by station_id, status`);
      stationStats = stationRows.map((s) => {
        const open = counts.rows.find((c) => c.station_id === s.id && c.status === 'open')?.n ?? 0;
        const accepted = counts.rows.find((c) => c.station_id === s.id && c.status === 'accepted')?.n ?? 0;
        let problem: string | null = null;
        if (s.printTrigger !== 'never' && !s.printerId) problem = 'Kein Drucker zugeordnet';
        if (!s.showOnDisplay && s.printTrigger !== 'on_order')
          problem = 'Nicht am Tablet sichtbar – es wird deshalb sofort gedruckt';
        if (problem) warnings.push(`Station "${s.name}": ${problem}.`);
        return { id: s.id, name: s.name, open, accepted, problem };
      });
      const [o] = (
        await ctx.db.execute<{ orders: number; last_hour: number }>(sql`
        select count(*)::int as orders,
               count(*) filter (where created_at > now() - interval '1 hour')::int as last_hour
        from orders where event_id = ${event.id}`)
      ).rows;
      orderStats = { orders: o.orders, lastHour: o.last_hour };
    }
    for (const p of printerList) {
      if (p.status === 'error' || p.status === 'offline') warnings.push(`Drucker "${p.name}": ${p.statusMessage ?? p.status}`);
    }
    for (const a of agentList) if (!a.connected) warnings.push(`Druck-Agent "${a.name}" ist nicht verbunden.`);
    return {
      tenantName: tenant?.name ?? '',
      event: event ? { id: event.id, name: event.name } : null,
      printers: printerList,
      agents: agentList,
      stations: stationStats,
      orders: orderStats,
      warnings,
    };
  });
}
