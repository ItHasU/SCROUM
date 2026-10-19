import { describe, expect, it } from 'vitest';
import type { Condition } from '@scroum/schema';
import { canonicalize, cloneState, compare, createInitialState, evalCondition, stateKey, type GameState } from '../src';
import { loadExample, makeGame } from './helpers';

const game = makeGame(
  {
    'scenes/a.yaml': 'world: w\n',
    'items.yaml': 'pomme: { name: Pomme, stackable: true }\ncle: { name: Clé }\n',
    'bible/quests.yaml': 'q1: { title: Q1 }\nq2: { title: Q2 }\n',
    'characters/masque.yaml': 'persona: { name: Masque }\nidentity: { name: Vrai }\nrevealed_by: { flag: f }\n',
  },
  `counters:
  c: { label: C, initial: 12, max: 10, min: 0 }
  d: { label: D }
initial:
  flags: [f, e]
  vars: { v: 3, z: 0 }
  inventory: { pomme: 3, cle: 5 }
  quests: [q1]
collections:
  - { id: col, title: Col, if: { flag: e } }
`,
);

describe('createInitialState', () => {
  const s = createInitialState(game);
  it('applique game.initial et les compteurs', () => {
    expect(s.scene).toBe('a');
    expect(s.flags).toEqual(['e', 'f']);
    expect(s.vars).toEqual({ v: 3 });
    expect(s.counters).toEqual({ c: 10, d: 0 });
    expect(s.inventory).toEqual({ pomme: 3, cle: 1 }); // non stackable plafonné à 1
    expect(s.ever_had).toEqual(['cle', 'pomme']);
    expect(s.quests).toEqual({ unlocked: ['q1'], completed: [] });
    expect(s.dialogue).toBeNull();
    expect(s.ending).toBeNull();
  });
  it('calcule révélations et collections initiales', () => {
    expect(s.revealed).toEqual(['masque']);
    expect(s.collections).toEqual(['col']);
  });
  it('est sérialisable JSON', () => {
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
  it('fonctionne sur la démo', () => {
    const d = createInitialState(loadExample('demo'));
    expect(d.scene).toBe('port');
    expect(d.counters).toEqual({ courage: 1, maladresses: 0 });
  });
});

describe('stateKey / canonicalize', () => {
  it('ignore l’ordre des clés', () => {
    const a = createInitialState(game);
    const b: GameState = JSON.parse(JSON.stringify(a));
    b.vars = { y: 1, x: 2 };
    const c: GameState = JSON.parse(JSON.stringify(a));
    c.vars = { x: 2, y: 1 };
    expect(stateKey(b)).toBe(stateKey(c));
    expect(stateKey(a)).not.toBe(stateKey(b));
    expect(Object.keys(canonicalize({ b: 1, a: { d: 1, c: 2 } }))).toEqual(['a', 'b']);
    expect(canonicalize([{ b: 1, a: 2 }])).toEqual([{ a: 2, b: 1 }]);
  });
  it('équivaut à JSON.stringify(canonicalize(état))', () => {
    const a = createInitialState(game) as GameState & Record<string, unknown>;
    a.dialogue = { id: 'd', node: 'n', pending_scene: null };
    a.visibility = { z: { b: false, a: true } };
    a.extra = { u: undefined, l: [1, undefined, 'é"\n'], n: NaN };
    expect(stateKey(a)).toBe(JSON.stringify(canonicalize(a)));
  });
  it('cloneState copie en profondeur, champs inconnus compris', () => {
    const a = createInitialState(game) as GameState & Record<string, unknown>;
    a.extra = { deep: [1, { x: 2 }] };
    const b = cloneState(a) as typeof a;
    expect(b).toEqual(a);
    (b.extra as { deep: unknown[] }).deep.push(3);
    b.flags.push('zz');
    expect((a.extra as { deep: unknown[] }).deep).toHaveLength(2);
    expect(a.flags).not.toContain('zz');
  });
});

describe('compare', () => {
  it.each([
    [{ eq: 2 }, 2, true],
    [{ eq: 2 }, 3, false],
    [{ gte: 2 }, 2, true],
    [{ gte: 2 }, 1, false],
    [{ lte: 2 }, 2, true],
    [{ lte: 2 }, 3, false],
    [{ gt: 2 }, 3, true],
    [{ gt: 2 }, 2, false],
    [{ lt: 2 }, 1, true],
    [{ lt: 2 }, 2, false],
    [{ gte: 2, lte: 5 }, 4, true],
    [{ gte: 2, lte: 5 }, 6, false],
  ])('%j sur %d → %s', (cmp, v, r) => expect(compare(v, cmp)).toBe(r));
});

describe('evalCondition', () => {
  const s = createInitialState(game);
  s.quests.unlocked = ['q1', 'q2'];
  s.quests.completed = ['q2'];
  s.ever_had.push('vieux');
  const cases: [string, Condition, boolean][] = [
    ['flag levé', { kind: 'flag', flag: 'f' }, true],
    ['flag baissé', { kind: 'flag', flag: 'nope' }, false],
    ['var', { kind: 'var', var: 'v', cmp: { eq: 3 } }, true],
    ['var absente = 0', { kind: 'var', var: 'absent', cmp: { eq: 0 } }, true],
    ['counter', { kind: 'counter', counter: 'c', cmp: { gte: 10 } }, true],
    ['counter faux', { kind: 'counter', counter: 'd', cmp: { gt: 0 } }, false],
    ['has_item', { kind: 'has_item', item: 'pomme' }, true],
    ['has_item absent', { kind: 'has_item', item: 'vieux' }, false],
    ['item_qty', { kind: 'item_qty', item: 'pomme', cmp: { eq: 3 } }, true],
    ['item_qty absent = 0', { kind: 'item_qty', item: 'rien', cmp: { lt: 1 } }, true],
    ['ever_had_item', { kind: 'ever_had_item', item: 'vieux' }, true],
    ['ever_had_item jamais', { kind: 'ever_had_item', item: 'rien' }, false],
    ['quest unlocked (active)', { kind: 'quest', quest: 'q1', state: 'unlocked' }, true],
    ['quest unlocked (terminée)', { kind: 'quest', quest: 'q2', state: 'unlocked' }, true],
    ['quest active', { kind: 'quest', quest: 'q1', state: 'active' }, true],
    ['quest active terminée', { kind: 'quest', quest: 'q2', state: 'active' }, false],
    ['quest completed', { kind: 'quest', quest: 'q2', state: 'completed' }, true],
    ['quest completed non', { kind: 'quest', quest: 'q1', state: 'completed' }, false],
    ['quest verrouillée', { kind: 'quest', quest: 'q3', state: 'unlocked' }, false],
    ['all vide', { kind: 'all', conditions: [] }, true],
    ['all', { kind: 'all', conditions: [{ kind: 'flag', flag: 'f' }, { kind: 'flag', flag: 'x' }] }, false],
    ['any vide', { kind: 'any', conditions: [] }, false],
    ['any', { kind: 'any', conditions: [{ kind: 'flag', flag: 'f' }, { kind: 'flag', flag: 'x' }] }, true],
    ['not', { kind: 'not', condition: { kind: 'flag', flag: 'x' } }, true],
  ];
  it.each(cases)('%s', (_n, c, r) => expect(evalCondition(c, s)).toBe(r));
});
