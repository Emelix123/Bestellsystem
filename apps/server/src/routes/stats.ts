import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { requireTenant } from '../lib/auth';
import { parse, z } from '../lib/validate';
import { resolveEvent } from '../services/common';
import { loadExportLines, loadStats } from '../services/stats';

const statsQuery = z.object({
  eventId: z.coerce.number().int().positive().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function csvCell(value: string | number): string {
  const s = String(value);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function euro(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function fileName(eventName: string, ext: string) {
  const safe = eventName.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '_').slice(0, 50) || 'veranstaltung';
  return `bestellungen_${safe}.${ext}`;
}

function contentDisposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function registerStatsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/stats', async (req) => {
    const { tenantId } = requireTenant(req, 'admin');
    const q = parse(statsQuery, req.query);
    const event = await resolveEvent(ctx.db, tenantId, q.eventId);
    return loadStats(ctx, tenantId, event, { from: q.from, to: q.to });
  });

  app.get('/api/admin/export.csv', async (req, reply) => {
    const { tenantId } = requireTenant(req, 'admin');
    const q = parse(statsQuery, req.query);
    const event = await resolveEvent(ctx.db, tenantId, q.eventId);
    const stats = await loadStats(ctx, tenantId, event, { from: q.from, to: q.to });
    const lines = await loadExportLines(ctx, event, { from: q.from, to: q.to });
    const header = ['Bestellung', 'Zeit', 'Art', 'Ort', 'Bedienung', 'Kategorie', 'Station', 'Produkt', 'Optionen', 'Notiz', 'Menge', 'Storniert'];
    if (stats.showValues) header.push('Einzelpreis', 'Summe');
    const rows = lines.map((l) => {
      const cells: (string | number)[] = [
        l.orderNumber, l.time, l.kind, l.location, l.waiter, l.category, l.station, l.product, l.options, l.note, l.qty, l.cancelledQty,
      ];
      if (stats.showValues) cells.push(euro(l.unitPriceCents), euro((l.qty - l.cancelledQty) * l.unitPriceCents));
      return cells.map(csvCell).join(';');
    });
    // BOM + Semikolon: so öffnet deutsches Excel die Datei direkt richtig.
    const body = '﻿' + [header.join(';'), ...rows].join('\r\n') + '\r\n';
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', contentDisposition(fileName(event.name, 'csv')));
    return body;
  });

  app.get('/api/admin/export.xlsx', async (req, reply) => {
    const { tenantId } = requireTenant(req, 'admin');
    const q = parse(statsQuery, req.query);
    const event = await resolveEvent(ctx.db, tenantId, q.eventId);
    const stats = await loadStats(ctx, tenantId, event, { from: q.from, to: q.to });
    const lines = await loadExportLines(ctx, event, { from: q.from, to: q.to });
    const values = stats.showValues;
    const money = '#,##0.00 "€"';

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Bestellsystem';
    wb.created = new Date();

    const summary = wb.addWorksheet('Übersicht');
    summary.columns = [{ width: 28 }, { width: 22 }];
    summary.addRows([
      ['Veranstaltung', event.name],
      ['Datum', event.date ?? ''],
      ['Bestellungen', stats.totals.orders],
      ['Positionen (Stück)', stats.totals.items],
      ['Storniert (Stück)', stats.totals.cancelledItems],
    ]);
    if (values) {
      const row = summary.addRow(['Bestellwert', (stats.totals.valueCents ?? 0) / 100]);
      row.getCell(2).numFmt = money;
    }
    summary.getColumn(1).font = { bold: true };

    const groupSheet = (name: string, label: string, rows: typeof stats.products) => {
      const ws = wb.addWorksheet(name);
      ws.columns = [
        { header: label, key: 'label', width: 32 },
        { header: 'Stück', key: 'qty', width: 10 },
        { header: 'Storniert', key: 'cancelled', width: 10 },
        ...(values ? [{ header: 'Wert', key: 'value', width: 14, style: { numFmt: money } }] : []),
      ];
      for (const r of rows) {
        ws.addRow({ label: r.label, qty: r.qty, cancelled: r.cancelledQty, value: (r.valueCents ?? 0) / 100 });
      }
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    };
    groupSheet('Produkte', 'Produkt', stats.products);
    groupSheet('Kategorien', 'Kategorie', stats.categories);
    groupSheet('Stationen', 'Station', stats.stations);
    groupSheet('Bedienungen', 'Bedienung', stats.waiters);

    const timeline = wb.addWorksheet('Zeitverlauf');
    timeline.columns = [
      { header: 'Zeit (15 Min.)', key: 'bucket', width: 20 },
      { header: 'Bestellungen', key: 'orders', width: 14 },
      { header: 'Stück', key: 'items', width: 10 },
    ];
    for (const p of stats.timeline) timeline.addRow({ bucket: p.bucket.replace('T', ' ').slice(0, 16), orders: p.orders, items: p.items });
    timeline.getRow(1).font = { bold: true };

    const through = wb.addWorksheet('Durchlaufzeit');
    through.columns = [
      { header: 'Station', key: 'station', width: 24 },
      { header: 'Tickets', key: 'tickets', width: 10 },
      { header: 'Ø Minuten bis fertig', key: 'avg', width: 22 },
      { header: 'Max. Minuten', key: 'max', width: 14 },
    ];
    for (const t of stats.throughput) {
      through.addRow({
        station: t.stationName,
        tickets: t.tickets,
        avg: t.avgSecondsToDone === null ? '' : Math.round(t.avgSecondsToDone / 6) / 10,
        max: t.maxSecondsToDone === null ? '' : Math.round(t.maxSecondsToDone / 6) / 10,
      });
    }
    through.getRow(1).font = { bold: true };

    const detail = wb.addWorksheet('Positionen');
    detail.columns = [
      { header: 'Bestellung', key: 'orderNumber', width: 11 },
      { header: 'Zeit', key: 'time', width: 20 },
      { header: 'Art', key: 'kind', width: 8 },
      { header: 'Ort', key: 'location', width: 18 },
      { header: 'Bedienung', key: 'waiter', width: 16 },
      { header: 'Kategorie', key: 'category', width: 16 },
      { header: 'Station', key: 'station', width: 14 },
      { header: 'Produkt', key: 'product', width: 28 },
      { header: 'Optionen', key: 'options', width: 24 },
      { header: 'Notiz', key: 'note', width: 24 },
      { header: 'Menge', key: 'qty', width: 8 },
      { header: 'Storniert', key: 'cancelledQty', width: 10 },
      ...(values
        ? [
            { header: 'Einzelpreis', key: 'unit', width: 12, style: { numFmt: money } },
            { header: 'Summe', key: 'sum', width: 12, style: { numFmt: money } },
          ]
        : []),
    ];
    for (const l of lines) {
      detail.addRow({
        ...l,
        unit: l.unitPriceCents / 100,
        sum: ((l.qty - l.cancelledQty) * l.unitPriceCents) / 100,
      });
    }
    detail.getRow(1).font = { bold: true };
    detail.views = [{ state: 'frozen', ySplit: 1 }];
    detail.autoFilter = { from: 'A1', to: { row: 1, column: detail.columns.length } };

    const buffer = await wb.xlsx.writeBuffer();
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', contentDisposition(fileName(event.name, 'xlsx')));
    return Buffer.from(buffer);
  });
}
