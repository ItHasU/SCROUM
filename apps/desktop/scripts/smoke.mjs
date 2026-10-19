// Test de fumée : lance l'application (Playwright `_electron`), ouvre examples/demo et vérifie que l'éditeur et le player chargent.
// Usage : node scripts/smoke.mjs [chemin vers l'exécutable empaqueté]   (sans argument : electron . depuis apps/desktop)
// Sans écran : xvfb-run -a node scripts/smoke.mjs, ou SMOKE_HEADLESS=1 (--ozone-platform=headless).
import { _electron as electron } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = join(root, '../../examples/demo');
const packaged = process.argv[2];
const extra = ['--no-sandbox', ...(process.env.SMOKE_HEADLESS ? ['--ozone-platform=headless', '--disable-gpu'] : [])];
const app = await electron.launch({
  ...(packaged ? { executablePath: packaged, args: extra } : { args: [root, ...extra] }),
  env: { ...process.env, SCROUM_DESKTOP_OPEN: demo },
  timeout: 60_000,
});
let ok = false;
try {
  const win = await app.firstWindow();
  await win.waitForSelector('#app *', { timeout: 30_000 });
  await win.waitForFunction(() => document.querySelectorAll('#app button, #app nav *').length > 3, null, { timeout: 30_000 });
  const info = await win.evaluate(() => fetch('/api/project').then((r) => r.json()));
  const play = await win.evaluate(() => fetch('/play/').then((r) => r.text()));
  console.log('éditeur :', await win.title(), '| projet :', info.name, '| player disponible :', info.playerAvailable, '| claude :', JSON.stringify(info.claude));
  if (!info.name || !info.playerAvailable || !/<html/i.test(play)) throw new Error('éditeur ou player non chargé');
  ok = true;
} finally {
  await app.close();
}
console.log(ok ? 'SMOKE OK' : 'SMOKE KO');
