import type { AgentDevice } from '@bestellsystem/shared';
import fs from 'node:fs/promises';
import { discoverUsbPrinters, extraDevices } from './usb';
import { isVirtualPrinter, printerProblem, windowsDevice, WindowsSpooler, type WindowsPrinter } from './windows';

/** Wie der Agent Drucker findet und Bytes zu ihnen bringt – je Betriebssystem. */
export interface PrinterBackend {
  platform: string;
  rescanIntervalMs: number;
  discover(): Promise<AgentDevice[]>;
  write(device: AgentDevice, data: Buffer): Promise<void>;
  close(): void;
}

/** Bytes roh auf ein Gerät schreiben bzw. an eine Testdatei anhängen. */
async function writeFile(device: AgentDevice, data: Buffer) {
  const handle = await fs.open(device.path, device.key.startsWith('file:') ? 'a' : 'w');
  try {
    await handle.write(data);
  } finally {
    await handle.close();
  }
}

export function linuxBackend(opts: { extra?: string; sysRoot?: string; devRoot?: string } = {}): PrinterBackend {
  return {
    platform: 'Linux',
    rescanIntervalMs: 5000,
    async discover() {
      const usb = await discoverUsbPrinters(opts.sysRoot ?? '/sys', opts.devRoot ?? '/dev');
      return [...usb, ...extraDevices(opts.extra)];
    },
    write: writeFile,
    close() {},
  };
}

/**
 * Windows: Drucken und Druckerliste laufen in getrennten Hilfsprozessen. Die
 * Abfrage der Druckerliste (WMI) dauert unter Windows oft eine Sekunde oder
 * länger – ein Bon soll nie dahinter warten müssen.
 */
export function windowsBackend(opts: {
  extra?: string;
  spooler: WindowsSpooler;
  lister?: WindowsSpooler;
  keepAwake?: boolean;
  log?(message: string): void;
}): PrinterBackend {
  let known = new Map<string, WindowsPrinter>();
  const lister = opts.lister ?? opts.spooler;
  if (opts.keepAwake) {
    opts.spooler.keepAwake().catch((err: Error) => opts.log?.(`PC wach halten nicht möglich: ${err.message}`));
  }
  return {
    platform: 'Windows',
    rescanIntervalMs: 5000,
    async discover() {
      const printers = (await lister.list()).filter((p) => !isVirtualPrinter(p));
      known = new Map(printers.map((p) => [p.name, p]));
      return [...printers.map(windowsDevice), ...extraDevices(opts.extra)];
    },
    async write(device, data) {
      if (!device.key.startsWith('win:')) return writeFile(device, data);
      const problem = known.get(device.path) ? printerProblem(known.get(device.path)!) : null;
      // Bei offline/hängender Warteschlange nicht an Windows übergeben: Der Auftrag
      // bleibt sonst unsichtbar dort liegen. So wartet er sichtbar auf dem Server.
      if (problem?.blocking) throw new Error(problem.message);
      await opts.spooler.print(device.path, data, 'Bestellsystem');
    },
    close() {
      opts.spooler.close();
      lister.close();
    },
  };
}
