/**
 * Normalisation des formes abrégées (conditions, scripts, transitions,
 * réactions indexées par objet) vers la forme canonique de `types.ts`.
 *
 * Ces fonctions sont écrites à la main (plutôt qu'en unions zod) pour produire
 * des messages d'erreur précis et en français. Elles ne lèvent jamais
 * d'exception : les problèmes sont accumulés dans `ctx.issues` avec leur
 * chemin relatif à la valeur brute, et une valeur de repli est renvoyée.
 */
import type {
  Comparison,
  Condition,
  Ending,
  EndingType,
  ItemReactions,
  Script,
  Step,
  Transition,
  VerbAction,
} from './types';
import { NARRATOR } from './types';

export type PathSeg = string | number;
export type Path = PathSeg[];

export interface NormIssue {
  path: Path;
  message: string;
}

/** Contexte de normalisation : problèmes rencontrés et fins déclarées en ligne. */
export interface NormCtx {
  issues: NormIssue[];
  /** Fins déclarées en ligne via `end_game: { ending, type, text }`, remontées dans `GameData.endings`. */
  inlineEndings: { ending: Ending; path: Path }[];
}

export function createNormCtx(): NormCtx {
  return { issues: [], inlineEndings: [] };
}

/** Expression régulière des identifiants. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9_]*$/;

const COMPARATORS = ['eq', 'gte', 'lte', 'gt', 'lt'] as const;

function fail(ctx: NormCtx, path: Path, message: string): void {
  ctx.issues.push({ path, message });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describe(v: unknown): string {
  if (v === null || v === undefined) return 'rien';
  if (Array.isArray(v)) return 'une liste';
  if (typeof v === 'object') return 'un objet';
  return `${typeof v === 'string' ? 'le texte' : typeof v === 'number' ? 'le nombre' : 'la valeur'} ${JSON.stringify(v)}`;
}

/** Lit un identifiant ; renvoie '' (et signale) si invalide. */
export function readId(v: unknown, path: Path, ctx: NormCtx, what = 'identifiant'): string {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) v = String(v);
  if (typeof v !== 'string') {
    fail(ctx, path, `${what} attendu (texte), reçu ${describe(v)}`);
    return '';
  }
  if (!ID_PATTERN.test(v)) {
    fail(ctx, path, `${what} invalide « ${v} » : minuscules, chiffres et _ uniquement (ex. cle_rouillee)`);
    return v;
  }
  return v;
}

function readText(v: unknown, path: Path, ctx: NormCtx, what = 'texte'): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v !== 'string') {
    fail(ctx, path, `${what} attendu, reçu ${describe(v)}`);
    return '';
  }
  return v;
}

function readNumber(v: unknown, path: Path, ctx: NormCtx, what = 'nombre'): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail(ctx, path, `${what} attendu, reçu ${describe(v)}`);
    return 0;
  }
  return v;
}

function readPositiveInt(v: unknown, path: Path, ctx: NormCtx): number {
  if (v === undefined || v === null) return 1;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    fail(ctx, path, `quantité attendue (entier ≥ 1), reçu ${describe(v)}`);
    return 1;
  }
  return v;
}

function checkKeys(obj: Record<string, unknown>, allowed: readonly string[], path: Path, ctx: NormCtx, what: string): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      fail(ctx, [...path, k], `clé « ${k} » inattendue dans ${what} (clés possibles : ${allowed.join(', ')})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

const CONDITION_KEYS = ['flag', 'var', 'counter', 'has_item', 'item_qty', 'ever_had_item', 'quest', 'all', 'any', 'not'] as const;

function readComparison(obj: Record<string, unknown>, path: Path, ctx: NormCtx, what: string): Comparison {
  const cmp: Comparison = {};
  for (const op of COMPARATORS) {
    if (obj[op] !== undefined) cmp[op] = readNumber(obj[op], [...path, op], ctx);
  }
  if (Object.keys(cmp).length === 0) {
    fail(ctx, path, `${what} : au moins un comparateur attendu (${COMPARATORS.join(', ')})`);
  }
  return cmp;
}

/**
 * Normalise une condition. Formes acceptées :
 * - `"nom_flag"` (texte seul) ≡ `{ flag: nom_flag }` ;
 * - `[c1, c2]` (liste) ≡ `{ all: [c1, c2] }` ;
 * - `{ flag }`, `{ var, gte|lte|eq|gt|lt }`, `{ counter, … }`, `{ has_item }`,
 *   `{ item_qty, … }`, `{ ever_had_item }`, `{ quest, state? }`, `{ all: [] }`,
 *   `{ any: [] }`, `{ not: c }`.
 */
export function normalizeCondition(raw: unknown, path: Path, ctx: NormCtx): Condition {
  const fallback: Condition = { kind: 'all', conditions: [] };
  if (typeof raw === 'string') return { kind: 'flag', flag: readId(raw, path, ctx, 'nom de drapeau') };
  if (Array.isArray(raw)) {
    return { kind: 'all', conditions: raw.map((c, i) => normalizeCondition(c, [...path, i], ctx)) };
  }
  if (!isRecord(raw)) {
    fail(ctx, path, `condition attendue, reçu ${describe(raw)}`);
    return fallback;
  }
  const mains = CONDITION_KEYS.filter((k) => raw[k] !== undefined);
  if (mains.length !== 1) {
    fail(
      ctx,
      path,
      mains.length === 0
        ? `condition non reconnue (clés possibles : ${CONDITION_KEYS.join(', ')})`
        : `une condition ne peut avoir qu'un type (trouvé : ${mains.join(', ')}) ; utiliser all/any pour les combiner`,
    );
    return fallback;
  }
  const key = mains[0]!;
  const p = [...path, key];
  switch (key) {
    case 'flag':
      checkKeys(raw, ['flag'], path, ctx, 'la condition flag');
      return { kind: 'flag', flag: readId(raw.flag, p, ctx, 'nom de drapeau') };
    case 'has_item':
      checkKeys(raw, ['has_item'], path, ctx, 'la condition has_item');
      return { kind: 'has_item', item: readId(raw.has_item, p, ctx, "id d'objet") };
    case 'ever_had_item':
      checkKeys(raw, ['ever_had_item'], path, ctx, 'la condition ever_had_item');
      return { kind: 'ever_had_item', item: readId(raw.ever_had_item, p, ctx, "id d'objet") };
    case 'var':
      checkKeys(raw, ['var', ...COMPARATORS], path, ctx, 'la condition var');
      return { kind: 'var', var: readId(raw.var, p, ctx, 'nom de variable'), cmp: readComparison(raw, path, ctx, 'var') };
    case 'counter':
      checkKeys(raw, ['counter', ...COMPARATORS], path, ctx, 'la condition counter');
      return {
        kind: 'counter',
        counter: readId(raw.counter, p, ctx, 'id de compteur'),
        cmp: readComparison(raw, path, ctx, 'counter'),
      };
    case 'item_qty':
      checkKeys(raw, ['item_qty', ...COMPARATORS], path, ctx, 'la condition item_qty');
      return {
        kind: 'item_qty',
        item: readId(raw.item_qty, p, ctx, "id d'objet"),
        cmp: readComparison(raw, path, ctx, 'item_qty'),
      };
    case 'quest': {
      checkKeys(raw, ['quest', 'state'], path, ctx, 'la condition quest');
      const state = raw.state ?? 'unlocked';
      if (state !== 'unlocked' && state !== 'active' && state !== 'completed') {
        fail(ctx, [...path, 'state'], `état de quête attendu (unlocked, active, completed), reçu ${describe(state)}`);
      }
      return {
        kind: 'quest',
        quest: readId(raw.quest, p, ctx, 'id de quête'),
        state: state === 'active' || state === 'completed' ? state : 'unlocked',
      };
    }
    case 'all':
    case 'any': {
      checkKeys(raw, [key], path, ctx, `la condition ${key}`);
      const list = raw[key];
      if (!Array.isArray(list)) {
        fail(ctx, p, `liste de conditions attendue, reçu ${describe(list)}`);
        return { kind: key, conditions: [] };
      }
      return { kind: key, conditions: list.map((c, i) => normalizeCondition(c, [...p, i], ctx)) };
    }
    case 'not':
      checkKeys(raw, ['not'], path, ctx, 'la condition not');
      return { kind: 'not', condition: normalizeCondition(raw.not, p, ctx) };
  }
}

/** Condition optionnelle : `undefined`/`null` → `null`. */
export function normalizeOptionalCondition(raw: unknown, path: Path, ctx: NormCtx): Condition | null {
  return raw === undefined || raw === null ? null : normalizeCondition(raw, path, ctx);
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

/** Clés « principales » d'une étape (une seule par étape). */
const STEP_KEYS = [
  'if',
  'do',
  'set',
  'unset',
  'add',
  'counter',
  'give_item',
  'take_item',
  'reveal',
  'hide',
  'goto_scene',
  'start_dialogue',
  'dialogue',
  'unlock_quest',
  'complete_quest',
  'say',
  'end_game',
] as const;

/** Clés secondaires autorisées avec chaque clé principale. */
const STEP_EXTRA: Record<(typeof STEP_KEYS)[number], readonly string[]> = {
  if: ['do', 'then', 'else'],
  do: [],
  set: [],
  unset: [],
  add: [],
  counter: ['add', 'set'],
  give_item: ['qty'],
  take_item: ['qty'],
  reveal: ['scene'],
  hide: ['scene'],
  goto_scene: [],
  start_dialogue: ['node'],
  dialogue: ['node'],
  unlock_quest: [],
  complete_quest: [],
  say: ['text'],
  end_game: [],
};

function idList(v: unknown, path: Path, ctx: NormCtx, what: string): string[] {
  if (Array.isArray(v)) return v.map((x, i) => readId(x, [...path, i], ctx, what));
  return [readId(v, path, ctx, what)];
}

/** Normalise une étape ; peut en produire plusieurs (`set: [a, b]`, `do: [...]`). */
export function normalizeStep(raw: unknown, path: Path, ctx: NormCtx): Step[] {
  if (typeof raw === 'string') return [{ kind: 'say', speaker: NARRATOR, text: raw }];
  if (!isRecord(raw)) {
    fail(ctx, path, `étape de script attendue (objet), reçu ${describe(raw)}`);
    return [];
  }
  // `{ if, do, else }` : la présence de `if` prime sur `do`.
  let main: (typeof STEP_KEYS)[number] | undefined;
  if (raw.if !== undefined) main = 'if';
  else if (raw.counter !== undefined) main = 'counter';
  else {
    const mains = STEP_KEYS.filter((k) => raw[k] !== undefined);
    if (mains.length > 1) {
      fail(
        ctx,
        path,
        `une étape ne peut contenir qu'un effet (trouvé : ${mains.join(', ')}) ; en mettre plusieurs dans une liste`,
      );
      return [];
    }
    main = mains[0];
  }
  if (!main) {
    fail(ctx, path, `étape non reconnue (clés possibles : ${STEP_KEYS.join(', ')})`);
    return [];
  }
  checkKeys(raw, [main, ...STEP_EXTRA[main]], path, ctx, `l'étape ${main}`);
  const v = raw[main];
  const p = [...path, main];

  switch (main) {
    case 'if': {
      if (raw.do !== undefined && raw.then !== undefined) fail(ctx, path, '« do » et « then » sont synonymes : un seul des deux');
      const thenKey = raw.then !== undefined ? 'then' : 'do';
      return [
        {
          kind: 'if',
          condition: normalizeCondition(v, p, ctx),
          then: normalizeScript(raw[thenKey], [...path, thenKey], ctx),
          else: normalizeScript(raw.else, [...path, 'else'], ctx),
        },
      ];
    }
    case 'do':
      return normalizeScript(v, p, ctx);
    case 'set':
      if (isRecord(v)) {
        return Object.entries(v).map(([name, value]) => ({
          kind: 'set_var' as const,
          var: readId(name, [...p, name], ctx, 'nom de variable'),
          value: readNumber(value, [...p, name], ctx, 'valeur numérique'),
        }));
      }
      return idList(v, p, ctx, 'nom de drapeau').map((flag) => ({ kind: 'set_flag' as const, flag }));
    case 'unset':
      return idList(v, p, ctx, 'nom de drapeau').map((flag) => ({ kind: 'unset_flag' as const, flag }));
    case 'add':
      if (!isRecord(v)) {
        fail(ctx, p, `objet { variable: montant } attendu, reçu ${describe(v)}`);
        return [];
      }
      return Object.entries(v).map(([name, amount]) => ({
        kind: 'add_var' as const,
        var: readId(name, [...p, name], ctx, 'nom de variable'),
        amount: readNumber(amount, [...p, name], ctx, 'montant'),
      }));
    case 'counter': {
      const counter = readId(v, p, ctx, 'id de compteur');
      if ((raw.add === undefined) === (raw.set === undefined)) {
        fail(ctx, path, 'effet counter : préciser exactement un de « add » ou « set »');
        return [];
      }
      return raw.add !== undefined
        ? [{ kind: 'counter_add', counter, amount: readNumber(raw.add, [...path, 'add'], ctx) }]
        : [{ kind: 'counter_set', counter, value: readNumber(raw.set, [...path, 'set'], ctx) }];
    }
    case 'give_item':
    case 'take_item': {
      const qty = readPositiveInt(raw.qty, [...path, 'qty'], ctx);
      return idList(v, p, ctx, "id d'objet").map((item) => ({ kind: main, item, qty }));
    }
    case 'reveal':
    case 'hide': {
      let scene: string | null = raw.scene === undefined || raw.scene === null ? null : readId(raw.scene, [...path, 'scene'], ctx, 'id de scène');
      if (isRecord(v)) {
        checkKeys(v, ['target', 'scene'], p, ctx, `l'effet ${main}`);
        if (v.scene !== undefined) scene = readId(v.scene, [...p, 'scene'], ctx, 'id de scène');
        return [{ kind: main, target: readId(v.target, [...p, 'target'], ctx, 'id de hotspot'), scene }];
      }
      return idList(v, p, ctx, 'id de hotspot ou de sortie').map((target) => ({ kind: main, target, scene }));
    }
    case 'goto_scene':
      return [{ kind: 'goto_scene', scene: readId(v, p, ctx, 'id de scène') }];
    case 'start_dialogue':
    case 'dialogue':
      return [
        {
          kind: 'start_dialogue',
          dialogue: readId(v, p, ctx, 'id de dialogue'),
          node: raw.node === undefined || raw.node === null ? null : readId(raw.node, [...path, 'node'], ctx, 'id de nœud'),
        },
      ];
    case 'unlock_quest':
    case 'complete_quest':
      return idList(v, p, ctx, 'id de quête').map((quest) => ({ kind: main, quest }));
    case 'say':
      if (raw.text === undefined) {
        fail(ctx, path, 'effet say : « text » est obligatoire (ex. { say: narrator, text: "…" })');
        return [];
      }
      return [{ kind: 'say', speaker: readId(v, p, ctx, 'locuteur'), text: readText(raw.text, [...path, 'text'], ctx) }];
    case 'end_game':
      return [{ kind: 'end_game', ending: normalizeEndGame(v, p, ctx) }];
  }
}

function normalizeEndGame(v: unknown, path: Path, ctx: NormCtx): string {
  if (!isRecord(v)) return readId(v, path, ctx, 'id de fin');
  checkKeys(v, ['ending', 'type', 'title', 'text', 'image'], path, ctx, "l'effet end_game");
  const id = readId(v.ending, [...path, 'ending'], ctx, 'id de fin (ending)');
  let type: EndingType = 'win';
  if (v.type === 'win' || v.type === 'game_over') type = v.type;
  else fail(ctx, [...path, 'type'], `type de fin attendu (win ou game_over), reçu ${describe(v.type)}`);
  const opt = (k: string) => (v[k] === undefined || v[k] === null ? null : readText(v[k], [...path, k], ctx));
  ctx.inlineEndings.push({
    ending: { id, type, title: opt('title'), text: opt('text'), image: v.image == null ? null : readId(v.image, [...path, 'image'], ctx, "id d'asset") },
    path,
  });
  return id;
}

/**
 * Normalise un script. Formes acceptées :
 * - absent / `null` → script vide ;
 * - `"texte"` → `say narrator` ;
 * - une liste d'étapes ;
 * - une étape seule (`{ say, text }`, `{ dialogue: id }`, `{ goto_scene: id }`…) ;
 * - `{ do: [...] }` ;
 * - `{ if, do, else }`.
 */
export function normalizeScript(raw: unknown, path: Path, ctx: NormCtx): Script {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.flatMap((s, i) => normalizeStep(s, [...path, i], ctx));
  return normalizeStep(raw, path, ctx);
}

/** Action de verbe de hotspot : forme de script, plus `label` optionnel sur la forme objet. */
export function normalizeVerbAction(raw: unknown, path: Path, ctx: NormCtx): VerbAction {
  if (isRecord(raw) && raw.label !== undefined) {
    const { label, ...rest } = raw;
    return {
      label: readText(label, [...path, 'label'], ctx, 'libellé'),
      script: Object.keys(rest).length === 0 ? [] : normalizeScript(rest, path, ctx),
    };
  }
  return { label: null, script: normalizeScript(raw, path, ctx) };
}

/** Réactions indexées par objet (`use`, `on_give`, `on_show`) avec clé `default`. */
export function normalizeItemReactions<T>(
  raw: unknown,
  path: Path,
  ctx: NormCtx,
  each: (v: unknown, path: Path, ctx: NormCtx) => T,
): ItemReactions<T> | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) {
    fail(ctx, path, `objet { id_objet: réaction, default: réaction } attendu, reçu ${describe(raw)}`);
    return null;
  }
  const out: ItemReactions<T> = { byItem: {}, default: null };
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'default') out.default = each(v, [...path, k], ctx);
    else out.byItem[readId(k, [...path, k], ctx, "id d'objet")] = each(v, [...path, k], ctx);
  }
  return out;
}

/** Transition : `"n2"` → `{ next: n2 }` ; `{ next?, effects? }` ; `null` → fin du dialogue. */
export function normalizeTransition(raw: unknown, path: Path, ctx: NormCtx): Transition {
  if (raw === null) return { effects: [], next: null };
  if (typeof raw === 'string') return { effects: [], next: readId(raw, path, ctx, 'id de nœud') };
  if (!isRecord(raw)) {
    fail(ctx, path, `transition attendue (id de nœud ou { next, effects }), reçu ${describe(raw)}`);
    return { effects: [], next: null };
  }
  checkKeys(raw, ['next', 'effects'], path, ctx, 'la transition');
  return {
    effects: normalizeScript(raw.effects, [...path, 'effects'], ctx),
    next: raw.next === undefined || raw.next === null ? null : readId(raw.next, [...path, 'next'], ctx, 'id de nœud'),
  };
}

/**
 * Actions d'un hotspot : `{ verbe: action, use: { id_objet: script, default: script } }`.
 * Le verbe `use` est extrait dans `use` ; les autres sont des `VerbAction`.
 */
export function normalizeHotspotActions(
  raw: unknown,
  path: Path,
  ctx: NormCtx,
): { actions: Record<string, VerbAction>; use: ItemReactions<Script> | null } {
  const out = { actions: {} as Record<string, VerbAction>, use: null as ItemReactions<Script> | null };
  if (raw === undefined || raw === null) return out;
  if (!isRecord(raw)) {
    fail(ctx, path, `objet { verbe: action } attendu, reçu ${describe(raw)}`);
    return out;
  }
  for (const [verb, v] of Object.entries(raw)) {
    if (verb === 'use') out.use = normalizeItemReactions(v, [...path, verb], ctx, normalizeScript);
    else out.actions[readId(verb, [...path, verb], ctx, 'verbe')] = normalizeVerbAction(v, [...path, verb], ctx);
  }
  return out;
}
