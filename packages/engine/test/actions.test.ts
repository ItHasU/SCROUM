import { describe, expect, it } from 'vitest';
import {
  characterView,
  counterViews,
  describeAction,
  dialogueView,
  endingView,
  hudCounters,
  inventoryView,
  listActions,
  questLog,
  sceneView,
  start,
  step,
  unlockedCollections,
  visibleExits,
  visibleHotspots,
  type Action,
  type GameState,
} from '../src';
import { mini } from './fixtures';
import { loadExample } from './helpers';

const game = mini();
const begin = () => start(game).state;
const give = (s: GameState, inv: Record<string, number>): GameState => ({ ...s, inventory: { ...s.inventory, ...inv } });
const run = (s: GameState, ...actions: Action[]) => actions.reduce((st, a) => step(game, st, a).state, s);
const talkMenu = () => run(begin(), { type: 'verb', hotspot: 'bouton', verb: 'parler' }, { type: 'continue' });

describe('listActions', () => {
  it('hors dialogue : verbes, use (hotspots avec use), sorties, objets', () => {
    const s = give(begin(), { cle: 1, meche: 1, huile: 1 });
    const acts = listActions(game, s).map(describeAction);
    expect(acts.filter((a) => a.endsWith(' bouton'))).toHaveLength(Object.keys(game.scenes.a!.hotspots[0]!.actions).length);
    expect(acts).toContain('look bouton2');
    expect(acts).not.toContain('look secret');
    expect(acts).not.toContain('look cond');
    expect(acts.filter((a) => a.startsWith('use '))).toEqual(['use cle on machine', 'use meche on machine', 'use huile on machine']);
    expect(acts.filter((a) => a.startsWith('exit '))).toEqual(['exit exit_b']);
    expect(acts.filter((a) => a.startsWith('inspect '))).toEqual(['inspect cle', 'inspect meche', 'inspect huile']);
    expect(acts.filter((a) => a.startsWith('combine '))).toEqual(['combine meche huile']);
  });

  it('exhaustive : use sur tous les hotspots visibles et toutes les paires', () => {
    const s = give(begin(), { cle: 1, meche: 1 });
    const acts = listActions(game, s, { exhaustive: true }).map(describeAction);
    expect(acts.filter((a) => a.startsWith('use cle'))).toEqual(['use cle on bouton', 'use cle on bouton2', 'use cle on machine', 'use cle on mur']);
    expect(acts.filter((a) => a.startsWith('combine '))).toEqual(['combine cle meche']);
  });

  it('combinaison d’un objet avec lui-même si possédé en double', () => {
    expect(listActions(game, give(begin(), { caillou: 1 })).map(describeAction)).not.toContain('combine caillou caillou');
    expect(listActions(game, give(begin(), { caillou: 2 })).map(describeAction)).toContain('combine caillou caillou');
  });

  it('nœud à continue : continue seulement (+ objets)', () => {
    const s = run(begin(), { type: 'verb', hotspot: 'bouton', verb: 'parler' });
    expect(listActions(game, s)).toEqual([{ type: 'continue' }]);
  });

  it('nœud à choix + texte libre + on_give/on_show', () => {
    const s = give(talkMenu(), { pomme: 1 });
    expect(listActions(game, s).map(describeAction)).toEqual([
      'choose 0',
      'choose 2',
      'choose 3',
      'choose 4',
      'choose 5',
      'choose 6',
      'choose 7',
      'intent salut 1',
      'intent bye 1',
      'intent give_item pomme 1',
      'intent show_item pomme 1',
      'intent - 0',
      'give pomme',
      'show pomme',
      'inspect pomme',
    ]);
  });

  it('leave proposé sur un nœud à texte libre sans choix', () => {
    const s = run(talkMenu(), { type: 'choose', choice: 5 });
    expect(listActions(game, s).map(describeAction)).toEqual(['intent salut 1', 'intent - 0', 'leave']);
  });

  it('partie finie → aucune action', () => {
    expect(listActions(game, run(begin(), { type: 'verb', hotspot: 'bouton', verb: 'fin' }))).toEqual([]);
  });

  it('chaque action listée est acceptée par step (sans erreur), sur toute la démo', () => {
    const demo = loadExample('demo');
    // petite exploration en largeur bornée
    const seen = new Set<string>();
    let frontier = [start(demo).state];
    for (let depth = 0; depth < 6; depth++) {
      const next: GameState[] = [];
      for (const s of frontier) {
        for (const a of listActions(demo, s, { exhaustive: true })) {
          const r = step(demo, s, a);
          expect(r.events.filter((e) => e.type === 'error'), describeAction(a)).toEqual([]);
          const k = JSON.stringify(r.state);
          if (!seen.has(k)) {
            seen.add(k);
            next.push(r.state);
          }
        }
      }
      frontier = next.slice(0, 200);
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it('ordre stable (déterministe)', () => {
    const s = give(talkMenu(), { pomme: 1, cle: 1 });
    expect(listActions(game, s)).toEqual(listActions(game, structuredClone(s)));
  });
});

describe('vues', () => {
  it('scène, hotspots, sorties', () => {
    const s = begin();
    expect(sceneView(game, s)).toEqual({ id: 'a', title: null, world: 'w', skin: 'plain', background: null });
    const hs = visibleHotspots(game, s);
    expect(hs.map((h) => h.id)).toEqual(['bouton', 'bouton2', 'machine', 'mur']);
    expect(hs.find((h) => h.id === 'machine')).toMatchObject({ accepts_items: true, verbs: [{ verb: 'look', label: null }] });
    expect(visibleExits(game, s)).toEqual([{ id: 'exit_b', label: 'B', to: 'b', rect: { x: 0, y: 0, w: 0.1, h: 0.1 } }]);
  });

  it('compteurs avec titre', () => {
    const s = run(begin(), { type: 'verb', hotspot: 'bouton', verb: 'push' });
    expect(hudCounters(game, s)).toEqual([{ id: 'c', label: 'C', value: 3, title: 'Haut', hud: true }]);
    expect(counterViews(game, s)).toHaveLength(1);
    const demo = loadExample('demo');
    const d = start(demo).state;
    expect(hudCounters(demo, d).map((c) => c.id)).toEqual(['courage']);
    expect(counterViews(demo, d).find((c) => c.id === 'maladresses')).toMatchObject({ value: 0, title: 'Gardienne prometteuse', hud: false });
  });

  it('inventaire détaillé, quêtes, collections', () => {
    const s = run(give(begin(), { meche: 1 }), { type: 'verb', hotspot: 'bouton', verb: 'push' });
    expect(inventoryView(game, s)).toEqual([
      { id: 'pomme', name: 'Pomme', description: null, icon: null, qty: 1, stackable: true, consumable: false },
      { id: 'meche', name: 'Mèche', description: null, icon: null, qty: 1, stackable: false, consumable: false },
    ]);
    expect(questLog(game, s)).toEqual([
      { id: 'q1', title: 'Q1', description: null, state: 'active' },
      { id: 'q2', title: 'Q2', description: null, state: 'completed' },
    ]);
    expect(unlockedCollections(game, s)).toEqual([{ id: 'col_f', title: 'Col F', text: null, images: [], character: null }]);
  });

  it('personnage : persona puis identité', () => {
    const s = begin();
    expect(characterView(game, s, 'masque')).toMatchObject({ face: 'persona', revealed: false, name: 'Masque' });
    expect(characterView(game, run(s, { type: 'verb', hotspot: 'bouton', verb: 'push' }), 'masque')).toMatchObject({ face: 'identity', revealed: true, name: 'Vrai Nom' });
    expect(characterView(game, s, 'heros')).toMatchObject({ face: 'identity', revealed: true, name: 'Héros' });
    expect(characterView(game, s, 'zz')).toBeNull();
  });

  it('dialogue en cours et fin', () => {
    expect(dialogueView(game, begin())).toBeNull();
    const v = dialogueView(game, talkMenu())!;
    expect(v).toMatchObject({ dialogue: 'd', node: 'menu', mode: 'input', can_give: true, can_show: true, can_leave: false, speaker: { name: 'Masque' } });
    expect(v.choices).toHaveLength(7);
    expect(v.lines).toMatchObject([{ text: 'Alors ?' }]);
    expect(endingView(game, begin())).toBeNull();
    expect(endingView(game, run(begin(), { type: 'verb', hotspot: 'bouton', verb: 'fin' }))).toEqual({ id: 'perdu', type: 'game_over', title: 'Perdu', text: 'Raté.', image: null });
  });
});
