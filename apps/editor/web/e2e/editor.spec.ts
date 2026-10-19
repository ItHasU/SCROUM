/** Éditeur dans un vrai Chromium : graphe, inspecteur, playtest + panneau de debug (postMessage). */
import { expect, test, type Page } from '@playwright/test';

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForSelector('.nav-btn');
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const open = (page: Page, view: string) => page.click(`.nav-btn[data-view=${view}]`);

test('le graphe affiche des nœuds (canvas Cytoscape non vide)', async ({ page }) => {
  await open(page, 'graph');
  const canvas = page.locator('.cy canvas').first();
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const cs = [...document.querySelectorAll<HTMLCanvasElement>('.cy canvas')];
        return cs.some((c) => {
          const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
          return !!d && d.some((v, i) => i % 4 === 3 && v > 0);
        });
      }),
    )
    .toBe(true);
});

test("l'inspecteur enregistre une modification de fichier YAML", async ({ page }) => {
  await open(page, 'items');
  await page.locator('.view.items .link, .view.items a').first().click();
  const ta = page.locator('textarea.yaml');
  await expect(ta).toBeVisible();
  const before = await ta.inputValue();
  await ta.fill(`${before.trimEnd()}\n# modif e2e\n`);
  await expect(page.locator('.save')).toBeEnabled();
  await page.click('.save');
  await expect(page.locator('#toasts')).toContainText('enregistré');
  await expect(page.locator('.save')).toBeDisabled();
  const r = await page.request.get('/api/files/' + (await page.locator('.ins-head .file').innerText()));
  expect(await r.text()).toContain('# modif e2e');
});

test("le playtest charge l'iframe et le panneau de debug reçoit l'état", async ({ page }) => {
  await open(page, 'playtest');
  const frame = page.frameLocator('iframe.play');
  await expect(frame.locator('.stage')).toHaveAttribute('data-scene', 'port', { timeout: 30_000 }).catch(async () => {
    await frame.locator('[data-action=new-game]').click();
    await expect(frame.locator('.stage')).toHaveAttribute('data-scene', 'port');
  });
  await expect(page.locator('.debug')).toContainText('scène : port');
  await expect(page.locator('.debug')).toContainText('Drapeaux');
});
