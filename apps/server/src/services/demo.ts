import { DEFAULT_TENANT_SETTINGS, type TenantSettings } from '@bestellsystem/shared';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context';
import type { DbOrTx } from '../db/client';
import {
  areas,
  categories,
  events,
  optionGroups,
  options,
  printers,
  productOptionGroups,
  products,
  stations,
  tables,
  tenants,
  users,
} from '../db/schema';
import { pinLookup } from '../lib/crypto';

/**
 * Beispieldaten zum Ausprobieren: ein Fest mit Küche (Tablet, Druck bei
 * "Fertig"), Getränke- und Bierdrucker (sofort), To-Go mit Abholbon.
 * Alle Drucker sind Simulatoren – die Bons erscheinen im Admin-Bereich.
 */
export async function seedDemoData(tx: DbOrTx, ctx: Pick<AppContext, 'secret'>, tenantId: number) {
  const [event] = await tx
    .insert(events)
    .values({ tenantId, name: 'Sommerfest (Demo)', date: new Date().toISOString().slice(0, 10), active: true })
    .returning();
  const eventId = event.id;

  const printer = async (name: string) =>
    (await tx.insert(printers).values({ tenantId, name, type: 'simulator', widthChars: 48, status: 'ok' }).returning())[0];
  const pKitchen = await printer('Küche');
  const pBar = await printer('Schank');
  const pBeer = await printer('Bierstand');
  const pPickup = await printer('To-Go-Ausgabe');

  const station = async (name: string, values: Partial<typeof stations.$inferInsert>, sort: number) =>
    (await tx.insert(stations).values({ tenantId, eventId, name, sort, ...values }).returning())[0];
  const sKitchen = await station('Küche', { showOnDisplay: true, printTrigger: 'on_done', printerId: pKitchen.id }, 0);
  const sDrinks = await station('Getränke', { showOnDisplay: false, printTrigger: 'on_order', printerId: pBar.id }, 1);
  const sBeer = await station('Bier', { showOnDisplay: false, printTrigger: 'on_order', printerId: pBeer.id }, 2);

  const area = async (name: string, labels: string[], sort: number) => {
    const [a] = await tx.insert(areas).values({ tenantId, eventId, name, sort }).returning();
    await tx.insert(tables).values(labels.map((label, i) => ({ tenantId, eventId, areaId: a.id, label, sort: i })));
  };
  const range = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
  await area('Gang A', range(12), 0);
  await area('Gang B', range(12), 1);
  await area('Terrasse', ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'], 2);

  const category = async (name: string, color: string, sort: number) =>
    (await tx.insert(categories).values({ tenantId, eventId, name, color, sort }).returning())[0];
  const cFood = await category('Essen', '#ea580c', 0);
  const cSoft = await category('Alkoholfrei', '#0284c7', 1);
  const cBeer = await category('Bier', '#ca8a04', 2);
  const cWine = await category('Wein & Sekt', '#9333ea', 3);

  const [gSide] = await tx
    .insert(optionGroups)
    .values({ tenantId, eventId, name: 'Beilage', multi: false, required: true, sort: 0 })
    .returning();
  await tx.insert(options).values([
    { tenantId, groupId: gSide.id, name: 'Pommes', sort: 0 },
    { tenantId, groupId: gSide.id, name: 'Kartoffelsalat', sort: 1 },
    { tenantId, groupId: gSide.id, name: 'Brötchen', priceDeltaCents: -50, sort: 2 },
  ]);
  const [gSauce] = await tx
    .insert(optionGroups)
    .values({ tenantId, eventId, name: 'Soße', multi: true, required: false, sort: 1 })
    .returning();
  await tx.insert(options).values([
    { tenantId, groupId: gSauce.id, name: 'Ketchup', sort: 0 },
    { tenantId, groupId: gSauce.id, name: 'Mayo', sort: 1 },
    { tenantId, groupId: gSauce.id, name: 'Senf', sort: 2 },
  ]);

  let sort = 0;
  const product = async (
    categoryId: number,
    stationId: number,
    name: string,
    priceCents: number,
    extra: Partial<typeof products.$inferInsert> = {},
    groupIds: number[] = [],
  ) => {
    const [p] = await tx
      .insert(products)
      .values({ tenantId, eventId, categoryId, stationId, name, priceCents, sort: sort++, ...extra })
      .returning();
    if (groupIds.length) {
      await tx.insert(productOptionGroups).values(groupIds.map((groupId, i) => ({ productId: p.id, groupId, sort: i })));
    }
  };
  await product(cFood.id, sKitchen.id, 'Schnitzel', 950, {}, [gSide.id]);
  await product(cFood.id, sKitchen.id, 'Bratwurst', 450, {}, [gSide.id, gSauce.id]);
  await product(cFood.id, sKitchen.id, 'Currywurst', 500, {}, [gSide.id]);
  await product(cFood.id, sKitchen.id, 'Pommes', 350, {}, [gSauce.id]);
  await product(cFood.id, sKitchen.id, 'Flammkuchen', 800, { bonName: 'Flammk.' });
  await product(cSoft.id, sDrinks.id, 'Wasser 0,5 l', 250, { depositCents: 200 });
  await product(cSoft.id, sDrinks.id, 'Apfelschorle 0,5 l', 300, { depositCents: 200 });
  await product(cSoft.id, sDrinks.id, 'Cola 0,5 l', 300, { depositCents: 200 });
  await product(cBeer.id, sBeer.id, 'Helles 0,5 l', 450, { depositCents: 200 });
  await product(cBeer.id, sBeer.id, 'Weißbier 0,5 l', 480, { depositCents: 200 });
  await product(cBeer.id, sBeer.id, 'Radler 0,5 l', 420, { depositCents: 200 });
  await product(cBeer.id, sBeer.id, 'Maß', 1100, { depositCents: 500 });
  await product(cWine.id, sDrinks.id, 'Weinschorle 0,25 l', 400, { depositCents: 200 });
  await product(cWine.id, sDrinks.id, 'Sekt 0,1 l', 450, { depositCents: 200 });

  const pin = (p: string) => pinLookup(ctx.secret, tenantId, p);
  await tx.insert(users).values([
    { tenantId, name: 'Anna', roles: ['waiter'], pinLookup: pin('1111') },
    { tenantId, name: 'Ben', roles: ['waiter'], pinLookup: pin('2222') },
    { tenantId, name: 'Küche', roles: ['station'], pinLookup: pin('3333') },
    { tenantId, name: 'To-Go', roles: ['togo'], pinLookup: pin('4444') },
  ]);

  const settings: TenantSettings = {
    ...DEFAULT_TENANT_SETTINGS,
    togo: true,
    billingHelper: true,
    deposit: true,
    pickupPrinterId: pPickup.id,
    pickupBonHeader: 'Sommerfest',
  };
  await tx.update(tenants).set({ settings }).where(eq(tenants.id, tenantId));
}
