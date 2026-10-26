import { buildApp, startBackground } from './app';
import { loadConfig } from './config';
import { createDb, runMigrations } from './db/client';

async function main() {
  const config = loadConfig();
  const { db, pool } = createDb(config.databaseUrl);

  // Beim Start der Container ist die Datenbank evtl. noch nicht bereit.
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('select 1');
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      console.log(`Warte auf Datenbank … (${attempt})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await runMigrations(db, config.migrationsFolder);

  const { app, ctx } = await buildApp(db, config);
  await startBackground(ctx);
  await app.listen({ host: config.host, port: config.port });

  const shutdown = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
