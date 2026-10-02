import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:5184',
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  webServer: [
    {
      command: 'pnpm exec tsx apps/server/src/main.ts',
      url: 'http://127.0.0.1:3124/api/health',
      reuseExistingServer: false,
      env: {
        PORT: '3124',
        MANDATE_WEB_PORT: '5184',
        MANDATE_DB: resolve('.runtime', `e2e-${process.pid}.sqlite`),
        MANDATE_SCENARIO: 'northern-sandbox.json',
      },
    },
    {
      command: 'pnpm --filter @mandate/web dev',
      url: 'http://127.0.0.1:5184',
      reuseExistingServer: false,
      env: { PORT: '3124', MANDATE_WEB_PORT: '5184' },
    },
  ],
});
