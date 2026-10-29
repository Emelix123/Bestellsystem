import {
  buildTicketBon,
  renderEscPos,
  type BonDoc,
  type BonItem,
  type BonLocation,
  type PrintJobKind,
  type PrinterStatus,
} from '@bestellsystem/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import net from 'node:net';
import type { Db, DbOrTx } from '../db/client';
import { orderItems, orders, printers, printJobs, stations, tickets } from '../db/schema';
import type { Hub } from '../lib/hub';
import type { AgentHub } from './agents';

type PrinterRow = typeof printers.$inferSelect;
type OrderRow = typeof orders.$inferSelect;
type TicketRow = typeof tickets.$inferSelect;
type StationRow = typeof stations.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;

interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface EnqueueInput {
  tenantId: number;
  printerId: number;
  kind: PrintJobKind;
  doc: BonDoc;
  ticketId?: number | null;
  orderId?: number | null;
}

const MAX_BACKOFF_MS = 10_000;

function backoff(attempts: number) {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempts - 1));
}

export function sendTcp(host: string, port: number, data: Uint8Array, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(timeoutMs, () => done(new Error('Zeitüberschreitung – Drucker antwortet nicht')));
    socket.on('error', (err) => done(new Error(`Netzwerkfehler: ${err.message}`)));
    socket.on('connect', () => {
      socket.end(Buffer.from(data), () => done());
    });
  });
}

/**
 * Druck-Warteschlange. Aufträge liegen in der Datenbank und gehen deshalb
 * nicht verloren, wenn ein Drucker oder Agent kurz weg ist. Pro Drucker wird
 * immer nur ein Auftrag gleichzeitig verschickt, damit die Reihenfolge stimmt.
 */
export class PrintService {
  private inFlight = new Map<number, number>();
  private running = false;
  private rerun = false;
  private timer: NodeJS.Timeout | null = null;
  private statusCache = new Map<number, string>();

  constructor(
    private db: Db,
    private hub: Hub,
    private agentHub: AgentHub,
    private log: Logger,
  ) {
    agentHub.events = {
      // Gerätestatus erst bewerten, wenn der Agent seine Geräteliste geschickt hat ("hello").
      onConnect: (agentId, tenantId) => {
        this.hub.broadcast(tenantId, { type: 'agent', agentId, connected: true });
        this.kick();
      },
      onDevices: (agentId, tenantId) => void this.refreshAgentPrinters(agentId, tenantId),
      onDisconnect: (agentId, tenantId) => void this.handleAgentDisconnect(agentId, tenantId),
      onResult: (agentId, jobId, ok, error) => void this.handleAgentResult(agentId, jobId, ok, error),
      onBlocked: (agentId, jobId, message) => void this.handleAgentBlocked(agentId, jobId, message),
    };
  }

  async start() {
    // Nach einem Neustart ist kein Agent verbunden – "unterwegs" heißt jetzt "wartend".
    await this.db.update(printJobs).set({ status: 'pending' }).where(eq(printJobs.status, 'sent'));
    this.timer = setInterval(() => this.kick(), 2000);
    this.kick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Nach dem Anlegen von Aufträgen aufrufen (nach dem Commit der Transaktion). */
  kick() {
    if (this.running) {
      this.rerun = true;
      return;
    }
    void this.process();
  }

  async enqueue(tx: DbOrTx, input: EnqueueInput): Promise<number> {
    const [row] = await tx
      .insert(printJobs)
      .values({
        tenantId: input.tenantId,
        printerId: input.printerId,
        kind: input.kind,
        doc: input.doc,
        ticketId: input.ticketId ?? null,
        orderId: input.orderId ?? null,
      })
      .returning({ id: printJobs.id });
    return row.id;
  }

  /** Wartet, bis alle gerade anstehenden Aufträge verarbeitet sind (für Tests). */
  async drain() {
    while (this.running) await new Promise((r) => setTimeout(r, 10));
    await this.process();
    while (this.running || this.inFlight.size > 0) await new Promise((r) => setTimeout(r, 10));
  }

  private async process() {
    if (this.running) return;
    this.running = true;
    try {
      do {
        this.rerun = false;
        await this.processOnce();
      } while (this.rerun);
    } catch (err) {
      this.log.error({ err }, 'Druck-Warteschlange: Fehler');
    } finally {
      this.running = false;
    }
  }

  private async processOnce() {
    // Pro Drucker nur der älteste wartende Auftrag – strikte Reihenfolge.
    const heads = await this.db
      .selectDistinctOn([printJobs.printerId], {
        id: printJobs.id,
        printerId: printJobs.printerId,
        nextAttemptAt: printJobs.nextAttemptAt,
      })
      .from(printJobs)
      .where(eq(printJobs.status, 'pending'))
      .orderBy(printJobs.printerId, printJobs.id);
    if (heads.length === 0) return;

    const orphaned = heads.filter((h) => h.printerId === null).map((h) => h.id);
    if (orphaned.length > 0) {
      await this.db
        .update(printJobs)
        .set({ status: 'cancelled', lastError: 'Drucker wurde gelöscht' })
        .where(and(eq(printJobs.status, 'pending'), sql`${printJobs.printerId} is null`));
    }

    const now = Date.now();
    const due = heads.filter(
      (h) => h.printerId !== null && !this.inFlight.has(h.printerId) && h.nextAttemptAt.getTime() <= now,
    );
    if (due.length === 0) return;

    const printerRows = await this.db
      .select()
      .from(printers)
      .where(inArray(printers.id, due.map((d) => d.printerId!)));
    const byId = new Map(printerRows.map((p) => [p.id, p]));

    for (const head of due) {
      const printer = byId.get(head.printerId!);
      if (!printer) continue;
      await this.dispatch(head.id, printer);
    }
  }

  private async dispatch(jobId: number, printer: PrinterRow) {
    const [job] = await this.db.select().from(printJobs).where(eq(printJobs.id, jobId));
    if (!job || job.status !== 'pending') return;

    if (printer.type === 'simulator') {
      await this.markDone(job.id, printer);
      return;
    }

    const bytes = renderEscPos(job.doc, {
      widthChars: printer.widthChars,
      codepage: printer.codepage,
      cut: printer.cut,
    });

    if (printer.type === 'network') {
      if (!printer.host) {
        await this.markFailed(job.id, printer, 'Keine IP-Adresse eingetragen');
        return;
      }
      this.inFlight.set(printer.id, job.id);
      sendTcp(printer.host, printer.port, bytes)
        .then(() => this.markDone(job.id, printer))
        .catch((err: Error) => this.markFailed(job.id, printer, err.message))
        .finally(() => {
          this.inFlight.delete(printer.id);
          this.kick();
        });
      return;
    }

    // USB über Druck-Agent
    if (!printer.agentId || !printer.deviceKey) {
      await this.markFailed(job.id, printer, 'Kein Druck-Agent / kein USB-Gerät zugeordnet');
      return;
    }
    if (!this.agentHub.isConnected(printer.agentId)) {
      await this.setPrinterStatus(printer, 'offline', 'Druck-Agent nicht verbunden – Aufträge warten');
      return;
    }
    this.inFlight.set(printer.id, job.id);
    await this.db.update(printJobs).set({ status: 'sent', sentAt: new Date() }).where(eq(printJobs.id, job.id));
    const sent = this.agentHub.send(printer.agentId, {
      type: 'job',
      jobId: job.id,
      deviceKey: printer.deviceKey,
      data: Buffer.from(bytes).toString('base64'),
    });
    if (!sent) {
      this.inFlight.delete(printer.id);
      await this.db.update(printJobs).set({ status: 'pending' }).where(eq(printJobs.id, job.id));
    }
  }

  private async markDone(jobId: number, printer: PrinterRow) {
    await this.db
      .update(printJobs)
      .set({ status: 'done', printedAt: new Date(), lastError: null })
      .where(and(eq(printJobs.id, jobId), inArray(printJobs.status, ['pending', 'sent'])));
    await this.db.update(printers).set({ lastSeenAt: new Date() }).where(eq(printers.id, printer.id));
    await this.setPrinterStatus(printer, 'ok', null);
    this.hub.broadcast(printer.tenantId, {
      type: 'printjob',
      jobId,
      printerId: printer.id,
      status: 'done',
      lastError: null,
    });
  }

  private async markFailed(jobId: number, printer: PrinterRow, error: string) {
    const [row] = await this.db
      .update(printJobs)
      .set({
        status: 'pending',
        attempts: sql`${printJobs.attempts} + 1`,
        lastError: error,
      })
      .where(and(eq(printJobs.id, jobId), inArray(printJobs.status, ['pending', 'sent'])))
      .returning({ attempts: printJobs.attempts });
    if (row) {
      await this.db
        .update(printJobs)
        .set({ nextAttemptAt: new Date(Date.now() + backoff(row.attempts)) })
        .where(eq(printJobs.id, jobId));
    }
    this.log.warn({ jobId, printer: printer.name, error }, 'Druck fehlgeschlagen – wird wiederholt');
    await this.setPrinterStatus(printer, 'error', error);
    this.hub.broadcast(printer.tenantId, {
      type: 'printjob',
      jobId,
      printerId: printer.id,
      status: 'pending',
      lastError: error,
    });
  }

  async setPrinterStatus(printer: Pick<PrinterRow, 'id' | 'tenantId'>, status: PrinterStatus, message: string | null) {
    const key = `${status}|${message ?? ''}`;
    if (this.statusCache.get(printer.id) === key) return;
    this.statusCache.set(printer.id, key);
    await this.db.update(printers).set({ status, statusMessage: message }).where(eq(printers.id, printer.id));
    this.hub.broadcast(printer.tenantId, { type: 'printer', printerId: printer.id, status, statusMessage: message });
  }

  forgetPrinter(printerId: number) {
    this.statusCache.delete(printerId);
    this.inFlight.delete(printerId);
  }

  private async refreshAgentPrinters(agentId: number, tenantId: number) {
    const rows = await this.db.select().from(printers).where(eq(printers.agentId, agentId));
    const devices = this.agentHub.devices(agentId) ?? [];
    for (const printer of rows) {
      if (printer.type !== 'usb') continue;
      const device = printer.deviceKey ? devices.find((d) => d.key === printer.deviceKey) : undefined;
      if (device) {
        // Drucker (wieder) da: wartende Aufträge sofort versuchen, nicht erst nach Ablauf der Wartezeit.
        await this.db
          .update(printJobs)
          .set({ nextAttemptAt: new Date() })
          .where(and(eq(printJobs.printerId, printer.id), eq(printJobs.status, 'pending')));
      }
      if (!printer.deviceKey) await this.setPrinterStatus(printer, 'error', 'Kein Drucker am Agent ausgewählt');
      else if (!device) await this.setPrinterStatus(printer, 'error', 'Drucker am Agent nicht gefunden (Kabel/Strom?)');
      // Vom Betriebssystem gemeldetes Problem (z. B. Windows: offline, Warteschlange hängt).
      else if (device.problem) await this.setPrinterStatus(printer, 'error', device.problem);
      else await this.setPrinterStatus(printer, 'ok', null);
    }
    this.hub.broadcast(tenantId, { type: 'agent', agentId, connected: true });
    this.kick();
  }

  private async handleAgentDisconnect(agentId: number, tenantId: number) {
    const rows = await this.db.select().from(printers).where(eq(printers.agentId, agentId));
    for (const printer of rows) {
      this.inFlight.delete(printer.id);
      await this.db
        .update(printJobs)
        .set({ status: 'pending' })
        .where(and(eq(printJobs.printerId, printer.id), eq(printJobs.status, 'sent')));
      await this.setPrinterStatus(printer, 'offline', 'Druck-Agent nicht verbunden – Aufträge warten');
    }
    this.hub.broadcast(tenantId, { type: 'agent', agentId, connected: false });
  }

  private async findAgentJob(agentId: number, jobId: number) {
    const [row] = await this.db
      .select({ job: printJobs, printer: printers })
      .from(printJobs)
      .innerJoin(printers, eq(printers.id, printJobs.printerId))
      .where(and(eq(printJobs.id, jobId), eq(printers.agentId, agentId)));
    return row ?? null;
  }

  private async handleAgentResult(agentId: number, jobId: number, ok: boolean, error?: string) {
    const row = await this.findAgentJob(agentId, jobId);
    if (!row) return;
    if (this.inFlight.get(row.printer.id) === jobId) this.inFlight.delete(row.printer.id);
    if (ok) await this.markDone(jobId, row.printer);
    else await this.markFailed(jobId, row.printer, error ?? 'Unbekannter Fehler am Druck-Agent');
    this.kick();
  }

  private async handleAgentBlocked(agentId: number, jobId: number, message: string) {
    const row = await this.findAgentJob(agentId, jobId);
    if (!row) return;
    await this.setPrinterStatus(row.printer, 'error', message);
  }
}

// ---------------------------------------------------------------------------
// Bons für Tickets
// ---------------------------------------------------------------------------

export function orderLocation(order: Pick<OrderRow, 'kind' | 'areaName' | 'tableLabel' | 'pickupNumber'>): BonLocation {
  return order.kind === 'togo'
    ? { kind: 'togo', pickupNumber: order.pickupNumber ?? 0 }
    : { kind: 'table', areaName: order.areaName ?? '', tableLabel: order.tableLabel ?? '?' };
}

export function bonItem(item: Pick<OrderItemRow, 'bonName' | 'options' | 'note'>, qty: number): BonItem {
  return { qty, name: item.bonName, options: item.options.map((o) => o.name), note: item.note };
}

export interface TicketPrintContext {
  order: OrderRow;
  ticket: TicketRow;
  station: StationRow;
  items: OrderItemRow[];
  time: string;
}

/** Erzeugt die Bons für ein Ticket (bei "ein Bon pro Stück" mehrere). */
export function ticketDocs(ctx: TicketPrintContext, banner?: string): BonDoc[] {
  const live = ctx.items
    .map((item) => ({ item, qty: item.qty - item.cancelledQty }))
    .filter((x) => x.qty > 0);
  if (live.length === 0) return [];
  const base = {
    stationName: ctx.station.name,
    location: orderLocation(ctx.order),
    orderNumber: ctx.order.number,
    waiterName: ctx.order.waiterName,
    time: ctx.time,
    orderNote: ctx.order.note,
    banner,
  };
  if (!ctx.station.bonPerItem) {
    return [buildTicketBon({ ...base, items: live.map((x) => bonItem(x.item, x.qty)) })];
  }
  const units = live.flatMap((x) => Array.from({ length: x.qty }, () => x.item));
  return units.map((item, i) =>
    buildTicketBon({ ...base, items: [bonItem(item, 1)], part: `${i + 1}/${units.length}` }),
  );
}
