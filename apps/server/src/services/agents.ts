import type { AgentDevice, AgentToServer, ServerToAgent } from '@bestellsystem/shared';
import { eq } from 'drizzle-orm';
import type { WebSocket } from 'ws';
import type { Db } from '../db/client';
import { agents } from '../db/schema';

interface AgentConnection {
  agentId: number;
  tenantId: number;
  socket: WebSocket;
  alive: boolean;
  devices: AgentDevice[];
}

export interface AgentHubEvents {
  onConnect(agentId: number, tenantId: number): void;
  onDisconnect(agentId: number, tenantId: number): void;
  onResult(agentId: number, jobId: number, ok: boolean, error?: string): void;
  onBlocked(agentId: number, jobId: number, message: string): void;
  onDevices(agentId: number, tenantId: number): void;
}

/**
 * Verwaltet die Verbindungen der Druck-Agenten. Ein Agent läuft auf dem
 * Rechner, an dem die USB-Drucker hängen, und baut selbst eine ausgehende
 * WebSocket-Verbindung auf. Der Server schiebt Aufträge sofort durch – kein
 * Polling, keine Portfreigaben.
 */
export class AgentHub {
  private connections = new Map<number, AgentConnection>();
  private timer: NodeJS.Timeout | null = null;
  events: AgentHubEvents | null = null;

  constructor(private db: Db) {}

  start() {
    this.timer = setInterval(() => {
      for (const conn of this.connections.values()) {
        if (!conn.alive) {
          conn.socket.terminate();
          continue;
        }
        conn.alive = false;
        conn.socket.ping();
      }
    }, 15_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const conn of this.connections.values()) conn.socket.close();
    this.connections.clear();
  }

  isConnected(agentId: number) {
    return this.connections.has(agentId);
  }

  devices(agentId: number): AgentDevice[] | null {
    return this.connections.get(agentId)?.devices ?? null;
  }

  send(agentId: number, message: ServerToAgent): boolean {
    const conn = this.connections.get(agentId);
    if (!conn || conn.socket.readyState !== conn.socket.OPEN) return false;
    conn.socket.send(JSON.stringify(message));
    return true;
  }

  disconnect(agentId: number) {
    this.connections.get(agentId)?.socket.close(4001, 'Agent entfernt');
  }

  attach(agent: { id: number; tenantId: number; name: string }, socket: WebSocket) {
    // Ein Agent darf nur einmal verbunden sein – alte Verbindung schließen.
    const previous = this.connections.get(agent.id);
    if (previous) previous.socket.close(4000, 'Neue Verbindung');

    const conn: AgentConnection = { agentId: agent.id, tenantId: agent.tenantId, socket, alive: true, devices: [] };
    this.connections.set(agent.id, conn);
    socket.on('pong', () => (conn.alive = true));
    socket.on('message', (raw) => {
      conn.alive = true;
      let msg: AgentToServer;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      void this.handle(conn, msg);
    });
    const onClose = () => {
      if (this.connections.get(agent.id) !== conn) return;
      this.connections.delete(agent.id);
      void this.db.update(agents).set({ lastSeenAt: new Date() }).where(eq(agents.id, agent.id));
      this.events?.onDisconnect(agent.id, agent.tenantId);
    };
    socket.on('close', onClose);
    socket.on('error', onClose);

    this.send(agent.id, { type: 'welcome', agentId: agent.id, name: agent.name });
    void this.db.update(agents).set({ lastSeenAt: new Date() }).where(eq(agents.id, agent.id));
    this.events?.onConnect(agent.id, agent.tenantId);
  }

  private async handle(conn: AgentConnection, msg: AgentToServer) {
    switch (msg.type) {
      case 'hello':
        conn.devices = msg.devices ?? [];
        await this.db
          .update(agents)
          .set({ hostname: msg.hostname, version: msg.version, devices: conn.devices, lastSeenAt: new Date() })
          .where(eq(agents.id, conn.agentId));
        this.events?.onDevices(conn.agentId, conn.tenantId);
        break;
      case 'devices':
        conn.devices = msg.devices ?? [];
        await this.db
          .update(agents)
          .set({ devices: conn.devices, lastSeenAt: new Date() })
          .where(eq(agents.id, conn.agentId));
        this.events?.onDevices(conn.agentId, conn.tenantId);
        break;
      case 'result':
        this.events?.onResult(conn.agentId, msg.jobId, msg.ok, msg.error);
        break;
      case 'blocked':
        this.events?.onBlocked(conn.agentId, msg.jobId, msg.message);
        break;
    }
  }
}
