/**
 * Harnais de scénarios : une suite d'actions (forme courte textuelle ou objet
 * `Action`, ou texte libre classé par un `LlmBackend`) et des attentes sur
 * l'état et les événements. Format JSON simple (écrivable aussi en YAML).
 *
 * ```ts
 * const r = await runScenario(game, {
 *   name: 'ramasser la mèche',
 *   steps: [
 *     'take caisse',
 *     { do: 'talk loic', expect: { dialogue: 'loic', node: 'accueil' } },
 *     'continue',
 *     { text: 'Bonjour !', expect: { node: 'salut' } },
 *     { do: 'choose "Au revoir"', expect: { dialogue: null } },
 *   ],
 * });
 * expect(r.failures).toEqual([]);
 * ```
 *
 * Formes courtes (voir `parseAction`) :
 * `<verbe> <hotspot>` · `use <objet> on <hotspot>` · `exit <sortie>` ·
 * `choose <index>` · `choose "<libellé>"` · `continue` · `leave` ·
 * `give <objet>` · `show <objet>` · `combine <objet> <objet>` · `inspect <objet>` ·
 * `intent <id|-> [objet] [confiance]`.
 */
import type { EndingType, GameData, Id } from '@scroum/schema';
import { describeAction, listActions } from './actions';
import { start, step } from './engine';
import { buildClassifyRequest, intentAction, KeywordBackend, normalizeText, type LlmBackend } from './llm';
import { currentNode, visibleChoices } from './queries';
import type { GameState } from './state';
import type { Action, EngineEvent, EngineOptions, ErrorCode } from './types';

/** Motif d'événement : sous-ensemble des champs (comparaison partielle récursive). */
export type EventPattern = { type: EngineEvent['type'] } & Record<string, unknown>;

export interface Expectation {
  scene?: Id;
  /** Dialogue en cours (null = aucun). */
  dialogue?: Id | null;
  node?: Id | null;
  /** Drapeaux qui doivent être levés / baissés. */
  flags?: Id[];
  notFlags?: Id[];
  vars?: Record<Id, number>;
  counters?: Record<Id, number>;
  /** Quantités attendues (0 = absent) ; les objets non cités sont ignorés. */
  inventory?: Record<Id, number>;
  /** Inventaire exact. */
  inventoryExact?: Record<Id, number>;
  everHad?: Id[];
  quests?: { unlocked?: Id[]; completed?: Id[]; locked?: Id[] };
  collections?: Id[];
  revealed?: Id[];
  /** Fin atteinte (null = partie en cours). */
  ending?: Id | null;
  endingType?: EndingType;
  /** Chaque motif doit correspondre à au moins un événement de l'étape. */
  events?: EventPattern[];
  /** Aucun événement de l'étape ne doit correspondre à ces motifs. */
  noEvents?: EventPattern[];
  /** Erreur attendue (code, ou true pour n'importe laquelle). Sans cela, toute erreur est un échec. */
  error?: ErrorCode | true;
  /** Actions jouables après l'étape. */
  actions?: { include?: (string | Action)[]; exclude?: (string | Action)[]; none?: boolean };
}

export type ScenarioStep =
  | string
  | {
      /** Action (forme courte ou objet). */
      do?: string | Action;
      /** Texte libre, classé par le backend puis joué comme action `intent`. */
      text?: string;
      expect?: Expectation;
      note?: string;
    };

export interface Scenario {
  name: string;
  description?: string;
  options?: EngineOptions;
  /** Attentes juste après `start` (événements de démarrage compris). */
  start?: Expectation;
  steps: ScenarioStep[];
}

export interface ScenarioFailure {
  /** Index de l'étape (-1 = démarrage). */
  step: number;
  action: string;
  message: string;
}

export interface ScenarioResult {
  name: string;
  ok: boolean;
  failures: ScenarioFailure[];
  /** État final. */
  state: GameState;
  /** Trace : action jouée et événements produits, par étape. */
  trace: { action: string; events: EngineEvent[] }[];
}

export interface RunScenarioOptions {
  /** Backend pour les étapes `text` (défaut : `KeywordBackend`). */
  backend?: LlmBackend;
  /** Arrêter au premier échec (défaut true). */
  stopOnFailure?: boolean;
  /** État de départ au lieu de `start(game)` (les attentes `start` portent alors sur cet état, sans événements). */
  initialState?: GameState;
}

/** Analyse une action en forme courte, dans le contexte de l'état (pour `choose "<libellé>"`). */
export function parseAction(game: GameData, state: GameState, input: string): Action {
  const src = input.trim();
  const quoted = /^choose\s+"(.*)"$/.exec(src);
  if (quoted) {
    const node = currentNode(game, state);
    if (!node) throw new Error(`« ${src} » : aucun dialogue en cours`);
    const wanted = normalizeText(quoted[1]!);
    const choices = visibleChoices(node, state);
    const found = choices.find((c) => normalizeText(c.label) === wanted) ?? choices.find((c) => normalizeText(c.label).includes(wanted));
    if (!found) throw new Error(`« ${src} » : aucun choix visible correspondant (${choices.map((c) => c.label).join(' | ') || 'aucun'})`);
    return { type: 'choose', choice: found.index };
  }
  const t = src.split(/\s+/);
  const [head, a, b, c] = t;
  const need = (n: number) => {
    if (t.length !== n) throw new Error(`« ${src} » : forme invalide`);
  };
  switch (head) {
    case 'use':
      if (t.length !== 4 || b !== 'on') throw new Error(`« ${src} » : attendu « use <objet> on <hotspot> »`);
      return { type: 'use', item: a!, hotspot: c! };
    case 'exit':
      need(2);
      return { type: 'exit', exit: a! };
    case 'choose':
      need(2);
      if (!/^\d+$/.test(a!)) throw new Error(`« ${src} » : index ou "libellé" attendu`);
      return { type: 'choose', choice: Number(a) };
    case 'continue':
      need(1);
      return { type: 'continue' };
    case 'leave':
      need(1);
      return { type: 'leave' };
    case 'give':
    case 'show':
      need(2);
      return { type: head, item: a! };
    case 'combine':
      need(3);
      return { type: 'combine', item: a!, with: b! };
    case 'inspect':
      need(2);
      return { type: 'look_item', item: a! };
    case 'intent': {
      if (t.length < 2 || t.length > 4) throw new Error(`« ${src} » : attendu « intent <id|-> [objet] [confiance] »`);
      let item: Id | null = null;
      let confidence = 1;
      for (const x of t.slice(2)) {
        if (/^\d*\.?\d+$/.test(x)) confidence = Number(x);
        else item = x;
      }
      const intent = a === '-' ? null : a!;
      return { type: 'intent', intent, confidence: intent === null && t.length === 2 ? 0 : confidence, item };
    }
    default:
      need(2);
      return { type: 'verb', verb: head!, hotspot: a! };
  }
}

/** Comparaison partielle récursive (objets : clés attendues seulement ; tableaux : même longueur). */
export function matches(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected);
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => matches(actual[i], e));
  if (!actual || typeof actual !== 'object') return false;
  return Object.entries(expected).every(([k, v]) => matches((actual as Record<string, unknown>)[k], v));
}

const show = (v: unknown) => JSON.stringify(v);

/** Vérifie une attente ; renvoie la liste des écarts. */
export function checkExpectation(game: GameData, state: GameState, events: EngineEvent[], exp: Expectation = {}): string[] {
  const out: string[] = [];
  const eq = (label: string, actual: unknown, expected: unknown) => {
    if (!matches(actual, expected)) out.push(`${label} : attendu ${show(expected)}, obtenu ${show(actual)}`);
  };
  if (exp.scene !== undefined) eq('scène', state.scene, exp.scene);
  if (exp.dialogue !== undefined) eq('dialogue', state.dialogue?.id ?? null, exp.dialogue);
  if (exp.node !== undefined) eq('nœud', state.dialogue?.node ?? null, exp.node);
  for (const f of exp.flags ?? []) if (!state.flags.includes(f)) out.push(`drapeau « ${f} » non levé`);
  for (const f of exp.notFlags ?? []) if (state.flags.includes(f)) out.push(`drapeau « ${f} » levé`);
  for (const [k, v] of Object.entries(exp.vars ?? {})) eq(`variable ${k}`, state.vars[k] ?? 0, v);
  for (const [k, v] of Object.entries(exp.counters ?? {})) eq(`compteur ${k}`, state.counters[k] ?? 0, v);
  for (const [k, v] of Object.entries(exp.inventory ?? {})) eq(`objet ${k}`, state.inventory[k] ?? 0, v);
  if (exp.inventoryExact) {
    const a = Object.fromEntries(Object.entries(state.inventory).sort());
    const e = Object.fromEntries(Object.entries(exp.inventoryExact).filter(([, v]) => v > 0).sort());
    if (show(a) !== show(e)) out.push(`inventaire : attendu ${show(e)}, obtenu ${show(a)}`);
  }
  for (const i of exp.everHad ?? []) if (!state.ever_had.includes(i)) out.push(`objet « ${i} » jamais possédé`);
  for (const q of exp.quests?.unlocked ?? []) if (!state.quests.unlocked.includes(q)) out.push(`quête « ${q} » non débloquée`);
  for (const q of exp.quests?.completed ?? []) if (!state.quests.completed.includes(q)) out.push(`quête « ${q} » non terminée`);
  for (const q of exp.quests?.locked ?? []) if (state.quests.unlocked.includes(q)) out.push(`quête « ${q} » débloquée`);
  for (const c of exp.collections ?? []) if (!state.collections.includes(c)) out.push(`collection « ${c} » non débloquée`);
  for (const c of exp.revealed ?? []) if (!state.revealed.includes(c)) out.push(`personnage « ${c} » non révélé`);
  if (exp.ending !== undefined) eq('fin', state.ending?.id ?? null, exp.ending);
  if (exp.endingType !== undefined) eq('type de fin', state.ending?.type ?? null, exp.endingType);
  for (const p of exp.events ?? []) if (!events.some((e) => matches(e, p))) out.push(`événement absent : ${show(p)} (types émis : ${events.map((e) => e.type).join(', ') || 'aucun'})`);
  for (const p of exp.noEvents ?? []) if (events.some((e) => matches(e, p))) out.push(`événement inattendu : ${show(p)}`);
  const errors = events.filter((e): e is Extract<EngineEvent, { type: 'error' }> => e.type === 'error');
  if (exp.error === undefined) for (const e of errors) out.push(`erreur ${e.code} : ${e.message}`);
  else if (!errors.some((e) => exp.error === true || e.code === exp.error)) out.push(`erreur attendue ${exp.error === true ? '' : exp.error}, aucune obtenue`);
  if (exp.actions) {
    const acts = listActions(game, state);
    const keys = acts.map(describeAction);
    const key = (a: string | Action) => (typeof a === 'string' ? describeAction(parseAction(game, state, a)) : describeAction(a));
    for (const a of exp.actions.include ?? []) if (!keys.includes(key(a))) out.push(`action absente : ${key(a)}`);
    for (const a of exp.actions.exclude ?? []) if (keys.includes(key(a))) out.push(`action présente : ${key(a)}`);
    if (exp.actions.none && acts.length) out.push(`aucune action attendue, obtenu : ${keys.join(', ')}`);
  }
  return out;
}

/** Joue un scénario et vérifie ses attentes. N'échoue jamais par exception : les problèmes sont dans `failures`. */
export async function runScenario(game: GameData, scenario: Scenario, options: RunScenarioOptions = {}): Promise<ScenarioResult> {
  const backend = options.backend ?? new KeywordBackend();
  const stop = options.stopOnFailure ?? true;
  const failures: ScenarioFailure[] = [];
  const trace: ScenarioResult['trace'] = [];
  const init = options.initialState ? { state: options.initialState, events: [] as EngineEvent[] } : start(game, scenario.options);
  let state = init.state;
  trace.push({ action: 'start', events: init.events });
  for (const m of checkExpectation(game, state, init.events, scenario.start)) failures.push({ step: -1, action: 'start', message: m });

  for (let i = 0; i < scenario.steps.length && !(stop && failures.length); i++) {
    const raw = scenario.steps[i]!;
    const st = typeof raw === 'string' ? { do: raw } : raw;
    let label = st.note ?? '';
    try {
      let action: Action | null = null;
      if (st.text !== undefined) {
        const res = await backend.classify(buildClassifyRequest(game, state, st.text));
        action = intentAction(res);
        label = `« ${st.text} » → ${describeAction(action)}`;
      } else if (st.do !== undefined) {
        action = typeof st.do === 'string' ? parseAction(game, state, st.do) : st.do;
        label = describeAction(action);
      }
      let events: EngineEvent[] = trace.at(-1)!.events;
      if (action) {
        const r = step(game, state, action, scenario.options);
        state = r.state;
        events = r.events;
        trace.push({ action: label, events });
      } else label = label || 'vérification';
      for (const m of checkExpectation(game, state, events, st.expect)) failures.push({ step: i, action: label, message: m });
    } catch (e) {
      failures.push({ step: i, action: label || String(st.do ?? st.text), message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { name: scenario.name, ok: failures.length === 0, failures, state, trace };
}

/** Rapport lisible des échecs d'un scénario. */
export function formatScenarioResult(r: ScenarioResult): string {
  if (r.ok) return `✔ ${r.name}`;
  return [`✘ ${r.name}`, ...r.failures.map((f) => `  étape ${f.step} (${f.action}) : ${f.message}`)].join('\n');
}
