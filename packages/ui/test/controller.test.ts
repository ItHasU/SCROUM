// @vitest-environment jsdom
/** Contrôleur et vues DOM sur examples/demo. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent, type GameData } from '@scroum/schema';
import { describe, expect, it } from 'vitest';
import { GameController, createPlayer, parseSave, makeSave, classifyGrammar, parseClassifyResponse } from '../src';

function loadDemo(): GameData {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo/content');
  const files = new Map<string, string>();
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else files.set(relative(dir, f).split(sep).join('/'), /\.(ya?ml|md)$/.test(n) ? readFileSync(f, 'utf8') : '');
    }
  };
  walk(dir);
  return loadContent(files).game!;
}

const game = loadDemo();
const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('GameController', () => {
  it('journal, sessions de dialogue, dialogue terminé affiché jusqu’à « Suite »', () => {
    const c = new GameController(game);
    c.newGame();
    expect(c.log.some((e) => e.kind === 'line' && e.text.startsWith('Le bac repart'))).toBe(true);
    c.dispatch({ type: 'verb', hotspot: 'caisse', verb: 'take' });
    expect(c.log.some((e) => e.kind === 'info' && e.tone === 'item')).toBe(true);
    c.dispatch({ type: 'verb', hotspot: 'loic', verb: 'talk' });
    expect(c.currentSession).toBe(1);
    c.dispatch({ type: 'continue' });
    const last = c.dispatch({ type: 'choose', choice: 3 }); // « Au revoir »
    expect(last.state.dialogue).toBeNull();
  });

  it('texte libre via KeywordBackend, sélection et combinaison', async () => {
    const c = new GameController(game);
    c.newGame();
    c.dispatch({ type: 'verb', hotspot: 'loic', verb: 'talk' });
    c.dispatch({ type: 'continue' });
    const info = await c.submitText('Quelle belle barbe !');
    expect(info).toMatchObject({ intent: 'compliment', accepted: true });
    expect(c.state.dialogue?.node).toBe('compliment');
    c.select('meche');
    expect(c.selected).toBeNull(); // non possédé
  });

  it('newGame(scene) et sauvegarde JSON', () => {
    const c = new GameController(game);
    c.newGame('lanterne');
    expect(c.state.scene).toBe('lanterne');
    const save = parseSave(JSON.stringify(makeSave(game, c.state, c.log)));
    const c2 = new GameController(game);
    c2.loadState(save.state, save.log);
    expect(c2.state.scene).toBe('lanterne');
    expect(() => parseSave('{}')).toThrow();
  });

  it('grammaire GBNF et filtrage de la réponse LLM', () => {
    const req = { text: 'x', intents: [{ id: 'saluer', desc: '', examples: [], keywords: [] }], items: [], speaker: null };
    expect(classifyGrammar(req)).toContain('"\\"saluer\\""');
    expect(parseClassifyResponse(req, '{"intent":"pirater","confidence":0.9}')).toMatchObject({ intent: null, confidence: 0 });
    expect(parseClassifyResponse(req, 'ok {"intent":"saluer","confidence":0.8}')).toMatchObject({ intent: 'saluer', confidence: 0.8 });
  });
});

describe('vues DOM', () => {
  it('scène placeholder, menu contextuel, dialogue, inventaire, fin', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const { controller } = createPlayer(root, game, { store: memStore() });
    controller.newGame();
    expect(root.querySelector('.stage-placeholder')?.textContent).toContain('Le port');
    (root.querySelector('[data-hotspot=caisse]') as HTMLElement).click();
    (root.querySelector('.hotspot-menu [data-verb=take]') as HTMLElement).click();
    expect(controller.state.inventory.meche).toBe(1);
    (root.querySelector('[data-hud=inventory]') as HTMLElement).click();
    expect(root.querySelector('.drawer [data-item=meche]')).not.toBeNull();
    (root.querySelector('[data-hotspot=loic]') as HTMLElement).click();
    (root.querySelector('.hotspot-menu [data-verb=talk]') as HTMLElement).click();
    expect(root.querySelector('.dialogue .dlg-name')?.textContent).toBe('Loïc');
    (root.querySelector('[data-action=continue]') as HTMLElement).click();
    expect(root.querySelectorAll('.dlg-controls .choice').length).toBeGreaterThan(0);
    expect(root.querySelector('.free-input')).not.toBeNull();
    controller.newGame('lanterne');
    (root.querySelector('[data-hotspot=balcon]') as HTMLElement).click();
    (root.querySelector('.hotspot-menu [data-verb=enjamber]') as HTMLElement).click();
    expect(root.querySelector('.ending')?.getAttribute('data-type')).toBe('game_over');
  });
});

describe('évolutions du format dans l’UI', () => {
  const mini = (): GameData => {
    const { game: g } = loadContent({
      'game.yaml': 'title: T\nversion: 0.1.0\nformatVersion: 1\nstart_scene: a\ninitial: { inventory: [flacon] }\ncollections:\n  - { id: c1, title: Mur, if: { has_item: flacon } }\nendings:\n  fin: { type: game_over, text: Glou }\n',
      'bible/worlds.yaml': 'w: { name: W, ui_skin: neon }\n',
      'skins/neon.css': '.skin-neon { color: lime; }',
      'items.yaml': 'flacon:\n  name: Flacon\n  actions:\n    boire: { label: "Boire", end_game: fin }\n',
      'scenes/a.yaml': 'world: w\n',
    });
    return g!;
  };

  it('verbe d’objet dans la fiche, skin du jeu injecté, galerie accessible', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const { controller } = createPlayer(root, mini(), { store: memStore() });
    controller.newGame();
    expect(document.head.querySelector('style[data-scroum-skin=neon]')?.textContent).toContain('lime');
    (root.querySelector('[data-hud=gallery]') as HTMLElement).click();
    expect(root.querySelector('[data-collection=c1]')).not.toBeNull();
    (root.querySelector('.modal .close') as HTMLElement).click();
    (root.querySelector('[data-hud=inventory]') as HTMLElement).click();
    (root.querySelector('.drawer [data-item=flacon]') as HTMLElement).click();
    (root.querySelector('[data-item-verb=boire]') as HTMLElement).click();
    expect(controller.state.ending?.id).toBe('fin');
  });
});

describe('service worker du player', () => {
  const sw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../apps/player/public/sw.js'), 'utf8');
  it("ne sert jamais un script ou un zip en cache d'abord (vieux lecteur figé)", () => {
    expect(sw).not.toMatch(/caches\.match\(req\)\.then\(\(hit\) => \{/);
    expect(sw).toMatch(/fetch\(req\)\s*\.then/);
    expect(sw).toMatch(/skipWaiting/);
    expect(sw).toMatch(/clients\.claim/);
    expect(sw).not.toContain("'scroum-v1'");
  });
});
