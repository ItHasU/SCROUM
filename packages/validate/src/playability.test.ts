import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent, type GameData } from '@scroum/schema';
import { runScenario, start, step } from '@scroum/engine';
import { readContentDir } from './node';
import { analyzePlayability, exportPaths, saturations } from './playability';
import { validateContent } from './validate';

const root = fileURLToPath(new URL('../../../examples/', import.meta.url));

const HEADER = 'title: T\nversion: 0.1.0\nformatVersion: 1\nstart_scene: a\n';
const WORLDS = 'w: { name: W, refuse_line: "Non." }\n';

/** Mini-jeu en mémoire : `game` complète l'en-tête de game.yaml. */
function files(f: Record<string, string>, game = ''): Map<string, string> {
  return new Map(Object.entries({ 'game.yaml': HEADER + game, 'bible/worlds.yaml': WORLDS, ...f }));
}
function load(m: Map<string, string>): GameData {
  const { game, errors } = loadContent(m);
  const errs = errors.filter((e) => e.severity === 'error');
  if (!game || errs.length) throw new Error(errs.map((e) => `${e.file} ${e.path} ${e.message}`).join('\n'));
  return game;
}

describe('examples/demo', () => {
  it('fin win atteignable, aucun soft-lock, exploration complète', async () => {
    const game = load(await readContentDir(`${root}demo/content`));
    const r = analyzePlayability(game, { maxStates: 200_000 });
    expect(r.complete).toBe(true);
    expect(r.winReachable).toBe(true);
    expect(r.winPath?.id).toBe('phare_rallume');
    expect(r.softlocks).toEqual([]);
    expect(r.endings.unreached).toEqual([]);
    expect(r.endings.reached.map((e) => e.id).sort()).toEqual(['chute', 'phare_rallume']);
    expect(Object.values(r.unreached).flat()).toEqual([]);
    // le chemin gagnant est rejouable par le harnais de scénarios
    const paths = exportPaths(game, r);
    const sc = await runScenario(game, paths.win!.scenario);
    expect(sc.failures).toEqual([]);
    expect(sc.state.ending).toEqual({ id: 'phare_rallume', type: 'win' });
  }, 60_000);
});

describe('examples/demo-softlock', () => {
  it('soft-lock détecté avec son chemin (critère M1b)', async () => {
    const m = await readContentDir(`${root}demo-softlock/content`);
    const game = load(m);
    const r = analyzePlayability(game);
    expect(r.complete).toBe(true);
    expect(r.winReachable).toBe(false);
    expect(r.softlocks).toHaveLength(1);
    const g = r.softlocks[0]!;
    expect(g).toMatchObject({ suspected: false, action: 'use cle on porte1', file: 'scenes/couloir.yaml', location: 'hotspots[1].actions.use.cle' });
    expect(g.diagnosis).toMatchObject({ kind: 'consumable_reused', item: 'cle', requiredBy: ['porte2 (cave)'] });
    expect(g.path.steps).toEqual(['take cle', 'use cle on porte1']);
    // chemin rejouable : scénario et liste d'actions
    const exp = exportPaths(game, r).softlocks[0]!;
    expect((await runScenario(game, exp.scenario)).failures).toEqual([]);
    let s = start(game).state;
    for (const a of exp.actions) s = step(game, s, a).state;
    expect(s).toEqual(exp.state);

    const v = validateContent(m, { playability: true });
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.code).sort()).toEqual(['softlock', 'win_unreachable']);
    expect(v.errors.find((e) => e.code === 'softlock')!.message).toMatch(/take cle → use cle on porte1/);
    expect(v.playability?.softlocks).toHaveLength(1);
  });
});

/** Porte à deux serrures, clé consommable unique, mais une autre voie (levier) pour la porte 1. */
const consumable = files(
  {
    'items.yaml': 'cle: { name: Clé, consumable: true }\n',
    'scenes/a.yaml': `world: w
hotspots:
  - id: cle
    label: Clé
    rect: [0, 0, 0.1, 0.1]
    visible_if: { not: { ever_had_item: cle } }
    actions: { take: { give_item: cle } }
  - id: levier
    label: Levier
    rect: [0.2, 0, 0.1, 0.1]
    actions: { tirer: { set: p1 } }
  - id: porte1
    label: Porte 1
    rect: [0.4, 0, 0.1, 0.1]
    actions:
      use: { cle: { set: p1 } }
exits:
  - { to: b, label: B, rect: [0.9, 0, 0.1, 0.1], if: { flag: p1 }, else: "Fermé." }
`,
    'scenes/b.yaml': `world: w
hotspots:
  - id: porte2
    label: Porte 2
    rect: [0.4, 0, 0.1, 0.1]
    actions:
      use: { cle: { end_game: sortie } }
exits:
  - { to: a, label: A, rect: [0, 0, 0.1, 0.1] }
`,
  },
  'endings:\n  sortie: { type: win }\n',
);

describe('soft-locks', () => {
  it('consommable requis deux fois mais obtenable une fois', () => {
    const r = analyzePlayability(load(consumable));
    expect(r.winReachable).toBe(true);
    expect(r.softlocks).toHaveLength(1);
    expect(r.softlocks[0]).toMatchObject({ suspected: false, action: 'use cle on porte1', diagnosis: { kind: 'consumable_reused', item: 'cle' } });
    expect(r.softlocks[0]!.path.steps).toEqual(['take cle', 'use cle on porte1']);
  });

  it('don irréversible fermant la seule voie', () => {
    const game = load(
      files(
        {
          'items.yaml': 'perle: { name: Perle }\n',
          'characters/marchand.yaml': 'name: Marchand\n',
          'dialogues/marchand.yaml': `speaker: marchand
start: n1
nodes:
  n1:
    lines: ["Tu as quelque chose pour moi ?"]
    choices:
      - { label: "Au revoir" }
    on_give:
      perle: { next: merci, effects: [ { take_item: perle } ] }
  merci:
    lines: ["Merci !"]
`,
          'scenes/a.yaml': `world: w
hotspots:
  - id: coffre
    label: Coffre
    rect: [0, 0, 0.1, 0.1]
    visible_if: { not: { ever_had_item: perle } }
    actions: { open: { give_item: perle } }
  - id: marchand
    label: Marchand
    rect: [0.2, 0, 0.1, 0.1]
    actions: { talk: { dialogue: marchand } }
  - id: porte
    label: Porte
    rect: [0.4, 0, 0.1, 0.1]
    actions:
      use: { perle: { end_game: sortie } }
`,
        },
        'endings:\n  sortie: { type: win }\n',
      ),
    );
    const r = analyzePlayability(game);
    expect(r.winReachable).toBe(true);
    expect(r.softlocks).toHaveLength(1);
    const g = r.softlocks[0]!;
    expect(g.diagnosis).toMatchObject({ kind: 'irreversible_give', item: 'perle' });
    expect(g.diagnosis.requiredBy).toEqual(['porte (a)']);
    expect(g.file).toBe('dialogues/marchand.yaml');
    expect(g.location).toBe('nodes.n1.on_give.perle');
    // chemin le plus court : 3 actions (don direct ; la variante par texte libre est regroupée)
    expect(g.path.steps).toEqual(['open coffre', 'talk marchand', 'give perle']);
    expect(g.variants).toEqual([]);
  });

  it('objet obtenable seulement après le point où il est indispensable', () => {
    const game = load(
      files(
        {
          'items.yaml': 'piece: { name: Pièce }\n',
          'scenes/a.yaml': `world: w
hotspots:
  - id: bourse
    label: Bourse
    rect: [0, 0, 0.1, 0.1]
    visible_if: { not: { ever_had_item: piece } }
    actions: { take: { give_item: piece } }
  - id: passeur
    label: Passeur
    rect: [0.4, 0, 0.1, 0.1]
    actions:
      use: { piece: { end_game: traversee } }
exits:
  - { to: ile, label: "Pont", rect: [0.9, 0, 0.1, 0.1] }
`,
          'scenes/ile.yaml': `world: w
hotspots:
  - id: tresor
    label: Trésor
    rect: [0, 0, 0.1, 0.1]
    actions: { take: { give_item: piece } }
`,
        },
        'endings:\n  traversee: { type: win }\n',
      ),
    );
    const r = analyzePlayability(game);
    expect(r.winReachable).toBe(true);
    const tooLate = r.softlocks.find((g) => g.diagnosis.kind === 'item_too_late');
    expect(tooLate).toMatchObject({ action: 'exit exit_ile', diagnosis: { item: 'piece', lostScenes: ['a'] } });
    expect(tooLate!.path.steps).toEqual(['exit exit_ile']);
    // y aller avec la pièce : point de non-retour simple
    const noReturn = r.softlocks.find((g) => g.diagnosis.kind === 'point_of_no_return');
    expect(noReturn!.path.steps).toEqual(['take bourse', 'exit exit_ile']);
  });

  it('les fins game_over sont des terminaux voulus, pas des soft-locks', () => {
    const game = load(
      files(
        {
          'scenes/a.yaml': `world: w
hotspots:
  - id: falaise
    label: Falaise
    rect: [0, 0, 0.1, 0.1]
    actions: { sauter: { end_game: chute }, regarder: "Le vide." }
  - id: porte
    label: Porte
    rect: [0.4, 0, 0.1, 0.1]
    actions: { open: { end_game: sortie } }
`,
        },
        'endings:\n  sortie: { type: win }\n  chute: { type: game_over }\n',
      ),
    );
    const r = analyzePlayability(game);
    expect(r.complete).toBe(true);
    expect(r.endings.reached.map((e) => [e.id, e.type])).toEqual([
      ['chute', 'game_over'],
      ['sortie', 'win'],
    ]);
    expect(r.softlocks).toEqual([]);
    expect(r.unreached.actions).toEqual([]);
  });
});

describe('fins et couverture', () => {
  it('aucune fin win atteignable : erreur', () => {
    const m = files(
      {
        'scenes/a.yaml': `world: w
hotspots:
  - id: porte
    label: Porte
    rect: [0, 0, 0.1, 0.1]
    actions: { open: { if: { flag: jamais }, do: { end_game: sortie }, else: "Fermé." } }
`,
      },
      'endings:\n  sortie: { type: win }\n',
    );
    const r = analyzePlayability(load(m));
    expect(r).toMatchObject({ complete: true, winReachable: false, softlocks: [], endings: { reached: [], unreached: ['sortie'] } });
    const v = validateContent(m, { playability: true });
    expect(v.errors.map((e) => e.code)).toEqual(['win_unreachable']);
    expect(v.warnings.map((e) => e.code)).toContain('unreached_ending');
  });

  it('éléments jamais atteints : scène, dialogue, nœud, action, objet, quête, collection', () => {
    const game = load(
      files(
        {
          'items.yaml': 'cle: { name: Clé }\n',
          'bible/quests.yaml': 'q: { title: Q }\nq0: { title: Q0 }\n',
          'characters/pnj.yaml': 'name: PNJ\n',
          'dialogues/pnj.yaml': `speaker: pnj
start: n1
nodes:
  n1:
    lines: ["Salut."]
    choices:
      - { label: "Secret", if: { flag: jamais }, next: secret }
      - { label: "Au revoir" }
  secret:
    lines: ["Chut."]
`,
          'dialogues/muet.yaml': 'speaker: pnj\nstart: n1\nnodes:\n  n1:\n    lines: ["…"]\n',
          'scenes/a.yaml': `world: w
hotspots:
  - id: pnj
    label: PNJ
    rect: [0, 0, 0.1, 0.1]
    actions: { talk: { dialogue: pnj } }
  - id: porte
    label: Porte
    rect: [0.4, 0, 0.1, 0.1]
    actions:
      open: { end_game: sortie }
      forcer: { if: { flag: jamais }, do: [ { give_item: cle }, { unlock_quest: q }, { goto_scene: b } ] }
      use: { cle: { start_dialogue: muet } }
`,
          'scenes/b.yaml': 'world: w\n',
        },
        `endings:\n  sortie: { type: win }\ninitial:\n  quests: [q0]\ncollections:\n  - { id: col, title: Col, if: { flag: jamais } }\n`,
      ),
    );
    const r = analyzePlayability(game);
    expect(r.complete).toBe(true);
    expect(r.unreached).toEqual({
      scenes: ['b'],
      dialogues: ['muet'],
      nodes: [{ dialogue: 'pnj', node: 'secret' }],
      actions: [{ scene: 'a', hotspot: 'porte', action: 'use cle' }],
      items: ['cle'],
      quests: ['q'],
      uncompletedQuests: ['q0'],
      collections: ['col'],
    });
  });
});

describe('exploration bornée', () => {
  /** Compteur non monotone (+1 / -1) : espace d'états infini. */
  const infinite = files(
    {
      'scenes/a.yaml': `world: w
hotspots:
  - id: bouton
    label: Bouton
    rect: [0, 0, 0.1, 0.1]
    actions:
      plus: { add: { v: 1 } }
      moins: { add: { v: -2 } }
      fin: { if: { var: v, eq: -7 }, do: { end_game: sortie } }
`,
    },
    'endings:\n  sortie: { type: win }\n',
  );

  it('au-delà des bornes, le rapport dit « exploration incomplète » sans conclure', () => {
    const r = analyzePlayability(load(infinite), { maxStates: 50 });
    expect(r.complete).toBe(false);
    expect(r.stopReason).toBe('max_states');
    expect(r.stats.states).toBeLessThanOrEqual(50);
    const v = validateContent(infinite, { playability: { maxStates: 5 } });
    expect(v.errors).toEqual([]);
    expect(v.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['exploration_incomplete', 'win_not_found', 'unreached_ending']));
    expect(v.warnings.find((w) => w.code === 'unreached_ending')!.message).toMatch(/exploration incomplète/);
  });

  it('borne de profondeur et de temps', () => {
    expect(analyzePlayability(load(infinite), { maxDepth: 3 })).toMatchObject({ complete: false, stopReason: 'max_depth' });
    let t = 0;
    expect(analyzePlayability(load(infinite), { timeLimitMs: 10, now: () => (t += 100) })).toMatchObject({ complete: false, stopReason: 'time_limit' });
  });

  it('assez profond, la fin est trouvée malgré l’exploration incomplète', () => {
    const r = analyzePlayability(load(infinite), { maxStates: 2_000 });
    expect(r.complete).toBe(false);
    expect(r.winReachable).toBe(true);
    expect(r.winPath!.path.steps.length).toBeGreaterThan(0);
  });

  it('soft-lock certain même si l’exploration est incomplète ailleurs', () => {
    const m = new Map(consumable);
    m.set('scenes/a.yaml', m.get('scenes/a.yaml')!.replace('      use: { cle: { set: p1 } }', '      use: { cle: { set: p1 } }\n      compter: { add: { n: 1 } }\n      decompter: { add: { n: -1 } }\n      tester: { if: { var: n, eq: 99 }, do: "99 !" }'));
    const r = analyzePlayability(load(m), { maxStates: 3_000 });
    expect(r.complete).toBe(false);
    expect(r.softlocks.some((g) => g.diagnosis.kind === 'consumable_reused')).toBe(true);
  });
});

describe('abstraction', () => {
  it('valeurs monotones saturées, valeurs jamais lues ignorées', () => {
    const game = load(
      files(
        { 'scenes/a.yaml': 'world: w\n', 'items.yaml': 'perle: { name: Perle, stackable: true }\n' },
        `counters:\n  score: { label: Score }\n  peur: { label: Peur }\ninitial:\n  vars: { humeur: 1 }\n`,
      ),
    );
    expect(saturations(game)).toEqual([
      { kind: 'counter', id: 'peur', dir: 'drop', cap: 0 },
      { kind: 'counter', id: 'score', dir: 'drop', cap: 0 },
      { kind: 'ever_had', id: 'perle', dir: 'drop', cap: 0 },
      { kind: 'item', id: 'perle', dir: 'up', cap: 2 },
      { kind: 'var', id: 'humeur', dir: 'drop', cap: 1 },
    ]);
    const g2 = load(
      files({
        'scenes/a.yaml': `world: w
hotspots:
  - id: h
    label: H
    rect: [0, 0, 0.1, 0.1]
    actions:
      flatter: { add: { humeur: 1 } }
      parler: { if: { var: humeur, gte: 3 }, do: { set: ami } }
      fuir: { if: { flag: ami }, do: "Bye." }
`,
      }),
    );
    expect(saturations(g2)).toEqual([{ kind: 'var', id: 'humeur', dir: 'up', cap: 3 }]);
    expect(analyzePlayability(g2)).toMatchObject({ complete: true, stats: { states: 5 } });
  });
});

describe('nœuds routeurs', () => {
  it('un nœud sans répliques à next conditionnel n’est pas signalé « jamais atteint »', () => {
    const game = load(
      files({
        'characters/pnj.yaml': 'name: Pnj\n',
        'dialogues/d.yaml': `speaker: pnj
start: route
nodes:
  route:
    next:
      - { if: { flag: x }, next: a }
      - { next: b }
  a: { lines: ["A."] }
  b:
    lines: ["B."]
    choices: [ { label: "Aiguiller", next: route2 } ]
  route2:
    next: [ { next: a } ]
`,
        'scenes/a.yaml': `world: w
hotspots:
  - { id: h, label: H, rect: [0.1, 0.1, 0.2, 0.2], actions: { talk: { start_dialogue: d } } }
`,
      }),
    );
    const r = analyzePlayability(game);
    expect(r.unreached.nodes.filter((n) => n.node.startsWith('route'))).toEqual([]);
  });
});
