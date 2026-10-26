import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** Datenbank oder laufende Transaktion – beides hat dieselbe Abfrage-API. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export async function runMigrations(db: Db, migrationsFolder: string) {
  await migrate(db, { migrationsFolder });
}
