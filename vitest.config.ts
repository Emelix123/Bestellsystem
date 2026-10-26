import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts', 'apps/agent/src/**/*.test.ts'],
    // Server-Tests teilen sich eine Test-Datenbank.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
