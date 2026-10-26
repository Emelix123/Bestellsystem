import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { agents } from '../db/schema';
import { sha256 } from '../lib/crypto';

export function registerWsRoutes(app: FastifyInstance, ctx: AppContext) {
  /** Live-Updates für Browser (Tablets, Handys, Admin). */
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    const tenantId = req.auth?.tenantId;
    if (!req.auth || !tenantId) {
      socket.close(4401, 'Nicht angemeldet');
      return;
    }
    ctx.hub.add(tenantId, socket);
    socket.send(JSON.stringify({ type: 'hello' }));
  });

  /** Druck-Agenten melden sich mit ihrem Token an. */
  app.get('/api/agent/ws', { websocket: true }, async (socket, req) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    // Nachrichten, die vor der Anmeldung eintreffen, kurz puffern.
    const early: Buffer[] = [];
    const buffer = (data: Buffer) => early.push(data);
    socket.on('message', buffer);
    const [agent] = token
      ? await ctx.db.select().from(agents).where(eq(agents.tokenHash, sha256(token)))
      : [];
    if (!agent) {
      socket.close(4401, 'Token ungültig');
      return;
    }
    socket.off('message', buffer);
    ctx.agentHub.attach(agent, socket);
    for (const data of early) socket.emit('message', data);
  });
}
