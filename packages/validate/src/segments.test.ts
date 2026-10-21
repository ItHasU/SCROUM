import { describe, expect, it } from 'vitest';
import { loadContent, type GameData } from '@scroum/schema';
import { runScenario } from '@scroum/engine';
import { analyzeSegments } from './segments';
import { exportPaths } from './playability';
import { validateContent } from './validate';

const GAME = 'title: T\nversion: 0.1.0\nformatVersion: 1\nstart_scene: a\nendings:\n  fin: { type: win, text: "Fin." }\n';
const SCENE_A = `world: w
hotspots:
  - id: cle
    label: Clé
    rect: [0.1, 0.8, 0.05, 0.05]
    visible_if: { not: { ever_had_item: cle } }
    actions: { take: { give_item: cle } }
  - id: coffre
    label: Coffre
    rect: [0.4, 0.2, 0.2, 0.3]
    actions:
      use:
        cle: [ { give_item: piece }, { complete_quest: q1 } ]
exits:
  - { to: b, label: B, rect: [0.9, 0.3, 0.1, 0.5] }
`;
const SCENE_B = `world: w
hotspots:
  - id: fantome
    label: Fantôme
    rect: [0.1, 0.8, 0.05, 0.05]
    visible_if: { quest: q2, state: completed }
    actions: { take: { give_item: fantome } }
  - id: marchand
    label: Marchand
    rect: [0.4, 0.2, 0.2, 0.3]
    actions:
      use:
        piece: [ { complete_quest: q2 }, { end_game: fin } ]
exits:
  - { to: a, label: A, rect: [0, 0.3, 0.1, 0.5] }
`;
const ITEMS = 'cle: { name: Clé }\npiece: { name: Pièce }\nfantome: { name: Fantôme }\n';
const QUESTS = `q1:
  title: Q1
  checkpoint: { scene: a }
q2:
  title: Q2
  checkpoint: { scene: b, inventory: [piece] }
`;

function files(over: Record<string, string> = {}): Map<string, string> {
  return new Map(
    Object.entries({
      'game.yaml': GAME,
      'bible/worlds.yaml': 'w: { name: W, refuse_line: "Non." }\n',
      'items.yaml': ITEMS,
      'scenes/a.yaml': SCENE_A,
      'scenes/b.yaml': SCENE_B,
      'bible/quests.yaml': QUESTS,
      ...over,
    }),
  );
}
const noCheckpoints = QUESTS.replace(/  checkpoint:.*\n/g, '');
function load(m: Map<string, string>): GameData {
  const { game, errors } = loadContent(m);
  const errs = errors.filter((e) => e.severity === 'error');
  if (!game || errs.length) throw new Error(errs.map((e) => `${e.file} ${e.path} ${e.message}`).join('\n'));
  return game;
}
const codes = (v: { errors: { code: string }[]; warnings: { code: string }[] }) => [...v.errors, ...v.warnings].map((i) => i.code).sort();

describe('validation par quête', () => {
  it('démo segmentée : chaque segment atteint son but, chaînage et fin OK, BFS global omis', async () => {
    const m = files();
    const v = validateContent(m, { playability: true });
    expect(v.errors).toEqual([]);
    expect(v.warnings.filter((w) => w.code === 'given_never_obtained')).toEqual([]);
    expect(v.playability).toBeNull();
    const seg = v.segments!;
    expect(seg.segments.map((s) => [s.quest, s.goalReached, s.complete, s.softlocks.length])).toEqual([
      ['q1', true, true, 0],
      ['q2', true, true, 0],
    ]);
    expect(seg.segments[0]!.goalPath!.path.steps).toEqual(['take cle', 'use cle on coffre']);
    expect(seg.segments[1]!.startScene).toBe('b');
    expect(seg.segments[0]!.produced.items).toContain('piece');
    expect(seg.finalReached).toBe(true);
    // --path-out : les chemins de segment se rejouent depuis l'état forgé
    const game = load(m);
    const paths = exportPaths(game, null, undefined, seg);
    const q1 = paths.segments![0]!;
    const sc = await runScenario(game, q1.goal!.scenario, { initialState: q1.startState });
    expect(sc.failures).toEqual([]);
    expect(sc.state.quests.completed).toContain('q1');
  });

  it('--global : le BFS global complet reste rapporté', () => {
    const v = validateContent(files(), { playability: { global: 'on' } });
    expect(v.playability?.winReachable).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('soft-lock détecté dans un segment', () => {
    const a = SCENE_A.replace(
      'exits:',
      `  - id: jeter
    label: Jeter
    rect: [0.7, 0.8, 0.05, 0.05]
    actions: { look: { take_item: cle } }
exits:`,
    );
    const v = validateContent(files({ 'scenes/a.yaml': a }), { playability: true });
    const sl = v.errors.filter((e) => e.code === 'softlock');
    expect(sl).toHaveLength(1);
    expect(sl[0]!.message).toMatch(/\[quête « q1 »\]/);
    expect(v.segments!.segments[0]!.softlocks[0]!.path.steps).toEqual(['take cle', 'look jeter']);
    expect(v.segments!.segments[1]!.softlocks).toEqual([]);
  });

  it('checkpoint donnant un objet jamais obtenu : avertissement', () => {
    const q = QUESTS.replace('inventory: [piece]', 'inventory: [piece, fantome]');
    const v = validateContent(files({ 'bible/quests.yaml': q }), { playability: true });
    const w = v.warnings.filter((x) => x.code === 'given_never_obtained');
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toMatch(/objet « fantome »/);
    expect(v.segments!.neverObtained).toEqual([{ quest: 'q2', kind: 'item', id: 'fantome' }]);
    expect(v.ok).toBe(true);
  });

  it('but inatteignable : erreur', () => {
    const q = QUESTS.replace('q1:\n  title: Q1\n', 'q1:\n  title: Q1\n  goal: { if: { flag: jamais_pose } }\n');
    const v = validateContent(files({ 'bible/quests.yaml': q }), { playability: true });
    expect(v.errors.map((e) => e.code)).toContain('quest_goal_unreachable');
    expect(v.ok).toBe(false);
  });

  it('exploration incomplète : avertissement sans verdict', () => {
    const v = validateContent(files(), { playability: { maxStates: 2 } });
    expect(v.warnings.map((w) => w.code)).toContain('segment_incomplete');
    expect(v.errors.map((e) => e.code)).not.toContain('softlock');
  });

  it('reveal du checkpoint : un hotspot caché devient accessible', () => {
    const b = SCENE_B.replace('  - id: marchand', '  - id: marchand\n    hidden: true').replace('label: Marchand', 'label: Marchand');
    const q = QUESTS.replace('inventory: [piece]', 'inventory: [piece], reveal: { b: [marchand] }');
    const v = validateContent(files({ 'scenes/b.yaml': b, 'bible/quests.yaml': q }), { playability: true });
    expect(v.segments!.segments[1]!.goalReached).toBe(true);
    const bad = validateContent(files({ 'bible/quests.yaml': QUESTS.replace('inventory: [piece]', 'inventory: [piece], reveal: { b: [nul] }') }));
    expect(bad.errors.map((e) => e.code)).toContain('unknown_target');
  });

  it('référence inconnue dans un checkpoint : erreur', () => {
    const q = QUESTS.replace('scene: b,', 'scene: nulle_part,');
    const v = validateContent(files({ 'bible/quests.yaml': q }));
    expect(v.errors.map((e) => e.code)).toContain('unknown_scene');
  });

  it('rétrocompatibilité : sans checkpoint, BFS global comme avant', () => {
    const v = validateContent(files({ 'bible/quests.yaml': noCheckpoints }), { playability: true });
    expect(v.segments).toBeNull();
    expect(v.playability?.winReachable).toBe(true);
    expect(v.playability?.winPath?.id).toBe('fin');
    expect(v.errors).toEqual([]);
    expect(codes(v)).toEqual(['unreached_action', 'unreached_item']); // fantôme : après la fin
    expect(analyzeSegments(load(files({ 'bible/quests.yaml': noCheckpoints }))).segments).toEqual([]);
  });
});
