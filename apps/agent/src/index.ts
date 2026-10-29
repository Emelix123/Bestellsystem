import { buildTestBon, renderEscPos, type Codepage } from '@bestellsystem/shared';
import os from 'node:os';
import { PrintAgent } from './agent';
import { linuxBackend, windowsBackend, type PrinterBackend } from './backends';
import { createLogger, loadConfig } from './config';
import { WindowsSpooler } from './windows';

const VERSION = '0.2.0';
const isWindows = process.platform === 'win32';

function usage() {
  console.log(`Bestellsystem Druck-Agent ${VERSION}

Betrieb:
  Linux:    SERVER_URL=http://192.168.1.10:8080 AGENT_TOKEN=… node agent.mjs
  Windows:  node agent.mjs --config C:\\ProgramData\\Bestellsystem-Agent\\agent.json

Hilfen:
  node agent.mjs --list                    gefundene Drucker anzeigen
  node agent.mjs --test <Drucker>          Testbon direkt drucken (ohne Server)
      Linux:   --test /dev/usb/lp0
      Windows: --test "POS-80"   (Name wie in den Windows-Druckereinstellungen)
      optional: --width 32 (58 mm) oder 48 (80 mm), --codepage cp858|cp437|ascii

Einstellungen (Umgebungsvariable oder Schlüssel in der --config-Datei):
  SERVER_URL      / serverUrl     Adresse des Bestellsystems
  AGENT_TOKEN     / token         Token aus dem Admin-Bereich (Drucker → Druck-Agenten)
  EXTRA_DEVICES   / extraDevices  zusätzliche Testgeräte, z. B. file:/tmp/bons.bin
  LOG_FILE        / logFile       Protokoll zusätzlich in Datei (auch: --log <Datei>)`);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function createBackend(extra: string | undefined, log: (m: string) => void): PrinterBackend {
  if (isWindows) return windowsBackend({ extra, spooler: new WindowsSpooler({ log }) });
  return linuxBackend({ extra, sysRoot: process.env.SYSFS_ROOT, devRoot: process.env.DEV_ROOT });
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }
  const config = loadConfig();
  const log = createLogger(config.logFile);
  const backend = createBackend(config.extraDevices, log);

  if (process.argv.includes('--list')) {
    const devices = await backend.discover();
    if (devices.length === 0) {
      console.log('Keine Drucker gefunden. Ist der Drucker eingeschaltet und per USB verbunden?');
      console.log(
        isWindows
          ? 'Tipp: Der Drucker muss unter Windows installiert sein (Einstellungen → Drucker & Scanner).'
          : 'Tipp: "ls /dev/usb/" und "dmesg | grep -i usblp" zeigen, ob Linux ihn erkannt hat.',
      );
    }
    for (const d of devices) console.log(`${d.key}\n    ${d.description}${d.problem ? `\n    ! ${d.problem}` : ''}`);
    backend.close();
    return;
  }

  const testTarget = arg('--test');
  if (testTarget) {
    const widthChars = Number(arg('--width') ?? 48);
    const codepage = (arg('--codepage') ?? 'cp858') as Codepage;
    const doc = buildTestBon({
      printerName: os.hostname(),
      profile: { widthChars, codepage },
      time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    });
    const bytes = Buffer.from(renderEscPos(doc, { widthChars, codepage, cut: true }));
    // Unter Windows ist das Ziel ein Druckername, sonst ein Gerätepfad.
    const isPrinterName = isWindows && !/[\\/]/.test(testTarget.replace(/^win:/, ''));
    const name = testTarget.replace(/^win:/, '');
    const device = isPrinterName
      ? { key: `win:${name}`, path: name, description: name }
      : { key: 'test', path: testTarget, description: testTarget };
    if (isPrinterName) await backend.discover();
    await backend.write(device, bytes);
    console.log(`Testbon an ${testTarget} gesendet (${bytes.length} Bytes).`);
    backend.close();
    return;
  }

  if (!config.serverUrl || !config.token) {
    usage();
    console.error('\nFehler: Server-Adresse und Token fehlen (SERVER_URL/AGENT_TOKEN oder --config).');
    process.exit(1);
  }

  const agent = new PrintAgent({
    serverUrl: config.serverUrl,
    token: config.token,
    version: VERSION,
    hostname: os.hostname(),
    platform: backend.platform,
    rescanIntervalMs: backend.rescanIntervalMs,
    discover: () => backend.discover(),
    write: (device, data) => backend.write(device, data),
    log,
  });
  log(`Druck-Agent ${VERSION} startet (${backend.platform}, ${os.hostname()})`);
  await agent.start();
  const shutdown = () => {
    agent.stop();
    backend.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
