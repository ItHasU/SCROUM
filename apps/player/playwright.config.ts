import { defineConfig, devices } from '@playwright/test';

/**
 * E2E : le player servi par le serveur de l'éditeur sur examples/demo (mode `?source=/api`).
 * `pnpm --filter @scroum/player e2e` (nécessite Chromium : `pnpm exec playwright install chromium`).
 */
const PORT = Number(process.env.SCROUM_E2E_PORT ?? 5398);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'mobile', use: { ...devices['Pixel 7'], browserName: 'chromium', viewport: { width: 390, height: 844 } } }],
  webServer: {
    command: `node ../../packages/cli/bin/scroum.js edit ../../examples/demo --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/project`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
