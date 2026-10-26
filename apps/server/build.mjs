import { build } from 'esbuild';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
// Abhängigkeiten bleiben in node_modules, nur der eigene Code (inkl. shared) wird gebündelt.
const external = Object.keys(pkg.dependencies).filter((d) => d !== '@bestellsystem/shared');

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external,
  sourcemap: true,
  logLevel: 'info',
});
