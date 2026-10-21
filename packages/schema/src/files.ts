/**
 * Schémas zod des fichiers SOURCE (YAML) du format SCROUM.
 *
 * Chaque schéma valide la forme d'un fichier tel qu'écrit par un auteur et
 * le transforme en forme canonique (`types.ts`). Les objets sont stricts :
 * une clé inconnue (faute de frappe) est une erreur. Le champ libre `notes`
 * est accepté partout pour les commentaires d'auteur.
 *
 * Les fichiers « à un élément » (personnage, scène, dialogue) ne connaissent
 * pas leur id ni leur chemin : le chargeur (`load.ts`) les complète.
 */
import { z } from 'zod';
import {
  ID_PATTERN,
  createNormCtx,
  normalizeCondition,
  normalizeItemActions,
  normalizeItemReactions,
  normalizeOptionalCondition,
  normalizeScript,
  normalizeTransition,
  normalizeHotspotActions,
  type NormCtx,
  type Path,
} from './normalize';
import type {
  Asset,
  AssetKind,
  Character,
  CharacterFace,
  Choice,
  Collection,
  Condition,
  Counter,
  Dialogue,
  DialogueNode,
  Ending,
  Exit,
  FreeText,
  Gag,
  GameMeta,
  Hotspot,
  Intent,
  Item,
  ItemReactions,
  Line,
  NextBranch,
  Quest,
  Checkpoint,
  QuestGoal,
  Rect,
  Scene,
  Script,
  Transition,
  VarDef,
  VerbAction,
  World,
} from './types';

// ---------------------------------------------------------------------------
// Briques
// ---------------------------------------------------------------------------

export const IdSchema = z.string().regex(ID_PATTERN, {
  error: 'identifiant invalide : minuscules, chiffres et _ uniquement (ex. cle_rouillee)',
});

export const StatusSchema = z.enum(['draft', 'review', 'validated', 'rejected']);
const status = StatusSchema.default('draft');
const notes = z.string().optional();

const optText = z
  .string()
  .nullish()
  .transform((v) => v ?? null);
const optId = IdSchema.nullish().transform((v) => v ?? null);
const idList = z.array(IdSchema).default([]);
const textList = z.array(z.string()).default([]);

/** Applique une fonction de normalisation maison en remontant ses problèmes à zod. */
function normalized<T>(fn: (raw: unknown, path: Path, ctx: NormCtx) => T) {
  return z.unknown().optional().transform((raw, zctx): T => {
    const ctx = createNormCtx();
    const out = fn(raw, [], ctx);
    for (const issue of ctx.issues) zctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    for (const e of ctx.inlineEndings) inlineEndingSink?.push({ ...e });
    return out;
  });
}

/**
 * Collecteur des fins déclarées en ligne pendant un `safeParse`
 * (positionné par `parseWithEndings`).
 */
let inlineEndingSink: { ending: Ending; path: Path }[] | null = null;

/** Exécute un parse en collectant les fins déclarées en ligne (`end_game: { ending, type, … }`). */
export function parseWithEndings<T>(fn: () => T): { result: T; endings: Ending[] } {
  const prev = inlineEndingSink;
  const sink: { ending: Ending; path: Path }[] = [];
  inlineEndingSink = sink;
  try {
    return { result: fn(), endings: sink.map((e) => e.ending) };
  } finally {
    inlineEndingSink = prev;
  }
}

export const ConditionSchema = normalized<Condition>(normalizeCondition);
const optCondition = normalized<Condition | null>(normalizeOptionalCondition);
export const ScriptSchema = normalized<Script>(normalizeScript);
const TransitionSchema = normalized<Transition>(normalizeTransition);

const unit = z.number().min(0, { error: 'coordonnée normalisée attendue entre 0 et 1' }).max(1, {
  error: 'coordonnée normalisée attendue entre 0 et 1',
});

/** Rectangle normalisé : `[x, y, w, h]` ou `{ x, y, w, h }`, dans [0, 1], ne débordant pas de l'image. */
export const RectSchema = z
  .union([z.tuple([unit, unit, unit, unit]), z.strictObject({ x: unit, y: unit, w: unit, h: unit })])
  .transform((r): Rect => (Array.isArray(r) ? { x: r[0], y: r[1], w: r[2], h: r[3] } : r))
  .superRefine((r, ctx) => {
    if (r.w <= 0 || r.h <= 0) ctx.addIssue({ code: 'custom', message: 'largeur et hauteur doivent être > 0' });
    if (r.x + r.w > 1.0001 || r.y + r.h > 1.0001) {
      ctx.addIssue({ code: 'custom', message: 'le rectangle déborde de l’image (x + w et y + h doivent être ≤ 1)' });
    }
  });

// ---------------------------------------------------------------------------
// game.yaml
// ---------------------------------------------------------------------------

const CounterSchema = z
  .strictObject({
    label: z.string(),
    hud: z.boolean().default(false),
    initial: z.number().default(0),
    min: z.number().nullish(),
    max: z.number().nullish(),
    titles: z.array(z.strictObject({ min: z.number(), label: z.string() })).default([]),
    notes,
  })
  .transform(
    (c): Omit<Counter, 'id'> => ({
      label: c.label,
      hud: c.hud,
      initial: c.initial,
      min: c.min ?? null,
      max: c.max ?? null,
      titles: [...c.titles].sort((a, b) => a.min - b.min),
    }),
  );

const EndingSchema = z
  .strictObject({
    type: z.enum(['win', 'game_over']),
    title: optText,
    text: z
      .union([z.string(), z.array(z.union([z.string().transform((text) => ({ if: null as Condition | null, text })), z.strictObject({ if: optCondition, text: z.string() })]))])
      .nullish()
      .transform((v, ctx): { text: string | null; text_if: { condition: Condition; text: string }[] } => {
        if (v === null || v === undefined) return { text: null, text_if: [] };
        if (typeof v === 'string') return { text: v, text_if: [] };
        const text_if: { condition: Condition; text: string }[] = [];
        let text: string | null = null;
        v.forEach((e, i) => {
          if (e.if) text_if.push({ condition: e.if, text: e.text });
          else if (i === v.length - 1) text = e.text;
          else ctx.addIssue({ code: 'custom', message: 'seule la dernière variante peut être sans « if » (texte par défaut)', path: [i] });
        });
        return { text, text_if };
      }),
    image: optId,
    notes,
  })
  .transform((e): Omit<Ending, 'id'> => ({ type: e.type, title: e.title, text: e.text.text, text_if: e.text.text_if, image: e.image }));

const CollectionSchema = z
  .strictObject({
    id: IdSchema,
    title: z.string(),
    text: optText,
    character: optId,
    images: idList,
    if: ConditionSchema,
    notes,
  })
  .transform(
    (c): Collection => ({ id: c.id, title: c.title, text: c.text, character: c.character, images: c.images, condition: c.if }),
  );

const VarSchema = z
  .strictObject({ min: z.number().nullish(), max: z.number().nullish(), notes })
  .superRefine((v, ctx) => {
    if (v.min != null && v.max != null && v.min > v.max) ctx.addIssue({ code: 'custom', message: '« min » doit être ≤ « max »', path: ['min'] });
  })
  .transform((v): Omit<VarDef, 'id'> => ({ min: v.min ?? null, max: v.max ?? null }));

const InitialSchema = z
  .strictObject({
    flags: idList,
    vars: z.record(IdSchema, z.number()).default({}),
    inventory: z
      .union([z.array(IdSchema), z.record(IdSchema, z.number().int().min(1))])
      .default({})
      .transform((inv) => (Array.isArray(inv) ? Object.fromEntries(inv.map((i) => [i, 1])) : inv)),
    quests: idList,
  })
  .default({ flags: [], vars: {}, inventory: {}, quests: [] });

export const DEFAULT_REFUSE_LINE = 'Ça ne donne rien.';

export const GameFileSchema = z
  .strictObject({
    title: z.string(),
    version: z.union([z.string(), z.number()]).transform(String),
    formatVersion: z.number().int().min(1),
    description: optText,
    start_scene: IdSchema,
    player_character: optId,
    refuse_line: z.string().default(DEFAULT_REFUSE_LINE),
    counters: z.record(IdSchema, CounterSchema).default({}),
    vars: z.record(IdSchema, VarSchema).default({}),
    dialogue: z
      .strictObject({ echo_choices: z.boolean().default(false) })
      .default({ echo_choices: false }),
    character_roles: idList,
    validation: z
      .strictObject({
        characters: z
          .strictObject({
            require_age: z.boolean().default(false),
            min_age: z.number().nullish().transform((v) => v ?? null),
          })
          .default({ require_age: false, min_age: null }),
      })
      .default({ characters: { require_age: false, min_age: null } }),
    collections: z.array(CollectionSchema).default([]),
    endings: z.record(IdSchema, EndingSchema).default({}),
    initial: InitialSchema,
    notes,
  })
  .superRefine((g, ctx) => {
    const seen = new Set<string>();
    g.collections.forEach((c, i) => {
      if (seen.has(c.id)) ctx.addIssue({ code: 'custom', message: `collection « ${c.id} » déclarée deux fois`, path: ['collections', i, 'id'] });
      seen.add(c.id);
    });
  });

export type GameFile = z.output<typeof GameFileSchema>;

export function gameMetaFromFile(g: GameFile): GameMeta {
  return {
    title: g.title,
    version: g.version,
    formatVersion: g.formatVersion,
    description: g.description,
    start_scene: g.start_scene,
    player_character: g.player_character,
    refuse_line: g.refuse_line,
    character_roles: g.character_roles,
    validation: g.validation,
    initial: g.initial,
    dialogue: g.dialogue,
  };
}

// ---------------------------------------------------------------------------
// Bible
// ---------------------------------------------------------------------------

export const WorldSchema = z
  .strictObject({
    status,
    name: z.string(),
    description: optText,
    ui_skin: z.string().default('plain'),
    refuse_line: optText,
    notes,
  })
  .transform((w) => ({
    status: w.status,
    name: w.name,
    description: w.description,
    ui_skin: w.ui_skin,
    refuse_line: w.refuse_line,
  }));
/** `bible/worlds.yaml` : id de monde → monde. `refuse_line` reste null ici, complété au chargement. */
export const WorldsFileSchema = z.record(IdSchema, WorldSchema);
export type WorldEntry = Omit<World, 'id' | 'source' | 'refuse_line'> & { refuse_line: string | null };

const CheckpointSchema = z
  .strictObject({
    scene: IdSchema.nullish(),
    flags: idList,
    vars: z.record(IdSchema, z.number()).default({}),
    counters: z.record(IdSchema, z.number()).default({}),
    inventory: z
      .union([z.array(IdSchema), z.record(IdSchema, z.number().int().min(1))])
      .default({})
      .transform((inv) => (Array.isArray(inv) ? Object.fromEntries(inv.map((i) => [i, 1])) : inv)),
    quests: idList,
    completed: idList,
    reveal: z.record(IdSchema, z.array(IdSchema)).default({}),
    hide: z.record(IdSchema, z.array(IdSchema)).default({}),
    limits: z
      .strictObject({
        max_states: z.number().int().min(1).nullish(),
        max_depth: z.number().int().min(1).nullish(),
        time_limit: z.number().positive().nullish(),
      })
      .nullish(),
    dialogue: z
      .union([IdSchema, z.strictObject({ id: IdSchema, node: IdSchema.nullish() })])
      .nullish()
      .transform((d) => (d == null ? null : typeof d === 'string' ? { id: d, node: null } : { id: d.id, node: d.node ?? null })),
  })
  .transform(
    (c): Checkpoint => ({
      scene: c.scene ?? null,
      flags: c.flags,
      vars: c.vars,
      counters: c.counters,
      inventory: c.inventory,
      quests: c.quests,
      completed: c.completed,
      reveal: c.reveal,
      hide: c.hide,
      limits: c.limits ? { max_states: c.limits.max_states ?? null, max_depth: c.limits.max_depth ?? null, time_limit: c.limits.time_limit ?? null } : null,
      dialogue: c.dialogue,
    }),
  );

const GoalSchema = z
  .strictObject({ if: optCondition, ending: IdSchema.nullish() })
  .refine((g) => !(g.if && g.ending), { message: '« if » et « ending » sont exclusifs' })
  .transform((g): QuestGoal => ({ condition: g.if ?? null, ending: g.ending ?? null }));

export const QuestSchema = z
  .strictObject({ status, title: z.string(), description: optText, notes, checkpoint: CheckpointSchema.nullish(), goal: GoalSchema.nullish() })
  .transform((q): Omit<Quest, 'id' | 'source'> => ({
    status: q.status,
    title: q.title,
    description: q.description,
    checkpoint: q.checkpoint ?? null,
    goal: q.goal ?? null,
  }));
/** `bible/quests.yaml` : id de quête → quête. */
export const QuestsFileSchema = z.record(IdSchema, QuestSchema);

export const GagSchema = z
  .union([
    z.string().transform((text) => ({ status: 'draft' as const, text, tags: [] as string[] })),
    z.strictObject({ status, text: z.string(), tags: textList, notes }).transform((g) => ({ status: g.status, text: g.text, tags: g.tags })),
  ])
  .transform((g): Omit<Gag, 'id' | 'source'> => g);
/** `bible/gags.yaml` : id de gag → texte ou `{ text, tags, status }`. */
export const GagsFileSchema = z.record(IdSchema, GagSchema);

/** Front matter des fichiers Markdown de la bible. */
export const BibleDocFrontMatterSchema = z.looseObject({ status }).default({ status: 'draft' });

// ---------------------------------------------------------------------------
// Personnages
// ---------------------------------------------------------------------------

const FaceSchema = z
  .strictObject({
    name: z.string(),
    description: optText,
    world: optId,
    avatar: optId,
    portrait: optId,
  })
  .transform((f): CharacterFace => f);

/**
 * `characters/<id>.yaml`. Deux formes :
 * - simple : `name`, `description`, `world`, `avatar`, `portrait` au premier niveau ;
 * - double identité : `persona` + `identity` (+ `revealed_by`).
 */
export const CharacterFileSchema = z
  .strictObject({
    id: IdSchema.optional(),
    status,
    role: optId,
    age: z.number().int().min(0).nullish().transform((v) => v ?? null),
    name: z.string().optional(),
    description: optText,
    world: optId,
    avatar: optId,
    portrait: optId,
    persona: FaceSchema.optional(),
    identity: FaceSchema.optional(),
    revealed_by: optCondition,
    motivation: optText,
    voice: optText,
    dislikes: textList,
    llm_persona_prompt: optText,
    notes,
  })
  .superRefine((c, ctx) => {
    const flat = c.name !== undefined;
    if (flat && c.identity) {
      ctx.addIssue({ code: 'custom', message: '« name » au premier niveau et « identity » sont exclusifs', path: ['identity'] });
    }
    if (!flat && !c.identity) {
      ctx.addIssue({ code: 'custom', message: 'un personnage a besoin de « name » (forme simple) ou de « identity »', path: [] });
    }
    if (c.identity && (c.description || c.world || c.avatar || c.portrait)) {
      ctx.addIssue({
        code: 'custom',
        message: 'avec « identity », description/world/avatar/portrait vont dans identity ou persona',
        path: [],
      });
    }
    if (c.revealed_by && !c.persona) {
      ctx.addIssue({ code: 'custom', message: '« revealed_by » n’a de sens qu’avec une « persona »', path: ['revealed_by'] });
    }
  })
  .transform(
    (c): Omit<Character, 'source' | 'id'> & { id?: string } => ({
      ...(c.id !== undefined ? { id: c.id } : {}),
      status: c.status,
      role: c.role,
      age: c.age,
      identity: c.identity ?? {
        name: c.name ?? '',
        description: c.description,
        world: c.world,
        avatar: c.avatar,
        portrait: c.portrait,
      },
      persona: c.persona ?? null,
      revealed_by: c.revealed_by,
      motivation: c.motivation,
      voice: c.voice,
      dislikes: c.dislikes,
      llm_persona_prompt: c.llm_persona_prompt,
    }),
  );

// ---------------------------------------------------------------------------
// Scènes
// ---------------------------------------------------------------------------

const HotspotActionsSchema = normalized(normalizeHotspotActions);

const HotspotSchema = z
  .strictObject({
    id: IdSchema,
    label: z.string(),
    rect: RectSchema,
    hidden: z.boolean().default(false),
    visible_if: optCondition,
    image: optId,
    character: optId,
    actions: HotspotActionsSchema,
    notes,
  })
  .transform(
    (h): Hotspot => ({
      id: h.id,
      label: h.label,
      rect: h.rect,
      hidden: h.hidden,
      visible_if: h.visible_if,
      image: h.image,
      character: h.character,
      actions: h.actions.actions,
      use: h.actions.use,
    }),
  );

const ExitSchema = z
  .strictObject({
    id: IdSchema.optional(),
    to: IdSchema,
    label: z.string(),
    rect: RectSchema,
    hidden: z.boolean().default(false),
    visible_if: optCondition,
    if: optCondition,
    do: ScriptSchema,
    else: ScriptSchema,
    notes,
  })
  .transform(
    (e): Exit => ({
      id: e.id ?? `exit_${e.to}`,
      to: e.to,
      label: e.label,
      rect: e.rect,
      hidden: e.hidden,
      visible_if: e.visible_if,
      condition: e.if,
      script: e.do,
      else: e.else,
    }),
  );

/** `scenes/<id>.yaml`. */
export const SceneFileSchema = z
  .strictObject({
    id: IdSchema.optional(),
    status,
    title: optText,
    world: IdSchema,
    background: optId,
    music: optId,
    on_enter: ScriptSchema,
    hotspots: z.array(HotspotSchema).default([]),
    exits: z.array(ExitSchema).default([]),
    notes,
  })
  .superRefine((s, ctx) => {
    const seen = new Map<string, string>();
    s.hotspots.forEach((h, i) => {
      if (seen.has(h.id)) ctx.addIssue({ code: 'custom', message: `id « ${h.id} » déjà utilisé dans la scène`, path: ['hotspots', i, 'id'] });
      seen.set(h.id, 'hotspot');
    });
    s.exits.forEach((e, i) => {
      if (seen.has(e.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `id de sortie « ${e.id} » déjà utilisé dans la scène (donner un « id » explicite à la sortie)`,
          path: ['exits', i],
        });
      }
      seen.set(e.id, 'exit');
    });
  })
  .transform(
    (s): Omit<Scene, 'id' | 'source'> & { id?: string } => ({
      ...(s.id !== undefined ? { id: s.id } : {}),
      status: s.status,
      title: s.title,
      world: s.world,
      background: s.background,
      music: s.music,
      on_enter: s.on_enter,
      hotspots: s.hotspots,
      exits: s.exits,
    }),
  );

// ---------------------------------------------------------------------------
// Dialogues
// ---------------------------------------------------------------------------

const LineSchema = z.union([
  z.string().transform((text) => ({ speaker: null as string | null, text, if: null as Condition | null })),
  z.strictObject({ speaker: optId, text: z.string(), if: optCondition }),
]);

const BranchSchema = z.union([
  IdSchema.transform((next) => ({ if: null as Condition | null, next: next as string | null })),
  z.strictObject({ if: optCondition, next: optId }),
]);

/** `next` : id de nœud, `null`, ou liste de branches `{ if, next }` (dernière sans `if` = repli). */
const NextSchema = z
  .union([z.null(), IdSchema, z.array(BranchSchema).min(1)])
  .optional()
  .transform((v, ctx): { next: string | null; next_if: NextBranch[] } => {
    if (v === undefined || v === null) return { next: null, next_if: [] };
    if (typeof v === 'string') return { next: v, next_if: [] };
    const next_if: NextBranch[] = [];
    let next: string | null = null;
    v.forEach((b, i) => {
      if (b.if) next_if.push({ condition: b.if, next: b.next });
      else if (i === v.length - 1) next = b.next;
      else ctx.addIssue({ code: 'custom', message: 'seule la dernière branche peut être sans « if » (repli)', path: [i] });
    });
    return { next, next_if };
  });

const ChoiceSchema = z
  .strictObject({
    label: z.string(),
    intent: optId,
    if: optCondition,
    effects: ScriptSchema,
    next: optId,
    notes,
  })
  .transform((c): Choice => ({ label: c.label, intent: c.intent, condition: c.if, effects: c.effects, next: c.next }));

const FreeTextSchema = z
  .strictObject({
    intents: z.record(IdSchema, TransitionSchema).default({}),
    fallback: TransitionSchema.optional(),
    threshold: z.number().min(0).max(1).nullish(),
    placeholder: optText,
  })
  .superRefine((f, ctx) => {
    for (const k of ['give_item', 'show_item']) {
      if (k in f.intents) {
        ctx.addIssue({
          code: 'custom',
          message: `l'intention réservée « ${k} » ne se déclare pas dans free_text : utiliser on_give / on_show`,
          path: ['intents', k],
        });
      }
    }
  });

const ReactionsSchema = normalized<ItemReactions<Transition> | null>((raw, path, ctx) =>
  normalizeItemReactions(raw, path, ctx, normalizeTransition),
);

const NodeSchema = z
  .strictObject({
    speaker: optId,
    lines: z
      .union([LineSchema.transform((l) => [l]), z.array(LineSchema)])
      .default([]),
    effects: ScriptSchema,
    choices: z.array(ChoiceSchema).default([]),
    free_text: FreeTextSchema.optional(),
    next: NextSchema,
    on_give: ReactionsSchema,
    on_show: ReactionsSchema,
    notes,
  })
  .superRefine((n, ctx) => {
    if ((n.next.next || n.next.next_if.length > 0) && (n.choices.length > 0 || n.free_text)) {
      ctx.addIssue({ code: 'custom', message: '« next » est exclusif avec « choices » et « free_text »', path: ['next'] });
    }
  });

/** `dialogues/<id>.yaml`. */
export const DialogueFileSchema = z
  .strictObject({
    id: IdSchema.optional(),
    status,
    speaker: IdSchema,
    start: IdSchema.optional(),
    nodes: z.record(IdSchema, NodeSchema),
    notes,
  })
  .superRefine((d, ctx) => {
    if (Object.keys(d.nodes).length === 0) ctx.addIssue({ code: 'custom', message: 'un dialogue a au moins un nœud', path: ['nodes'] });
  })
  .transform((d): Omit<Dialogue, 'id' | 'source'> & { id?: string } => {
    const nodes: Record<string, DialogueNode> = {};
    for (const [id, n] of Object.entries(d.nodes)) {
      const defaultSpeaker = n.speaker ?? d.speaker;
      const free_text: FreeText | null = n.free_text
        ? {
            intents: n.free_text.intents,
            // Par défaut, un texte non compris laisse le joueur sur le même nœud.
            fallback: n.free_text.fallback ?? { effects: [], next: id },
            threshold: n.free_text.threshold ?? null,
            placeholder: n.free_text.placeholder,
          }
        : null;
      nodes[id] = {
        id,
        lines: n.lines.map((l): Line => ({ speaker: l.speaker ?? defaultSpeaker, text: l.text, condition: l.if })),
        effects: n.effects,
        choices: n.choices,
        free_text,
        next: n.next.next,
        next_if: n.next.next_if,
        on_give: n.on_give,
        on_show: n.on_show,
      };
    }
    return {
      ...(d.id !== undefined ? { id: d.id } : {}),
      status: d.status,
      speaker: d.speaker,
      start: d.start ?? Object.keys(d.nodes)[0] ?? '',
      nodes,
    };
  });

// ---------------------------------------------------------------------------
// intents.yaml, items.yaml, assets.yaml
// ---------------------------------------------------------------------------

export const IntentSchema = z
  .strictObject({ desc: z.string(), examples: textList, keywords: textList, notes })
  .transform((i): Omit<Intent, 'id' | 'source' | 'reserved'> => ({ desc: i.desc, examples: i.examples, keywords: i.keywords }));
/** `intents.yaml` : id d'intention → intention. */
export const IntentsFileSchema = z.record(IdSchema, IntentSchema);

const CombinationSchema = z.strictObject({
  with: IdSchema,
  result: optId,
  consume: idList,
  effects: ScriptSchema,
  notes,
});

export const ItemSchema = z
  .strictObject({
    status,
    name: z.string(),
    description: optText,
    icon: optId,
    scope: z
      .union([z.literal('any'), IdSchema, z.array(IdSchema)])
      .default('any')
      .transform((s) => (s === 'any' ? null : Array.isArray(s) ? s : [s])),
    consumable: z.boolean().default(false),
    stackable: z.boolean().default(false),
    look: ScriptSchema,
    actions: normalized<Record<string, VerbAction>>(normalizeItemActions),
    combine: z.array(CombinationSchema).default([]),
    notes,
  })
  .transform(
    (i): Omit<Item, 'id' | 'source'> => ({
      status: i.status,
      name: i.name,
      description: i.description,
      icon: i.icon,
      scope: i.scope,
      consumable: i.consumable,
      stackable: i.stackable,
      look: i.look,
      actions: i.actions,
      combine: i.combine.map((c) => ({ with: c.with, result: c.result, consume: c.consume, effects: c.effects })),
    }),
  );
/** `items.yaml` : id d'objet → objet. */
export const ItemsFileSchema = z.record(IdSchema, ItemSchema);

export const ASSET_KINDS = ['background', 'character', 'portrait', 'avatar', 'sprite', 'item', 'ending', 'other'] as const satisfies readonly AssetKind[];

export const AssetSchema = z
  .strictObject({
    status,
    kind: z.enum(ASSET_KINDS).default('other'),
    prompt: optText,
    negative: optText,
    seed: z.number().int().nullish().transform((v) => v ?? null),
    workflow: optText,
    references: idList,
    model: optText,
    width: z.number().int().positive().nullish().transform((v) => v ?? null),
    height: z.number().int().positive().nullish().transform((v) => v ?? null),
    /** Monde (préfixe/suffixe de style.md, post-traitement) ; sinon déduit des scènes/personnages qui l'utilisent. */
    world: z.string().nullish().transform((v) => v ?? null),
    notes,
  })
  .transform((a): Omit<Asset, 'id' | 'source' | 'file'> => {
    const { notes: _n, ...rest } = a;
    return rest;
  });
/** `assets/assets.yaml` : id d'asset → métadonnées de génération. */
export const AssetsFileSchema = z.record(IdSchema, AssetSchema);
