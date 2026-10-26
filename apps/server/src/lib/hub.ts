import type { WsMessage } from '@bestellsystem/shared';
import type { WebSocket } from 'ws';

interface Client {
  socket: WebSocket;
  alive: boolean;
}

/**
 * Verteilt Live-Updates an alle Browser eines Vereins (Tablets, Handys, Admin).
 * Die Nachrichten sind klein; jeder Client filtert selbst, was ihn interessiert.
 */
export class Hub {
  private clients = new Map<number, Set<Client>>();
  private timer: NodeJS.Timeout | null = null;

  start() {
    // Tote Verbindungen (WLAN weg) erkennen und aufräumen.
    this.timer = setInterval(() => {
      for (const set of this.clients.values()) {
        for (const client of set) {
          if (!client.alive) {
            client.socket.terminate();
            set.delete(client);
            continue;
          }
          client.alive = false;
          client.socket.ping();
        }
      }
    }, 20_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const set of this.clients.values()) for (const c of set) c.socket.close();
    this.clients.clear();
  }

  add(tenantId: number, socket: WebSocket) {
    const client: Client = { socket, alive: true };
    let set = this.clients.get(tenantId);
    if (!set) this.clients.set(tenantId, (set = new Set()));
    set.add(client);
    socket.on('pong', () => (client.alive = true));
    socket.on('close', () => set!.delete(client));
    socket.on('error', () => set!.delete(client));
  }

  broadcast(tenantId: number, message: WsMessage) {
    const set = this.clients.get(tenantId);
    if (!set || set.size === 0) return;
    const data = JSON.stringify(message);
    for (const client of set) {
      if (client.socket.readyState === client.socket.OPEN) client.socket.send(data);
    }
  }

  count(tenantId: number) {
    return this.clients.get(tenantId)?.size ?? 0;
  }
}
