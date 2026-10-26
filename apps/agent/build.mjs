import { build } from 'esbuild';
import fs from 'node:fs';

// Ein einziges Skript ohne node_modules – einfach auf den Raspberry Pi kopieren.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/agent.mjs',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
fs.copyFileSync('install-agent.sh', 'dist/install-agent.sh');
