import type { AgentDevice } from '@bestellsystem/shared';
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Windows: Bondrucker werden über die Windows-Druckerwarteschlange angesprochen.
 * Der Auftrag wird als "RAW" übergeben – die ESC/POS-Bytes gehen unverändert an
 * den Drucker, der Treiber rendert nichts. Dafür muss der Drucker in Windows
 * installiert sein (Herstellertreiber oder "Generic / Text Only").
 *
 * Node.js hat keinen eingebauten Zugriff auf die Druck-API von Windows. Statt
 * eines nativen Moduls läuft ein kleiner PowerShell-Prozess dauerhaft mit, der
 * winspool.drv aufruft. Kommunikation: eine JSON-Zeile pro Anfrage/Antwort.
 */
export const WORKER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try { [Console]::InputEncoding = [Text.Encoding]::UTF8; [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class BestellRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);

  static Exception Fail() { return new Win32Exception(Marshal.GetLastWin32Error()); }

  public static void Send(string printer, byte[] data, string docName) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw Fail();
    try {
      DOCINFO info = new DOCINFO();
      info.pDocName = docName;
      info.pDataType = "RAW";
      if (StartDocPrinter(handle, 1, info) == 0) throw Fail();
      try {
        if (!StartPagePrinter(handle)) throw Fail();
        int written;
        if (!WritePrinter(handle, data, data.Length, out written)) throw Fail();
        if (written != data.Length) throw new Exception("Nur " + written + " von " + data.Length + " Bytes geschrieben");
        EndPagePrinter(handle);
      } finally {
        EndDocPrinter(handle);
      }
    } finally {
      ClosePrinter(handle);
    }
  }
}
'@

function Write-Answer($answer) {
  $json = $answer | ConvertTo-Json -Compress -Depth 5
  # Nur ASCII ausgeben – unabhängig von der Codepage der Konsole.
  $json = [regex]::Replace($json, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

Write-Answer @{ id = 0; ok = $true; ready = $true }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  $id = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    if ($req.cmd -eq 'list') {
      $now = Get-Date
      $jobs = @(Get-CimInstance Win32_PrintJob -ErrorAction SilentlyContinue)
      $printers = @(Get-CimInstance Win32_Printer | ForEach-Object {
        $name = $_.Name
        $mine = @($jobs | Where-Object { ($_.Name -split ',')[0] -eq $name })
        $oldest = 0
        foreach ($j in $mine) {
          if ($j.TimeSubmitted) {
            $age = [int]($now - $j.TimeSubmitted).TotalSeconds
            if ($age -gt $oldest) { $oldest = $age }
          }
        }
        [pscustomobject]@{
          name = $name
          port = [string]$_.PortName
          driver = [string]$_.DriverName
          offline = [bool]$_.WorkOffline
          status = [int]$_.PrinterStatus
          errorState = [int]$_.DetectedErrorState
          jobs = $mine.Count
          oldestJobSeconds = $oldest
        }
      })
      Write-Answer @{ id = $id; ok = $true; printers = $printers }
    } elseif ($req.cmd -eq 'print') {
      [BestellRawPrinter]::Send([string]$req.printer, [Convert]::FromBase64String([string]$req.data), [string]$req.doc)
      Write-Answer @{ id = $id; ok = $true }
    } else {
      Write-Answer @{ id = $id; ok = $false; error = 'Unbekannter Befehl' }
    }
  } catch {
    Write-Answer @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
}
`;

export interface WindowsPrinter {
  name: string;
  port: string;
  driver: string;
  offline: boolean;
  /** Win32_Printer.PrinterStatus (7 = offline) */
  status: number;
  /** Win32_Printer.DetectedErrorState */
  errorState: number;
  /** Aufträge, die gerade in der Windows-Warteschlange liegen */
  jobs: number;
  oldestJobSeconds: number;
}

interface Pending {
  resolve(value: Record<string, unknown>): void;
  reject(err: Error): void;
  timer: NodeJS.Timeout;
}

export interface SpoolerOptions {
  /** Programm und Argumente des Hilfsprozesses (für Tests austauschbar). */
  command?: string;
  args?: string[];
  timeoutMs?: number;
  log?(message: string): void;
}

export function powershellArgs(script = WORKER_SCRIPT): string[] {
  return [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ];
}

/** Dauerhafter PowerShell-Hilfsprozess; startet bei Absturz beim nächsten Aufruf neu. */
export class WindowsSpooler {
  private child: ChildProcess | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = '';

  constructor(private opts: SpoolerOptions = {}) {}

  private ensure(): ChildProcess {
    if (this.child) return this.child;
    const child = spawn(this.opts.command ?? 'powershell.exe', this.opts.args ?? powershellArgs(), {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    this.buffer = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      this.buffer += chunk;
      let index: number;
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (line) this.handleLine(line);
      }
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (text) this.opts.log?.(`PowerShell: ${text.slice(0, 500)}`);
    });
    child.on('error', (err) => this.discard(child, `PowerShell konnte nicht gestartet werden: ${err.message}`));
    child.on('exit', (code) => this.discard(child, `PowerShell-Hilfsprozess beendet (Code ${code})`));
    return child;
  }

  /** Hilfsprozess verwerfen: offene Anfragen scheitern, die nächste startet einen neuen. */
  private discard(child: ChildProcess, reason: string) {
    if (this.child !== child) return;
    this.child = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.pending.delete(id);
    }
    child.kill();
  }

  private handleLine(line: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      this.opts.log?.(`Unerwartete Ausgabe von PowerShell: ${line.slice(0, 200)}`);
      return;
    }
    const id = typeof msg.id === 'number' ? msg.id : null;
    if (id === null || id === 0) return;
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    if (msg.ok) p.resolve(msg);
    else p.reject(new Error(String(msg.error ?? 'Unbekannter Fehler')));
  }

  private request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const child = this.ensure();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      // Hängender Hilfsprozess wird verworfen und beim nächsten Aufruf neu gestartet.
      const timer = setTimeout(
        () => this.discard(child, 'Zeitüberschreitung bei der Windows-Druckerwarteschlange'),
        this.opts.timeoutMs ?? 30_000,
      );
      this.pending.set(id, { resolve, reject, timer });
      // Nicht-ASCII-Zeichen escapen, damit die Codepage der Konsole keine Rolle spielt.
      const line = JSON.stringify({ ...payload, id }).replace(
        /[\u0080-￿]/g,
        (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
      );
      child.stdin!.write(line + '\n');
    });
  }

  async list(): Promise<WindowsPrinter[]> {
    const res = await this.request({ cmd: 'list' });
    const printers = res.printers;
    // ConvertTo-Json macht aus einem einzelnen Element manchmal kein Array.
    if (!printers) return [];
    return (Array.isArray(printers) ? printers : [printers]) as WindowsPrinter[];
  }

  async print(printer: string, data: Buffer, docName: string): Promise<void> {
    await this.request({ cmd: 'print', printer, data: data.toString('base64'), doc: docName });
  }

  close() {
    if (this.child) this.discard(this.child, 'Druck-Agent wird beendet');
  }
}

// ---------------------------------------------------------------------------
// Abbildung auf Geräte des Agenten
// ---------------------------------------------------------------------------

/** Virtuelle Drucker (PDF, XPS, Fax …) sind keine Bondrucker. */
export function isVirtualPrinter(p: Pick<WindowsPrinter, 'name' | 'port'>): boolean {
  if (/^(PORTPROMPT:|nul:|SHRFAX:|XPSPort:|FILE:)$/i.test(p.port.trim())) return true;
  return /Microsoft Print to PDF|Microsoft XPS|OneNote|Fax/i.test(p.name);
}

const ERROR_STATES: Record<number, string> = {
  4: 'Kein Papier',
  7: 'Deckel offen',
  8: 'Papierstau',
  9: 'Drucker offline',
  10: 'Wartung erforderlich',
};

/** Ab so vielen Sekunden gilt die Windows-Warteschlange als hängend. */
export const STUCK_QUEUE_SECONDS = 20;

/**
 * Was Windows über den Drucker meldet. Ein schwerwiegendes Problem (offline,
 * hängende Warteschlange) führt dazu, dass der Agent keine weiteren Aufträge
 * annimmt – sie bleiben dann sichtbar in der Warteschlange des Servers statt
 * unbemerkt in der von Windows zu verschwinden.
 */
export function printerProblem(p: WindowsPrinter): { message: string; blocking: boolean } | null {
  if (p.offline || p.status === 7 || p.errorState === 9) {
    return { message: 'Windows meldet den Drucker als offline – USB-Kabel und Strom prüfen', blocking: true };
  }
  const state = ERROR_STATES[p.errorState];
  if (state) return { message: `Windows meldet: ${state}`, blocking: true };
  if (p.jobs > 0 && p.oldestJobSeconds >= STUCK_QUEUE_SECONDS) {
    return {
      message: `Windows-Druckerwarteschlange hängt (${p.jobs} ${p.jobs === 1 ? 'Auftrag' : 'Aufträge'}) – Drucker prüfen`,
      blocking: true,
    };
  }
  return null;
}

export function windowsDevice(p: WindowsPrinter): AgentDevice {
  return {
    key: `win:${p.name}`,
    path: p.name,
    description: `${p.name} (${[p.port, p.driver].filter(Boolean).join(', ')})`,
    problem: printerProblem(p)?.message ?? null,
  };
}
