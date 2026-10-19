/** Joue « Le Phare de Kerbrume » jusqu'à la fin via l'interface (portrait), avec captures d'écran. */
import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png` });

async function verb(page: Page, hotspot: string, v: string) {
  await page.click(`.stage [data-hotspot=${hotspot}]`);
  await page.click(`.hotspot-menu [data-verb=${v}]`);
}

/** Clique « Suite » tant qu'il y en a (nœuds `continue` et dialogue terminé). */
async function advance(page: Page) {
  for (let i = 0; i < 10; i++) {
    const b = page.locator('.dlg-controls [data-action=continue], .dlg-controls [data-action=close]');
    if (!(await b.count())) return;
    await b.first().click();
  }
}

async function choose(page: Page, text: string) {
  await page.locator('.dlg-controls .choice', { hasText: text }).first().click();
}

async function hold(page: Page, item: string) {
  if (!(await page.locator('.drawer.open').count())) await page.click('[data-hud=inventory]');
  await page.click(`.drawer [data-select=${item}]`);
}

async function exit(page: Page, id: string) {
  await page.click(`.exits-bar [data-exit=${id}]`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/play/?source=/api');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/play/?source=/api');
  await page.click('[data-action=new-game]');
  await expect(page.locator('.stage')).toHaveAttribute('data-scene', 'port');
});

test('partie complète gagnante', async ({ page }) => {
  await verb(page, 'caisse', 'take');
  await expect(page.locator('.log')).toContainText('Obtenu : Mèche de coton');
  await verb(page, 'rochers', 'take');
  await verb(page, 'rochers', 'take');
  await page.click('[data-hud=inventory]');
  await expect(page.locator('.drawer [data-item=coquillage]')).toContainText('×2');
  await page.click('.drawer .close');

  await page.click('.stage [data-hotspot=loic]');
  await page.click('.hotspot-menu [data-verb=talk]');
  await expect(page.locator('.dialogue')).toBeVisible();
  await advance(page);
  await page.fill('.free-input', 'Quelle belle barbe !');
  await page.click('.free-text .send');
  await expect(page.locator('.dlg-log')).toContainText('Quarante ans de sel');
  await advance(page);
  await choose(page, 'Comment rallumer le phare');
  await advance(page);
  await choose(page, 'Offrir deux coquillages');
  await advance(page);
  await choose(page, 'briquet');
  await choose(page, "S'il vous plaît");
  await advance(page);
  await expect(page.locator('.dialogue')).toHaveCount(0);

  await exit(page, 'exit_phare_bas');
  await expect(page.locator('.stage')).toHaveAttribute('data-scene', 'phare_bas');
  await verb(page, 'coffre', 'open');
  await verb(page, 'cle_rouillee', 'take');
  await hold(page, 'cle_rouillee');
  await page.click('.drawer .close');
  await page.click('.stage [data-hotspot=porte_escalier]');
  await page.click('.hotspot-menu [data-verb=use]');
  await verb(page, 'commode', 'fouiller');
  await verb(page, 'lit', 'dormir');
  await expect(page.locator('.stage')).toHaveAttribute('data-scene', 'songe_grotte');
  await expect(page.locator('.scroum')).toHaveClass(/skin-rpg_bubbles/);

  await verb(page, 'gardien', 'talk');
  await shot(page, '05-dialogue-rpg');
  await hold(page, 'photo_ancienne');
  await page.click('.drawer [data-action=give]');
  await expect(page.locator('.dlg-log')).toContainText('Ma petite Margot');
  await advance(page);
  await exit(page, 'exit_phare_bas');

  await page.click('[data-hud=inventory]');
  await page.click('.drawer [data-select=meche]');
  await page.click('.drawer [data-item=huile]');
  await expect(page.locator('.drawer [data-item=meche_huilee]')).toBeVisible();
  await page.click('.drawer .close');
  await exit(page, 'exit_lanterne');
  await expect(page.locator('.stage')).toHaveAttribute('data-scene', 'lanterne');
  await hold(page, 'meche_huilee');
  await page.click('.drawer .close');
  await page.click('.stage [data-hotspot=lampe]');
  await page.click('.hotspot-menu [data-verb=use]');
  await hold(page, 'briquet');
  await page.click('.drawer .close');
  await page.click('.stage [data-hotspot=lampe]');
  await page.click('.hotspot-menu [data-verb=use]');

  await expect(page.locator('.ending')).toHaveAttribute('data-type', 'win');
  await expect(page.locator('.ending')).toContainText('Le phare veille');
  await page.click('.ending [data-action=restart]');
  await expect(page.locator('.ending')).toBeHidden();
});

test('game over, recommencer, sauvegarde et paysage', async ({ page }) => {
  await exit(page, 'exit_phare_bas');
  await page.click('[data-hud=menu]');
  await page.click('[data-action=saves]');
  await page.click('[data-save="1"]');
  await expect(page.locator('.modal')).toContainText('Partie sauvegardée');
  await page.click('.modal .close');
  await page.setViewportSize({ width: 844, height: 390 });
  await shot(page, 'paysage');
  await page.setViewportSize({ width: 390, height: 844 });
  await verb(page, 'coffre', 'open');
  await verb(page, 'cle_rouillee', 'take');
  await hold(page, 'cle_rouillee');
  await page.click('.drawer .close');
  await page.click('.stage [data-hotspot=porte_escalier]');
  await page.click('.hotspot-menu [data-verb=use]');
  await exit(page, 'exit_lanterne');
  await verb(page, 'balcon', 'enjamber');
  await expect(page.locator('.ending')).toHaveAttribute('data-type', 'game_over');
  await page.click('.ending [data-action=load]');
  await page.click('[data-load="1"]');
  await expect(page.locator('.stage')).toHaveAttribute('data-scene', 'phare_bas');
  await expect(page.locator('.ending')).toBeHidden();
});
