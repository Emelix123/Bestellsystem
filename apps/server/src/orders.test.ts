import { bonToPlainText, type Catalog, type OrderDto, type PrintJobDto, type TicketDto } from '@bestellsystem/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestEnv, loginPin, requestId, type TestEnv } from './test/helpers';

let env: TestEnv;
let admin: Client;
let anna: Client;
let kitchen: Client;
let togo: Client;
let catalog: Catalog;

const product = (name: string) => catalog.products.find((p) => p.name === name)!;
const option = (groupName: string, name: string) =>
  catalog.optionGroups.find((g) => g.name === groupName)!.options.find((o) => o.name === name)!;
const table = (area: string, label: string) =>
  catalog.areas.find((a) => a.name === area)!.tables.find((t) => t.label === label)!;
const station = (name: string) => catalog.stations.find((s) => s.name === name)!;

async function jobs(): Promise<PrintJobDto[]> {
  await env.ctx.printing.drain();
  return (await admin.get<PrintJobDto[]>('/api/admin/print-jobs?limit=500')).body;
}

beforeAll(async () => {
  env = await createTestEnv();
  admin = new Client(env.app);
  const setup = await admin.post('/api/setup', {
    tenantName: 'TSV Musterdorf',
    adminName: 'Chefin',
    username: 'chefin',
    password: 'geheim1234',
    demo: true,
  });
  expect(setup.status).toBe(200);
  anna = await loginPin(env.app, 'tsv-musterdorf', '1111');
  kitchen = await loginPin(env.app, 'tsv-musterdorf', '3333');
  togo = await loginPin(env.app, 'tsv-musterdorf', '4444');
  catalog = (await anna.get<Catalog>('/api/catalog')).body;
});

afterAll(async () => {
  await env.close();
});

describe('Einrichtung und Anmeldung', () => {
  it('lässt sich nur einmal einrichten', async () => {
    const res = await new Client(env.app).post('/api/setup', {
      tenantName: 'Zweiter',
      adminName: 'X',
      username: 'xxx',
      password: 'geheim1234',
    });
    expect(res.status).toBe(409);
  });

  it('liefert Verein und aktive Veranstaltung', async () => {
    const me = await admin.get('/api/auth/me');
    expect(me.body.user.isSuperadmin).toBe(true);
    expect(me.body.tenant.slug).toBe('tsv-musterdorf');
    expect(me.body.activeEvent.name).toBe('Sommerfest (Demo)');
  });

  it('lehnt falsche PIN ab', async () => {
    const res = await new Client(env.app).post('/api/auth/pin', { tenantSlug: 'tsv-musterdorf', pin: '9999' });
    expect(res.status).toBe(401);
  });

  it('verweigert Bedienungen den Admin-Bereich', async () => {
    expect((await anna.get('/api/admin/products')).status).toBe(403);
    expect((await new Client(env.app).get('/api/catalog')).status).toBe(401);
  });
});

describe('Tischbestellung', () => {
  let order: OrderDto;

  it('teilt die Bestellung nach Stationen auf und druckt Getränke und Bier sofort', async () => {
    const res = await anna.post<OrderDto>('/api/orders', {
      clientRequestId: requestId(),
      kind: 'table',
      tableId: table('Gang A', '3').id,
      items: [
        { productId: product('Schnitzel').id, qty: 2, optionIds: [option('Beilage', 'Pommes').id], note: 'ohne Zitrone' },
        { productId: product('Helles 0,5 l').id, qty: 3, optionIds: [] },
        { productId: product('Cola 0,5 l').id, qty: 1, optionIds: [] },
        { productId: product('Helles 0,5 l').id, qty: 1, optionIds: [] },
      ],
    });
    expect(res.status).toBe(201);
    order = res.body;
    expect(order.tableLabel).toBe('3');
    expect(order.areaName).toBe('Gang A');
    expect(order.waiterName).toBe('Anna');
    // Gleiche Positionen werden zusammengefasst.
    expect(order.items.find((i) => i.name === 'Helles 0,5 l')!.qty).toBe(4);
    expect(order.tickets.map((t) => [t.stationName, t.status])).toEqual([
      ['Küche', 'open'],
      ['Getränke', 'done'],
      ['Bier', 'done'],
    ]);

    const printed = (await jobs()).filter((j) => j.kind === 'ticket');
    expect(printed).toHaveLength(2);
    expect(printed.every((j) => j.status === 'done')).toBe(true);
    const beer = printed.find((j) => j.printerName === 'Bierstand')!;
    const text = bonToPlainText(beer.doc, { widthChars: 48, codepage: 'cp858' });
    expect(text).toContain('BIER');
    expect(text).toContain('Tisch 3');
    expect(text).toContain('4x Helles 0,5 l');
    expect(text).not.toContain('Schnitzel');
  });

  it('druckt bei doppelt gesendeter Bestellung nichts doppelt', async () => {
    const id = requestId();
    const body = {
      clientRequestId: id,
      kind: 'table',
      tableId: table('Gang B', '1').id,
      items: [{ productId: product('Wasser 0,5 l').id, qty: 1, optionIds: [] }],
    };
    const first = await anna.post<OrderDto>('/api/orders', body);
    const before = (await jobs()).length;
    const second = await anna.post<OrderDto>('/api/orders', body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect((await jobs()).length).toBe(before);
  });

  it('prüft Pflicht-Optionen und berechnet Preise serverseitig', async () => {
    const missing = await anna.post('/api/orders', {
      clientRequestId: requestId(),
      kind: 'table',
      tableId: table('Gang A', '1').id,
      items: [{ productId: product('Schnitzel').id, qty: 1, optionIds: [] }],
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toContain('Beilage');

    const ok = await anna.post<OrderDto>('/api/orders', {
      clientRequestId: requestId(),
      kind: 'table',
      tableId: table('Gang A', '1').id,
      items: [
        {
          productId: product('Bratwurst').id,
          qty: 1,
          optionIds: [option('Beilage', 'Brötchen').id, option('Soße', 'Senf').id, option('Soße', 'Ketchup').id],
        },
      ],
    });
    expect(ok.status).toBe(201);
    const item = ok.body.items[0];
    expect(item.unitPriceCents).toBe(400); // 4,50 € - 0,50 € Brötchen
    expect(item.depositCents).toBe(0);
    expect(item.options.map((o) => o.name)).toEqual(['Brötchen', 'Ketchup', 'Senf']);
  });

  it('sperrt ausverkaufte Produkte sofort', async () => {
    const pommes = product('Pommes');
    expect((await kitchen.post(`/api/products/${pommes.id}/sold-out`, { soldOut: true })).status).toBe(200);
    const res = await anna.post('/api/orders', {
      clientRequestId: requestId(),
      kind: 'table',
      tableId: table('Gang A', '1').id,
      items: [{ productId: pommes.id, qty: 1, optionIds: [] }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('ausverkauft');
    await kitchen.post(`/api/products/${pommes.id}/sold-out`, { soldOut: false });
  });

  it('Küche sieht das Ticket am Tablet und der Bon kommt erst bei "Fertig"', async () => {
    const kitchenId = station('Küche').id;
    const list = await kitchen.get<TicketDto[]>(`/api/tickets?stationIds=${kitchenId}`);
    const ticket = list.body.find((t) => t.orderId === order.id)!;
    expect(ticket.items).toEqual([
      expect.objectContaining({ name: 'Schnitzel', qty: 2, options: ['Pommes'], note: 'ohne Zitrone' }),
    ]);
    const kitchenJobs = () => jobs().then((all) => all.filter((j) => j.printerName === 'Küche'));
    expect(await kitchenJobs()).toHaveLength(0);

    const done = await kitchen.post<TicketDto>(`/api/tickets/${ticket.id}/done`);
    expect(done.body.status).toBe('done');
    const printed = await kitchenJobs();
    expect(printed).toHaveLength(1);
    const text = bonToPlainText(printed[0].doc, { widthChars: 48, codepage: 'cp858' });
    expect(text).toContain('2x Schnitzel');
    expect(text).toContain('! ohne Zitrone');

    // Rückgängig und erneut fertig: kein zweiter Bon.
    await kitchen.post(`/api/tickets/${ticket.id}/reopen`);
    await kitchen.post(`/api/tickets/${ticket.id}/done`);
    expect(await kitchenJobs()).toHaveLength(1);

    // Nachdruck auf Wunsch.
    await kitchen.post(`/api/tickets/${ticket.id}/reprint`);
    const after = await kitchenJobs();
    expect(after).toHaveLength(2);
    expect(after[0].kind).toBe('reprint');
  });

  it('Storno erzeugt einen Storno-Bon an der betroffenen Station', async () => {
    const helles = order.items.find((i) => i.name === 'Helles 0,5 l')!;
    const res = await anna.post<OrderDto>(`/api/orders/${order.id}/cancel`, {
      items: [{ orderItemId: helles.id, qty: 1 }],
      reason: 'falsch eingegeben',
    });
    expect(res.status).toBe(200);
    expect(res.body.items.find((i) => i.id === helles.id)!.cancelledQty).toBe(1);
    const storno = (await jobs()).filter((j) => j.kind === 'storno');
    expect(storno).toHaveLength(1);
    expect(storno[0].printerName).toBe('Bierstand');
    const text = bonToPlainText(storno[0].doc, { widthChars: 48, codepage: 'cp858' });
    expect(text).toContain('STORNO');
    expect(text).toContain('1x Helles 0,5 l');

    const tooMuch = await anna.post(`/api/orders/${order.id}/cancel`, { items: [{ orderItemId: helles.id, qty: 9 }] });
    expect(tooMuch.status).toBe(400);
  });

  it('erlaubt anderen Bedienungen kein Storno fremder Bestellungen', async () => {
    const ben = await loginPin(env.app, 'tsv-musterdorf', '2222');
    const cola = order.items.find((i) => i.name === 'Cola 0,5 l')!;
    const res = await ben.post(`/api/orders/${order.id}/cancel`, { items: [{ orderItemId: cola.id, qty: 1 }] });
    expect(res.status).toBe(403);
  });

  it('zeigt der Bedienung die Bestellungen eines Tisches', async () => {
    const res = await anna.get<OrderDto[]>(`/api/orders?tableId=${table('Gang A', '3').id}`);
    expect(res.body.map((o) => o.id)).toContain(order.id);
  });
});

describe('To-Go', () => {
  it('vergibt Abholnummern, druckt den Abholbon und zeigt den Status am Monitor', async () => {
    const res = await togo.post<OrderDto>('/api/orders', {
      clientRequestId: requestId(),
      kind: 'togo',
      items: [
        { productId: product('Currywurst').id, qty: 1, optionIds: [option('Beilage', 'Pommes').id] },
        { productId: product('Cola 0,5 l').id, qty: 1, optionIds: [] },
      ],
    });
    expect(res.status).toBe(201);
    const order = res.body;
    expect(order.pickupNumber).toBe(1);
    expect(order.readyAt).toBeNull();

    const pickupJob = (await jobs()).find((j) => j.kind === 'pickup')!;
    expect(pickupJob.printerName).toBe('To-Go-Ausgabe');
    const text = bonToPlainText(pickupJob.doc, { widthChars: 48, codepage: 'cp858' });
    expect(text).toContain('Ihre Abholnummer');
    expect(text).toContain('1x Currywurst');

    let board = (await new Client(env.app).get('/api/public/pickup/tsv-musterdorf')).body;
    expect(board).toEqual({ tenantName: 'TSV Musterdorf', preparing: [1], ready: [] });

    const ticket = order.tickets.find((t) => t.stationName === 'Küche')!;
    await kitchen.post(`/api/tickets/${ticket.id}/done`);
    board = (await new Client(env.app).get('/api/public/pickup/tsv-musterdorf')).body;
    expect(board.ready).toEqual([1]);

    await togo.post(`/api/orders/${order.id}/picked-up`, { pickedUp: true });
    board = (await new Client(env.app).get('/api/public/pickup/tsv-musterdorf')).body;
    expect(board.ready).toEqual([]);
  });

  it('erlaubt reinen Bedienungen kein To-Go', async () => {
    const res = await anna.post('/api/orders', {
      clientRequestId: requestId(),
      kind: 'togo',
      items: [{ productId: product('Cola 0,5 l').id, qty: 1, optionIds: [] }],
    });
    expect(res.status).toBe(403);
  });
});

describe('Statistik und Export', () => {
  it('zählt Stück ohne Euro, solange Werte nicht freigeschaltet sind', async () => {
    const stats = (await admin.get('/api/admin/stats')).body;
    expect(stats.showValues).toBe(false);
    expect(stats.totals.valueCents).toBeNull();
    const helles = stats.products.find((p: { label: string }) => p.label === 'Helles 0,5 l');
    expect(helles.qty).toBe(3);
    expect(helles.cancelledQty).toBe(1);
    expect(helles.valueCents).toBeNull();
    expect(stats.timeline.length).toBeGreaterThan(0);
    expect(stats.throughput.find((t: { stationName: string }) => t.stationName === 'Küche').tickets).toBe(2);
  });

  it('zeigt Werte nach Freischaltung und exportiert CSV und Excel', async () => {
    await admin.put('/api/admin/settings', { settings: { statsShowValues: true } });
    const stats = (await admin.get('/api/admin/stats')).body;
    expect(stats.products.find((p: { label: string }) => p.label === 'Helles 0,5 l').valueCents).toBe(3 * 450);

    const csv = await admin.get('/api/admin/export.csv');
    expect(csv.status).toBe(200);
    const text = csv.raw.body;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Bestellung;Zeit;Art;Ort;Bedienung');
    expect(text).toContain('Helles 0,5 l');
    expect(text).toContain('4,50');

    const xlsx = await admin.get('/api/admin/export.xlsx');
    expect(xlsx.status).toBe(200);
    expect(xlsx.raw.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });
});
