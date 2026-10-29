import type { AgentDto, Catalog, OrderDto, PrinterDto, PrintJobDto, ServerToAgent } from '@bestellsystem/shared';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Client, createTestEnv, loginPin, requestId, type TestEnv } from './test/helpers';

let env: TestEnv;
let superadmin: Client;

beforeAll(async () => {
  env = await createTestEnv();
  superadmin = new Client(env.app);
  await superadmin.post('/api/setup', {
    tenantName: 'Musikverein',
    adminName: 'Betreiber',
    username: 'betreiber',
    password: 'geheim1234',
    demo: true,
  });
});

afterAll(async () => {
  await env.close();
});

describe('Mandantentrennung', () => {
  let other: Client;
  let foreignOrder: OrderDto;

  beforeAll(async () => {
    const created = await superadmin.post('/api/super/tenants', {
      name: 'Feuerwehr Nachbarort',
      adminName: 'Kommandant',
      username: 'kommandant',
      password: 'geheim1234',
    });
    expect(created.status).toBe(200);
    other = new Client(env.app);
    expect((await other.post('/api/auth/password', { username: 'kommandant', password: 'geheim1234' })).status).toBe(200);

    const anna = await loginPin(env.app, 'musikverein', '1111');
    const catalog = (await anna.get<Catalog>('/api/catalog')).body;
    foreignOrder = (
      await anna.post<OrderDto>('/api/orders', {
        clientRequestId: requestId(),
        kind: 'table',
        tableId: catalog.areas[0].tables[0].id,
        items: [{ productId: catalog.products.find((p) => p.name === 'Pommes')!.id, qty: 1, optionIds: [] }],
      })
    ).body;
  });

  it('neuer Verein startet leer und ohne aktive Veranstaltung', async () => {
    const me = (await other.get('/api/auth/me')).body;
    expect(me.tenant.name).toBe('Feuerwehr Nachbarort');
    expect(me.user.isSuperadmin).toBe(false);
    expect(me.activeEvent).toBeNull();
    expect((await other.get('/api/catalog')).status).toBe(409);
    expect((await other.get('/api/admin/printers')).body).toEqual([]);
  });

  it('sieht und ändert keine Daten des anderen Vereins', async () => {
    const ev = await other.post('/api/admin/events', { name: 'Feuerwehrfest' });
    await other.post(`/api/admin/events/${ev.body.id}/activate`);
    expect((await other.get('/api/admin/products')).body).toEqual([]);

    const productId = foreignOrder.items[0].productId;
    expect((await other.patch(`/api/admin/products/${productId}`, { priceCents: 1 })).status).toBe(404);
    expect((await other.get(`/api/orders/${foreignOrder.id}`)).status).toBe(404);
    expect((await other.post(`/api/tickets/${foreignOrder.tickets[0].id}/done`)).status).toBe(404);
    expect(
      (await other.post(`/api/orders/${foreignOrder.id}/cancel`, { items: [{ orderItemId: foreignOrder.items[0].id, qty: 1 }] }))
        .status,
    ).toBe(404);
    expect((await other.get('/api/super/tenants')).status).toBe(403);
  });

  it('PINs gelten nur im eigenen Verein', async () => {
    const res = await new Client(env.app).post('/api/auth/pin', { tenantSlug: 'feuerwehr-nachbarort', pin: '1111' });
    expect(res.status).toBe(401);
  });
});

describe('Verwaltung', () => {
  it('legt Tische in Serie an und überspringt doppelte', async () => {
    const area = (await superadmin.post('/api/admin/areas', { name: 'Zelt' })).body;
    const first = await superadmin.post(`/api/admin/areas/${area.id}/tables`, { from: 1, to: 20 });
    expect(first.body).toEqual({ created: 20, skipped: 0 });
    const second = await superadmin.post(`/api/admin/areas/${area.id}/tables`, { from: 15, to: 25 });
    expect(second.body).toEqual({ created: 5, skipped: 6 });
  });

  it('verhindert doppelte PINs', async () => {
    const res = await superadmin.post('/api/admin/users', { name: 'Doppelt', roles: ['waiter'], pin: '1111' });
    expect(res.status).toBe(409);
    const ok = await superadmin.post('/api/admin/users', { name: 'Neu', roles: ['waiter', 'togo'], pin: '5555' });
    expect(ok.status).toBe(200);
    await loginPin(env.app, 'musikverein', '5555');
  });

  it('kopiert eine Veranstaltung mit allen Stammdaten', async () => {
    const events = (await superadmin.get('/api/admin/events')).body;
    const active = events.find((e: { active: boolean }) => e.active);
    const copy = await superadmin.post(`/api/admin/events/${active.id}/copy`, { name: 'Herbstfest' });
    expect(copy.status).toBe(200);
    const original = (await superadmin.get(`/api/admin/events/${active.id}/summary`)).body;
    const copied = (await superadmin.get(`/api/admin/events/${copy.body.id}/summary`)).body;
    expect(copied.products).toBe(original.products);
    expect(copied.tables).toBe(original.tables);
    expect(copied.stations).toBe(original.stations);
    expect(copied.orders).toBe(0);
    const groups = (await superadmin.get(`/api/admin/option-groups?eventId=${copy.body.id}`)).body;
    expect(groups.find((g: { name: string }) => g.name === 'Beilage').options).toHaveLength(3);
  });

  it('Station ohne Tablet druckt sofort, auch wenn "bei Fertig" eingestellt ist', async () => {
    const stations = (await superadmin.get('/api/admin/stations')).body;
    const drinks = stations.find((s: { name: string }) => s.name === 'Getränke');
    await superadmin.patch(`/api/admin/stations/${drinks.id}`, { printTrigger: 'on_done' });
    const overview = (await superadmin.get('/api/admin/overview')).body;
    expect(overview.warnings.join(' ')).toContain('sofort gedruckt');

    const anna = await loginPin(env.app, 'musikverein', '1111');
    const catalog = (await anna.get<Catalog>('/api/catalog')).body;
    const order = await anna.post<OrderDto>('/api/orders', {
      clientRequestId: requestId(),
      kind: 'table',
      tableId: catalog.areas[0].tables[1].id,
      items: [{ productId: catalog.products.find((p) => p.name === 'Wasser 0,5 l')!.id, qty: 1, optionIds: [] }],
    });
    await env.ctx.printing.drain();
    const jobs = (await superadmin.get<PrintJobDto[]>('/api/admin/print-jobs')).body;
    expect(jobs.some((j) => j.printerName === 'Schank' && j.status === 'done')).toBe(true);
    expect(order.body.tickets[0].status).toBe('done');
    await superadmin.patch(`/api/admin/stations/${drinks.id}`, { printTrigger: 'on_order' });
  });
});

describe('Druck-Agent (USB)', () => {
  let port: number;

  beforeAll(async () => {
    await env.app.listen({ port: 0, host: '127.0.0.1' });
    port = (env.app.server.address() as AddressInfo).port;
    // Wiederholungsversuche laufen über den Takt der Warteschlange.
    await env.ctx.printing.start();
  });

  function connect(token: string) {
    return new WebSocket(`ws://127.0.0.1:${port}/api/agent/ws`, { headers: { Authorization: `Bearer ${token}` } });
  }

  function nextMessage(ws: WebSocket): Promise<ServerToAgent> {
    return new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(data.toString()))));
  }

  it('lehnt ungültige Tokens ab', async () => {
    const ws = connect('falsch');
    const code = await new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)));
    expect(code).toBe(4401);
  });

  it('bekommt Druckaufträge gepusht und meldet das Ergebnis', async () => {
    const created = (await superadmin.post('/api/admin/agents', { name: 'Raspi Bierstand' })).body;
    expect(created.token).toMatch(/^agt_/);
    const printer = (
      await superadmin.post('/api/admin/printers', {
        name: 'USB Bier',
        type: 'usb',
        agentId: created.id,
        deviceKey: 'usb:0416:5011:ABC',
        widthChars: 32,
      })
    ).body;

    // Auftrag entsteht, bevor der Agent verbunden ist – er darf nicht verloren gehen.
    await superadmin.post(`/api/admin/printers/${printer.id}/test`);
    await env.ctx.printing.drain();
    let printers = (await superadmin.get<PrinterDto[]>('/api/admin/printers')).body;
    expect(printers.find((p) => p.id === printer.id)!.status).toBe('offline');
    expect(printers.find((p) => p.id === printer.id)!.pendingJobs).toBe(1);

    const ws = connect(created.token);
    const welcome = await nextMessage(ws);
    expect(welcome).toMatchObject({ type: 'welcome', agentId: created.id });
    const jobPromise = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: 'hello',
        version: 'test',
        hostname: 'raspi',
        devices: [{ key: 'usb:0416:5011:ABC', path: '/dev/usb/lp0', description: 'POS-58' }],
      }),
    );
    const job = await jobPromise;
    expect(job.type).toBe('job');
    if (job.type !== 'job') return;
    expect(job.deviceKey).toBe('usb:0416:5011:ABC');
    const bytes = Buffer.from(job.data, 'base64');
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
    expect(bytes.includes(Buffer.from('TESTDRUCK'))).toBe(true);

    // Erster Versuch scheitert (Papier leer), wird wiederholt, dann klappt es.
    const retryPromise = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'result', jobId: job.jobId, ok: false, error: 'Papier leer' }));
    await new Promise((r) => setTimeout(r, 50));
    printers = (await superadmin.get<PrinterDto[]>('/api/admin/printers')).body;
    expect(printers.find((p) => p.id === printer.id)!.statusMessage).toBe('Papier leer');
    const retry = await retryPromise; // Backoff 1 s
    expect(retry.type === 'job' && retry.jobId).toBe(job.jobId);
    ws.send(JSON.stringify({ type: 'result', jobId: job.jobId, ok: true }));
    await new Promise((r) => setTimeout(r, 100));

    const jobs = (await superadmin.get<PrintJobDto[]>(`/api/admin/print-jobs?printerId=${printer.id}`)).body;
    expect(jobs[0].status).toBe('done');
    expect(jobs[0].attempts).toBe(1);
    const agents = (await superadmin.get<AgentDto[]>('/api/admin/agents')).body;
    expect(agents[0]).toMatchObject({ connected: true, hostname: 'raspi' });
    printers = (await superadmin.get<PrinterDto[]>('/api/admin/printers')).body;
    expect(printers.find((p) => p.id === printer.id)!.status).toBe('ok');

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    printers = (await superadmin.get<PrinterDto[]>('/api/admin/printers')).body;
    expect(printers.find((p) => p.id === printer.id)!.status).toBe('offline');
  });

  it('mehrere Rechner an verschiedenen Standorten, auch Windows', async () => {
    const kitchenPc = (await superadmin.post('/api/admin/agents', { name: 'Windows-PC Küche' })).body;
    const barPi = (await superadmin.post('/api/admin/agents', { name: 'Raspi Schank' })).body;
    const winPrinter = (
      await superadmin.post('/api/admin/printers', {
        name: 'Küche (Windows)',
        type: 'usb',
        agentId: kitchenPc.id,
        deviceKey: 'win:POS-80',
      })
    ).body;
    const piPrinter = (
      await superadmin.post('/api/admin/printers', {
        name: 'Schank (Pi)',
        type: 'usb',
        agentId: barPi.id,
        deviceKey: 'usb:0416:5011:XYZ',
      })
    ).body;

    const win = connect(kitchenPc.token);
    const pi = connect(barPi.token);
    await nextMessage(win);
    await nextMessage(pi);
    pi.send(JSON.stringify({ type: 'hello', version: 't', hostname: 'raspi-schank', platform: 'Linux', devices: [{ key: 'usb:0416:5011:XYZ', path: '/dev/usb/lp0', description: 'POS58' }] }));
    win.send(
      JSON.stringify({
        type: 'hello',
        version: 't',
        hostname: 'KUECHE-PC',
        platform: 'Windows',
        devices: [{ key: 'win:POS-80', path: 'POS-80', description: 'POS-80 (USB001)', problem: 'Windows meldet den Drucker als offline' }],
      }),
    );
    await new Promise((r) => setTimeout(r, 150));

    const agents = (await superadmin.get<AgentDto[]>('/api/admin/agents')).body;
    expect(agents.find((a) => a.id === kitchenPc.id)).toMatchObject({ connected: true, platform: 'Windows', hostname: 'KUECHE-PC' });
    expect(agents.find((a) => a.id === barPi.id)).toMatchObject({ connected: true, platform: 'Linux' });
    let printers = (await superadmin.get<PrinterDto[]>('/api/admin/printers')).body;
    expect(printers.find((p) => p.id === winPrinter.id)).toMatchObject({ status: 'error', statusMessage: 'Windows meldet den Drucker als offline' });
    expect(printers.find((p) => p.id === piPrinter.id)).toMatchObject({ status: 'ok' });

    // Jeder Auftrag geht an den Rechner, an dem sein Drucker hängt.
    const piJob = nextMessage(pi);
    await superadmin.post(`/api/admin/printers/${piPrinter.id}/test`);
    const received = await piJob;
    expect(received).toMatchObject({ type: 'job', deviceKey: 'usb:0416:5011:XYZ' });

    // Windows meldet den Drucker wieder bereit -> Status grün.
    win.send(JSON.stringify({ type: 'devices', devices: [{ key: 'win:POS-80', path: 'POS-80', description: 'POS-80 (USB001)', problem: null }] }));
    await new Promise((r) => setTimeout(r, 150));
    printers = (await superadmin.get<PrinterDto[]>('/api/admin/printers')).body;
    expect(printers.find((p) => p.id === winPrinter.id)!.status).toBe('ok');
    win.close();
    pi.close();
  });

  it('druckt sofort weiter, sobald der Drucker wieder da ist', async () => {
    const pi = (await superadmin.post('/api/admin/agents', { name: 'Raspi Küche' })).body;
    const key = 'usb:04b8:0e28:K1';
    const printer = (
      await superadmin.post('/api/admin/printers', { name: 'Küche USB', type: 'usb', agentId: pi.id, deviceKey: key })
    ).body;
    const ws = connect(pi.token);
    await nextMessage(ws);
    const jobs: { at: number; msg: ServerToAgent }[] = [];
    ws.on('message', (raw) => jobs.push({ at: Date.now(), msg: JSON.parse(raw.toString()) }));
    ws.send(JSON.stringify({ type: 'hello', version: 't', hostname: 'pi', platform: 'Linux', devices: [] }));
    await superadmin.post(`/api/admin/printers/${printer.id}/test`);

    // Zweimal scheitern (Drucker aus) -> Wartezeit wächst auf 2 s.
    for (let i = 1; i <= 2; i++) {
      while (jobs.filter((j) => j.msg.type === 'job').length < i) await new Promise((r) => setTimeout(r, 20));
      const job = jobs.filter((j) => j.msg.type === 'job')[i - 1].msg;
      if (job.type === 'job') ws.send(JSON.stringify({ type: 'result', jobId: job.jobId, ok: false, error: 'Drucker aus' }));
    }
    await new Promise((r) => setTimeout(r, 100));
    // Drucker wird eingeschaltet: Agent meldet das Gerät -> Auftrag kommt sofort, nicht erst nach 2 s.
    const pluggedIn = Date.now();
    ws.send(JSON.stringify({ type: 'devices', devices: [{ key, path: '/dev/usb/lp0', description: 'TM-T20' }] }));
    while (jobs.filter((j) => j.msg.type === 'job').length < 3) await new Promise((r) => setTimeout(r, 20));
    expect(jobs.filter((j) => j.msg.type === 'job')[2].at - pluggedIn).toBeLessThan(1000);
    ws.close();
  });

  it('ein Rechner mit mehreren Druckern', async () => {
    const pc = (await superadmin.post('/api/admin/agents', { name: 'PC Schank' })).body;
    const devices = [
      { key: 'win:Bon-Getraenke', path: 'Bon-Getraenke', description: 'Bon-Getraenke (USB001)' },
      { key: 'win:Bon-Bier', path: 'Bon-Bier', description: 'Bon-Bier (USB002)' },
    ];
    const drinks = (
      await superadmin.post('/api/admin/printers', { name: 'Getränke', type: 'usb', agentId: pc.id, deviceKey: devices[0].key })
    ).body;
    const beer = (
      await superadmin.post('/api/admin/printers', { name: 'Bier', type: 'usb', agentId: pc.id, deviceKey: devices[1].key })
    ).body;
    const ws = connect(pc.token);
    await nextMessage(ws);
    const jobs: ServerToAgent[] = [];
    ws.on('message', (raw) => jobs.push(JSON.parse(raw.toString())));
    ws.send(JSON.stringify({ type: 'hello', version: 't', hostname: 'SCHANK-PC', platform: 'Windows', devices }));
    await new Promise((r) => setTimeout(r, 100));
    await superadmin.post(`/api/admin/printers/${drinks.id}/test`);
    await superadmin.post(`/api/admin/printers/${beer.id}/test`);
    await new Promise((r) => setTimeout(r, 300));
    // Beide Drucker bekommen ihren Auftrag, ohne aufeinander zu warten.
    expect(jobs.filter((j) => j.type === 'job').map((j) => j.type === 'job' && j.deviceKey).sort()).toEqual([
      'win:Bon-Bier',
      'win:Bon-Getraenke',
    ]);
    const printers = (await superadmin.get<PrinterDto[]>('/api/admin/printers')).body;
    expect(printers.filter((p) => p.agentId === pc.id).map((p) => p.status)).toEqual(['ok', 'ok']);
    ws.close();
  });
});
