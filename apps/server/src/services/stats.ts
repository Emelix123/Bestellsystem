import type { StatsResponse, StatsRow } from '@bestellsystem/shared';
import { sql } from 'drizzle-orm';
import type { AppContext } from '../context';
import { eventSummary, getTenantSettings, type EventRow } from './common';

interface Range {
  from?: Date;
  to?: Date;
}

function rangeSql(range: Range) {
  return sql`${range.from ? sql`and o.created_at >= ${range.from}` : sql``} ${range.to ? sql`and o.created_at < ${range.to}` : sql``}`;
}

/**
 * Statistik über Stückzahlen (immer) und Werte in Euro (nur wenn in den
 * Einstellungen des Vereins freigeschaltet).
 */
export async function loadStats(ctx: AppContext, tenantId: number, event: EventRow, range: Range = {}): Promise<StatsResponse> {
  const settings = await getTenantSettings(ctx.db, tenantId);
  const showValues = settings.statsShowValues;
  const tz = ctx.config.timezone;
  const r = rangeSql(range);

  const grouped = async (keyExpr: ReturnType<typeof sql>, labelExpr: ReturnType<typeof sql>): Promise<StatsRow[]> => {
    const res = await ctx.db.execute<{ key: string; label: string; qty: number; cancelled: number; value: number }>(sql`
      select ${keyExpr}::text as key, ${labelExpr} as label,
             sum(i.qty - i.cancelled_qty)::int as qty,
             sum(i.cancelled_qty)::int as cancelled,
             sum((i.qty - i.cancelled_qty) * i.unit_price_cents)::int as value
      from order_items i join orders o on o.id = i.order_id
      where o.event_id = ${event.id} ${r}
      group by 1, 2
      order by qty desc, label`);
    return res.rows.map((row) => ({
      key: row.key,
      label: row.label,
      qty: row.qty,
      cancelledQty: row.cancelled,
      valueCents: showValues ? row.value : null,
    }));
  };

  const [totalsRes, products, categories, stations, waiters, timelineRes, throughputRes] = await Promise.all([
    ctx.db.execute<{ orders: number; items: number; cancelled: number; value: number }>(sql`
      select count(distinct o.id)::int as orders,
             coalesce(sum(i.qty - i.cancelled_qty), 0)::int as items,
             coalesce(sum(i.cancelled_qty), 0)::int as cancelled,
             coalesce(sum((i.qty - i.cancelled_qty) * i.unit_price_cents), 0)::int as value
      from orders o left join order_items i on i.order_id = o.id
      where o.event_id = ${event.id} ${r}`),
    grouped(sql`coalesce(i.product_id::text, i.name)`, sql`i.name`),
    grouped(sql`i.category_name`, sql`i.category_name`),
    grouped(sql`i.station_name`, sql`i.station_name`),
    grouped(sql`o.waiter_name`, sql`o.waiter_name`),
    ctx.db.execute<{ bucket: string; orders: number; items: number }>(sql`
      select to_char(date_bin('15 minutes', o.created_at at time zone ${tz}, timestamp '2000-01-01'), 'YYYY-MM-DD"T"HH24:MI:SS') as bucket,
             count(distinct o.id)::int as orders,
             coalesce(sum(i.qty - i.cancelled_qty), 0)::int as items
      from orders o left join order_items i on i.order_id = o.id
      where o.event_id = ${event.id} ${r}
      group by 1 order by 1`),
    ctx.db.execute<{ station_name: string; tickets: number; avg_s: number | null; max_s: number | null }>(sql`
      select t.station_name, count(*)::int as tickets,
             avg(extract(epoch from (t.done_at - t.created_at)))::float as avg_s,
             max(extract(epoch from (t.done_at - t.created_at)))::float as max_s
      from tickets t join orders o on o.id = t.order_id join stations s on s.id = t.station_id
      where t.event_id = ${event.id} and t.status = 'done' and s.show_on_display ${r}
      group by t.station_name order by t.station_name`),
  ]);
  const totals = totalsRes.rows[0];
  return {
    event: eventSummary(event),
    showValues,
    totals: {
      orders: totals.orders,
      items: totals.items,
      cancelledItems: totals.cancelled,
      valueCents: showValues ? totals.value : null,
    },
    products,
    categories,
    stations,
    waiters,
    // Lokale Zeit ohne Zeitzone – das Diagramm zeigt sie so, wie sie am Fest war.
    timeline: timelineRes.rows.map((row) => ({ bucket: row.bucket, orders: row.orders, items: row.items })),
    throughput: throughputRes.rows.map((row) => ({
      stationName: row.station_name,
      tickets: row.tickets,
      avgSecondsToDone: row.avg_s === null ? null : Math.round(row.avg_s),
      maxSecondsToDone: row.max_s === null ? null : Math.round(row.max_s),
    })),
  };
}

export interface ExportLine {
  orderNumber: number;
  time: string;
  kind: string;
  location: string;
  waiter: string;
  category: string;
  station: string;
  product: string;
  options: string;
  note: string;
  qty: number;
  cancelledQty: number;
  unitPriceCents: number;
}

export async function loadExportLines(ctx: AppContext, event: EventRow, range: Range = {}): Promise<ExportLine[]> {
  const tz = ctx.config.timezone;
  const res = await ctx.db.execute<{
    number: number;
    time: string;
    kind: string;
    area_name: string | null;
    table_label: string | null;
    pickup_number: number | null;
    waiter_name: string;
    category_name: string;
    station_name: string;
    name: string;
    options: { name: string }[];
    note: string | null;
    qty: number;
    cancelled_qty: number;
    unit_price_cents: number;
  }>(sql`
    select o.number, to_char(o.created_at at time zone ${tz}, 'YYYY-MM-DD HH24:MI:SS') as time,
           o.kind, o.area_name, o.table_label, o.pickup_number, o.waiter_name,
           i.category_name, i.station_name, i.name, i.options, i.note, i.qty, i.cancelled_qty, i.unit_price_cents
    from order_items i join orders o on o.id = i.order_id
    where o.event_id = ${event.id} ${rangeSql(range)}
    order by o.id, i.id`);
  return res.rows.map((row) => ({
    orderNumber: row.number,
    time: row.time,
    kind: row.kind === 'togo' ? 'To-Go' : 'Tisch',
    location: row.kind === 'togo' ? `Abholnr. ${row.pickup_number}` : `${row.area_name ?? ''} ${row.table_label ?? ''}`.trim(),
    waiter: row.waiter_name,
    category: row.category_name,
    station: row.station_name,
    product: row.name,
    options: row.options.map((o) => o.name).join(', '),
    note: row.note ?? '',
    qty: row.qty,
    cancelledQty: row.cancelled_qty,
    unitPriceCents: row.unit_price_cents,
  }));
}
