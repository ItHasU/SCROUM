import { describe, expect, it } from 'vitest';
import { start, step, stateKey, type Action, type EngineEvent, type GameState } from '../src';
import { mini } from './fixtures';
import { makeGame } from './helpers';

const game = mini();

function begin(): GameState {
  return start(game).state;
}
function run(state: GameState, ...actions: Action[]) {
  let s = state;
  let events: EngineEvent[] = [];
  for (const a of actions) {
    const r = step(game, s, a);
    s = r.state;
    events = r.events;
  }
  return { state: s, events };
}
const verb = (hotspot: string, v: string): Action => ({ type: 'verb', hotspot, verb: v });
const of = <T extends EngineEvent['type']>(events: EngineEvent[], type: T) =>
  events.filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type);
const types = (events: EngineEvent[]) => events.map((e) => e.type);
const give = (s: GameState, inv: Record<string, number>): GameState => ({ ...s, inventory: { ...s.inventory, ...inv } });

describe('start', () => {
  it('entre dans la scène de départ et exécute on_enter', () => {
    const r = start(game);
    expect(r.events[0]).toEqual({ type: 'scene_entered', scene: 'a', from: null, title: null, world: 'w', skin: 'plain' });
    expect(of(r.events, 'say')[0]).toMatchObject({ text: 'Entrée A', speaker: 'narrator', name: null, face: null, world: 'w' });
    expect(r.state.vars).toEqual({ entrees: 1 });
  });
});

describe('effets', () => {
  it('set/unset/set var/add/counter/give/take/quêtes/say', () => {
    const s0 = begin();
    const { state, events } = run(s0, verb('bouton', 'push'));
    expect(state.flags).toEqual(['f']);
    expect(state.vars).toEqual({ entrees: 1, v: 3 });
    expect(state.counters.c).toBe(3);
    expect(state.inventory).toEqual({ pomme: 1 });
    expect(state.ever_had).toEqual(['pomme']);
    expect(state.quests).toEqual({ unlocked: ['q1', 'q2'], completed: ['q2'] });
    expect(types(events)).toEqual([
      'flag_changed',
      'var_changed',
      'var_changed',
      'counter_changed',
      'item_gained',
      'item_lost',
      'quest_unlocked',
      'quest_unlocked',
      'quest_completed',
      'say',
      'character_revealed',
      'collection_unlocked',
    ]);
    expect(of(events, 'counter_changed')[0]).toEqual({
      type: 'counter_changed',
      counter: 'c',
      label: 'C',
      hud: true,
      value: 3,
      previous: 0,
      title: 'Haut',
      previous_title: 'Bas',
    });
    expect(of(events, 'item_gained')[0]).toEqual({ type: 'item_gained', item: 'pomme', qty: 2, total: 2 });
    expect(of(events, 'item_lost')[0]).toEqual({ type: 'item_lost', item: 'pomme', qty: 1, total: 1 });
    // la révélation est évaluée au moment de la réplique (f vient d'être levé)
    expect(of(events, 'say')[0]).toMatchObject({ speaker: 'masque', name: 'Vrai Nom', face: 'identity' });
    expect(of(events, 'character_revealed')[0]).toEqual({ type: 'character_revealed', character: 'masque', persona_name: 'Masque', name: 'Vrai Nom' });
  });

  it('variable remise à 0 supprimée, compteur borné, take jamais sous 0, persona de retour', () => {
    const s1 = run(begin(), verb('bouton', 'push')).state;
    const { state, events } = run(s1, verb('bouton', 'raz'));
    expect(state.vars).toEqual({ entrees: 1 });
    expect(state.counters.c).toBe(-10);
    expect(state.inventory).toEqual({});
    expect(state.ever_had).toEqual(['pomme']);
    expect(of(events, 'item_lost')[0]).toMatchObject({ qty: 1, total: 0 });
    expect(of(events, 'character_hidden')).toHaveLength(1);
    expect(state.revealed).toEqual([]);
    // la collection reste débloquée
    expect(state.collections).toEqual(['col_f']);
    expect(of(events, 'collection_unlocked')).toHaveLength(0);
  });

  it('aucun événement pour un effet sans changement', () => {
    const s = run(begin(), verb('bouton', 'raz')).state;
    const { events } = run(s, verb('bouton', 'raz'));
    expect(types(events).filter((t) => t !== 'counter_changed')).toEqual([]);
    expect(of(run(s, verb('bouton', 'raz')).events, 'counter_changed')).toEqual([]);
  });

  it('give_item plafonne un objet non stackable', () => {
    const g = makeGame({
      'scenes/a.yaml': `world: w
hotspots:
  - id: h
    label: H
    rect: [0, 0, 0.1, 0.1]
    actions: { take: [ { give_item: cle, qty: 3 }, { give_item: cle } ] }
`,
      'items.yaml': 'cle: { name: Clé }\n',
    });
    const r = step(g, start(g).state, verb('h', 'take'));
    expect(r.state.inventory).toEqual({ cle: 1 });
    expect(of(r.events, 'item_gained')).toEqual([{ type: 'item_gained', item: 'cle', qty: 1, total: 1 }]);
  });

  it('if / else imbriqués évalués au moment de l’étape', () => {
    expect(of(run(begin(), verb('bouton', 'branche')).events, 'say')[0]!.text).toBe('non');
    expect(of(run(begin(), verb('bouton', 'push'), verb('bouton', 'branche')).events, 'say')[0]!.text).toBe('oui');
    const s = run(begin(), verb('bouton', 'push'), verb('bouton', 'raz')).state;
    expect(of(run({ ...s, vars: { v: 2 } }, verb('bouton', 'branche')).events, 'say')[0]!.text).toBe('v');
  });

  it('reveal / hide (scène du script, autre scène, sortie)', () => {
    const { state, events } = run(begin(), verb('bouton', 'cacher'));
    expect(state.visibility).toEqual({ a: { bouton2: false, secret: true, exit_cache: true } });
    expect(of(events, 'visibility_changed')).toHaveLength(3);
    expect(step(game, state, verb('bouton2', 'look')).events[0]).toMatchObject({ type: 'error', code: 'unknown_hotspot' });
    expect(step(game, state, verb('secret', 'look')).events[0]).toMatchObject({ type: 'say', text: 'S' });
    expect(step(game, state, { type: 'exit', exit: 'exit_cache' }).state.scene).toBe('c');
    expect(run(begin(), verb('bouton', 'revele_b')).state.visibility).toEqual({ b: { porte: true } });
  });

  it('visible_if réévalué en continu', () => {
    expect(step(game, begin(), verb('cond', 'look')).events[0]).toMatchObject({ type: 'error', code: 'unknown_hotspot' });
    expect(run(begin(), verb('bouton', 'push'), verb('cond', 'look')).events[0]).toMatchObject({ text: 'C' });
  });

  it('goto_scene et start_dialogue différés à la fin du script', () => {
    const { state, events } = run(begin(), verb('bouton', 'ordre'));
    expect(types(events).slice(0, 4)).toEqual(['say', 'scene_entered', 'say', 'dialogue_started']);
    expect(of(events, 'say')[0]).toMatchObject({ text: 'encore en A', world: 'w' });
    expect(events[1]).toMatchObject({ scene: 'b', from: 'a', title: 'Scène B', world: 'v' });
    expect(state.scene).toBe('b');
    expect(state.dialogue).toEqual({ id: 'd2', node: 'n', pending_scene: null });
  });

  it('plusieurs goto_scene : le dernier l’emporte', () => {
    expect(run(begin(), verb('bouton', 'double_goto')).state.scene).toBe('b');
  });

  it('end_game interrompt le script et termine la partie', () => {
    const { state, events } = run(begin(), verb('bouton', 'fin'));
    expect(state.ending).toEqual({ id: 'perdu', type: 'game_over' });
    expect(state.flags).not.toContain('jamais');
    expect(events.at(-1)).toEqual({ type: 'game_ended', ending: 'perdu', ending_type: 'game_over', title: 'Perdu', text: 'Raté.', image: null });
    const after = step(game, state, verb('bouton', 'look'));
    expect(after.state).toBe(state);
    expect(after.events).toEqual([{ type: 'error', code: 'game_ended', message: expect.any(String) }]);
  });

  it('fin inconnue ou boucle de scènes → erreur, état inchangé', () => {
    const s = begin();
    const r1 = step(game, s, verb('bouton', 'fin_inconnue'));
    expect(r1.state).toBe(s);
    expect(r1.events).toMatchObject([{ type: 'error', code: 'unknown_ending' }]);
    const r2 = step(game, s, verb('bouton', 'boucle'));
    expect(r2.state).toBe(s);
    expect(r2.events).toMatchObject([{ type: 'error', code: 'loop_limit' }]);
    expect(step(game, s, verb('bouton', 'boucle'), { maxTransitions: 5 }).events[0]).toMatchObject({ message: expect.stringContaining('5') });
  });
});

describe('use', () => {
  it('réaction spécifique ; consumable retiré après', () => {
    const { state, events } = run(give(begin(), { cle: 1 }), { type: 'use', item: 'cle', hotspot: 'machine' });
    expect(types(events)).toEqual(['say', 'flag_changed', 'item_lost']);
    expect(state.inventory).toEqual({});
    expect(state.flags).toContain('ouvert');
  });
  it('réaction spécifique même hors scope', () => {
    const r = run(give(begin(), { onirique: 1 }), { type: 'use', item: 'onirique', hotspot: 'machine' });
    expect(r.events[0]).toMatchObject({ type: 'say', text: 'Ça marche quand même.' });
    expect(r.state.inventory).toEqual({ onirique: 1 });
  });
  it('hors scope sans réaction → refus du monde (dit par player_character)', () => {
    const r = run(give(begin(), { onirique: 1 }), { type: 'use', item: 'onirique', hotspot: 'mur' });
    expect(r.events).toEqual([{ type: 'refuse', reason: 'out_of_scope', item: 'onirique', text: 'Non.', speaker: 'heros', name: 'Héros', face: 'identity', world: 'w' }]);
  });
  it('default', () => {
    expect(run(give(begin(), { pomme: 1 }), { type: 'use', item: 'pomme', hotspot: 'machine' }).events[0]).toMatchObject({ type: 'say', text: 'Pas ça.' });
  });
  it('sans réaction ni default → refus', () => {
    expect(run(give(begin(), { pomme: 1 }), { type: 'use', item: 'pomme', hotspot: 'mur' }).events[0]).toMatchObject({ type: 'refuse', reason: 'no_reaction' });
  });
  it('objet non possédé / hotspot invisible → erreur', () => {
    expect(step(game, begin(), { type: 'use', item: 'cle', hotspot: 'machine' }).events[0]).toMatchObject({ code: 'missing_item' });
    expect(step(game, begin(), { type: 'use', item: 'zzz', hotspot: 'machine' }).events[0]).toMatchObject({ code: 'unknown_item' });
    expect(step(game, give(begin(), { cle: 1 }), { type: 'use', item: 'cle', hotspot: 'secret' }).events[0]).toMatchObject({ code: 'unknown_hotspot' });
  });
  it('dans un autre monde, hors scope → refus de ce monde', () => {
    const s = run(begin(), verb('bouton', 'double_goto')).state;
    expect(step(game, give(s, { cle: 1 }), { type: 'use', item: 'cle', hotspot: 'autel' }).events[0]).toMatchObject({ reason: 'out_of_scope', text: 'Niet.' });
    expect(step(game, give(s, { partout: 1 }), { type: 'use', item: 'partout', hotspot: 'autel' }).events[0]).toMatchObject({ type: 'say', text: 'Rien.' });
  });
});

describe('sorties', () => {
  it('condition fausse → else, on reste', () => {
    const r = step(game, begin(), { type: 'exit', exit: 'exit_b' });
    expect(r.state.scene).toBe('a');
    expect(r.events).toMatchObject([{ type: 'say', text: 'Fermé.' }]);
  });
  it('condition vraie → do puis changement vers `to` (prioritaire), dialogue ouvert après', () => {
    const s = { ...begin(), flags: ['ouvert'] };
    const r = step(game, s, { type: 'exit', exit: 'exit_b' });
    expect(r.state.scene).toBe('b');
    expect(types(r.events)).toEqual(['say', 'scene_entered', 'say', 'dialogue_started', 'say', 'dialogue_node']);
    expect(r.state.dialogue?.id).toBe('d2');
  });
  it('sortie inconnue → erreur', () => {
    expect(step(game, begin(), { type: 'exit', exit: 'exit_zz' }).events[0]).toMatchObject({ code: 'unknown_exit' });
  });
  it('on_enter à chaque entrée', () => {
    const s = run(begin(), verb('bouton', 'double_goto'), { type: 'exit', exit: 'exit_a' }).state;
    expect(s.vars.entrees).toBe(2);
  });
});

describe('dialogues', () => {
  const talk = () => run(begin(), verb('bouton', 'parler'));

  it('ouverture : nœud à next avec répliques → attend continue', () => {
    const { state, events } = talk();
    expect(state.dialogue).toEqual({ id: 'd', node: 'start', pending_scene: null });
    expect(events[0]).toMatchObject({ type: 'dialogue_started', dialogue: 'd', node: 'start', speaker: 'masque', name: 'Masque', face: 'persona', skin: 'plain' });
    expect(events[1]).toMatchObject({ type: 'say', text: 'Bonjour.', dialogue: 'd', node: 'start', name: 'Masque' });
    expect(events[2]).toMatchObject({ type: 'dialogue_node', mode: 'continue', choices: [], free_text: null, can_give: false, can_leave: false });
  });

  it('continue → nœud à choix ; choix filtrés par leur condition', () => {
    const { state, events } = run(talk().state, { type: 'continue' });
    expect(state.dialogue?.node).toBe('menu');
    const node = of(events, 'dialogue_node')[0]!;
    expect(node.mode).toBe('input');
    expect(node.choices.map((c) => c.index)).toEqual([0, 2, 3, 4, 5, 6, 7]);
    expect(node.lines).toMatchObject([{ text: 'Alors ?' }]);
    expect(node).toMatchObject({ can_give: true, can_show: true, can_leave: false, free_text: { intents: ['salut'] } });
  });

  it('actions de scène refusées pendant un dialogue, actions de dialogue refusées hors dialogue', () => {
    const s = talk().state;
    expect(step(game, s, verb('bouton', 'look')).events[0]).toMatchObject({ code: 'in_dialogue' });
    expect(step(game, s, { type: 'choose', choice: 0 }).events[0]).toMatchObject({ code: 'bad_choice' });
    expect(step(game, begin(), { type: 'continue' }).events[0]).toMatchObject({ code: 'not_in_dialogue' });
  });

  const menu = () => run(talk().state, { type: 'continue' }).state;

  it('choix : effets puis next ; nœud final → fin du dialogue', () => {
    const { state, events } = run(menu(), { type: 'choose', choice: 0 });
    expect(state.dialogue).toBeNull();
    expect(of(events, 'say')[0]).toMatchObject({ text: "C'est moi !", name: 'Vrai Nom', face: 'identity' });
    expect(events.at(-3)).toMatchObject({ type: 'dialogue_ended', dialogue: 'd', node: 'revele', reason: 'end' });
    expect(types(events)).toContain('character_revealed');
  });

  it('choix invisible ou hors bornes → erreur', () => {
    expect(step(game, menu(), { type: 'choose', choice: 1 }).events[0]).toMatchObject({ code: 'bad_choice' });
    expect(step(game, menu(), { type: 'choose', choice: 99 }).events[0]).toMatchObject({ code: 'bad_choice' });
    expect(step(game, menu(), { type: 'continue' }).events[0]).toMatchObject({ code: 'cannot_continue' });
  });

  it('choix sans next → fin', () => {
    expect(step(game, menu(), { type: 'choose', choice: 2 }).state.dialogue).toBeNull();
  });

  it('start_dialogue dans un dialogue → saut vers l’autre dialogue (prioritaire sur next)', () => {
    const r = step(game, menu(), { type: 'choose', choice: 3 });
    expect(r.state.dialogue).toEqual({ id: 'd2', node: 'n', pending_scene: null });
  });

  it('goto_scene dans un dialogue → appliqué à la fin du dialogue', () => {
    const s = step(game, menu(), { type: 'choose', choice: 4 }).state;
    expect(s.scene).toBe('a');
    expect(s.dialogue).toEqual({ id: 'd', node: 'menu', pending_scene: 'c' });
    const end = step(game, s, { type: 'choose', choice: 2 });
    expect(end.state.scene).toBe('c');
    expect(types(end.events)).toEqual(['dialogue_ended', 'scene_entered', 'say']);
  });

  it('saut de dialogue : le changement de scène en attente est conservé', () => {
    const s = run(menu(), { type: 'choose', choice: 4 }, { type: 'choose', choice: 3 });
    expect(s.state.dialogue).toEqual({ id: 'd2', node: 'n', pending_scene: 'c' });
    expect(step(game, s.state, { type: 'choose', choice: 0 }).state.scene).toBe('c');
  });

  it('end_game dans un dialogue → dialogue fermé, partie finie', () => {
    const r = step(game, menu(), { type: 'choose', choice: 6 });
    expect(r.state.dialogue).toBeNull();
    expect(r.state.ending).toEqual({ id: 'perdu', type: 'game_over' });
    expect(types(r.events)).toEqual(['dialogue_ended', 'game_ended']);
    expect(r.events[0]).toMatchObject({ reason: 'game_ended' });
  });

  it('nœud sans répliques à next → enchaîné sans attendre', () => {
    const r = step(game, menu(), { type: 'choose', choice: 7 });
    expect(r.state.dialogue?.node).toBe('apres_route');
    expect(r.state.flags).toContain('route_vue');
  });

  it('start_dialogue avec nœud', () => {
    expect(run(begin(), verb('bouton', 'parler_noeud')).state.dialogue?.node).toBe('menu');
  });

  describe('texte libre', () => {
    const intent = (intent: string | null, confidence = 1, item?: string): Action => ({ type: 'intent', intent, confidence, item: item ?? null });
    it('intention de free_text.intents', () => {
      const r = step(game, menu(), intent('salut', 0.9));
      expect(r.state.vars.saluts).toBe(1);
      expect(r.state.dialogue?.node).toBe('menu');
    });
    it('sous le seuil du nœud → fallback', () => {
      expect(step(game, menu(), intent('salut', 0.69)).state.dialogue?.node).toBe('incompris');
    });
    it('seuil global (option) quand le nœud n’en a pas', () => {
      const s = step(game, menu(), { type: 'choose', choice: 5 }).state; // nœud libre
      expect(step(game, s, intent('salut', 0.4)).state.dialogue?.node).toBe('libre'); // fallback par défaut : rester
      expect(step(game, s, intent('salut', 0.5)).state.dialogue?.node).toBe('menu');
      expect(step(game, s, intent('salut', 0.5), { threshold: 0.8 }).state.dialogue?.node).toBe('libre');
    });
    it('intention portée par un choix visible → ce choix', () => {
      expect(step(game, menu(), intent('bye')).state.dialogue).toBeNull();
    });
    it('rien reconnu / intention inconnue → fallback', () => {
      expect(step(game, menu(), intent(null, 0)).state.dialogue?.node).toBe('incompris');
      expect(step(game, menu(), intent('autre')).state.dialogue?.node).toBe('incompris');
    });
    it('fallback par défaut : répliques réaffichées', () => {
      const s = step(game, menu(), { type: 'choose', choice: 5 }).state;
      const r = step(game, s, intent(null, 0));
      expect(types(r.events)).toEqual(['say', 'dialogue_node']);
    });
    it('give_item avec objet possédé → on_give', () => {
      const r = step(game, give(menu(), { pomme: 2 }), intent('give_item', 0.9, 'pomme'));
      expect(r.state.dialogue?.node).toBe('merci');
      expect(r.state.inventory.pomme).toBe(1);
    });
    it('give_item avec objet absent → refus sans effet', () => {
      const s = menu();
      const r = step(game, s, intent('give_item', 0.9, 'pomme'));
      expect(r.events).toMatchObject([{ type: 'refuse', reason: 'missing_item', item: 'pomme' }]);
      expect(stateKey(r.state)).toBe(stateKey(s));
    });
    it('give_item sans objet → fallback ; show_item → on_show', () => {
      expect(step(game, menu(), intent('give_item', 0.9)).state.dialogue?.node).toBe('incompris');
      expect(step(game, give(menu(), { cle: 1 }), intent('show_item', 0.9, 'cle')).state.dialogue?.node).toBe('menu');
    });
    it('intent hors nœud à texte libre → erreur', () => {
      expect(step(game, talk().state, intent('salut')).events[0]).toMatchObject({ code: 'no_free_text' });
    });
  });

  describe('donner / montrer', () => {
    it('réaction spécifique (le don ne retire que via take_item)', () => {
      const r = step(game, give(menu(), { pomme: 3 }), { type: 'give', item: 'pomme' });
      expect(r.state.inventory.pomme).toBe(2);
      expect(r.state.dialogue?.node).toBe('merci');
    });
    it('sans réaction ni default → refus du monde, on reste', () => {
      const s = give(menu(), { cle: 1 });
      const r = step(game, s, { type: 'give', item: 'cle' });
      expect(r.events).toMatchObject([{ type: 'refuse', reason: 'no_give_reaction', text: 'Non.' }]);
      expect(r.state.dialogue?.node).toBe('menu');
    });
    it('montrer : spécifique puis default (transition sans next → fin)', () => {
      expect(step(game, give(menu(), { cle: 1 }), { type: 'show', item: 'cle' }).state.inventory).toEqual({ cle: 1 });
      const r = step(game, give(menu(), { pomme: 1 }), { type: 'show', item: 'pomme' });
      expect(r.state.dialogue).toBeNull();
      expect(of(r.events, 'say')[0]!.text).toBe('Bof.');
    });
    it('default de on_give', () => {
      const s = step(game, menu(), { type: 'choose', choice: 5 }).state;
      expect(step(game, give(s, { cle: 1 }), { type: 'give', item: 'cle' }).state.dialogue?.node).toBe('menu');
      expect(step(game, give(s, { cle: 1 }), { type: 'show', item: 'cle' }).events[0]).toMatchObject({ code: 'cannot_show' });
    });
    it('objet non possédé / nœud sans on_give → erreur', () => {
      expect(step(game, menu(), { type: 'give', item: 'pomme' }).events[0]).toMatchObject({ code: 'missing_item' });
      expect(step(game, give(talk().state, { pomme: 1 }), { type: 'give', item: 'pomme' }).events[0]).toMatchObject({ code: 'cannot_give' });
    });
  });

  it('quitter : seulement sur un nœud à texte libre sans choix visible', () => {
    expect(step(game, menu(), { type: 'leave' }).events[0]).toMatchObject({ code: 'cannot_leave' });
    const s = step(game, menu(), { type: 'choose', choice: 5 }).state;
    const r = step(game, s, { type: 'leave' });
    expect(r.state.dialogue).toBeNull();
    expect(r.events).toMatchObject([{ type: 'dialogue_ended', reason: 'leave' }]);
  });
});

describe('inventaire', () => {
  it('look_item exécute le script de l’objet', () => {
    const r = step(game, give(begin(), { pomme: 1 }), { type: 'look_item', item: 'pomme' });
    expect(r.events[0]).toMatchObject({ type: 'say', text: 'Une pomme.' });
    expect(r.state.flags).toContain('pomme_vue');
    expect(step(game, begin(), { type: 'look_item', item: 'pomme' }).events[0]).toMatchObject({ code: 'missing_item' });
  });
  it('combine (symétrique) : consume, result, effects', () => {
    for (const [a, b] of [['meche', 'huile'], ['huile', 'meche']] as const) {
      const r = step(game, give(begin(), { meche: 1, huile: 1 }), { type: 'combine', item: a, with: b });
      expect(r.state.inventory).toEqual({ meche_huilee: 1 });
      expect(types(r.events)).toEqual(['item_lost', 'item_lost', 'item_gained', 'say']);
    }
  });
  it('combine sans combinaison → refus', () => {
    expect(step(game, give(begin(), { meche: 1, pomme: 1 }), { type: 'combine', item: 'meche', with: 'pomme' }).events[0]).toMatchObject({
      type: 'refuse',
      reason: 'no_combination',
    });
  });
  it('combine d’un objet avec lui-même : il en faut deux', () => {
    expect(step(game, give(begin(), { caillou: 1 }), { type: 'combine', item: 'caillou', with: 'caillou' }).events[0]).toMatchObject({ code: 'missing_item' });
    expect(step(game, give(begin(), { caillou: 3 }), { type: 'combine', item: 'caillou', with: 'caillou' }).state.inventory).toEqual({ caillou: 1, tas: 1 });
  });
  it('look_item / combine pendant un dialogue', () => {
    const s = give(run(begin(), verb('bouton', 'parler')).state, { pomme: 1 });
    const r = step(game, s, { type: 'look_item', item: 'pomme' });
    expect(r.state.dialogue).toEqual(s.dialogue);
  });
});

describe('robustesse', () => {
  it('ne modifie jamais l’état reçu', () => {
    const s = begin();
    const frozen = JSON.stringify(s);
    step(game, s, verb('bouton', 'push'));
    step(game, s, verb('bouton', 'cacher'));
    expect(JSON.stringify(s)).toBe(frozen);
  });
  it('action mal formée → erreur, jamais d’exception', () => {
    const s = begin();
    for (const a of [{ type: 'danse' }, null, {}, { type: 'verb' }, { type: 'intent', intent: 3, confidence: 'x' }] as unknown as Action[]) {
      const r = step(game, s, a);
      expect(r.state).toBe(s);
      expect(r.events[0]!.type).toBe('error');
    }
    expect(step(game, s, verb('bouton', 'toString')).events[0]).toMatchObject({ code: 'unknown_verb' });
  });
  it('déterministe', () => {
    const a = step(game, begin(), verb('bouton', 'push'));
    const b = step(game, begin(), verb('bouton', 'push'));
    expect(a).toEqual(b);
  });
});
