import { describe, expect, it } from 'vitest';
import { loadContent, type GameData } from '@scroum/schema';
import { describeAction, listActions, runScenario, start, step, type Action, type EngineEvent, type GameState } from '../src';

const GAME = `
title: T
version: 0.1.0
formatVersion: 1
start_scene: a
player_character: heros
vars:
  confiance: { min: 0, max: 2 }
dialogue: { echo_choices: true }
initial: { inventory: [flacon] }
endings:
  fin:
    type: win
    text:
      - { if: { flag: ami }, text: "Fin amicale." }
      - "Fin froide."
`;
const FILES: Record<string, string> = {
  'game.yaml': GAME,
  'bible/worlds.yaml': 'w: { name: W, ui_skin: neon }\n',
  'skins/neon.css': '.skin-neon { color: lime; }',
  'characters/heros.yaml': 'name: Boris\nrole: hero\n',
  'characters/lea.yaml': 'name: Léa\nrole: npc\n',
  'items.yaml': `
flacon:
  name: Flacon
  actions:
    boire: { label: "Boire", do: [ { say: narrator, text: "Glou." }, { add: { confiance: 5 } }, { set: ami } ] }
    jeter: { end_game: fin }
`,
  'scenes/a.yaml': `
world: w
hotspots:
  - { id: lea, label: Léa, rect: [0.1, 0.1, 0.2, 0.2], actions: { talk: { start_dialogue: lea } } }
`,
  'dialogues/lea.yaml': `
speaker: lea
nodes:
  start:
    lines:
      - "Salut."
      - { if: { flag: ami }, text: "Ah, vous revoilà !" }
      - { speaker: heros, if: { not: { flag: ami } }, text: "Première fois." }
    choices:
      - { label: "Dire bonjour", next: routeur }
  routeur:
    next:
      - { if: { var: confiance, gte: 1 }, next: confiant }
      - { next: froid }
  confiant:
    lines: ["Confiance."]
  froid:
    lines: ["Froideur."]
`,
};

const game = (): GameData => {
  const { game: g, errors } = loadContent(FILES);
  expect(errors.filter((e) => e.severity === 'error')).toEqual([]);
  return g!;
};
const texts = (ev: EngineEvent[]) => ev.flatMap((e) => (e.type === 'say' ? [`${e.speaker}:${e.text}`] : []));
const run = (g: GameData, s: GameState, ...a: Action[]) => a.reduce((acc, x) => step(g, acc.state, x), { state: s, events: [] as EngineEvent[] });

describe('évolutions du format v1', () => {
  it('skins du jeu portés par GameData', () => {
    expect(game().skins).toEqual({ neon: '.skin-neon { color: lime; }' });
  });

  it('verbes d’objet : listActions, exécution, borne de variable', () => {
    const g = game();
    const s = start(g).state;
    const acts = listActions(g, s).map(describeAction);
    expect(acts).toContain('act flacon boire');
    const r = step(g, s, { type: 'item_verb', item: 'flacon', verb: 'boire' });
    expect(texts(r.events)).toEqual(['narrator:Glou.']);
    expect(r.state.vars.confiance).toBe(2); // add 5 borné à max 2
    expect(r.state.flags).toContain('ami');
    expect(step(g, s, { type: 'item_verb', item: 'flacon', verb: 'inconnu' }).events[0]).toMatchObject({ type: 'error', code: 'unknown_verb' });
  });

  it('borne minimale et scénario act', async () => {
    const g = game();
    const s = { ...start(g).state };
    const r = await runScenario(g, { name: 'x', steps: [{ do: 'act flacon boire', expect: { vars: { confiance: 2 } } }] });
    expect(r.failures).toEqual([]);
    expect(s.vars.confiance).toBeUndefined();
  });

  it('fin à texte conditionnel', () => {
    const g = game();
    const s = start(g).state;
    const froid = step(g, s, { type: 'item_verb', item: 'flacon', verb: 'jeter' });
    expect(froid.events.find((e) => e.type === 'game_ended')).toMatchObject({ text: 'Fin froide.' });
    const ami = step(g, { ...s, flags: ['ami'] }, { type: 'item_verb', item: 'flacon', verb: 'jeter' });
    expect(ami.events.find((e) => e.type === 'game_ended')).toMatchObject({ text: 'Fin amicale.' });
  });

  it('répliques conditionnelles, next conditionnel (routeur) et écho des choix', () => {
    const g = game();
    const s = start(g).state;
    const open = (st: GameState) => step(g, st, { type: 'verb', hotspot: 'lea', verb: 'talk' });
    expect(texts(open(s).events)).toEqual(['lea:Salut.', 'heros:Première fois.']);
    const confiant = { ...s, flags: ['ami'], vars: { confiance: 1 } };
    expect(texts(open(confiant).events)).toEqual(['lea:Salut.', 'lea:Ah, vous revoilà !']);
    const r = run(g, open(confiant).state, { type: 'choose', choice: 0 });
    expect(texts(r.events)).toEqual(['heros:Dire bonjour', 'lea:Confiance.']);
    const f = run(g, open(s).state, { type: 'choose', choice: 0 });
    expect(texts(f.events)).toEqual(['heros:Dire bonjour', 'lea:Froideur.']);
  });

  it('echo_choices désactivé par défaut', () => {
    const g = game();
    g.meta.dialogue.echo_choices = false;
    const s = step(g, start(g).state, { type: 'verb', hotspot: 'lea', verb: 'talk' }).state;
    expect(texts(step(g, s, { type: 'choose', choice: 0 }).events)).toEqual(['lea:Froideur.']);
  });

  it('exclude avec choose "libellé" invisible ne lève pas', async () => {
    const g = game();
    const r = await runScenario(g, {
      name: 'x',
      steps: [
        { do: 'talk lea', expect: { actions: { exclude: ['choose "Inexistant"'], include: ['choose "Dire bonjour"'] } } },
      ],
    });
    expect(r.failures).toEqual([]);
  });
});

describe('formes invalides', () => {
  const load = (extra: Record<string, string>) => loadContent({ ...FILES, ...extra }).errors.filter((e) => e.severity === 'error');
  it('branche sans if hors dernière position', () => {
    const errs = load({ 'dialogues/lea.yaml': 'speaker: lea\nnodes:\n  start:\n    next: [ { next: a }, { if: x, next: b } ]\n  a: {}\n  b: {}\n' });
    expect(errs.some((e) => /dernière branche/.test(e.message))).toBe(true);
  });
  it('next conditionnel exclusif avec choices', () => {
    const errs = load({ 'dialogues/lea.yaml': 'speaker: lea\nnodes:\n  start:\n    next: [ { if: x, next: a } ]\n    choices: [ { label: L } ]\n  a: {}\n' });
    expect(errs.length).toBeGreaterThan(0);
  });
  it('bornes incohérentes et verbe réservé', () => {
    expect(load({ 'game.yaml': GAME.replace('{ min: 0, max: 2 }', '{ min: 3, max: 2 }') }).length).toBeGreaterThan(0);
    expect(load({ 'items.yaml': 'f:\n  name: F\n  actions:\n    look: { say: narrator, text: x }\n' }).length).toBeGreaterThan(0);
  });
});
