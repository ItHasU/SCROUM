/**
 * Parcours et utilitaires sur la forme canonique, partagés par le moteur,
 * la validation et l'éditeur.
 */
import type {
  Character,
  CharacterFace,
  Combination,
  Condition,
  Counter,
  GameData,
  Id,
  Script,
  Step,
} from './types';

/** Où se trouve un script / une condition dans le contenu. */
export interface Location {
  /** Fichier source relatif à `content/`. */
  file: string;
  /** Chemin canonique dans l'entité (ex. `hotspots[0].actions.look.script`). */
  path: string;
  /** Scène qui contient l'élément, le cas échéant. */
  scene?: Id;
  /** Dialogue (et nœud) qui contient l'élément, le cas échéant. */
  dialogue?: Id;
  node?: Id;
  /** Objet qui contient l'élément (look, combine), le cas échéant. */
  item?: Id;
}

/** Appelle `fn` sur chaque étape (y compris dans les branches `if`), en profondeur d'abord. */
export function forEachStep(script: Script, fn: (step: Step, path: string) => void, path = ''): void {
  script.forEach((step, i) => {
    const p = `${path}[${i}]`;
    fn(step, p);
    if (step.kind === 'if') {
      forEachStep(step.then, fn, `${p}.then`);
      forEachStep(step.else, fn, `${p}.else`);
    }
  });
}

/** Appelle `fn` sur chaque condition et sous-condition. */
export function forEachCondition(cond: Condition, fn: (c: Condition) => void): void {
  fn(cond);
  if (cond.kind === 'all' || cond.kind === 'any') cond.conditions.forEach((c) => forEachCondition(c, fn));
  else if (cond.kind === 'not') forEachCondition(cond.condition, fn);
}

const join = (a: string, b: string) => (a ? `${a}.${b}` : b);

/** Appelle `fn` sur chaque script de premier niveau du jeu, avec sa localisation. */
export function visitScripts(game: GameData, fn: (script: Script, loc: Location) => void): void {
  for (const scene of Object.values(game.scenes)) {
    const base = { file: scene.source, scene: scene.id };
    fn(scene.on_enter, { ...base, path: 'on_enter' });
    scene.hotspots.forEach((h, i) => {
      const hp = `hotspots[${i}]`;
      for (const [verb, a] of Object.entries(h.actions)) fn(a.script, { ...base, path: `${hp}.actions.${verb}` });
      if (h.use) {
        for (const [item, s] of Object.entries(h.use.byItem)) fn(s, { ...base, path: `${hp}.actions.use.${item}` });
        if (h.use.default) fn(h.use.default, { ...base, path: `${hp}.actions.use.default` });
      }
    });
    scene.exits.forEach((e, i) => {
      fn(e.script, { ...base, path: `exits[${i}].do` });
      fn(e.else, { ...base, path: `exits[${i}].else` });
    });
  }
  for (const d of Object.values(game.dialogues)) {
    for (const n of Object.values(d.nodes)) {
      const base = { file: d.source, dialogue: d.id, node: n.id };
      const np = `nodes.${n.id}`;
      fn(n.effects, { ...base, path: `${np}.effects` });
      n.choices.forEach((c, i) => fn(c.effects, { ...base, path: `${np}.choices[${i}].effects` }));
      if (n.free_text) {
        for (const [intent, t] of Object.entries(n.free_text.intents)) fn(t.effects, { ...base, path: `${np}.free_text.intents.${intent}` });
        fn(n.free_text.fallback.effects, { ...base, path: `${np}.free_text.fallback` });
      }
      for (const key of ['on_give', 'on_show'] as const) {
        const r = n[key];
        if (!r) continue;
        for (const [item, t] of Object.entries(r.byItem)) fn(t.effects, { ...base, path: `${np}.${key}.${item}` });
        if (r.default) fn(r.default.effects, { ...base, path: `${np}.${key}.default` });
      }
    }
  }
  for (const item of Object.values(game.items)) {
    const base = { file: item.source, item: item.id };
    fn(item.look, { ...base, path: join(item.id, 'look') });
    for (const [verb, a] of Object.entries(item.actions)) fn(a.script, { ...base, path: join(item.id, `actions.${verb}`) });
    item.combine.forEach((c, i) => fn(c.effects, { ...base, path: join(item.id, `combine[${i}].effects`) }));
  }
}

/** Appelle `fn` sur chaque étape de chaque script du jeu. */
export function visitSteps(game: GameData, fn: (step: Step, loc: Location) => void): void {
  visitScripts(game, (script, loc) => forEachStep(script, (step, p) => fn(step, { ...loc, path: loc.path + p })));
}

/**
 * Appelle `fn` sur chaque condition racine du jeu : conditions des `if` de
 * scripts, `visible_if`, conditions de sortie, conditions de choix,
 * `revealed_by`, conditions de collection.
 */
export function visitConditions(game: GameData, fn: (cond: Condition, loc: Location) => void): void {
  visitSteps(game, (step, loc) => {
    if (step.kind === 'if') fn(step.condition, loc);
  });
  for (const scene of Object.values(game.scenes)) {
    const base = { file: scene.source, scene: scene.id };
    scene.hotspots.forEach((h, i) => h.visible_if && fn(h.visible_if, { ...base, path: `hotspots[${i}].visible_if` }));
    scene.exits.forEach((e, i) => {
      if (e.visible_if) fn(e.visible_if, { ...base, path: `exits[${i}].visible_if` });
      if (e.condition) fn(e.condition, { ...base, path: `exits[${i}].if` });
    });
  }
  for (const d of Object.values(game.dialogues)) {
    for (const n of Object.values(d.nodes)) {
      const loc = { file: d.source, dialogue: d.id, node: n.id };
      n.choices.forEach((c, i) => c.condition && fn(c.condition, { ...loc, path: `nodes.${n.id}.choices[${i}].if` }));
      n.next_if.forEach((b, i) => fn(b.condition, { ...loc, path: `nodes.${n.id}.next[${i}].if` }));
      n.lines.forEach((l, i) => l.condition && fn(l.condition, { ...loc, path: `nodes.${n.id}.lines[${i}].if` }));
    }
  }
  for (const c of Object.values(game.characters)) {
    if (c.revealed_by) fn(c.revealed_by, { file: c.source, path: 'revealed_by' });
  }
  for (const [id, e] of Object.entries(game.endings)) e.text_if.forEach((t, i) => fn(t.condition, { file: 'game.yaml', path: `endings.${id}.text[${i}].if` }));
  game.collections.forEach((c, i) => fn(c.condition, { file: 'game.yaml', path: `collections[${i}].if` }));
}

/**
 * Cherche la combinaison de deux objets, déclarée sur l'un ou l'autre
 * (les combinaisons sont symétriques). Renvoie aussi l'objet qui la déclare.
 */
export function findCombination(game: GameData, a: Id, b: Id): { owner: Id; combination: Combination } | null {
  for (const [owner, other] of [
    [a, b],
    [b, a],
  ] as const) {
    const c = game.items[owner]?.combine.find((x) => x.with === other);
    if (c) return { owner, combination: c };
  }
  return null;
}

/** Face à afficher pour un personnage selon que son identité est révélée. */
export function displayFace(character: Character, revealed: boolean): CharacterFace {
  return character.persona && !revealed ? character.persona : character.identity;
}

/** Titre courant d'un compteur pour une valeur (null si aucun seuil atteint). */
export function counterTitle(counter: Counter, value: number): string | null {
  let label: string | null = null;
  for (const t of counter.titles) if (value >= t.min) label = t.label;
  return label;
}

/** Tous les objets qu'un script peut donner (`give_item`), branches comprises. */
export function itemsGivenBy(script: Script): Id[] {
  const out: Id[] = [];
  forEachStep(script, (s) => {
    if (s.kind === 'give_item') out.push(s.item);
  });
  return out;
}
