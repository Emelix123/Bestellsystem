import type { AgentDevice } from '@bestellsystem/shared';
import fs from 'node:fs/promises';
import path from 'node:path';

async function readAttr(dir: string, name: string): Promise<string | null> {
  try {
    return (await fs.readFile(path.join(dir, name), 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Sucht USB-Drucker, die der Linux-Treiber "usblp" als /dev/usb/lpN
 * bereitstellt. Die Nummer N kann sich nach dem Umstecken ändern – deshalb
 * wird aus Hersteller-ID, Produkt-ID und Seriennummer (oder dem USB-Port)
 * eine stabile Kennung gebildet.
 */
export async function discoverUsbPrinters(sysRoot = '/sys', devRoot = '/dev'): Promise<AgentDevice[]> {
  const classDir = path.join(sysRoot, 'class/usbmisc');
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(classDir)).filter((e) => /^lp\d+$/.test(e));
  } catch {
    entries = [];
  }
  const devices: AgentDevice[] = [];
  for (const entry of entries.sort()) {
    const devicePath = path.join(devRoot, 'usb', entry);
    let usbDir: string | null = null;
    try {
      // .../usb1/1-1.2/1-1.2:1.0 → Elternordner ist das USB-Gerät
      const iface = await fs.realpath(path.join(classDir, entry, 'device'));
      usbDir = path.dirname(iface);
    } catch {
      usbDir = null;
    }
    const vendor = usbDir ? await readAttr(usbDir, 'idVendor') : null;
    const product = usbDir ? await readAttr(usbDir, 'idProduct') : null;
    const serial = usbDir ? await readAttr(usbDir, 'serial') : null;
    const manufacturer = usbDir ? await readAttr(usbDir, 'manufacturer') : null;
    const productName = usbDir ? await readAttr(usbDir, 'product') : null;
    const port = usbDir ? path.basename(usbDir) : null;

    let key: string;
    if (vendor && product && serial) key = `usb:${vendor}:${product}:${serial}`;
    else if (vendor && product && port) key = `usb:${vendor}:${product}@${port}`;
    else key = `path:${devicePath}`;

    const name = [manufacturer, productName].filter(Boolean).join(' ') || 'USB-Drucker';
    const where = port ? `Port ${port}` : devicePath;
    devices.push({ key, path: devicePath, description: `${name} (${where}, ${devicePath})` });
  }
  return devices;
}

/** Zusätzliche Geräte per Umgebungsvariable, z. B. EXTRA_DEVICES=file:/tmp/bon.bin */
export function extraDevices(spec: string | undefined): AgentDevice[] {
  if (!spec) return [];
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const filePath = s.startsWith('file:') ? s.slice(5) : s;
      return { key: `file:${filePath}`, path: filePath, description: `Datei/Gerät ${filePath}` };
    });
}
