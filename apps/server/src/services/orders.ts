import {
  buildPickupBon,
  buildTicketBon,
  type CancelItemsInput,
  type CreateOrderInput,
  type OrderDto,
  type SelectedOption,
  type TicketStatus,
} from '@bestellsystem/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppContext } from '../context';
import type { DbOrTx } from '../db/client';
import {
  areas,
  categories,
  events,
  optionGroups,
  options,
  orderItems,
  orders,
  productOptionGroups,
  products,
  stations,
  tables,
  tickets,
} from '../db/schema';
import { hasRole, type AuthInfo } from '../lib/auth';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { audit, getTenantSettings, requireActiveEvent } from './common';
import { loadOrder, loadTickets } from './dto';
import { bonItem, orderLocation, ticketDocs } from './printing';

type StationRow = typeof stations.$inferSelect;
type TicketRow = typeof tickets.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

/** Ohne Tablet-Anzeige gibt es kein "Annehmen"/"Fertig" – dann wird sofort gedruckt. */
export function effectiveTrigger(station: Pick<StationRow, 'showOnDisplay' | 'printTrigger'>) {
  return station.showOnDisplay ? station.printTrigger : 'on_order';
}

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === '23505';
}

interface ResolvedItem {
  productId: number;
  stationId: number;
  name: string;
  bonName: string;
  categoryName: string;
  unitPriceCents: number;
  depositCents: number;
  qty: number;
  options: SelectedOption[];
  note: string | null;
}

/** Prüft Produkte und Optionen und berechnet die Preise serverseitig. */
async function resolveItems(tx: DbOrTx, tenantId: number, eventId: number, input: CreateOrderInput) {
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const productRows = await tx
    .select({ product: products, categoryName: categories.name })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.tenantId, tenantId), eq(products.eventId, eventId), inArray(products.id, productIds)));
  const productById = new Map(productRows.map((r) => [r.product.id, r]));

  const links = await tx.select().from(productOptionGroups).where(inArray(productOptionGroups.productId, productIds));
  const groupIds = [...new Set(links.map((l) => l.groupId))];
  const groupRows = groupIds.length ? await tx.select().from(optionGroups).where(inArray(optionGroups.id, groupIds)) : [];
  const optionRows = groupIds.length ? await tx.select().from(options).where(inArray(options.groupId, groupIds)) : [];

  const merged = new Map<string, ResolvedItem>();
  for (const item of input.items) {
    const row = productById.get(item.productId);
    if (!row || !row.product.active) throw badRequest('Ein Produkt ist nicht mehr verfügbar. Bitte neu laden.');
    const product = row.product;
    if (product.soldOut) throw conflict(`"${product.name}" ist ausverkauft.`);

    const allowedGroups = links.filter((l) => l.productId === product.id).sort((a, b) => a.sort - b.sort);
    const chosen = [...new Set(item.optionIds)].map((id) => {
      const opt = optionRows.find((o) => o.id === id);
      if (!opt || !allowedGroups.some((g) => g.groupId === opt.groupId)) {
        throw badRequest(`Ungültige Option bei "${product.name}". Bitte neu laden.`);
      }
      return opt;
    });
    const selected: SelectedOption[] = [];
    for (const link of allowedGroups) {
      const group = groupRows.find((g) => g.id === link.groupId)!;
      const inGroup = chosen.filter((o) => o.groupId === group.id).sort((a, b) => a.sort - b.sort);
      if (group.required && inGroup.length === 0) throw badRequest(`Bei "${product.name}" fehlt: ${group.name}.`);
      if (!group.multi && inGroup.length > 1) throw badRequest(`Bei "${product.name}" nur eine Auswahl: ${group.name}.`);
      for (const o of inGroup) selected.push({ group: group.name, name: o.name, priceDeltaCents: o.priceDeltaCents });
    }

    const note = item.note?.trim() || null;
    const key = `${product.id}|${selected.map((s) => `${s.group}:${s.name}`).join(',')}|${note ?? ''}`;
    const existing = merged.get(key);
    if (existing) {
      existing.qty += item.qty;
      continue;
    }
    merged.set(key, {
      productId: product.id,
      stationId: product.stationId,
      name: product.name,
      bonName: product.bonName || product.name,
      categoryName: row.categoryName,
      unitPriceCents: Math.max(0, product.priceCents + selected.reduce((s, o) => s + o.priceDeltaCents, 0)),
      depositCents: product.depositCents,
      qty: item.qty,
      options: selected,
      note,
    });
  }
  return [...merged.values()];
}

async function printTicket(
  ctx: AppContext,
  tx: DbOrTx,
  order: OrderRow,
  ticket: TicketRow,
  station: StationRow,
  kind: 'ticket' | 'reprint',
) {
  if (!station.printerId) return false;
  const items = await tx.select().from(orderItems).where(eq(orderItems.ticketId, ticket.id));
  const docs = ticketDocs(
    { order, ticket, station, items, time: ctx.formatTime(order.createdAt) },
    kind === 'reprint' ? 'NACHDRUCK' : undefined,
  );
  for (const doc of docs) {
    await ctx.printing.enqueue(tx, {
      tenantId: order.tenantId,
      printerId: station.printerId,
      kind,
      doc,
      ticketId: ticket.id,
      orderId: order.id,
    });
  }
  if (docs.length > 0 && !ticket.printed) {
    await tx.update(tickets).set({ printed: true }).where(eq(tickets.id, ticket.id));
  }
  return docs.length > 0;
}

/** Nach dem Commit: Live-Updates an Tablets, Handys und Abholmonitor. */
async function publishOrder(ctx: AppContext, tenantId: number, orderId: number, ticketIds: number[]) {
  ctx.printing.kick();
  const order = await loadOrder(ctx.db, orderId);
  if (order) ctx.hub.broadcast(tenantId, { type: 'order', order });
  if (ticketIds.length > 0) {
    for (const ticket of await loadTickets(ctx.db, inArray(tickets.id, ticketIds))) {
      ctx.hub.broadcast(tenantId, { type: 'ticket', ticket });
    }
  }
  if (order?.kind === 'togo') ctx.hub.broadcast(tenantId, { type: 'pickup' });
  return order;
}

export async function createOrder(
  ctx: AppContext,
  auth: AuthInfo,
  tenantId: number,
  input: CreateOrderInput,
): Promise<{ order: OrderDto; duplicate: boolean }> {
  const findExisting = async () => {
    const [row] = await ctx.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.clientRequestId, input.clientRequestId)));
    return row ? loadOrder(ctx.db, row.id) : null;
  };
  // Gleiche Anfrage nochmal (Netz-Wackler, Doppeltipp): nichts doppelt drucken.
  const existing = await findExisting();
  if (existing) return { order: existing, duplicate: true };

  const settings = await getTenantSettings(ctx.db, tenantId);
  if (input.kind === 'togo') {
    if (!settings.togo) throw badRequest('To-Go ist für diesen Verein nicht aktiviert.');
    if (!hasRole(auth, 'togo')) throw forbidden('Keine Berechtigung für To-Go.');
  } else if (!hasRole(auth, 'waiter')) {
    throw forbidden('Keine Berechtigung für Tischbestellungen.');
  }

  let result: { orderId: number; ticketIds: number[] };
  try {
    result = await ctx.db.transaction(async (tx) => {
      const event = await requireActiveEvent(tx, tenantId);

      let tableLabel: string | null = null;
      let areaName: string | null = null;
      if (input.kind === 'table') {
        if (!input.tableId) throw badRequest('Bitte einen Tisch wählen.');
        const [t] = await tx
          .select({ label: tables.label, areaName: areas.name })
          .from(tables)
          .innerJoin(areas, eq(areas.id, tables.areaId))
          .where(and(eq(tables.id, input.tableId), eq(tables.tenantId, tenantId), eq(tables.eventId, event.id)));
        if (!t) throw badRequest('Tisch nicht gefunden. Bitte neu laden.');
        tableLabel = t.label;
        areaName = t.areaName;
      }

      const items = await resolveItems(tx, tenantId, event.id, input);
      const stationIds = [...new Set(items.map((i) => i.stationId))];
      const stationRows = await tx.select().from(stations).where(inArray(stations.id, stationIds));

      const [counter] = await tx
        .update(events)
        .set({
          orderCounter: sql`${events.orderCounter} + 1`,
          pickupCounter: input.kind === 'togo' ? sql`${events.pickupCounter} + 1` : events.pickupCounter,
        })
        .where(eq(events.id, event.id))
        .returning({ orderCounter: events.orderCounter, pickupCounter: events.pickupCounter });

      const [order] = await tx
        .insert(orders)
        .values({
          tenantId,
          eventId: event.id,
          number: counter.orderCounter,
          kind: input.kind,
          tableId: input.kind === 'table' ? input.tableId! : null,
          tableLabel,
          areaName,
          pickupNumber: input.kind === 'togo' ? counter.pickupCounter : null,
          waiterId: auth.user.id,
          waiterName: auth.user.name,
          note: input.note?.trim() || null,
          clientRequestId: input.clientRequestId,
        })
        .returning();

      const now = new Date();
      const ticketIds: number[] = [];
      let allDone = true;
      for (const station of stationRows.sort((a, b) => a.sort - b.sort)) {
        const status: TicketStatus = station.showOnDisplay ? 'open' : 'done';
        if (status !== 'done') allDone = false;
        const [ticket] = await tx
          .insert(tickets)
          .values({
            tenantId,
            eventId: event.id,
            orderId: order.id,
            stationId: station.id,
            stationName: station.name,
            status,
            doneAt: status === 'done' ? now : null,
          })
          .returning();
        ticketIds.push(ticket.id);
        await tx.insert(orderItems).values(
          items
            .filter((i) => i.stationId === station.id)
            .map((i) => ({ ...i, tenantId, orderId: order.id, ticketId: ticket.id, stationName: station.name })),
        );
        if (effectiveTrigger(station) === 'on_order') await printTicket(ctx, tx, order, ticket, station, 'ticket');
      }

      if (input.kind === 'togo') {
        if (allDone) await tx.update(orders).set({ readyAt: now }).where(eq(orders.id, order.id));
        if (settings.pickupPrinterId) {
          await ctx.printing.enqueue(tx, {
            tenantId,
            printerId: settings.pickupPrinterId,
            kind: 'pickup',
            orderId: order.id,
            doc: buildPickupBon({
              header: settings.pickupBonHeader,
              pickupNumber: order.pickupNumber!,
              orderNumber: order.number,
              time: ctx.formatTime(order.createdAt),
              items: items.map((i) => bonItem(i, i.qty)),
              footer: settings.pickupBonFooter,
            }),
          });
        }
      }
      return { orderId: order.id, ticketIds };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await findExisting();
      if (again) return { order: again, duplicate: true };
    }
    throw err;
  }

  const order = await publishOrder(ctx, tenantId, result.orderId, result.ticketIds);
  return { order: order!, duplicate: false };
}

async function ownedOrder(db: DbOrTx, tenantId: number, orderId: number) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
  if (!order) throw notFound('Bestellung nicht gefunden.');
  return order;
}

/** Togo-Bestellung ist abholbereit, wenn alle Tickets fertig oder storniert sind. */
async function updateReadiness(tx: DbOrTx, order: OrderRow) {
  if (order.kind !== 'togo') return false;
  const rows = await tx.select({ status: tickets.status }).from(tickets).where(eq(tickets.orderId, order.id));
  const ready = rows.every((t) => t.status === 'done' || t.status === 'cancelled');
  const allCancelled = rows.length > 0 && rows.every((t) => t.status === 'cancelled');
  if (allCancelled && !order.pickedUpAt) {
    await tx.update(orders).set({ pickedUpAt: new Date() }).where(eq(orders.id, order.id));
    return true;
  }
  if (ready && !order.readyAt) {
    await tx.update(orders).set({ readyAt: new Date() }).where(eq(orders.id, order.id));
    return true;
  }
  if (!ready && order.readyAt) {
    await tx.update(orders).set({ readyAt: null }).where(eq(orders.id, order.id));
    return true;
  }
  return false;
}

export async function cancelItems(
  ctx: AppContext,
  auth: AuthInfo,
  tenantId: number,
  orderId: number,
  input: CancelItemsInput,
) {
  const settings = await getTenantSettings(ctx.db, tenantId);
  const touched = await ctx.db.transaction(async (tx) => {
    const order = await ownedOrder(tx, tenantId, orderId);
    // Zeile sperren, damit zwei gleichzeitige Stornos sich nicht überholen.
    await tx.execute(sql`select id from ${orders} where id = ${order.id} for update`);
    if (!hasRole(auth, 'admin')) {
      const ageMinutes = (Date.now() - order.createdAt.getTime()) / 60_000;
      if (!settings.waiterCanCancel) throw forbidden('Stornieren ist nur für Admins erlaubt.');
      if (order.waiterId !== auth.user.id) throw forbidden('Nur eigene Bestellungen können storniert werden.');
      if (ageMinutes > settings.waiterCancelMinutes) {
        throw forbidden(`Storno nur innerhalb von ${settings.waiterCancelMinutes} Minuten. Bitte einen Admin fragen.`);
      }
    }

    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const cancelledByTicket = new Map<number, { item: (typeof items)[number]; qty: number }[]>();
    for (const req of input.items) {
      const item = items.find((i) => i.id === req.orderItemId);
      if (!item) throw badRequest('Position nicht gefunden.');
      const open = item.qty - item.cancelledQty;
      if (req.qty < 1 || req.qty > open) throw badRequest(`"${item.name}": höchstens ${open} stornierbar.`);
      await tx
        .update(orderItems)
        .set({ cancelledQty: item.cancelledQty + req.qty })
        .where(eq(orderItems.id, item.id));
      item.cancelledQty += req.qty;
      if (item.ticketId) {
        const list = cancelledByTicket.get(item.ticketId) ?? [];
        list.push({ item, qty: req.qty });
        cancelledByTicket.set(item.ticketId, list);
      }
    }

    const ticketIds = [...cancelledByTicket.keys()];
    const ticketRows = ticketIds.length ? await tx.select().from(tickets).where(inArray(tickets.id, ticketIds)) : [];
    for (const ticket of ticketRows) {
      const remaining = items.filter((i) => i.ticketId === ticket.id).some((i) => i.qty - i.cancelledQty > 0);
      if (!remaining) await tx.update(tickets).set({ status: 'cancelled' }).where(eq(tickets.id, ticket.id));
      const [station] = ticket.stationId
        ? await tx.select().from(stations).where(eq(stations.id, ticket.stationId))
        : [];
      // Storno-Bon nur, wenn die Station schon einen Bon bekommen hat.
      if (ticket.printed && station?.printerId) {
        await ctx.printing.enqueue(tx, {
          tenantId,
          printerId: station.printerId,
          kind: 'storno',
          ticketId: ticket.id,
          orderId: order.id,
          doc: buildTicketBon({
            banner: 'STORNO',
            stationName: ticket.stationName,
            location: orderLocation(order),
            orderNumber: order.number,
            waiterName: auth.user.name,
            time: ctx.formatTime(new Date()),
            items: cancelledByTicket.get(ticket.id)!.map(({ item, qty }) => bonItem(item, qty)),
          }),
        });
      }
    }
    await updateReadiness(tx, order);
    await audit(tx, tenantId, auth, 'order.cancel', {
      orderId: order.id,
      orderNumber: order.number,
      reason: input.reason ?? null,
      items: input.items.map((i) => {
        const item = items.find((x) => x.id === i.orderItemId)!;
        return { name: item.name, qty: i.qty };
      }),
    });
    return { orderId: order.id, ticketIds };
  });
  return publishOrder(ctx, tenantId, touched.orderId, touched.ticketIds);
}

// ---------------------------------------------------------------- Tickets

async function ownedTicket(db: DbOrTx, tenantId: number, ticketId: number) {
  const [row] = await db
    .select({ ticket: tickets, order: orders })
    .from(tickets)
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)));
  if (!row) throw notFound('Bestellung an Station nicht gefunden.');
  const [station] = row.ticket.stationId
    ? await db.select().from(stations).where(eq(stations.id, row.ticket.stationId))
    : [];
  return { ...row, station: station ?? null };
}

export type TicketAction = 'accept' | 'done' | 'reopen' | 'reprint';

export async function ticketAction(ctx: AppContext, tenantId: number, ticketId: number, action: TicketAction) {
  const orderId = await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${tickets} where id = ${ticketId} for update`);
    const { ticket, order, station } = await ownedTicket(tx, tenantId, ticketId);
    const trigger = station ? effectiveTrigger(station) : 'never';
    const now = new Date();

    if (action === 'accept') {
      if (ticket.status !== 'open') return order.id;
      await tx.update(tickets).set({ status: 'accepted', acceptedAt: now }).where(eq(tickets.id, ticket.id));
      if (station && trigger === 'on_accept' && !ticket.printed) await printTicket(ctx, tx, order, ticket, station, 'ticket');
    } else if (action === 'done') {
      if (ticket.status !== 'open' && ticket.status !== 'accepted') return order.id;
      await tx
        .update(tickets)
        .set({ status: 'done', doneAt: now, acceptedAt: ticket.acceptedAt ?? now })
        .where(eq(tickets.id, ticket.id));
      // Auch wenn "Annehmen" übersprungen wurde: der Bon muss raus.
      if (station && (trigger === 'on_accept' || trigger === 'on_done') && !ticket.printed) {
        await printTicket(ctx, tx, order, ticket, station, 'ticket');
      }
    } else if (action === 'reopen') {
      if (ticket.status !== 'done') return order.id;
      await tx
        .update(tickets)
        .set({ status: ticket.acceptedAt ? 'accepted' : 'open', doneAt: null })
        .where(eq(tickets.id, ticket.id));
    } else if (action === 'reprint') {
      if (!station?.printerId) throw badRequest('Für diese Station ist kein Drucker eingestellt.');
      await printTicket(ctx, tx, order, ticket, station, 'reprint');
    }
    await updateReadiness(tx, order);
    return order.id;
  });
  await publishOrder(ctx, tenantId, orderId, [ticketId]);
  const [dto] = await loadTickets(ctx.db, eq(tickets.id, ticketId));
  return dto;
}

export async function markPickedUp(ctx: AppContext, tenantId: number, orderId: number, pickedUp: boolean) {
  const order = await ownedOrder(ctx.db, tenantId, orderId);
  if (order.kind !== 'togo') throw badRequest('Keine To-Go-Bestellung.');
  await ctx.db
    .update(orders)
    .set({ pickedUpAt: pickedUp ? new Date() : null })
    .where(eq(orders.id, order.id));
  return publishOrder(ctx, tenantId, order.id, []);
}
