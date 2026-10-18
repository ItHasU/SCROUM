import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { readContentDir, validateDir } from './node';
import { validateContent } from './validate';
import type { Analyzer } from './types';

const root = fileURLToPath(new URL('../../../examples/', import.meta.url));
let demo: Map<string, string>;

beforeAll(async () => {
  demo = await readContentDir(`${root}demo/content`);
});

/** Copie de la démo avec des fichiers remplacés (`null` = supprimé). */
function mutate(changes: Record<string, string | null | ((s: string) => string)>): Map<string, string> {
  const files = new Map(demo);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) files.delete(k);
    else if (typeof v === 'function') files.set(k, v(files.get(k) ?? ''));
    else files.set(k, v);
  }
  return files;
}

const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);

describe('démos', () => {
  it('examples/demo est valide (aucune erreur)', async () => {
    const r = await validateDir(`${root}demo/content`);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    // seuls avertissements attendus : images non fournies
    expect(new Set(r.warnings.map((w) => w.code))).toEqual(new Set(['missing_image']));
  });

  it('examples/demo-softlock passe le niveau 1 (le soft-lock relève de la jouabilité)', async () => {
    const r = await validateDir(`${root}demo-softlock/content`);
    expect(r.errors).toEqual([]);
  });
});

describe('chargement', () => {
  it('erreur de schéma : analyseurs suivants ignorés', () => {
    const r = validateContent(mutate({ 'items.yaml': (s) => s.replace('stackable: true', 'stackable: oui') }));
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([expect.objectContaining({ code: 'schema', file: 'items.yaml', path: 'coquillage.stackable' })]);
    expect(r.skipped.length).toBeGreaterThan(0);
  });
});

describe('règles du jeu', () => {
  it('âge requis', () => {
    const r = validateContent(mutate({ 'characters/loic.yaml': (s) => s.replace('age: 62\n', '') }));
    expect(r.errors).toEqual([expect.objectContaining({ code: 'age_required', file: 'characters/loic.yaml', path: 'age' })]);
  });
  it('âge minimal', () => {
    const r = validateContent(mutate({ 'characters/loic.yaml': (s) => s.replace('age: 62', 'age: 16') }));
    expect(codes(r)).toEqual(['age_min']);
  });
  it('rôle non déclaré', () => {
    const r = validateContent(mutate({ 'characters/loic.yaml': (s) => s.replace('role: habitant', 'role: pirate') }));
    expect(codes(r)).toEqual(['unknown_role']);
  });
});

describe('références', () => {
  const cases: [string, Record<string, (s: string) => string>, string, string?][] = [
    ['scène de départ', { 'game.yaml': (s) => s.replace('start_scene: port', 'start_scene: quai') }, 'unknown_scene', 'start_scene'],
    ['sortie', { 'scenes/port.yaml': (s) => s.replace('to: phare_bas', 'to: phare') }, 'unknown_scene', 'exits[0].to'],
    ['goto_scene', { 'scenes/phare_bas.yaml': (s) => s.replace('goto_scene: songe_grotte', 'goto_scene: songe') }, 'unknown_scene'],
    ['dialogue', { 'scenes/port.yaml': (s) => s.replace('dialogue: loic', 'dialogue: loik') }, 'unknown_dialogue', 'hotspots[2].actions.talk[0]'],
    ['nœud de start_dialogue', { 'scenes/songe_grotte.yaml': (s) => s.replace('node: apres', 'node: apre') }, 'unknown_node'],
    ['nœud next', { 'dialogues/loic.yaml': (s) => s.replace('next: menu', 'next: menuu') }, 'unknown_node', 'nodes.accueil.next'],
    ['objet donné', { 'scenes/port.yaml': (s) => s.replace('give_item: meche }', 'give_item: mech }') }, 'unknown_item'],
    ['objet en condition', { 'scenes/port.yaml': (s) => s.replace('ever_had_item: meche', 'ever_had_item: mech') }, 'unknown_item'],
    ['objet de use', { 'scenes/lanterne.yaml': (s) => s.replace('meche: { say', 'mech: { say') }, 'unknown_item'],
    ['objet de on_give', { 'dialogues/gardien.yaml': (s) => s.replace('photo_ancienne:\n        next', 'photo:\n        next') }, 'unknown_item'],
    ['combinaison', { 'items.yaml': (s) => s.replace('result: meche_huilee', 'result: meche_huile') }, 'unknown_item'],
    ['asset', { 'scenes/port.yaml': (s) => s.replace('img_port_bg', 'img_port') }, 'unknown_asset', 'background'],
    ['intention', { 'dialogues/loic.yaml': (s) => s.replace('saluer: salut', 'bonjour: salut') }, 'unknown_intent'],
    ['monde', { 'scenes/port.yaml': (s) => s.replace('world: ile', 'world: isle') }, 'unknown_world', 'world'],
    ['monde de persona', { 'characters/gardien.yaml': (s) => s.replace('world: songe', 'world: reve') }, 'unknown_world', 'persona.world'],
    ['locuteur', { 'scenes/port.yaml': (s) => s.replace('say: margot', 'say: margaux') }, 'unknown_speaker'],
    ['quête', { 'scenes/port.yaml': (s) => s.replace('unlock_quest: rallumer_phare', 'unlock_quest: phare') }, 'unknown_quest'],
    ['compteur', { 'scenes/port.yaml': (s) => s.replace('counter: maladresses', 'counter: gaffes') }, 'unknown_counter'],
    ['fin', { 'scenes/lanterne.yaml': (s) => s.replace('end_game: phare_rallume', 'end_game: victoire') }, 'unknown_ending'],
    ['cible de reveal', { 'scenes/phare_bas.yaml': (s) => s.replace('reveal: cle_rouillee', 'reveal: cle') }, 'unknown_target'],
  ];
  for (const [name, change, code, path] of cases) {
    it(name, () => {
      const r = validateContent(mutate(change));
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.errors[0]).toMatchObject({ code, ...(path ? { path } : {}) });
    });
  }

  it('asset déclaré sans image : simple avertissement', () => {
    const r = validateContent(demo);
    expect(r.warnings.find((w) => w.code === 'missing_image' && w.path === 'img_port_bg')).toBeTruthy();
    const withImage = validateContent(mutate({ 'assets/images/img_port_bg.webp': '' }));
    expect(withImage.warnings.find((w) => w.path === 'img_port_bg')).toBeUndefined();
  });
});

describe('obtenabilité et orphelins', () => {
  it('objet jamais obtenable', () => {
    const r = validateContent(mutate({ 'items.yaml': (s) => `${s}\nboussole: { name: "Boussole" }\n` }));
    expect(r.errors).toEqual([expect.objectContaining({ code: 'unobtainable_item', path: 'boussole' })]);
  });

  it('objet obtenable par l’inventaire initial', () => {
    const r = validateContent(
      mutate({
        'items.yaml': (s) => `${s}\nboussole: { name: "Boussole" }\n`,
        'game.yaml': (s) => `${s}\ninitial:\n  inventory: [boussole]\n`,
      }),
    );
    expect(r.errors).toEqual([]);
  });

  it('scène orpheline, nœud inaccessible, drapeau jamais levé', () => {
    const r = validateContent(
      mutate({
        'scenes/grenier.yaml': 'world: ile\nhotspots:\n  - { id: malle, label: Malle, rect: [0,0,0.1,0.1], visible_if: { flag: jamais }, actions: { look: "Une malle." } }\n',
        'dialogues/loic.yaml': (s) => `${s}\n  oublie:\n    lines: ["Personne ne m'entend."]\n`,
      }),
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['orphan_scene', 'orphan_node', 'flag_never_set']));
  });
});

describe("point d'extension", () => {
  it('un analyseur de jouabilité est exécuté après les autres, et seulement sans erreur', () => {
    const calls: string[] = [];
    const playability: Analyzer = {
      name: 'fake-bfs',
      level: 'playability',
      run(game, ctx) {
        calls.push(game.meta.start_scene);
        ctx.report('error', 'softlock', 'scenes/port.yaml', '', 'bloqué');
      },
    };
    const ok = validateContent(demo, { extraAnalyzers: [playability] });
    expect(calls).toEqual(['port']);
    expect(codes(ok)).toEqual(['softlock']);

    const broken = validateContent(mutate({ 'game.yaml': (s) => s.replace('start_scene: port', 'start_scene: quai') }), {
      extraAnalyzers: [playability],
    });
    expect(calls).toHaveLength(1);
    expect(broken.skipped.map((s) => s.analyzer)).toEqual(['fake-bfs']);
  });
});
