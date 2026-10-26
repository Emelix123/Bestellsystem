import type { AgentDevice, AgentToServer } from '@bestellsystem/shared';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { agentWsUrl, PrintAgent } from './agent';
import { discoverUsbPrinters } from './usb';

describe('USB-Erkennung', () => {
  it('bildet stabile Kennungen aus Hersteller, Produkt und Seriennummer', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sys-'));
    const sys = path.join(root, 'sys');
    // Zwei Drucker: einer mit, einer ohne Seriennummer.
    const dev1 = path.join(sys, 'devices/pci0/usb1/1-1.2');
    const dev2 = path.join(sys, 'devices/pci0/usb1/1-1.3');
    for (const [dir, attrs] of [
      [dev1, { idVendor: '04b8', idProduct: '0e28', serial: 'X5E1234', manufacturer: 'EPSON', product: 'TM-T20III' }],
      [dev2, { idVendor: '0416', idProduct: '5011', manufacturer: 'STMicro', product: 'POS58' }],
    ] as const) {
      await fs.mkdir(path.join(dir, `${path.basename(dir)}:1.0`), { recursive: true });
      for (const [k, v] of Object.entries(attrs)) await fs.writeFile(path.join(dir, k), `${v}\n`);
    }
    await fs.mkdir(path.join(sys, 'class/usbmisc/lp0'), { recursive: true });
    await fs.mkdir(path.join(sys, 'class/usbmisc/lp1'), { recursive: true });
    await fs.symlink(path.join(dev1, '1-1.2:1.0'), path.join(sys, 'class/usbmisc/lp0/device'));
    await fs.symlink(path.join(dev2, '1-1.3:1.0'), path.join(sys, 'class/usbmisc/lp1/device'));

    const devices = await discoverUsbPrinters(sys, '/dev');
    expect(devices).toEqual([
      { key: 'usb:04b8:0e28:X5E1234', path: '/dev/usb/lp0', description: 'EPSON TM-T20III (Port 1-1.2, /dev/usb/lp0)' },
      { key: 'usb:0416:5011@1-1.3', path: '/dev/usb/lp1', description: 'STMicro POS58 (Port 1-1.3, /dev/usb/lp1)' },
    ]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('liefert eine leere Liste ohne usblp', async () => {
    expect(await discoverUsbPrinters('/nicht/vorhanden')).toEqual([]);
  });

  it('baut die WebSocket-Adresse', () => {
    expect(agentWsUrl('http://192.168.1.10:8080')).toBe('ws://192.168.1.10:8080/api/agent/ws');
    expect(agentWsUrl('https://fest.example.de/')).toBe('wss://fest.example.de/api/agent/ws');
  });
});

describe('Druck-Agent', () => {
  let server: WebSocketServer | null = null;
  let agent: PrintAgent | null = null;

  afterEach(() => {
    agent?.stop();
    server?.close();
  });

  async function setup(write: (d: AgentDevice, data: Buffer) => Promise<void>) {
    server = new WebSocketServer({ port: 0 });
    await new Promise((r) => server!.once('listening', r));
    const port = (server.address() as AddressInfo).port;
    const messages: AgentToServer[] = [];
    const connected = new Promise<WebSocket>((resolve) =>
      server!.once('connection', (socket, req) => {
        expect(req.headers.authorization).toBe('Bearer geheim');
        socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
        resolve(socket);
      }),
    );
    const device: AgentDevice = { key: 'usb:1:2:3', path: '/dev/usb/lp0', description: 'Test' };
    agent = new PrintAgent({
      serverUrl: `http://127.0.0.1:${port}`,
      token: 'geheim',
      version: 'test',
      hostname: 'pi',
      discover: async () => [device],
      write,
      log: () => {},
      blockedAfterMs: 50,
    });
    await agent.start();
    const socket = await connected;
    const waitFor = async (pred: (m: AgentToServer) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const found = messages.find(pred);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error('Nachricht nicht erhalten');
    };
    return { socket, messages, waitFor };
  }

  it('meldet Geräte, druckt Aufträge und verhindert Doppeldruck', async () => {
    const written: Buffer[] = [];
    const { socket, messages, waitFor } = await setup(async (_d, data) => {
      written.push(data);
    });
    const hello = await waitFor((m) => m.type === 'hello');
    expect(hello).toMatchObject({ type: 'hello', hostname: 'pi', devices: [{ key: 'usb:1:2:3' }] });

    const job = { type: 'job', jobId: 7, deviceKey: 'usb:1:2:3', data: Buffer.from('Hallo').toString('base64') };
    socket.send(JSON.stringify(job));
    await waitFor((m) => m.type === 'result' && m.jobId === 7);
    expect(written.map((b) => b.toString())).toEqual(['Hallo']);

    // Server schickt denselben Auftrag nach Verbindungsabbruch nochmal.
    socket.send(JSON.stringify(job));
    await new Promise((r) => setTimeout(r, 50));
    expect(written).toHaveLength(1);
    expect(messages.filter((m) => m.type === 'result' && m.jobId === 7)).toHaveLength(2);
  });

  it('meldet Fehler verständlich und unbekannte Geräte', async () => {
    const { socket, waitFor } = await setup(async () => {
      throw Object.assign(new Error('x'), { code: 'EACCES' });
    });
    await waitFor((m) => m.type === 'hello');
    socket.send(JSON.stringify({ type: 'job', jobId: 1, deviceKey: 'usb:1:2:3', data: '' }));
    const failed = await waitFor((m) => m.type === 'result' && m.jobId === 1);
    expect(failed).toMatchObject({ ok: false, error: expect.stringContaining('Schreibrechte') });

    socket.send(JSON.stringify({ type: 'job', jobId: 2, deviceKey: 'usb:9:9:9', data: '' }));
    const missing = await waitFor((m) => m.type === 'result' && m.jobId === 2);
    expect(missing).toMatchObject({ ok: false, error: expect.stringContaining('nicht gefunden') });
  });

  it('meldet hängende Drucker als blockiert', async () => {
    let release!: () => void;
    const { socket, waitFor } = await setup(() => new Promise<void>((r) => (release = r)));
    await waitFor((m) => m.type === 'hello');
    socket.send(JSON.stringify({ type: 'job', jobId: 3, deviceKey: 'usb:1:2:3', data: '' }));
    const blocked = await waitFor((m) => m.type === 'blocked');
    expect(blocked).toMatchObject({ jobId: 3, message: expect.stringContaining('Papier') });
    release();
    await waitFor((m) => m.type === 'result' && m.jobId === 3);
  });
});
