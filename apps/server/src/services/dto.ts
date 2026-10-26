import type { OrderDto, TicketDto } from '@bestellsystem/shared';
import { asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { orderItems, orders, tickets } from '../db/schema';
import { iso } from '../lib/time';

type OrderRow = typeof orders.$inferSelect;
type ItemRow = typeof orderItems.$inferSelect;
type TicketRow = typeof tickets.$inferSelect;

export function toOrderDto(order: OrderRow, items: ItemRow[], ticketRows: TicketRow[]): OrderDto {
  return {
    id: order.id,
    number: order.number,
    kind: order.kind,
    tableId: order.tableId,
    tableLabel: order.tableLabel,
    areaName: order.areaName,
    pickupNumber: order.pickupNumber,
    waiterId: order.waiterId,
    waiterName: order.waiterName,
    note: order.note,
    createdAt: order.createdAt.toISOString(),
    readyAt: iso(order.readyAt),
    pickedUpAt: iso(order.pickedUpAt),
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      stationId: i.stationId,
      ticketId: i.ticketId,
      name: i.name,
      qty: i.qty,
      cancelledQty: i.cancelledQty,
      unitPriceCents: i.unitPriceCents,
      depositCents: i.depositCents,
      options: i.options,
      note: i.note,
    })),
    tickets: ticketRows.map((t) => ({ id: t.id, stationId: t.stationId, stationName: t.stationName, status: t.status })),
  };
}

export async function loadOrders(db: DbOrTx, where: SQL | undefined, limit = 100): Promise<OrderDto[]> {
  const orderRows = await db.select().from(orders).where(where).orderBy(desc(orders.id)).limit(limit);
  if (orderRows.length === 0) return [];
  const ids = orderRows.map((o) => o.id);
  const itemRows = await db.select().from(orderItems).where(inArray(orderItems.orderId, ids)).orderBy(asc(orderItems.id));
  const ticketRows = await db.select().from(tickets).where(inArray(tickets.orderId, ids)).orderBy(asc(tickets.id));
  return orderRows.map((o) =>
    toOrderDto(
      o,
      itemRows.filter((i) => i.orderId === o.id),
      ticketRows.filter((t) => t.orderId === o.id),
    ),
  );
}

export async function loadOrder(db: DbOrTx, orderId: number): Promise<OrderDto | null> {
  const [dto] = await loadOrders(db, eq(orders.id, orderId), 1);
  return dto ?? null;
}

export async function loadTickets(
  db: DbOrTx,
  where: SQL | undefined,
  opts: { limit?: number; newestFirst?: boolean } = {},
): Promise<TicketDto[]> {
  const rows = await db
    .select({ ticket: tickets, order: orders })
    .from(tickets)
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .where(where)
    .orderBy(opts.newestFirst ? desc(tickets.id) : asc(tickets.id))
    .limit(opts.limit ?? 500);
  if (rows.length === 0) return [];
  const itemRows = await db
    .select()
    .from(orderItems)
    .where(
      inArray(
        orderItems.ticketId,
        rows.map((r) => r.ticket.id),
      ),
    )
    .orderBy(asc(orderItems.id));
  return rows.map(({ ticket, order }) => ({
    id: ticket.id,
    orderId: order.id,
    orderNumber: order.number,
    stationId: ticket.stationId,
    stationName: ticket.stationName,
    status: ticket.status,
    kind: order.kind,
    areaName: order.areaName,
    tableLabel: order.tableLabel,
    pickupNumber: order.pickupNumber,
    waiterName: order.waiterName,
    orderNote: order.note,
    createdAt: ticket.createdAt.toISOString(),
    acceptedAt: iso(ticket.acceptedAt),
    doneAt: iso(ticket.doneAt),
    items: itemRows
      .filter((i) => i.ticketId === ticket.id)
      .map((i) => ({
        id: i.id,
        name: i.bonName,
        qty: i.qty,
        cancelledQty: i.cancelledQty,
        options: i.options.map((o) => o.name),
        note: i.note,
      })),
  }));
}
