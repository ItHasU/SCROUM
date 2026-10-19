import { defineConfig, devices } from '@playwright/test';

/**
 * E2E de l'éditeur (Chromium réel) sur une COPIE temporaire d'examples/demo (le test d'inspecteur écrit un fichier).
 * `pnpm --filter @scroum/editor-web e2e` (nécessite Chromium : `pnpm exec playwright install chromium`).
 */
const PORT = Number(process.env.SCROUM_E2E_PORT ?? 5397);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  globalSetup: './e2e/setup.ts',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], browserName: 'chromium', viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `node e2e/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/project`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
