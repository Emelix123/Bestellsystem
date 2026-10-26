import type { Config } from './config';
import type { Db } from './db/client';
import type { Hub } from './lib/hub';
import type { AgentHub } from './services/agents';
import type { PrintService } from './services/printing';

export interface AppContext {
  db: Db;
  config: Config;
  /** Zufälliges Server-Geheimnis (in der DB gespeichert) für PIN-Hashes. */
  secret: string;
  hub: Hub;
  agentHub: AgentHub;
  printing: PrintService;
  formatTime(date: Date): string;
}
