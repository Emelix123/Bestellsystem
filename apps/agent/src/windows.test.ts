import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { windowsBackend } from './backends';
import { loadConfig } from './config';
import { printerProblem, WindowsSpooler, WORKER_SCRIPT, type WindowsPrinter } from './windows';

/**
 * Ersatz für den PowerShell-Hilfsprozess: spricht dasselbe Zeilenprotokoll.
 * Den echten Druck über winspool.drv kann man nur auf Windows prüfen.
 */
const FAKE_WORKER = `
const fs = require('fs');
const readline = require('readline');
const out = process.env.FAKE_OUT;
const reply = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
reply({ id: 0, ok: true, ready: true });
const printers = JSON.parse(process.env.FAKE_PRINTERS || '[]');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const req = JSON.parse(line);
  if (req.cmd === 'list') return reply({ id: req.id, ok: true, printers: process.env.FAKE_SINGLE ? printers[0] : printers });
  if (req.cmd === 'print') {
    if (req.printer === 'Absturz') process.exit(3);
    if (req.printer === 'Haenger') return;
    if (req.printer === 'Kaputt') return reply({ id: req.id, ok: false, error: 'Zugriff verweigert' });
    fs.appendFileSync(out, JSON.stringify({ printer: req.printer, doc: req.doc, bytes: req.data }) + '\\n');
    return reply({ id: req.id, ok: true });
  }
  reply({ id: req.id, ok: false, error: 'Unbekannter Befehl' });
});
`;

const base: WindowsPrinter = {
  name: 'POS-80',
  port: 'USB001',
  driver: 'POS-80C Printer',
  offline: false,
  status: 3,
  errorState: 2,
  jobs: 0,
  oldestJobSeconds: 0,
};

const PRINTERS: WindowsPrinter[] = [
  base,
  { ...base, name: 'Küche', port: 'USB002', offline: true },
  { ...base, name: 'Microsoft Print to PDF', port: 'PORTPROMPT:', driver: 'Microsoft Print To PDF' },
];

let dir: string;
let script: string;
let spooler: WindowsSpooler | null = null;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-win-'));
  script = path.join(dir, 'fake-worker.cjs');
  fs.writeFileSync(script, FAKE_WORKER);
});

afterEach(() => {
  spooler?.close();
  spooler = null;
  delete process.env.FAKE_SINGLE;
});

function createSpooler(timeoutMs = 5000) {
  const out = path.join(dir, `out-${Date.now()}-${Math.random()}.jsonl`);
  process.env.FAKE_OUT = out;
  process.env.FAKE_PRINTERS = JSON.stringify(PRINTERS);
  spooler = new WindowsSpooler({ command: process.execPath, args: [script], timeoutMs });
  const printed = () =>
    fs.existsSync(out)
      ? fs
          .readFileSync(out, 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l) as { printer: string; doc: string; bytes: string })
      : [];
  return { spooler, printed };
}

describe('Windows-Druck (simulierter Hilfsprozess)', () => {
  it('listet echte Drucker, blendet virtuelle aus und meldet Offline', async () => {
    const { spooler } = createSpooler();
    const backend = windowsBackend({ spooler });
    const devices = await backend.discover();
    expect(devices).toEqual([
      { key: 'win:POS-80', path: 'POS-80', description: 'POS-80 (USB001, POS-80C Printer)', problem: null },
      {
        key: 'win:Küche',
        path: 'Küche',
        description: 'Küche (USB002, POS-80C Printer)',
        problem: expect.stringContaining('offline'),
      },
    ]);
  });

  it('kommt mit einem einzelnen Drucker statt Liste zurecht', async () => {
    process.env.FAKE_SINGLE = '1';
    const { spooler } = createSpooler();
    expect((await spooler.list()).map((p) => p.name)).toEqual(['POS-80']);
  });

  it('übergibt die Bytes unverändert als RAW-Auftrag', async () => {
    const { spooler, printed } = createSpooler();
    const backend = windowsBackend({ spooler });
    await backend.discover();
    const data = Buffer.from([0x1b, 0x40, 0x84, 0x94, 0x81, 0x0a, 0x1d, 0x56, 0x01]);
    await backend.write({ key: 'win:POS-80', path: 'POS-80', description: '' }, data);
    const [job] = printed();
    expect(job.printer).toBe('POS-80');
    expect(job.doc).toBe('Bestellsystem');
    expect(Buffer.from(job.bytes, 'base64')).toEqual(data);
  });

  it('nimmt keine Aufträge für Drucker an, die Windows als offline meldet', async () => {
    const { spooler, printed } = createSpooler();
    const backend = windowsBackend({ spooler });
    await backend.discover();
    await expect(
      backend.write({ key: 'win:Küche', path: 'Küche', description: '' }, Buffer.from('x')),
    ).rejects.toThrow(/offline/);
    expect(printed()).toEqual([]);
  });

  it('meldet Fehler der Druckerwarteschlange weiter', async () => {
    const { spooler } = createSpooler();
    await expect(spooler.print('Kaputt', Buffer.from('x'), 'Test')).rejects.toThrow('Zugriff verweigert');
  });

  it('startet den Hilfsprozess nach einem Absturz neu', async () => {
    const { spooler, printed } = createSpooler();
    await expect(spooler.print('Absturz', Buffer.from('x'), 'Test')).rejects.toThrow(/beendet/);
    await spooler.print('POS-80', Buffer.from('weiter'), 'Test');
    expect(printed().map((j) => Buffer.from(j.bytes, 'base64').toString())).toEqual(['weiter']);
  });

  it('bricht hängende Aufträge ab und startet neu', async () => {
    const { spooler, printed } = createSpooler(300);
    await expect(spooler.print('Haenger', Buffer.from('x'), 'Test')).rejects.toThrow(/Zeitüberschreitung/);
    await spooler.print('POS-80', Buffer.from('danach'), 'Test');
    expect(printed()).toHaveLength(1);
  });

  it('erkennt eine hängende Windows-Warteschlange', () => {
    expect(printerProblem({ ...base, jobs: 2, oldestJobSeconds: 5 })).toBeNull();
    expect(printerProblem({ ...base, jobs: 2, oldestJobSeconds: 45 })).toMatchObject({
      blocking: true,
      message: expect.stringContaining('hängt (2 Aufträge)'),
    });
    expect(printerProblem({ ...base, errorState: 4 })?.message).toContain('Kein Papier');
  });

  it('PowerShell-Skript ist vollständig eingebettet', () => {
    expect(WORKER_SCRIPT).toContain("Add-Type -TypeDefinition @'");
    expect(WORKER_SCRIPT).toMatch(/^'@$/m);
    expect(WORKER_SCRIPT).toContain('pDataType');
    expect(WORKER_SCRIPT).toContain('"RAW"');
  });
});

describe('Konfiguration', () => {
  it('liest die Datei (auch mit BOM) und lässt Umgebungsvariablen gewinnen', () => {
    const file = path.join(dir, 'agent.json');
    fs.writeFileSync(file, '﻿' + JSON.stringify({ serverUrl: 'http://10.0.0.5:8080', token: 'aus-datei' }));
    expect(loadConfig(['node', 'agent.mjs', '--config', file], {})).toMatchObject({
      serverUrl: 'http://10.0.0.5:8080',
      token: 'aus-datei',
    });
    expect(loadConfig(['node', 'agent.mjs', '--config', file], { AGENT_TOKEN: 'aus-env' }).token).toBe('aus-env');
    expect(loadConfig(['node', 'agent.mjs', '--log', 'x.log'], {}).logFile).toBe('x.log');
  });
});
