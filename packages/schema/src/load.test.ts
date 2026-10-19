import { describe, expect, it } from 'vitest';
import { classifyPath, loadContent, splitFrontMatter } from './load';
import { FORMAT_VERSION, FormatVersionError, migrate } from './version';
import { findCombination, counterTitle, displayFace, visitSteps } from './visit';

const GAME = `
title: "Test"
version: 0.1.0
formatVersion: 1
start_scene: cuisine
player_character: heros
counters:
  points: { label: "Points", hud: true }
  gaffes:
    label: "Gaffes"
    titles: [ { min: 3, label: "Gaffeur" }, { min: 0, label: "Prudent" } ]
character_roles: [npc, hero]
validation:
  characters: { require_age: true, min_age: 18 }
collections:
  - { id: souvenir, title: "Souvenir", character: chat, if: { flag: chat_demasque } }
endings:
  victoire: { type: win, text: "Bravo." }
`;

const SCENE = `
world: maison
background: img_cuisine
on_enter:
  - if: { not: { flag: vu_cuisine } }
    do: [ { say: narrator, text: "Une cuisine." }, { set: vu_cuisine } ]
hotspots:
  - id: tiroir
    label: "Tiroir"
    rect: [0.1, 0.5, 0.2, 0.2]
    actions:
      look: { say: narrator, text: "Un tiroir." }
      open: { do: [ { reveal: telecommande } ] }
  - id: telecommande
    label: "Télécommande"
    rect: { x: 0.12, y: 0.55, w: 0.05, h: 0.05 }
    hidden: true
    visible_if: { not: { ever_had_item: telecommande } }
    actions:
      take: { do: [ { give_item: telecommande } ] }
  - id: tele
    label: "Télé"
    rect: [0.5, 0.2, 0.3, 0.3]
    actions:
      use:
        telecommande: { do: [ { set: tele_allumee } ] }
        default: { say: heros, text: "Non." }
exits:
  - { to: salon, label: "Salon", rect: [0, 0.3, 0.08, 0.5], if: { flag: tele_allumee }, else: "Pas maintenant." }
`;

const DIALOGUE = `
speaker: chat
start: n1
nodes:
  n1:
    lines: ["Miaou...", { speaker: heros, text: "Salut le chat." }]
    choices:
      - { label: "Caresser", intent: caresse, next: n2, effects: [ { add: { confiance: 1 } } ] }
      - { label: "Donner le poisson", if: { has_item: poisson }, next: n2 }
    free_text:
      intents:
        caresse: n2
        insulte: { next: null, effects: [ { end_game: { ending: griffe, type: game_over, text: "Aïe." } } ] }
    on_give:
      poisson: { next: n2, effects: [ { take_item: poisson } ] }
      default: n1
  n2:
    lines: "Ronron."
    effects: [ { set: chat_content } ]
`;

const CHARACTER = `
status: validated
role: npc
age: 40
persona: { name: "Le Chat", world: maison, avatar: img_chat }
identity: { name: "Gérard", description: "Un homme déguisé en chat", portrait: img_gerard }
revealed_by: { flag: chat_demasque }
voice: "Miaule entre les mots"
`;

function base(): Record<string, string> {
  return {
    'game.yaml': GAME,
    'scenes/cuisine.yaml': SCENE,
    'scenes/salon.yaml': 'world: maison\n',
    'dialogues/chat.yaml': DIALOGUE,
    'characters/chat.yaml': CHARACTER,
    'characters/heros.yaml': 'name: "Héros"\nage: 30\nrole: hero\n',
    'bible/worlds.yaml': 'maison: { name: "La Maison", ui_skin: plain }\nreve: { name: "Rêve", refuse_line: "Pouf." }\n',
    'bible/quests.yaml': 'q1: { title: "Allumer la télé", status: review }\n',
    'bible/gags.yaml': 'g1: "Le chat parle."\ng2: { text: "La télé est en noir et blanc.", tags: [tele] }\n',
    'bible/pitch.md': '---\nstatus: validated\n---\n# Pitch\nUn chat.\n',
    'bible/tone.md': '# Ton\nLéger.\n',
    'intents.yaml': 'caresse: { desc: "Caresser", keywords: [caresse] }\ninsulte: { desc: "Insulter" }\n',
    'items.yaml':
      'telecommande: { name: "Télécommande", scope: maison }\npoisson:\n  name: "Poisson"\n  look: "Il sent fort."\n  combine:\n    - { with: telecommande, result: null, effects: [ { set: bizarre } ] }\n',
    'assets/assets.yaml': 'img_cuisine: { kind: background, prompt: "une cuisine", status: validated }\nimg_chat: { kind: avatar }\n',
    'assets/images/img_cuisine.webp': '',
    'assets/_candidates/img_chat/1.png': '',
    '.gitkeep': '',
  };
}

describe('loadContent', () => {
  it('charge un contenu complet sans erreur', () => {
    const { game, errors } = loadContent(base());
    expect(errors).toEqual([]);
    expect(game).not.toBeNull();
    const g = game!;
    expect(g.formatVersion).toBe(FORMAT_VERSION);
    expect(g.meta.start_scene).toBe('cuisine');
    expect(g.meta.player_character).toBe('heros');
    expect(g.meta.validation.characters).toEqual({ require_age: true, min_age: 18 });
    expect(g.counters.points).toMatchObject({ id: 'points', hud: true, initial: 0 });
    expect(g.counters.gaffes!.titles.map((t) => t.min)).toEqual([0, 3]);
    expect(g.collections[0]!.condition).toEqual({ kind: 'flag', flag: 'chat_demasque' });
    // fins : déclarée + en ligne
    expect(Object.keys(g.endings).sort()).toEqual(['griffe', 'victoire']);
    expect(g.endings.griffe).toMatchObject({ type: 'game_over', text: 'Aïe.' });
    // mondes : refuse_line complétée
    expect(g.worlds.maison!.refuse_line).toBe('Ça ne donne rien.');
    expect(g.worlds.reve!.refuse_line).toBe('Pouf.');
    expect(g.worlds.reve!.ui_skin).toBe('plain');
    // bible
    expect(g.bible.docs.pitch).toMatchObject({ status: 'validated', body: '# Pitch\nUn chat.\n' });
    expect(g.bible.docs.tone!.status).toBe('draft');
    expect(g.bible.gags.g1).toMatchObject({ text: 'Le chat parle.', status: 'draft' });
    expect(g.quests.q1).toMatchObject({ title: 'Allumer la télé', status: 'review', source: 'bible/quests.yaml' });
    // intentions réservées
    expect(g.intents.give_item!.reserved).toBe(true);
    expect(g.intents.show_item!.reserved).toBe(true);
    expect(g.intents.caresse!.reserved).toBe(false);
    // objets
    expect(g.items.telecommande!.scope).toEqual(['maison']);
    expect(g.items.poisson!.scope).toBeNull();
    expect(g.items.poisson!.look).toEqual([{ kind: 'say', speaker: 'narrator', text: 'Il sent fort.' }]);
    expect(findCombination(g, 'telecommande', 'poisson')?.owner).toBe('poisson');
    // assets
    expect(g.assets.img_cuisine!.file).toBe('assets/images/img_cuisine.webp');
    expect(g.assets.img_chat!.file).toBeNull();
    // JSON-sérialisable
    expect(JSON.parse(JSON.stringify(g))).toEqual(g);
  });

  it('normalise une scène', () => {
    const s = loadContent(base()).game!.scenes.cuisine!;
    expect(s.id).toBe('cuisine');
    expect(s.source).toBe('scenes/cuisine.yaml');
    expect(s.on_enter[0]!.kind).toBe('if');
    const [tiroir, telecommande, tele] = s.hotspots;
    // reveal : la scène est complétée
    expect(tiroir!.actions.open!.script).toEqual([{ kind: 'reveal', target: 'telecommande', scene: 'cuisine' }]);
    expect(telecommande!.hidden).toBe(true);
    expect(telecommande!.rect).toEqual({ x: 0.12, y: 0.55, w: 0.05, h: 0.05 });
    expect(tiroir!.rect).toEqual({ x: 0.1, y: 0.5, w: 0.2, h: 0.2 });
    expect(tele!.use!.byItem.telecommande).toEqual([{ kind: 'set_flag', flag: 'tele_allumee' }]);
    expect(tele!.actions).toEqual({});
    expect(s.exits[0]).toMatchObject({
      id: 'exit_salon',
      to: 'salon',
      condition: { kind: 'flag', flag: 'tele_allumee' },
      else: [{ kind: 'say', speaker: 'narrator', text: 'Pas maintenant.' }],
      script: [],
    });
  });

  it('normalise un dialogue', () => {
    const d = loadContent(base()).game!.dialogues.chat!;
    const n1 = d.nodes.n1!;
    expect(n1.lines).toEqual([
      { speaker: 'chat', text: 'Miaou...', condition: null },
      { speaker: 'heros', text: 'Salut le chat.', condition: null },
    ]);
    expect(n1.choices[1]!.condition).toEqual({ kind: 'has_item', item: 'poisson' });
    expect(n1.free_text!.intents.caresse).toEqual({ next: 'n2', effects: [] });
    expect(n1.free_text!.fallback).toEqual({ next: 'n1', effects: [] });
    expect(n1.on_give!.default).toEqual({ next: 'n1', effects: [] });
    expect(d.nodes.n2!.lines).toEqual([{ speaker: 'chat', text: 'Ronron.', condition: null }]);
    expect(d.nodes.n2!.next).toBeNull();
  });

  it('normalise un personnage simple et à double identité', () => {
    const g = loadContent(base()).game!;
    expect(g.characters.heros).toMatchObject({ persona: null, identity: { name: 'Héros', avatar: null }, age: 30 });
    const chat = g.characters.chat!;
    expect(displayFace(chat, false).name).toBe('Le Chat');
    expect(displayFace(chat, true).name).toBe('Gérard');
    expect(counterTitle(g.counters.gaffes!, 4)).toBe('Gaffeur');
  });

  it('visitSteps parcourt toutes les étapes', () => {
    const kinds = new Set<string>();
    visitSteps(loadContent(base()).game!, (s) => kinds.add(s.kind));
    expect([...kinds].sort()).toEqual(
      ['add_var', 'end_game', 'give_item', 'if', 'reveal', 'say', 'set_flag', 'take_item'].sort(),
    );
  });

  it('erreurs localisées : schéma avec fichier, chemin et ligne', () => {
    const files = base();
    files['scenes/cuisine.yaml'] = SCENE.replace('rect: [0.5, 0.2, 0.3, 0.3]', 'rect: [0.5, 0.2, 0.8, 0.3]').replace(
      'look: { say: narrator, text: "Un tiroir." }',
      'look: { say: narrator }',
    );
    const { game, errors } = loadContent(files);
    expect(game).not.toBeNull();
    expect(game!.scenes.cuisine).toBeUndefined();
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'scenes/cuisine.yaml', path: 'hotspots[0].actions.look', code: 'schema', line: 12 }),
        expect.objectContaining({ file: 'scenes/cuisine.yaml', path: 'hotspots[2].rect', message: expect.stringMatching(/déborde/) }),
      ]),
    );
  });

  it('clé inconnue, YAML invalide, id incohérent, intention réservée', () => {
    const files = base();
    files['items.yaml'] = 'cle: { name: "Clé", consomable: true }\n';
    files['dialogues/chat.yaml'] = 'speaker: chat\nnodes: [oops\n';
    files['characters/heros.yaml'] = 'id: zorro\nname: "Héros"\n';
    files['intents.yaml'] = 'give_item: { desc: "x" }\n';
    files['notes.txt'] = 'hello';
    const { errors } = loadContent(files);
    const codes = errors.map((e) => `${e.severity}:${e.code}:${e.file}:${e.path}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'error:schema:items.yaml:cle',
        'error:yaml:dialogues/chat.yaml:',
        'error:id_mismatch:characters/heros.yaml:id',
        'error:reserved_intent:intents.yaml:give_item',
        'warning:unknown_file:notes.txt:',
      ]),
    );
    expect(errors.find((e) => e.file === 'items.yaml')!.message).toMatch(/consomable/);
  });

  it('game.yaml absent, invalide ou de version future → game null', () => {
    const files = base();
    delete files['game.yaml'];
    expect(loadContent(files)).toMatchObject({ game: null, errors: [expect.objectContaining({ code: 'missing_file' })] });
    expect(loadContent({ ...base(), 'game.yaml': 'title: x\n' }).game).toBeNull();
    const future = loadContent({ ...base(), 'game.yaml': GAME.replace('formatVersion: 1', 'formatVersion: 99') });
    expect(future.game).toBeNull();
    expect(future.errors[0]!.code).toBe('format_version');
  });

  it('fin déclarée deux fois différemment', () => {
    const files = base();
    files['dialogues/chat.yaml'] = DIALOGUE.replace('ending: griffe, type: game_over', 'ending: victoire, type: game_over');
    expect(loadContent(files).errors.map((e) => e.code)).toContain('ending_conflict');
  });

  it('collision d’id dans une scène', () => {
    const files = base();
    files['scenes/salon.yaml'] =
      'world: maison\nhotspots:\n  - { id: a, label: A, rect: [0,0,0.1,0.1] }\n  - { id: a, label: B, rect: [0,0,0.1,0.1] }\n';
    expect(loadContent(files).errors[0]).toMatchObject({ file: 'scenes/salon.yaml', path: 'hotspots[1].id' });
  });
});

describe('utilitaires', () => {
  it('classifyPath', () => {
    expect(classifyPath('scenes/port.yaml')).toBe('scene');
    expect(classifyPath('./dialogues/x.yml')).toBe('dialogue');
    expect(classifyPath('bible/style.md')).toBe('bible_doc');
    expect(classifyPath('assets/images/img.PNG')).toBe('image');
    expect(classifyPath('assets/_candidates/img/1.png')).toBe('ignored');
    expect(classifyPath('scenes/sub/x.yaml')).toBe('unknown');
  });

  it('splitFrontMatter', () => {
    expect(splitFrontMatter('---\nstatus: draft\n---\ncorps')).toEqual({ frontMatter: 'status: draft', body: 'corps', bodyLine: 4 });
    expect(splitFrontMatter('corps').frontMatter).toBeNull();
  });

  it('migrate', () => {
    expect(migrate({ formatVersion: 1, a: 1 })).toEqual({ formatVersion: 1, a: 1 });
    expect(migrate({ meta: { formatVersion: 1 } })).toEqual({ meta: { formatVersion: 1 } });
    expect(() => migrate({ formatVersion: 2 })).toThrow(FormatVersionError);
    expect(() => migrate({})).toThrow(/absent/);
    // registre de migrations injecté (simulation d'une v0)
    const out = migrate<{ formatVersion: number; renamed: number }>({ formatVersion: 0, old: 3 }, {
      0: ({ old, ...rest }) => ({ ...rest, renamed: old }),
    });
    expect(out).toEqual({ formatVersion: 1, renamed: 3 });
  });
});
