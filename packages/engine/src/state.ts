/**
 * État de jeu sérialisable (JSON simple) et utilitaires associés.
 *
 * Invariants maintenus par le moteur (ils rendent `stateKey` canonique) :
 * - les listes (`flags`, `ever_had`, `quests.*`, `revealed`, `collections`) sont
 *   triées et sans doublon ;
 * - `vars` ne contient pas de valeur 0 (une variable vaut 0 tant qu'elle n'est
 *   pas affectée : 0 et « absente » sont équivalents) ;
 * - `inventory` ne contient pas de quantité ≤ 0.
 */
import type { EndingType, GameData, Id } from '@scroum/schema';
import { evalCondition } from './conditions';

/** Version du format de l'état sérialisé (sauvegardes). */
export const STATE_VERSION = 1;

/** Dialogue en cours. */
export interface DialogueState {
  /** Id du dialogue. */
  id: Id;
  /** Nœud courant. */
  node: Id;
  /** Changement de scène demandé par un effet de dialogue, appliqué à la fin du dialogue. */
  pending_scene: Id | null;
}

export interface GameState {
  version: number;
  /** Scène courante. */
  scene: Id;
  /** Drapeaux levés (triés). */
  flags: Id[];
  /** Variables non nulles. */
  vars: Record<Id, number>;
  /** Valeur de chaque compteur déclaré. */
  counters: Record<Id, number>;
  /** Objet → quantité (> 0). */
  inventory: Record<Id, number>;
  /** Objets possédés au moins une fois (triés). */
  ever_had: Id[];
  /**
   * Visibilité forcée des hotspots et sorties par `reveal` (true) / `hide` (false) :
   * scène → cible → visible. Absent = état déclaré (`hidden`).
   */
  visibility: Record<Id, Record<Id, boolean>>;
  /** Quêtes débloquées (terminées comprises) et terminées (triées). */
  quests: { unlocked: Id[]; completed: Id[] };
  /** Dialogue en cours, ou null. */
  dialogue: DialogueState | null;
  /** Fin atteinte, ou null tant que la partie continue. */
  ending: { id: Id; type: EndingType } | null;
  /** Personnages dont l'identité est actuellement révélée (`revealed_by` vrai), triés. */
  revealed: Id[];
  /** Collections débloquées (définitivement), triées. */
  collections: Id[];
}

/** Insère `id` dans une liste triée sans doublon. Renvoie true si ajouté. */
export function sortedAdd(list: Id[], id: Id): boolean {
  if (list.includes(id)) return false;
  list.push(id);
  list.sort();
  return true;
}

/** Retire `id` d'une liste. Renvoie true si retiré. */
export function sortedRemove(list: Id[], id: Id): boolean {
  const i = list.indexOf(id);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

/** Borne une valeur de compteur selon `min`/`max` du compteur déclaré. */
export function clampCounter(game: GameData, counter: Id, value: number): number {
  const c = game.counters[counter];
  if (!c) return value;
  let v = value;
  if (c.min !== null && v < c.min) v = c.min;
  if (c.max !== null && v > c.max) v = c.max;
  return v;
}

/** Quantité maximale possédable d'un objet (1 si non `stackable`). */
export function maxQty(game: GameData, item: Id): number {
  return game.items[item]?.stackable === false ? 1 : Infinity;
}

/**
 * État initial : scène de départ (sans exécuter `on_enter`, voir `start`),
 * `game.yaml → initial`, valeurs initiales des compteurs. Les révélations et
 * collections déjà vraies au départ sont prises en compte silencieusement.
 */
export function createInitialState(game: GameData): GameState {
  const init = game.meta.initial;
  const state: GameState = {
    version: STATE_VERSION,
    scene: game.meta.start_scene,
    flags: [...new Set(init.flags)].sort(),
    vars: {},
    counters: {},
    inventory: {},
    ever_had: [],
    visibility: {},
    quests: { unlocked: [...new Set(init.quests)].sort(), completed: [] },
    dialogue: null,
    ending: null,
    revealed: [],
    collections: [],
  };
  for (const [k, v] of Object.entries(init.vars)) if (v !== 0) state.vars[k] = v;
  for (const c of Object.values(game.counters)) state.counters[c.id] = clampCounter(game, c.id, c.initial);
  for (const [item, qty] of Object.entries(init.inventory)) {
    const q = Math.min(qty, maxQty(game, item));
    if (q > 0) {
      state.inventory[item] = q;
      sortedAdd(state.ever_had, item);
    }
  }
  for (const ch of Object.values(game.characters)) {
    if (ch.persona && ch.revealed_by && evalCondition(ch.revealed_by, state)) sortedAdd(state.revealed, ch.id);
  }
  for (const col of game.collections) if (evalCondition(col.condition, state)) sortedAdd(state.collections, col.id);
  return state;
}

/** Copie profonde d'un état (le moteur ne modifie jamais l'état reçu). */
export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

/** Copie d'une valeur JSON avec les clés d'objet triées récursivement. */
export function canonicalize<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => canonicalize(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalize((value as Record<string, unknown>)[k]);
    return out as T;
  }
  return value;
}

/**
 * Clé canonique d'un état (JSON à clés triées) : deux états équivalents ont la
 * même clé. Sert au hachage / à la déduplication (exploration BFS).
 */
export function stateKey(state: GameState): string {
  return JSON.stringify(canonicalize(state));
}
