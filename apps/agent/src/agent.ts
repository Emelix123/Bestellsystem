import type { AgentDevice, AgentToServer, ServerToAgent } from '@bestellsystem/shared';
import WebSocket from 'ws';

export interface AgentOptions {
  serverUrl: string;
  token: string;
  version: string;
  hostname: string;
  discover(): Promise<AgentDevice[]>;
  write(device: AgentDevice, data: Buffer): Promise<void>;
  log(message: string): void;
  /** Ab wann ein hängender Schreibvorgang als "blockiert" gemeldet wird. */
  blockedAfterMs?: number;
  rescanIntervalMs?: number;
}

export function agentWsUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = url.pathname.replace(/\/+$/, '') + '/api/agent/ws';
  return url.toString();
}

export function describeWriteError(err: unknown, device: AgentDevice): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  switch (code) {
    case 'ENOENT':
      return `Drucker nicht vorhanden (${device.path}) – USB-Kabel und Strom prüfen`;
    case 'EACCES':
    case 'EPERM':
      return `Keine Schreibrechte auf ${device.path} – Agent als root oder in Gruppe "lp" starten`;
    case 'EBUSY':
      return `${device.path} ist belegt – läuft CUPS auf diesem Rechner?`;
    case 'ENODEV':
    case 'EIO':
      return 'Drucker getrennt oder ausgeschaltet';
    default:
      return (err as Error)?.message ?? String(err);
  }
}

/**
 * Der Druck-Agent hält eine dauerhafte Verbindung zum Server, bekommt
 * Druckaufträge gepusht und schreibt sie roh (ESC/POS) auf den USB-Drucker.
 */
export class PrintAgent {
  private ws: WebSocket | null = null;
  private devices: AgentDevice[] = [];
  private devicesSignature = '';
  /** Bereits gedruckte Aufträge – schützt vor Doppeldruck nach Verbindungsabbruch. */
  private printed = new Map<number, number>();
  private inFlight = new Set<number>();
  private queues = new Map<string, Promise<void>>();
  private reconnectDelay = 1000;
  private lastPing = Date.now();
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;

  constructor(private opts: AgentOptions) {}

  async start() {
    await this.rescan(false);
    this.timers.push(setInterval(() => void this.rescan(true), this.opts.rescanIntervalMs ?? 5000));
    // Server pingt alle 15 s. Kommt 45 s nichts, ist die Verbindung tot (WLAN weg).
    this.timers.push(
      setInterval(() => {
        if (this.ws && Date.now() - this.lastPing > 45_000) {
          this.opts.log('Keine Verbindung mehr zum Server – baue neu auf');
          this.ws.terminate();
        }
        const cutoff = Date.now() - 60 * 60_000;
        for (const [id, at] of this.printed) if (at < cutoff) this.printed.delete(id);
      }, 5000),
    );
    this.connect();
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.ws?.close();
  }

  private send(message: AgentToServer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private connect() {
    if (this.stopped) return;
    const url = agentWsUrl(this.opts.serverUrl);
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.opts.token}` } });
    this.ws = ws;
    ws.on('open', () => {
      this.reconnectDelay = 1000;
      this.lastPing = Date.now();
      this.opts.log(`Verbunden mit ${url}`);
      this.send({ type: 'hello', version: this.opts.version, hostname: this.opts.hostname, devices: this.devices });
    });
    ws.on('ping', () => (this.lastPing = Date.now()));
    ws.on('message', (raw) => {
      this.lastPing = Date.now();
      let msg: ServerToAgent;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'welcome') this.opts.log(`Angemeldet als "${msg.name}"`);
      if (msg.type === 'job') void this.handleJob(msg);
    });
    ws.on('close', (code, reason) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      if (code === 4401) this.opts.log('Token ungültig – bitte im Admin-Bereich einen neuen Token erzeugen.');
      else this.opts.log(`Verbindung getrennt (${code}${reason.length ? ` ${reason}` : ''}) – neuer Versuch in ${this.reconnectDelay / 1000} s`);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(10_000, this.reconnectDelay * 2);
    });
    ws.on('error', (err) => {
      this.opts.log(`Verbindungsfehler: ${err.message}`);
    });
  }

  private async rescan(report: boolean) {
    try {
      const found = await this.opts.discover();
      const signature = JSON.stringify(found);
      if (signature !== this.devicesSignature) {
        this.devices = found;
        this.devicesSignature = signature;
        this.opts.log(
          found.length ? `Drucker gefunden: ${found.map((d) => d.description).join('; ')}` : 'Keine USB-Drucker gefunden',
        );
        if (report) this.send({ type: 'devices', devices: found });
      }
    } catch (err) {
      this.opts.log(`Gerätesuche fehlgeschlagen: ${(err as Error).message}`);
    }
  }

  private async handleJob(msg: Extract<ServerToAgent, { type: 'job' }>) {
    if (this.printed.has(msg.jobId)) {
      this.send({ type: 'result', jobId: msg.jobId, ok: true });
      return;
    }
    if (this.inFlight.has(msg.jobId)) return;

    let device = this.devices.find((d) => d.key === msg.deviceKey);
    if (!device) {
      await this.rescan(true);
      device = this.devices.find((d) => d.key === msg.deviceKey);
    }
    if (!device) {
      this.send({
        type: 'result',
        jobId: msg.jobId,
        ok: false,
        error: 'USB-Drucker nicht gefunden – Kabel und Strom prüfen',
      });
      return;
    }

    this.inFlight.add(msg.jobId);
    const data = Buffer.from(msg.data, 'base64');
    const target = device;
    const previous = this.queues.get(target.key) ?? Promise.resolve();
    const run = previous.then(async () => {
      const blockedTimer = setTimeout(() => {
        this.send({
          type: 'blocked',
          jobId: msg.jobId,
          message: 'Drucker reagiert nicht – Papier leer, Deckel offen oder ausgeschaltet?',
        });
      }, this.opts.blockedAfterMs ?? 10_000);
      try {
        await this.opts.write(target, data);
        this.printed.set(msg.jobId, Date.now());
        this.send({ type: 'result', jobId: msg.jobId, ok: true });
      } catch (err) {
        const error = describeWriteError(err, target);
        this.opts.log(`Druck fehlgeschlagen (Auftrag ${msg.jobId}): ${error}`);
        this.send({ type: 'result', jobId: msg.jobId, ok: false, error });
      } finally {
        clearTimeout(blockedTimer);
        this.inFlight.delete(msg.jobId);
      }
    });
    this.queues.set(target.key, run);
    await run;
  }
}
