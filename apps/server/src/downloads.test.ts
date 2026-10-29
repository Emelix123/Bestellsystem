import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './test/helpers';

let env: TestEnv;
let downloads: string;

beforeAll(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'downloads-'));
  downloads = path.join(root, 'agent');
  const web = path.join(root, 'web');
  fs.mkdirSync(downloads);
  fs.mkdirSync(web);
  fs.writeFileSync(path.join(downloads, 'install-agent.ps1'), '# Installiert den Druck-Agenten\n');
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>App</title>');
  env = await createTestEnv({ agentDownloads: downloads, webDist: web });
});

afterAll(async () => {
  await env.close();
});

describe('Downloads für den Druck-Agenten', () => {
  it('liefert das Windows-Skript als Text', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/downloads/install-agent.ps1' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('# Installiert den Druck-Agenten');
  });

  it('meldet fehlende Dateien klar statt die Web-App auszuliefern', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/downloads/agent.mjs' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('<!doctype');
    expect(res.body).toContain('npm run build');
  });

  it('gibt keine anderen Dateien heraus', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/downloads/..%2F..%2Fpackage.json' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('<!doctype');
  });

  it('Seiten der Web-App funktionieren weiterhin', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/bedienung' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<!doctype html>');
  });
});
