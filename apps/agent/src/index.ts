import { buildTestBon, renderEscPos, type AgentDevice } from '@bestellsystem/shared';
import fs from 'node:fs/promises';
import os from 'node:os';
import { PrintAgent } from './agent';
import { discoverUsbPrinters, extraDevices } from './usb';

const VERSION = '0.1.0';

function log(message: string) {
  console.log(`${new Date().toISOString()} ${message}`);
}

async function discover(): Promise<AgentDevice[]> {
  const usb = await discoverUsbPrinters(process.env.SYSFS_ROOT ?? '/sys', process.env.DEV_ROOT ?? '/dev');
  return [...usb, ...extraDevices(process.env.EXTRA_DEVICES)];
}

/** Schreibt die Bytes roh auf das Gerät (oder hängt sie an eine Testdatei an). */
async function write(device: AgentDevice, data: Buffer) {
  const handle = await fs.open(device.path, device.key.startsWith('file:') ? 'a' : 'w');
  try {
    await handle.write(data);
  } finally {
    await handle.close();
  }
}

function usage() {
  console.log(`Bestellsystem Druck-Agent ${VERSION}

Betrieb:
  SERVER_URL=http://192.168.1.10:8080 AGENT_TOKEN=… node agent.mjs

Hilfen:
  node agent.mjs --list                 gefundene USB-Drucker anzeigen
  node agent.mjs --test /dev/usb/lp0    Testbon direkt drucken (ohne Server)
    optional: --width 32 (58 mm) oder 48 (80 mm), --codepage cp858|cp437|ascii

Umgebungsvariablen:
  SERVER_URL      Adresse des Bestellsystems
  AGENT_TOKEN     Token aus dem Admin-Bereich (Drucker → Druck-Agenten)
  EXTRA_DEVICES   zusätzliche Geräte/Dateien, kommagetrennt (z. B. file:/tmp/bons.bin)`);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  if (process.argv.includes('--list')) {
    const devices = await discover();
    if (devices.length === 0) {
      console.log('Keine USB-Drucker gefunden. Ist der Drucker eingeschaltet und per USB verbunden?');
      console.log('Tipp: "ls /dev/usb/" und "dmesg | grep -i usblp" zeigen, ob Linux ihn erkannt hat.');
    }
    for (const d of devices) console.log(`${d.key}\n    ${d.description}`);
    return;
  }

  const testTarget = arg('--test');
  if (testTarget) {
    const widthChars = Number(arg('--width') ?? 48);
    const codepage = (arg('--codepage') ?? 'cp858') as 'cp858';
    const doc = buildTestBon({
      printerName: os.hostname(),
      profile: { widthChars, codepage },
      time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    });
    const bytes = renderEscPos(doc, { widthChars, codepage, cut: true });
    await write({ key: 'test', path: testTarget, description: testTarget }, Buffer.from(bytes));
    console.log(`Testbon an ${testTarget} gesendet (${bytes.length} Bytes).`);
    return;
  }

  const serverUrl = process.env.SERVER_URL;
  const token = process.env.AGENT_TOKEN;
  if (!serverUrl || !token) {
    usage();
    console.error('\nFehler: SERVER_URL und AGENT_TOKEN müssen gesetzt sein.');
    process.exit(1);
  }

  const agent = new PrintAgent({ serverUrl, token, version: VERSION, hostname: os.hostname(), discover, write, log });
  await agent.start();
  const shutdown = () => {
    agent.stop();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
