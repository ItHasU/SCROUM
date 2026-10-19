/**
 * Analyse de jouabilité (spec §6.4, jalon M1b).
 *
 * Exploration en largeur (BFS) de l'**état réel du moteur** depuis `start(game)` :
 * transitions par `listActions` (non exhaustif : les actions omises ne changent
 * jamais l'état) + `step`, déduplication par `stateKey`. L'exploration est bornée
 * (nombre d'états, profondeur, temps) ; au-delà, le rapport le dit
 * (`complete: false`) au lieu de conclure.
 *
 * Sur le graphe exploré :
 * - fins atteintes / jamais atteintes, chemin le plus court vers chacune ;
 * - éléments jamais atteints (scènes, dialogues, nœuds, actions de hotspot, objets,
 *   quêtes, collections) ;
 * - **soft-locks** : états non terminaux depuis lesquels aucune fin `win` n'est
 *   atteignable (accessibilité inverse depuis les fins `win`). Les fins
 *   `game_over` sont des terminaux voulus. Seuls les états « frontière » (premier
 *   état bloqué d'un chemin) sont rapportés, regroupés par cause, avec le chemin
 *   d'actions le plus court qui y mène et un diagnostic heuristique.
 *
 * Exploration incomplète : un état non développé est supposé pouvoir gagner. Un
 * état bloqué dont tout le futur a été exploré (sans atteindre d'état non
 * développé) reste un soft-lock **certain**. Les états qui n'atteignent aucune
 * fin `win` dans le graphe exploré mais touchent la limite sont des soft-locks
 * **suspectés** : rapportés (avertissement) seulement quand un diagnostic
 * identifie une cause précise (objet perdu, objet trop tard / manqué).
 */
import { forEachCondition, visitConditions, visitSteps, type Condition, type EndingType, type GameData, type Id } from '@scroum/schema';
import { describeAction, listActions, start, step, stateKey, type Action, type EngineEvent, type EngineOptions, type Expectation, type GameState, type Scenario, type ScenarioStep } from '@scroum/engine';
import type { Analyzer, AnalyzerContext } from './types';

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export interface PlayabilityOptions {
  /** Nombre maximal d'états distincts (défaut 100 000). */
  maxStates?: number;
  /** Profondeur maximale (nombre d'actions depuis le départ, défaut 1 000). */
  maxDepth?: number;
  /** Durée maximale de l'exploration en millisecondes (défaut 30 000). */
  timeLimitMs?: number;
  /** Nombre maximal de groupes de soft-locks diagnostiqués et rapportés (défaut 20). */
  maxSoftlockGroups?: number;
  /** Options du moteur (seuil de texte libre, garde-fou de boucles). */
  engine?: EngineOptions;
  /** Horloge (tests). */
  now?: () => number;
}

export const DEFAULT_PLAYABILITY_LIMITS = { maxStates: 100_000, maxDepth: 1_000, timeLimitMs: 30_000, maxSoftlockGroups: 20 } as const;

export type StopReason = 'max_states' | 'max_depth' | 'time_limit';

/** Chemin rejouable depuis `start(game)`. */
export interface ReplayPath {
  /** Actions du moteur, à rejouer avec `step` (ou par le playtest). */
  actions: Action[];
  /** Mêmes actions en forme courte (`describeAction`, lisible par `parseAction`). */
  steps: string[];
}

export interface ReachedEnding {
  id: Id;
  type: EndingType;
  /** Chemin le plus court vers cette fin. */
  path: ReplayPath;
}

export type SoftlockKind =
  /** Consommable requis deux fois mais obtenable une fois. */
  | 'consumable_reused'
  /** Don irréversible fermant la seule voie. */
  | 'irreversible_give'
  /** Objet obtenable seulement après le point où il est indispensable. */
  | 'item_too_late'
  /** Objet indispensable non obtenu avant un point de non-retour. */
  | 'missed_item'
  /** Scènes devenues inaccessibles, sans objet identifié. */
  | 'point_of_no_return'
  /** Cause non identifiée (le message résume ce que l'action a changé). */
  | 'unknown';

export interface SoftlockDiagnosis {
  kind: SoftlockKind;
  /** Objet en cause, le cas échéant. */
  item: Id | null;
  /** Explication lisible. */
  message: string;
  /** Endroits où l'objet en cause est encore requis. */
  requiredBy: string[];
  /** Scènes devenues inaccessibles. */
  lostScenes: Id[];
}

export interface SoftlockGroup {
  /** Clé de regroupement (cause). */
  cause: string;
  /** Vrai si l'exploration incomplète ne permet pas de conclure. */
  suspected: boolean;
  diagnosis: SoftlockDiagnosis;
  /** Nombre d'états frontière (premiers états bloqués) de ce groupe. */
  count: number;
  /** Action fatale (forme courte) du représentant, et où elle est écrite. */
  action: string;
  file: string;
  location: string;
  /** Scène (et dialogue) où l'action fatale est jouée. */
  scene: Id;
  dialogue: { id: Id; node: Id } | null;
  /** Chemin le plus court jusqu'au premier état bloqué (action fatale comprise). */
  path: ReplayPath;
  /** État bloqué atteint (utilisable par le playtest via `set_state`). */
  state: GameState;
  /** Autres actions fatales regroupées sous la même cause (au plus 5). */
  variants: string[];
}

export interface UnreachedReport {
  scenes: Id[];
  /** Dialogues jamais lancés. */
  dialogues: Id[];
  /** Nœuds jamais atteints (dialogues lancés seulement). */
  nodes: { dialogue: Id; node: Id }[];
  /** Verbes / réactions `use` jamais joués (scènes atteintes seulement). `action` : `look`, `use cle`, `use *`. */
  actions: { scene: Id; hotspot: Id; action: string }[];
  items: Id[];
  /** Quêtes jamais débloquées. */
  quests: Id[];
  /** Quêtes débloquées mais jamais terminées. */
  uncompletedQuests: Id[];
  collections: Id[];
}

export interface PlayabilityReport {
  /** Vrai si tout l'espace d'états a été exploré. */
  complete: boolean;
  stopReason: StopReason | null;
  limits: { maxStates: number; maxDepth: number; timeLimitMs: number };
  stats: {
    states: number;
    /** Transitions qui changent l'état. */
    transitions: number;
    /** États développés (actions essayées). */
    expanded: number;
    /** Profondeur maximale atteinte. */
    depth: number;
    durationMs: number;
  };
  /** Variables / compteurs saturés (abstraction des valeurs monotones). */
  saturated: Saturation[];
  winReachable: boolean;
  /** Chemin le plus court vers une fin `win`. */
  winPath: ReachedEnding | null;
  endings: { reached: ReachedEnding[]; unreached: Id[] };
  unreached: UnreachedReport;
  /** Soft-locks certains puis suspectés, regroupés par cause. */
  softlocks: SoftlockGroup[];
  /** Nombre total d'états frontière bloqués (certains / suspectés), avant regroupement. */
  softlockStates: { certain: number; suspected: number };
  /** Groupes non diagnostiqués faute de place (`maxSoftlockGroups`). */
  omittedGroups: number;
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

class Interner<T> {
  readonly ids = new Map<string, number>();
  readonly values: T[] = [];
  id(key: string, make: () => T): number {
    let i = this.ids.get(key);
    if (i === undefined) {
      i = this.values.length;
      this.ids.set(key, i);
      this.values.push(make());
    }
    return i;
  }
}

/** Liste d'adjacence compacte (CSR). */
function csr(n: number, from: number[], to: number[]): { start: Int32Array; list: Int32Array } {
  const start = new Int32Array(n + 1);
  for (const f of from) start[f + 1]!++;
  for (let i = 0; i < n; i++) start[i + 1]! += start[i]!;
  const fill = start.slice(0, n);
  const list = new Int32Array(from.length);
  for (let e = 0; e < from.length; e++) list[fill[from[e]!]!++] = to[e]!;
  return { start, list };
}

function bfsFrom(seeds: Iterable<number>, g: { start: Int32Array; list: Int32Array }, mark: Uint8Array, cap = Infinity): number[] {
  const out: number[] = [];
  for (const s of seeds) {
    if (mark[s]) continue;
    mark[s] = 1;
    out.push(s);
  }
  for (let i = 0; i < out.length && out.length < cap; i++) {
    const u = out[i]!;
    for (let k = g.start[u]!; k < g.start[u + 1]!; k++) {
      const v = g.list[k]!;
      if (!mark[v]) {
        mark[v] = 1;
        out.push(v);
      }
    }
  }
  return out;
}

const quote = (s: string) => `« ${s} »`;
const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;

/** Endroit du contenu où une condition ou réaction exige un objet. */
interface NeedSite {
  label: string;
  scene: Id | null;
  /** Identité du site, pour l'exclure quand c'est l'action fatale qui l'exerce. */
  key: string;
}

function needSites(game: GameData): Map<Id, NeedSite[]> {
  const out = new Map<Id, NeedSite[]>();
  const add = (item: Id, site: NeedSite) => {
    const l = out.get(item) ?? [];
    if (!l.some((x) => x.key === site.key)) l.push(site);
    out.set(item, l);
  };
  for (const s of Object.values(game.scenes)) {
    for (const h of s.hotspots) {
      for (const item of Object.keys(h.use?.byItem ?? {})) add(item, { label: `${h.id} (${s.id})`, scene: s.id, key: `use:${s.id}:${h.id}` });
    }
  }
  for (const d of Object.values(game.dialogues)) {
    for (const n of Object.values(d.nodes)) {
      for (const [k, r] of [
        ['donner', n.on_give],
        ['montrer', n.on_show],
      ] as const) {
        for (const item of Object.keys(r?.byItem ?? {})) add(item, { label: `${k} à ${d.id} (nœud ${n.id})`, scene: null, key: `${k}:${d.id}:${n.id}` });
      }
    }
  }
  for (const it of Object.values(game.items)) {
    for (const c of it.combine) {
      const label = `combinaison ${it.id} + ${c.with}`;
      add(it.id, { label, scene: null, key: `combine:${[it.id, c.with].sort().join('+')}` });
      add(c.with, { label, scene: null, key: `combine:${[it.id, c.with].sort().join('+')}` });
    }
  }
  visitConditions(game, (cond: Condition, loc) =>
    forEachCondition(cond, (c) => {
      if (c.kind === 'has_item' || c.kind === 'item_qty') {
        const where = loc.scene ? `${loc.scene}` : loc.dialogue ? `dialogue ${loc.dialogue}` : loc.file;
        add(c.item, { label: `condition dans ${where} (${loc.path})`, scene: loc.scene ?? null, key: `cond:${loc.file}:${loc.path}` });
      }
    }),
  );
  return out;
}

/** Clé du site de besoin exercé par une action (pour ne pas le compter comme « encore requis »). */
function exercisedSite(state: GameState, a: Action): string | null {
  switch (a.type) {
    case 'use':
      return `use:${state.scene}:${a.hotspot}`;
    case 'give':
    case 'show':
      return state.dialogue ? `${a.type === 'give' ? 'donner' : 'montrer'}:${state.dialogue.id}:${state.dialogue.node}` : null;
    case 'intent':
      if ((a.intent === 'give_item' || a.intent === 'show_item') && state.dialogue)
        return `${a.intent === 'give_item' ? 'donner' : 'montrer'}:${state.dialogue.id}:${state.dialogue.node}`;
      return null;
    case 'combine':
      return `combine:${[a.item, a.with].sort().join('+')}`;
    default:
      return null;
  }
}

/** Fichier et chemin du contenu où l'action jouée dans `state` est écrite. */
export function locateAction(game: GameData, state: GameState, a: Action): { file: string; location: string } {
  const scene = game.scenes[state.scene];
  if (state.dialogue && !['look_item', 'combine'].includes(a.type)) {
    const d = game.dialogues[state.dialogue.id];
    const n = d?.nodes[state.dialogue.node];
    const base = `nodes.${state.dialogue.node}`;
    const file = d?.source ?? '';
    switch (a.type) {
      case 'choose':
        return { file, location: `${base}.choices[${a.choice}]` };
      case 'give':
      case 'show': {
        const r = a.type === 'give' ? n?.on_give : n?.on_show;
        return { file, location: `${base}.on_${a.type}.${r && Object.hasOwn(r.byItem, a.item) ? a.item : 'default'}` };
      }
      case 'intent':
        if (a.intent === 'give_item' || a.intent === 'show_item') return { file, location: `${base}.on_${a.intent === 'give_item' ? 'give' : 'show'}` };
        return { file, location: a.intent && n?.free_text && Object.hasOwn(n.free_text.intents, a.intent) ? `${base}.free_text.intents.${a.intent}` : `${base}.free_text` };
      default:
        return { file, location: base };
    }
  }
  switch (a.type) {
    case 'verb': {
      const i = scene?.hotspots.findIndex((h) => h.id === a.hotspot) ?? -1;
      return { file: scene?.source ?? '', location: `hotspots[${i}].actions.${a.verb}` };
    }
    case 'use': {
      const i = scene?.hotspots.findIndex((h) => h.id === a.hotspot) ?? -1;
      const h = scene?.hotspots[i];
      return { file: scene?.source ?? '', location: `hotspots[${i}].actions.use.${h?.use && Object.hasOwn(h.use.byItem, a.item) ? a.item : 'default'}` };
    }
    case 'exit':
      return { file: scene?.source ?? '', location: `exits[${scene?.exits.findIndex((e) => e.id === a.exit) ?? -1}]` };
    case 'look_item':
      return { file: game.items[a.item]?.source ?? 'items.yaml', location: `${a.item}.look` };
    case 'combine':
      return { file: game.items[a.item]?.source ?? 'items.yaml', location: `${a.item}.combine` };
    default:
      return { file: scene?.source ?? '', location: '' };
  }
}

// ---------------------------------------------------------------------------
// Abstraction des valeurs monotones
// ---------------------------------------------------------------------------

/** Abstraction d'une composante de l'état pendant l'exploration. */
export interface Saturation {
  kind: 'var' | 'counter' | 'item' | 'flag' | 'ever_had';
  id: Id;
  /**
   * `up` : valeurs > `cap` ramenées à `cap` ; `down` : valeurs < `cap` ramenées à `cap` ;
   * `drop` : jamais lue par une condition, ramenée à sa valeur initiale (`cap`).
   */
  dir: 'up' | 'down' | 'drop';
  cap: number;
}

/**
 * Abstraction de l'état pour garder un espace fini et réduit, **exacte pour
 * l'atteignabilité** (les valeurs n'influencent le jeu qu'à travers les
 * conditions) — sauf la borne des objets empilables, approximation large :
 *
 * - drapeau, variable ou compteur jamais lu par une condition : ignoré (valeur initiale) ;
 * - « déjà possédé » (`ever_had`) d'un objet jamais testé par `ever_had_item` : ignoré ;
 * - variable ou compteur **monotone** (tous les `add` de même signe) : saturé
 *   au-delà de la dernière borne distinguée par les comparaisons du contenu
 *   (ex. humeur incrémentée à chaque compliment, testée par `gte: 2` → 0, 1, 2+) ;
 * - quantité d'un objet empilable : bornée à (plus grande constante + plus grand retrait).
 *
 * Les chemins sont toujours rejoués sur l'état réel.
 */
export function saturations(game: GameData): Saturation[] {
  type Info = { up: number[]; down: number[]; read: boolean; pos: boolean; neg: boolean };
  const info = new Map<string, Info>();
  const get = (k: string) => {
    let i = info.get(k);
    if (!i) info.set(k, (i = { up: [], down: [], read: false, pos: false, neg: false }));
    return i;
  };
  // Bornes : pour une valeur croissante, toutes les valeurs ≥ up sont indiscernables ;
  // pour une valeur décroissante, toutes les valeurs ≤ down.
  const cmp = (k: string, c: { eq?: number; gte?: number; lte?: number; gt?: number; lt?: number }) => {
    const i = get(k);
    i.read = true;
    if (c.gte !== undefined) i.up.push(c.gte), i.down.push(c.gte - 1);
    if (c.gt !== undefined) i.up.push(c.gt + 1), i.down.push(c.gt);
    if (c.lte !== undefined) i.up.push(c.lte + 1), i.down.push(c.lte);
    if (c.lt !== undefined) i.up.push(c.lt), i.down.push(c.lt - 1);
    if (c.eq !== undefined) i.up.push(c.eq + 1), i.down.push(c.eq - 1);
  };
  const readFlags = new Set<Id>();
  const readEver = new Set<Id>();
  const qtyConsts = new Map<Id, number[]>();
  visitConditions(game, (cond) =>
    forEachCondition(cond, (c) => {
      if (c.kind === 'var') cmp(`var:${c.var}`, c.cmp);
      if (c.kind === 'counter') cmp(`counter:${c.counter}`, c.cmp);
      if (c.kind === 'flag') readFlags.add(c.flag);
      if (c.kind === 'ever_had_item') readEver.add(c.item);
      if (c.kind === 'item_qty') {
        const l = qtyConsts.get(c.item) ?? [];
        for (const v of Object.values(c.cmp)) if (typeof v === 'number') l.push(v + 1);
        qtyConsts.set(c.item, l);
      }
    }),
  );
  const setFlags = new Set<Id>(game.meta.initial.flags);
  const takes = new Map<Id, number[]>();
  const gives = new Map<Id, number[]>();
  const push = (m: Map<Id, number[]>, k: Id, v: number) => m.set(k, [...(m.get(k) ?? []), v]);
  visitSteps(game, (st) => {
    if (st.kind === 'set_flag' || st.kind === 'unset_flag') setFlags.add(st.flag);
    if (st.kind === 'set_var') get(`var:${st.var}`);
    if (st.kind === 'counter_set') get(`counter:${st.counter}`);
    if (st.kind === 'add_var' || st.kind === 'counter_add') {
      const i = get(st.kind === 'add_var' ? `var:${st.var}` : `counter:${st.counter}`);
      if (st.amount > 0) i.pos = true;
      if (st.amount < 0) i.neg = true;
    }
    if (st.kind === 'take_item') push(takes, st.item, st.qty);
    if (st.kind === 'give_item') push(gives, st.item, st.qty);
  });
  for (const v of Object.keys(game.meta.initial.vars)) get(`var:${v}`);
  for (const c of Object.values(game.counters)) get(`counter:${c.id}`);

  const out: Saturation[] = [];
  for (const f of setFlags) if (!readFlags.has(f)) out.push({ kind: 'flag', id: f, dir: 'drop', cap: 0 });
  for (const i of Object.keys(game.items)) if (!readEver.has(i)) out.push({ kind: 'ever_had', id: i, dir: 'drop', cap: 0 });
  for (const [k, i] of info) {
    const [kind, id] = k.split(/:(.*)/s) as ['var' | 'counter', Id];
    if (!i.read) {
      const initial = kind === 'var' ? (game.meta.initial.vars[id] ?? 0) : (game.counters[id]?.initial ?? 0);
      out.push({ kind, id, dir: 'drop', cap: initial });
    } else if (i.pos && !i.neg) out.push({ kind, id, dir: 'up', cap: Math.max(...i.up) });
    else if (i.neg && !i.pos) out.push({ kind, id, dir: 'down', cap: Math.min(...i.down) });
  }
  for (const item of Object.values(game.items)) {
    if (!item.stackable) continue;
    const consts = [1, ...(qtyConsts.get(item.id) ?? []), ...(gives.get(item.id) ?? []), game.meta.initial.inventory[item.id] ?? 0];
    const outs = [1, ...(takes.get(item.id) ?? []), ...(item.combine.some((c) => c.with === item.id) ? [2] : [])];
    out.push({ kind: 'item', id: item.id, dir: 'up', cap: Math.max(...consts) + Math.max(...outs) });
  }
  return out.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}

/** Applique l'abstraction à un état (modifié en place). */
function saturate(state: GameState, sats: Saturation[]): void {
  for (const s of sats) {
    if (s.kind === 'flag' || s.kind === 'ever_had') {
      const list = s.kind === 'flag' ? state.flags : state.ever_had;
      const i = list.indexOf(s.id);
      if (i >= 0) list.splice(i, 1);
      continue;
    }
    const rec = s.kind === 'var' ? state.vars : s.kind === 'counter' ? state.counters : state.inventory;
    const v = rec[s.id] ?? 0;
    let next = v;
    if (s.dir === 'drop') next = s.cap;
    else if (s.dir === 'up' && v > s.cap) next = s.cap;
    else if (s.dir === 'down' && v < s.cap) next = s.cap;
    if (next === v) continue;
    if (next === 0 && s.kind !== 'counter') delete rec[s.id];
    else rec[s.id] = next;
  }
}

// ---------------------------------------------------------------------------
// Clé d'exploration
// ---------------------------------------------------------------------------

const STATE_FIELDS = new Set(['version', 'scene', 'flags', 'vars', 'counters', 'inventory', 'ever_had', 'visibility', 'quests', 'dialogue', 'ending', 'revealed', 'collections']);
const entries = (o: Record<string, unknown>) => Object.keys(o).sort().map((k) => [k, o[k]]);

/**
 * Clé de déduplication : mêmes classes d'équivalence que `stateKey` (listes de
 * l'état triées par le moteur, clés d'objets triées ici), environ trois fois
 * plus rapide. Repli sur `stateKey` si l'état porte des champs inconnus.
 */
export function exploreKey(s: GameState): string {
  const keys = Object.keys(s);
  if (keys.length !== STATE_FIELDS.size || !keys.every((k) => STATE_FIELDS.has(k))) return stateKey(s);
  return JSON.stringify([
    s.version,
    s.scene,
    s.flags,
    entries(s.vars),
    entries(s.counters),
    entries(s.inventory),
    s.ever_had,
    Object.keys(s.visibility)
      .sort()
      .map((k) => [k, entries(s.visibility[k]!)]),
    s.quests.unlocked,
    s.quests.completed,
    s.dialogue && [s.dialogue.id, s.dialogue.node, s.dialogue.pending_scene],
    s.ending && [s.ending.id, s.ending.type],
    s.revealed,
    s.collections,
  ]);
}

// ---------------------------------------------------------------------------
// Exploration
// ---------------------------------------------------------------------------

/** Explore l'espace d'états et produit le rapport de jouabilité. Ne lève pas d'exception sur un contenu valide. */
export function analyzePlayability(game: GameData, options: PlayabilityOptions = {}): PlayabilityReport {
  const maxStates = options.maxStates ?? DEFAULT_PLAYABILITY_LIMITS.maxStates;
  const maxDepth = options.maxDepth ?? DEFAULT_PLAYABILITY_LIMITS.maxDepth;
  const timeLimitMs = options.timeLimitMs ?? DEFAULT_PLAYABILITY_LIMITS.timeLimitMs;
  const maxGroups = options.maxSoftlockGroups ?? DEFAULT_PLAYABILITY_LIMITS.maxSoftlockGroups;
  const eng = options.engine ?? {};
  const now = options.now ?? (() => performance.now());
  const t0 = now();

  // --- tables par état
  const index = new Map<string, number>();
  const parent: number[] = [];
  const parentAct: number[] = [];
  const depth: number[] = [];
  const sceneOf: number[] = [];
  const invOf: number[] = [];
  const everOf: number[] = [];
  /** 0 = en cours, 1 = fin win, 2 = fin game_over. */
  const term: number[] = [];
  const endingOf = new Map<number, Id>();
  const expanded: boolean[] = [];
  const eFrom: number[] = [];
  const eTo: number[] = [];
  const eAct: number[] = [];

  const scenes = new Interner<Id>();
  const invs = new Interner<Record<Id, number>>();
  const evers = new Interner<Id[]>();
  const acts = new Interner<Action>();

  // --- couverture
  const seenScenes = new Set<Id>();
  const seenDialogues = new Set<Id>();
  const seenNodes = new Set<string>();
  const seenActions = new Set<string>();
  const seenItems = new Set<Id>();
  const seenQuests = new Set<Id>();
  const doneQuests = new Set<Id>();
  const seenCollections = new Set<Id>();
  const firstEnding = new Map<Id, number>();

  const noteEvents = (events: EngineEvent[]) => {
    for (const e of events) {
      switch (e.type) {
        case 'scene_entered':
          seenScenes.add(e.scene);
          break;
        case 'dialogue_started':
          seenDialogues.add(e.dialogue);
          seenNodes.add(`${e.dialogue}/${e.node}`);
          break;
        case 'dialogue_node':
        case 'dialogue_ended':
          seenNodes.add(`${e.dialogue}/${e.node}`);
          break;
        case 'say':
          if (e.dialogue && e.node) seenNodes.add(`${e.dialogue}/${e.node}`);
          break;
        case 'item_gained':
          seenItems.add(e.item);
          break;
      }
    }
  };

  const queue: (GameState | null)[] = [];
  const add = (s: GameState, from: number, act: number): number => {
    const key = exploreKey(s);
    const known = index.get(key);
    if (known !== undefined) return known;
    const id = parent.length;
    index.set(key, id);
    parent.push(from);
    parentAct.push(act);
    depth.push(from < 0 ? 0 : depth[from]! + 1);
    sceneOf.push(scenes.id(s.scene, () => s.scene));
    invOf.push(invs.id(JSON.stringify(Object.entries(s.inventory).sort()), () => ({ ...s.inventory })));
    everOf.push(evers.id(s.ever_had.join('\n'), () => [...s.ever_had]));
    expanded.push(false);
    seenScenes.add(s.scene);
    if (s.dialogue) {
      seenDialogues.add(s.dialogue.id);
      seenNodes.add(`${s.dialogue.id}/${s.dialogue.node}`);
    }
    for (const i of s.ever_had) seenItems.add(i);
    for (const i of Object.keys(s.inventory)) seenItems.add(i);
    for (const q of s.quests.unlocked) seenQuests.add(q);
    for (const q of s.quests.completed) doneQuests.add(q);
    for (const c of s.collections) seenCollections.add(c);
    if (s.ending) {
      term.push(s.ending.type === 'win' ? 1 : 2);
      endingOf.set(id, s.ending.id);
      if (!firstEnding.has(s.ending.id)) firstEnding.set(s.ending.id, id);
      queue.push(null);
    } else {
      term.push(0);
      queue.push(s);
    }
    return id;
  };

  const sats = saturations(game);
  const first = start(game, eng);
  saturate(first.state, sats);
  noteEvents(first.events);
  add(first.state, -1, -1);

  let stopReason: StopReason | null = null;
  let transitions = 0;
  let expandedCount = 0;
  let maxDepthSeen = 0;
  for (let head = 0; head < queue.length; head++) {
    const s = queue[head];
    if (!s) continue;
    if (depth[head]! >= maxDepth) {
      stopReason ??= 'max_depth';
      continue;
    }
    if ((expandedCount & 63) === 0 && now() - t0 > timeLimitMs) {
      stopReason = 'time_limit';
      break;
    }
    const actions = listActions(game, s);
    if (parent.length + actions.length > maxStates) {
      stopReason = 'max_states';
      break;
    }
    for (const a of actions) {
      const r = step(game, s, a, eng);
      if (r.state === s) continue; // erreur : état inchangé
      saturate(r.state, sats);
      noteEvents(r.events);
      if (a.type === 'verb') seenActions.add(`${s.scene}/${a.hotspot}/${a.verb}`);
      else if (a.type === 'use') seenActions.add(`${s.scene}/${a.hotspot}/use ${a.item}`);
      const actId = acts.id(`${a.type}|${describeAction(a)}`, () => a);
      const to = add(r.state, head, actId);
      if (to === head) continue;
      eFrom.push(head);
      eTo.push(to);
      eAct.push(actId);
      transitions++;
      if (depth[to]! > maxDepthSeen) maxDepthSeen = depth[to]!;
    }
    expanded[head] = true;
    queue[head] = null;
    expandedCount++;
  }
  queue.length = 0;
  const n = parent.length;
  const complete = stopReason === null;

  // --- chemins
  const pathTo = (id: number, extra: number | null = null): ReplayPath => {
    const ids: number[] = [];
    if (extra !== null) ids.push(extra);
    for (let u = id; parent[u]! >= 0; u = parent[u]!) ids.push(parentAct[u]!);
    ids.reverse();
    const actions = ids.map((i) => acts.values[i]!);
    return { actions, steps: actions.map(describeAction) };
  };
  const replay = (path: ReplayPath): GameState => {
    let s = start(game, eng).state;
    for (const a of path.actions) s = step(game, s, a, eng).state;
    return s;
  };

  // --- fins
  const reached: ReachedEnding[] = [...firstEnding.entries()]
    .map(([id, sid]) => ({ id, type: term[sid] === 1 ? ('win' as const) : ('game_over' as const), path: pathTo(sid) }))
    .sort((a, b) => a.path.actions.length - b.path.actions.length || a.id.localeCompare(b.id));
  const winPath = reached.find((e) => e.type === 'win') ?? null;

  // --- accessibilité inverse
  const fwd = csr(n, eFrom, eTo);
  const rev = csr(n, eTo, eFrom);
  const canWin = new Uint8Array(n);
  const wins: number[] = [];
  const open: number[] = [];
  for (let i = 0; i < n; i++) {
    if (term[i] === 1) wins.push(i);
    else if (term[i] === 0 && !expanded[i]) open.push(i);
  }
  bfsFrom(wins, rev, canWin);
  const mayWin = new Uint8Array(n);
  bfsFrom([...wins, ...open], rev, mayWin);

  // --- états frontière : bloqué avec un prédécesseur non bloqué (le moins profond)
  type Cand = { v: number; u: number; act: number };
  const certain = new Map<number, Cand>();
  const suspected = new Map<number, Cand>();
  const anyWin = wins.length > 0;
  for (let e = 0; e < eFrom.length; e++) {
    const u = eFrom[e]!;
    const v = eTo[e]!;
    if (term[v] !== 0) continue;
    let target: Map<number, Cand> | null = null;
    if (!mayWin[v] && mayWin[u] && anyWin) target = certain;
    else if (!complete && anyWin && mayWin[v] && !canWin[v] && canWin[u]) target = suspected;
    if (!target) continue;
    const prev = target.get(v);
    if (!prev || depth[u]! < depth[prev.u]!) target.set(v, { v, u, act: eAct[e]! });
  }
  // Aucune fin win atteignable (exploration complète) : pas de frontière au sens
  // strict (le départ est déjà bloqué) ; on cherche les pertes d'objet qui
  // expliquent l'absence de fin (consommable réutilisé, don irréversible).
  const lossOnly = complete && !anyWin;
  if (lossOnly) {
    for (let e = 0; e < eFrom.length; e++) {
      const u = eFrom[e]!;
      const v = eTo[e]!;
      if (term[v] !== 0 || invOf[u] === invOf[v]) continue;
      const iu = invs.values[invOf[u]!]!;
      const iv = invs.values[invOf[v]!]!;
      if (!Object.entries(iu).some(([it, q]) => (iv[it] ?? 0) < q)) continue;
      const prev = certain.get(v);
      if (!prev || depth[u]! < depth[prev.u]!) certain.set(v, { v, u, act: eAct[e]! });
    }
  }

  // --- regroupement préalable (scène, action), diagnostic du représentant le moins profond
  const sites = needSites(game);
  const scenesOfClosure = (from: number, cap: number) => {
    const mark = new Uint8Array(n);
    const ids = bfsFrom([from], fwd, mark, cap);
    return { ids, scenes: new Set(ids.map((i) => scenes.values[sceneOf[i]!]!)) };
  };
  const CLOSURE_CAP = 200_000;

  const diagnose = (c: Cand, p: GameState, s: GameState, a: Action): SoftlockDiagnosis => {
    const desc = describeAction(a);
    const closS = scenesOfClosure(c.v, CLOSURE_CAP);
    const maxInv = new Map<Id, number>();
    const everInClosure = new Set<Id>();
    for (const i of closS.ids) {
      for (const [it, q] of Object.entries(invs.values[invOf[i]!]!)) maxInv.set(it, Math.max(maxInv.get(it) ?? 0, q));
      for (const it of evers.values[everOf[i]!]!) everInClosure.add(it);
      for (const it of Object.keys(invs.values[invOf[i]!]!)) everInClosure.add(it);
    }
    const used = exercisedSite(p, a);
    // A. objet perdu, plus jamais récupéré, encore requis ailleurs
    for (const [item, had] of Object.entries(p.inventory)) {
      const now = s.inventory[item] ?? 0;
      if (now >= had) continue;
      if ((maxInv.get(item) ?? 0) > now) continue;
      const others = (sites.get(item) ?? []).filter((x) => x.key !== used);
      if (others.length === 0) continue;
      const requiredBy = others.map((x) => x.label);
      const isGive = a.type === 'give' || (a.type === 'intent' && a.intent === 'give_item');
      if (isGive) {
        return {
          kind: 'irreversible_give',
          item,
          requiredBy,
          lostScenes: [],
          message: `don irréversible : donner ${quote(item)} (${desc}) ferme la seule voie — l'objet n'est plus obtenable et reste requis par : ${requiredBy.join(', ')}`,
        };
      }
      return {
        kind: 'consumable_reused',
        item,
        requiredBy,
        lostScenes: [],
        message: `consommable requis deux fois mais obtenable une fois : ${quote(item)} est consommé par ${quote(desc)} et ne peut plus être obtenu, alors qu'il reste requis par : ${requiredBy.join(', ')}`,
      };
    }
    // B. point de non-retour : scènes accessibles avant, plus après
    if (lossOnly) return { kind: 'unknown', item: null, requiredBy: [], lostScenes: [], message: '' };
    const before = scenesOfClosure(c.u, CLOSURE_CAP).scenes;
    const lostScenes = [...before].filter((x) => !closS.scenes.has(x)).sort();
    if (lostScenes.length > 0) {
      const lost = new Set(lostScenes);
      for (const [item, list] of sites) {
        if ((s.inventory[item] ?? 0) > 0) continue;
        const inLost = list.filter((x) => x.scene !== null && lost.has(x.scene));
        if (inLost.length === 0) continue;
        const requiredBy = inLost.map((x) => x.label);
        if (everInClosure.has(item) && !s.ever_had.includes(item)) {
          return {
            kind: 'item_too_late',
            item,
            requiredBy,
            lostScenes,
            message: `objet obtenable trop tard : ${quote(item)} ne s'obtient qu'après ${quote(desc)}, alors qu'il est indispensable à ${requiredBy.join(', ')}, désormais inaccessible`,
          };
        }
        if (!everInClosure.has(item) && game.items[item]) {
          return {
            kind: 'missed_item',
            item,
            requiredBy,
            lostScenes,
            message: `objet manqué : ${quote(item)}, indispensable à ${requiredBy.join(', ')}, n'est pas en main au point de non-retour ${quote(desc)} et ne peut plus être obtenu`,
          };
        }
      }
      return {
        kind: 'point_of_no_return',
        item: null,
        requiredBy: [],
        lostScenes,
        message: `point de non-retour : après ${quote(desc)}, ${lostScenes.length > 1 ? 'les scènes' : 'la scène'} ${lostScenes.map(quote).join(', ')} ${lostScenes.length > 1 ? 'ne sont' : "n'est"} plus accessible${lostScenes.length > 1 ? 's' : ''} et aucune fin « win » n'est atteignable`,
      };
    }
    // C. cause non identifiée : résumé des changements
    const changes: string[] = [];
    const fl = s.flags.filter((f) => !p.flags.includes(f)).map((f) => `+${f}`);
    const fu = p.flags.filter((f) => !s.flags.includes(f)).map((f) => `-${f}`);
    if (fl.length || fu.length) changes.push(`drapeaux ${[...fl, ...fu].join(' ')}`);
    const items = [...new Set([...Object.keys(p.inventory), ...Object.keys(s.inventory)])]
      .filter((i) => (p.inventory[i] ?? 0) !== (s.inventory[i] ?? 0))
      .map((i) => `${i} ${p.inventory[i] ?? 0}→${s.inventory[i] ?? 0}`);
    if (items.length) changes.push(`objets ${items.join(', ')}`);
    const vars = [...new Set([...Object.keys(p.vars), ...Object.keys(s.vars), ...Object.keys(s.counters)])]
      .filter((v) => (p.vars[v] ?? p.counters[v] ?? 0) !== (s.vars[v] ?? s.counters[v] ?? 0))
      .map((v) => `${v} ${p.vars[v] ?? p.counters[v] ?? 0}→${s.vars[v] ?? s.counters[v] ?? 0}`);
    if (vars.length) changes.push(`valeurs ${vars.join(', ')}`);
    if (p.scene !== s.scene) changes.push(`scène ${p.scene}→${s.scene}`);
    if ((p.dialogue?.id ?? null) !== (s.dialogue?.id ?? null)) changes.push(`dialogue ${p.dialogue?.id ?? '—'}→${s.dialogue?.id ?? '—'}`);
    return {
      kind: 'unknown',
      item: null,
      requiredBy: [],
      lostScenes: [],
      message: `après ${quote(desc)}, aucune fin « win » n'est plus atteignable${changes.length ? ` (changements : ${changes.join(' ; ')})` : ''}`,
    };
  };

  const groupsOf = (cands: Map<number, Cand>, isSuspected: boolean, budget: number): { groups: SoftlockGroup[]; omitted: number } => {
    const pre = new Map<string, { rep: Cand; count: number }>();
    for (const c of cands.values()) {
      const k = `${sceneOf[c.u]}|${c.act}|${invOf[c.u]}`;
      const g = pre.get(k);
      if (!g) pre.set(k, { rep: c, count: 1 });
      else {
        g.count++;
        if (depth[c.u]! < depth[g.rep.u]!) g.rep = c;
      }
    }
    const sorted = [...pre.values()].sort((a, b) => depth[a.rep.u]! - depth[b.rep.u]! || a.rep.v - b.rep.v);
    const merged = new Map<string, SoftlockGroup>();
    let omitted = 0;
    let diagnosed = 0;
    // Le diagnostic coûte deux parcours du graphe : au plus 3 × budget représentants.
    for (const g of sorted) {
      if (diagnosed >= budget * 3) {
        omitted++;
        continue;
      }
      diagnosed++;
      const prefix = pathTo(g.rep.u);
      const p = replay(prefix);
      const a = acts.values[g.rep.act]!;
      const s = step(game, p, a, eng).state;
      const diag = diagnose(g.rep, p, s, a);
      if ((isSuspected || lossOnly) && !['consumable_reused', 'irreversible_give', 'item_too_late', 'missed_item'].includes(diag.kind)) continue;
      const desc = describeAction(a);
      const cause =
        diag.kind === 'point_of_no_return'
          ? `${diag.kind}|${diag.lostScenes.join(',')}`
          : diag.kind === 'unknown'
            ? `${diag.kind}|${p.scene}|${p.dialogue?.id ?? ''}|${desc}`
            : `${diag.kind}|${diag.item}`;
      const existing = merged.get(cause);
      if (existing) {
        existing.count += g.count;
        if (existing.action !== desc && !existing.variants.includes(desc) && existing.variants.length < 5) existing.variants.push(desc);
        continue;
      }
      if (merged.size >= budget) {
        omitted++;
        continue;
      }
      const path: ReplayPath = { actions: [...prefix.actions, a], steps: [...prefix.steps, desc] };
      merged.set(cause, {
        cause,
        suspected: isSuspected,
        diagnosis: diag,
        count: g.count,
        action: desc,
        ...locateAction(game, p, a),
        scene: p.scene,
        dialogue: p.dialogue ? { id: p.dialogue.id, node: p.dialogue.node } : null,
        path,
        state: s,
        variants: [],
      });
    }
    return { groups: [...merged.values()], omitted };
  };

  const c1 = groupsOf(certain, false, maxGroups);
  const c2 = groupsOf(suspected, true, Math.max(0, maxGroups - c1.groups.length));

  // --- éléments jamais atteints
  const unreached: UnreachedReport = {
    scenes: Object.keys(game.scenes).filter((s) => !seenScenes.has(s)),
    dialogues: Object.keys(game.dialogues).filter((d) => !seenDialogues.has(d)),
    nodes: [],
    actions: [],
    items: Object.keys(game.items).filter((i) => !seenItems.has(i)),
    quests: Object.keys(game.quests).filter((q) => !seenQuests.has(q)),
    uncompletedQuests: Object.keys(game.quests).filter((q) => seenQuests.has(q) && !doneQuests.has(q)),
    collections: game.collections.map((c) => c.id).filter((c) => !seenCollections.has(c)),
  };
  for (const d of Object.values(game.dialogues)) {
    if (!seenDialogues.has(d.id)) continue;
    for (const id of Object.keys(d.nodes)) if (!seenNodes.has(`${d.id}/${id}`)) unreached.nodes.push({ dialogue: d.id, node: id });
  }
  for (const s of Object.values(game.scenes)) {
    if (!seenScenes.has(s.id)) continue;
    for (const h of s.hotspots) {
      for (const verb of Object.keys(h.actions)) if (!seenActions.has(`${s.id}/${h.id}/${verb}`)) unreached.actions.push({ scene: s.id, hotspot: h.id, action: verb });
      if (!h.use) continue;
      for (const item of Object.keys(h.use.byItem)) if (!seenActions.has(`${s.id}/${h.id}/use ${item}`)) unreached.actions.push({ scene: s.id, hotspot: h.id, action: `use ${item}` });
      if (h.use.default) {
        const any = [...seenActions].some((k) => k.startsWith(`${s.id}/${h.id}/use `) && !Object.hasOwn(h.use!.byItem, k.slice(`${s.id}/${h.id}/use `.length)));
        if (!any) unreached.actions.push({ scene: s.id, hotspot: h.id, action: 'use *' });
      }
    }
  }

  return {
    complete,
    stopReason,
    limits: { maxStates, maxDepth, timeLimitMs },
    stats: { states: n, transitions, expanded: expandedCount, depth: maxDepthSeen, durationMs: Math.round(now() - t0) },
    saturated: sats,
    winReachable: winPath !== null,
    winPath,
    endings: { reached, unreached: Object.keys(game.endings).filter((e) => !firstEnding.has(e)) },
    unreached,
    softlocks: [...c1.groups, ...c2.groups],
    softlockStates: { certain: certain.size, suspected: suspected.size },
    omittedGroups: c1.omitted + c2.omitted,
  };
}

// ---------------------------------------------------------------------------
// Export des chemins (scénarios, playtest)
// ---------------------------------------------------------------------------

/**
 * Scénario `runScenario` rejouant un chemin depuis `start(game)` ; les actions
 * sont passées sous forme d'objets `Action` (pas d'ambiguïté d'analyse). La
 * dernière étape vérifie l'attente `expect` si fournie.
 */
export function pathToScenario(name: string, path: ReplayPath, expect?: Expectation, options?: EngineOptions): Scenario {
  const steps: ScenarioStep[] = path.actions.map((a, i) => (i === path.actions.length - 1 && expect ? { do: a, expect } : { do: a }));
  return { name, ...(options && Object.keys(options).length ? { options } : {}), steps };
}

export interface ExportedPath extends ReplayPath {
  name: string;
  /** Pour `runScenario(game, scenario)`. */
  scenario: Scenario;
}

/** Fichier JSON des chemins (`scroum validate --path-out`). */
export interface PlayabilityPathsFile {
  game: { title: string; version: string };
  complete: boolean;
  /** Chemin le plus court vers une fin `win` (null si aucune). */
  win: (ExportedPath & { ending: Id }) | null;
  endings: (ExportedPath & { ending: Id; type: EndingType })[];
  softlocks: (ExportedPath & { cause: string; kind: SoftlockKind; message: string; suspected: boolean; state: GameState })[];
}

/** Chemins rejouables d'un rapport, au format de `--path-out`. */
export function exportPaths(game: GameData, report: PlayabilityReport, options?: EngineOptions): PlayabilityPathsFile {
  const ending = (e: ReachedEnding) => {
    const name = `fin ${e.id} (${e.type})`;
    return { name, ending: e.id, type: e.type, ...e.path, scenario: pathToScenario(name, e.path, { ending: e.id, endingType: e.type }, options) };
  };
  return {
    game: { title: game.meta.title, version: game.meta.version },
    complete: report.complete,
    win: report.winPath ? (({ type: _t, ...rest }) => rest)(ending(report.winPath)) : null,
    endings: report.endings.reached.map(ending),
    softlocks: report.softlocks.map((g) => {
      const name = `${g.suspected ? 'soft-lock suspecté' : 'soft-lock'} : ${g.diagnosis.kind}${g.diagnosis.item ? ` (${g.diagnosis.item})` : ''}`;
      const expect = { scene: g.state.scene, dialogue: g.state.dialogue?.id ?? null, ending: null };
      return {
        name,
        cause: g.cause,
        kind: g.diagnosis.kind,
        message: g.diagnosis.message,
        suspected: g.suspected,
        ...g.path,
        state: g.state,
        scenario: pathToScenario(name, g.path, expect, options),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Analyseur
// ---------------------------------------------------------------------------

function shortPath(p: ReplayPath, max = 10): string {
  if (p.steps.length === 0) return '(dès le départ)';
  if (p.steps.length <= max) return p.steps.join(' → ');
  return `… → ${p.steps.slice(-max).join(' → ')}`;
}

/** Traduit le rapport en problèmes de validation. */
export function reportPlayability(game: GameData, r: PlayabilityReport, ctx: AnalyzerContext): void {
  const inc = r.complete ? '' : ' (exploration incomplète : peut-être atteignable au-delà des bornes)';
  if (!r.complete) {
    const why = { max_states: `limite de ${r.limits.maxStates} états`, max_depth: `profondeur ${r.limits.maxDepth}`, time_limit: `limite de ${r.limits.timeLimitMs} ms` }[r.stopReason!];
    ctx.report(
      'warning',
      'exploration_incomplete',
      'game.yaml',
      '',
      `exploration incomplète (${why} atteinte : ${r.stats.states} états, profondeur ${r.stats.depth}) — l'analyse ne conclut pas au-delà`,
    );
  }
  const hasWin = Object.values(game.endings).some((e) => e.type === 'win');
  if (!r.winReachable) {
    if (r.complete) {
      ctx.report(
        'error',
        'win_unreachable',
        'game.yaml',
        'endings',
        hasWin
          ? `aucune fin « win » n'est atteignable depuis le départ (${r.stats.states} états explorés)`
          : `aucune fin « win » déclarée : le jeu ne peut pas être gagné`,
      );
    } else {
      ctx.report('warning', 'win_not_found', 'game.yaml', 'endings', `aucune fin « win » trouvée dans les bornes de l'exploration`);
    }
  }
  for (const id of r.endings.unreached) ctx.report('warning', 'unreached_ending', 'game.yaml', `endings.${id}`, `fin ${quote(id)} jamais atteinte${inc}`);
  for (const id of r.unreached.scenes) ctx.report('warning', 'unreached_scene', game.scenes[id]!.source, '', `scène ${quote(id)} jamais atteinte${inc}`);
  for (const id of r.unreached.dialogues) ctx.report('warning', 'unreached_dialogue', game.dialogues[id]!.source, '', `dialogue ${quote(id)} jamais lancé${inc}`);
  for (const { dialogue, node } of r.unreached.nodes)
    ctx.report('warning', 'unreached_node', game.dialogues[dialogue]!.source, `nodes.${node}`, `nœud ${quote(node)} jamais atteint${inc}`);
  for (const { scene, hotspot, action } of r.unreached.actions) {
    const s = game.scenes[scene]!;
    const i = s.hotspots.findIndex((h) => h.id === hotspot);
    const path = action.startsWith('use ') ? `hotspots[${i}].actions.use.${action === 'use *' ? 'default' : action.slice(4)}` : `hotspots[${i}].actions.${action}`;
    ctx.report('warning', 'unreached_action', s.source, path, `action ${quote(action)} du hotspot ${quote(hotspot)} jamais jouée${inc}`);
  }
  for (const id of r.unreached.items) ctx.report('warning', 'unreached_item', game.items[id]!.source, id, `objet ${quote(id)} jamais obtenu${inc}`);
  for (const id of r.unreached.quests) ctx.report('warning', 'unreached_quest', game.quests[id]?.source ?? 'bible/quests.yaml', id, `quête ${quote(id)} jamais débloquée${inc}`);
  for (const id of r.unreached.uncompletedQuests)
    ctx.report('warning', 'uncompleted_quest', game.quests[id]?.source ?? 'bible/quests.yaml', id, `quête ${quote(id)} jamais terminée${inc}`);
  for (const id of r.unreached.collections) {
    const i = game.collections.findIndex((c) => c.id === id);
    ctx.report('warning', 'unreached_collection', 'game.yaml', `collections[${i}]`, `collection ${quote(id)} jamais débloquée${inc}`);
  }
  for (const g of r.softlocks) {
    const others = g.count > 1 ? ` (+${plural(g.count - 1, 'autre état bloqué')} de même cause)` : '';
    ctx.report(
      g.suspected ? 'warning' : 'error',
      g.suspected ? 'softlock_suspected' : 'softlock',
      g.file,
      g.location,
      `${g.suspected ? 'soft-lock suspecté' : r.winReachable ? 'soft-lock' : 'blocage (cause probable de l’absence de fin « win »)'} — ${g.diagnosis.message}${others}. Chemin (${plural(g.path.steps.length, 'action')}) : ${shortPath(g.path)}`,
    );
  }
  if (r.omittedGroups > 0)
    ctx.report('warning', 'softlock_truncated', 'game.yaml', '', `${plural(r.omittedGroups, 'autre groupe')} de soft-locks non détaillé${r.omittedGroups > 1 ? 's' : ''} (maxSoftlockGroups)`);
}

/**
 * Crée l'analyseur de jouabilité (niveau `playability`). `onReport` reçoit le
 * rapport complet (chemins compris) ; les problèmes sont signalés via `ctx`.
 */
export function createPlayabilityAnalyzer(options: PlayabilityOptions = {}, onReport?: (r: PlayabilityReport) => void): Analyzer {
  return {
    name: 'playability',
    level: 'playability',
    run(game, ctx) {
      const r = analyzePlayability(game, options);
      onReport?.(r);
      reportPlayability(game, r, ctx);
    },
  };
}

/** Analyseur de jouabilité avec les bornes par défaut. */
export const playabilityAnalyzer: Analyzer = createPlayabilityAnalyzer();
