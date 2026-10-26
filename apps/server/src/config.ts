import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface Config {
  databaseUrl: string;
  host: string;
  port: number;
  /** Ordner mit der gebauten Web-Oberfläche (leer = nicht ausliefern). */
  webDist: string | null;
  migrationsFolder: string;
  /** Ordner mit agent.mjs und install-agent.sh zum Herunterladen (leer = aus). */
  agentDownloads: string | null;
  /** Zeitzone für Uhrzeiten auf Bons und in der Statistik. */
  timezone: string;
  /** Cookie nur über HTTPS senden. */
  secureCookies: boolean;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://bestell:bestell@localhost:5432/bestell',
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8080),
    webDist: env.WEB_DIST ?? path.resolve(here, '../../web/dist'),
    migrationsFolder: env.MIGRATIONS_FOLDER ?? path.resolve(here, '../drizzle'),
    agentDownloads: env.AGENT_DOWNLOADS ?? path.resolve(here, '../../agent/dist'),
    timezone: env.APP_TIMEZONE ?? 'Europe/Berlin',
    secureCookies: env.SECURE_COOKIES === 'true',
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
