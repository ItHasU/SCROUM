/**
 * Analyseurs de niveau 1 : règles du jeu (`game.yaml → validation`),
 * cohérence des références, obtenabilité des objets, orphelins.
 */
import {
  BUILTIN_SKINS,
  NARRATOR,
  forEachCondition,
  visitConditions,
  visitScripts,
  visitSteps,
  type Condition,
  type GameData,
  type Location,
  type Script,
} from '@scroum/schema';
import type { Analyzer, AnalyzerContext } from './types';

const has = (rec: Record<string, unknown>, id: string) => Object.prototype.hasOwnProperty.call(rec, id);

// ---------------------------------------------------------------------------
// Règles du jeu
// ---------------------------------------------------------------------------

/** `game.yaml → validation.characters` : âge requis et âge minimal ; rôles déclarés. */
export const gameRulesAnalyzer: Analyzer = {
  name: 'game-rules',
  level: 'rules',
  run(game, ctx) {
    const rules = game.meta.validation.characters;
    for (const c of Object.values(game.characters)) {
      if (rules.require_age && c.age === null) {
        ctx.report('error', 'age_required', c.source, 'age', `âge obligatoire (game.yaml → validation.characters.require_age)`);
      }
      if (rules.min_age !== null && c.age !== null && c.age < rules.min_age) {
        ctx.report('error', 'age_min', c.source, 'age', `âge ${c.age} inférieur au minimum ${rules.min_age} (game.yaml → validation.characters.min_age)`);
      }
      if (game.meta.character_roles.length > 0 && c.role === null) {
        ctx.report('warning', 'role_missing', c.source, 'role', `rôle non renseigné (parmi : ${game.meta.character_roles.join(', ')})`);
      }
      if (c.role !== null && !game.meta.character_roles.includes(c.role)) {
        ctx.report(
          'error',
          'unknown_role',
          c.source,
          'role',
          `rôle « ${c.role} » non déclaré dans game.yaml → character_roles (${game.meta.character_roles.join(', ') || 'vide'})`,
        );
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Références
// ---------------------------------------------------------------------------

type RefKind = 'scene' | 'dialogue' | 'item' | 'asset' | 'intent' | 'world' | 'character' | 'quest' | 'counter' | 'ending' | 'speaker';

const LABEL: Record<RefKind, string> = {
  scene: 'scène',
  dialogue: 'dialogue',
  item: 'objet',
  asset: 'asset',
  intent: 'intention',
  world: 'monde',
  character: 'personnage',
  quest: 'quête',
  counter: 'compteur',
  ending: 'fin',
  speaker: 'locuteur',
};

const FEMININE = new Set<RefKind>(['scene', 'intent', 'quest', 'ending']);

const WHERE: Record<RefKind, string> = {
  scene: 'scenes/',
  dialogue: 'dialogues/',
  item: 'items.yaml',
  asset: 'assets/assets.yaml',
  intent: 'intents.yaml',
  world: 'bible/worlds.yaml',
  character: 'characters/',
  quest: 'bible/quests.yaml',
  counter: 'game.yaml → counters',
  ending: 'game.yaml → endings',
  speaker: `characters/ (ou « ${NARRATOR} »)`,
};

function makeRef(game: GameData, ctx: AnalyzerContext) {
  const tables: Record<RefKind, Record<string, unknown>> = {
    scene: game.scenes,
    dialogue: game.dialogues,
    item: game.items,
    asset: game.assets,
    intent: game.intents,
    world: game.worlds,
    character: game.characters,
    quest: game.quests,
    counter: game.counters,
    ending: game.endings,
    speaker: { ...game.characters, [NARRATOR]: true },
  };
  /** Vérifie qu'une référence existe ; renvoie vrai si c'est le cas. */
  return function ref(kind: RefKind, id: string | null, file: string, path: string): boolean {
    if (id === null || id === '') return true;
    if (has(tables[kind], id)) return true;
    const unknown = FEMININE.has(kind) ? 'inconnue' : 'inconnu';
    ctx.report('error', `unknown_${kind}`, file, path, `${LABEL[kind]} « ${id} » ${unknown} (à déclarer dans ${WHERE[kind]})`);
    return false;
  };
}

function checkCondition(cond: Condition, loc: Location, ref: ReturnType<typeof makeRef>): void {
  forEachCondition(cond, (c) => {
    switch (c.kind) {
      case 'counter':
        ref('counter', c.counter, loc.file, loc.path);
        break;
      case 'has_item':
      case 'item_qty':
      case 'ever_had_item':
        ref('item', c.item, loc.file, loc.path);
        break;
      case 'quest':
        ref('quest', c.quest, loc.file, loc.path);
        break;
    }
  });
}

/** Cohérence de toutes les références entre fichiers. */
export const referencesAnalyzer: Analyzer = {
  name: 'references',
  level: 'refs',
  run(game, ctx) {
    const ref = makeRef(game, ctx);
    const m = game.meta;

    // --- game.yaml
    ref('scene', m.start_scene, 'game.yaml', 'start_scene');
    ref('character', m.player_character, 'game.yaml', 'player_character');
    Object.keys(m.initial.inventory).forEach((i) => ref('item', i, 'game.yaml', `initial.inventory.${i}`));
    m.initial.quests.forEach((q, i) => ref('quest', q, 'game.yaml', `initial.quests[${i}]`));
    game.collections.forEach((c, i) => {
      ref('character', c.character, 'game.yaml', `collections[${i}].character`);
      c.images.forEach((a, j) => ref('asset', a, 'game.yaml', `collections[${i}].images[${j}]`));
    });
    for (const e of Object.values(game.endings)) ref('asset', e.image, 'game.yaml', `endings.${e.id}.image`);
    if (!Object.values(game.endings).some((e) => e.type === 'win')) {
      ctx.report('warning', 'no_win_ending', 'game.yaml', 'endings', 'aucune fin de type « win » : le jeu ne peut pas être gagné');
    }

    // --- mondes
    for (const w of Object.values(game.worlds)) {
      if (!(BUILTIN_SKINS as readonly string[]).includes(w.ui_skin) && !ctx.files.has(`skins/${w.ui_skin}.css`)) {
        ctx.report(
          'warning',
          'unknown_skin',
          w.source,
          `${w.id}.ui_skin`,
          `skin « ${w.ui_skin} » ni fourni par le moteur (${BUILTIN_SKINS.join(', ')}) ni déclaré dans skins/${w.ui_skin}.css`,
        );
      }
    }

    // --- personnages
    for (const c of Object.values(game.characters)) {
      for (const [face, f] of [
        ['identity', c.identity],
        ['persona', c.persona],
      ] as const) {
        if (!f) continue;
        const base = c.persona ? `${face}.` : '';
        ref('world', f.world, c.source, `${base}world`);
        ref('asset', f.avatar, c.source, `${base}avatar`);
        ref('asset', f.portrait, c.source, `${base}portrait`);
      }
    }

    // --- scènes
    for (const s of Object.values(game.scenes)) {
      ref('world', s.world, s.source, 'world');
      ref('asset', s.background, s.source, 'background');
      ref('asset', s.music, s.source, 'music');
      s.hotspots.forEach((h, i) => {
        ref('asset', h.image, s.source, `hotspots[${i}].image`);
        ref('character', h.character, s.source, `hotspots[${i}].character`);
        if (h.use) Object.keys(h.use.byItem).forEach((it) => ref('item', it, s.source, `hotspots[${i}].actions.use.${it}`));
        if (Object.keys(h.actions).length === 0 && !h.use) {
          ctx.report('warning', 'inert_hotspot', s.source, `hotspots[${i}]`, `le hotspot « ${h.id} » n'a aucune action`);
        }
      });
      s.exits.forEach((e, i) => ref('scene', e.to, s.source, `exits[${i}].to`));
    }

    // --- dialogues
    for (const d of Object.values(game.dialogues)) {
      ref('character', d.speaker, d.source, 'speaker');
      const node = (id: string | null, path: string) => {
        if (id !== null && !has(d.nodes, id)) {
          ctx.report('error', 'unknown_node', d.source, path, `nœud « ${id} » inconnu dans le dialogue « ${d.id} »`);
        }
      };
      node(d.start, 'start');
      for (const n of Object.values(d.nodes)) {
        const np = `nodes.${n.id}`;
        n.lines.forEach((l, i) => ref('speaker', l.speaker, d.source, `${np}.lines[${i}]`));
        node(n.next, `${np}.next`);
        n.choices.forEach((c, i) => {
          node(c.next, `${np}.choices[${i}].next`);
          ref('intent', c.intent, d.source, `${np}.choices[${i}].intent`);
        });
        if (n.free_text) {
          for (const [intent, t] of Object.entries(n.free_text.intents)) {
            ref('intent', intent, d.source, `${np}.free_text.intents.${intent}`);
            node(t.next, `${np}.free_text.intents.${intent}`);
          }
          node(n.free_text.fallback.next, `${np}.free_text.fallback`);
        }
        for (const key of ['on_give', 'on_show'] as const) {
          const r = n[key];
          if (!r) continue;
          for (const [item, t] of Object.entries(r.byItem)) {
            ref('item', item, d.source, `${np}.${key}.${item}`);
            node(t.next, `${np}.${key}.${item}`);
          }
          if (r.default) node(r.default.next, `${np}.${key}.default`);
        }
      }
    }

    // --- objets
    for (const it of Object.values(game.items)) {
      ref('asset', it.icon, it.source, `${it.id}.icon`);
      it.scope?.forEach((w, i) => ref('world', w, it.source, `${it.id}.scope[${i}]`));
      it.combine.forEach((c, i) => {
        const p = `${it.id}.combine[${i}]`;
        ref('item', c.with, it.source, `${p}.with`);
        ref('item', c.result, it.source, `${p}.result`);
        c.consume.forEach((x, j) => {
          ref('item', x, it.source, `${p}.consume[${j}]`);
          if (x !== it.id && x !== c.with) {
            ctx.report('warning', 'consume_other', it.source, `${p}.consume[${j}]`, `« ${x} » consommé alors qu'il ne participe pas à la combinaison`);
          }
        });
        if (game.items[c.with]?.combine.some((o) => o.with === it.id)) {
          ctx.report('warning', 'duplicate_combine', it.source, p, `combinaison ${it.id} + ${c.with} déclarée sur les deux objets (une seule est utilisée)`);
        }
      });
    }

    // --- assets
    for (const a of Object.values(game.assets)) {
      a.references.forEach((r, i) => ref('asset', r, a.source, `${a.id}.references[${i}]`));
    }

    // --- scripts
    visitSteps(game, (step, loc) => {
      const { file, path } = loc;
      switch (step.kind) {
        case 'counter_add':
        case 'counter_set':
          ref('counter', step.counter, file, path);
          break;
        case 'give_item':
        case 'take_item':
          ref('item', step.item, file, path);
          break;
        case 'reveal':
        case 'hide': {
          const targets = (sceneId: string) => {
            const s = game.scenes[sceneId];
            return !!s && (s.hotspots.some((h) => h.id === step.target) || s.exits.some((e) => e.id === step.target));
          };
          if (step.scene !== null) {
            if (ref('scene', step.scene, file, path) && !targets(step.scene)) {
              ctx.report('error', 'unknown_target', file, path, `aucun hotspot ni sortie « ${step.target} » dans la scène « ${step.scene} »`);
            }
          } else if (!Object.keys(game.scenes).some(targets)) {
            ctx.report('error', 'unknown_target', file, path, `aucun hotspot ni sortie « ${step.target} » dans aucune scène`);
          }
          break;
        }
        case 'goto_scene':
          ref('scene', step.scene, file, path);
          break;
        case 'start_dialogue':
          if (ref('dialogue', step.dialogue, file, path) && step.node !== null && !has(game.dialogues[step.dialogue]!.nodes, step.node)) {
            ctx.report('error', 'unknown_node', file, path, `nœud « ${step.node} » inconnu dans le dialogue « ${step.dialogue} »`);
          }
          break;
        case 'unlock_quest':
        case 'complete_quest':
          ref('quest', step.quest, file, path);
          break;
        case 'say':
          ref('speaker', step.speaker, file, path);
          break;
        case 'end_game':
          ref('ending', step.ending, file, path);
          break;
      }
    });
    visitConditions(game, (cond, loc) => checkCondition(cond, loc, ref));
  },
};

// ---------------------------------------------------------------------------
// Assets sans image
// ---------------------------------------------------------------------------

/** Avertit pour chaque asset déclaré sans image retenue dans `assets/images/`. */
export const missingImagesAnalyzer: Analyzer = {
  name: 'missing-images',
  level: 'refs',
  run(game, ctx) {
    const missing = Object.values(game.assets).filter((a) => a.file === null);
    for (const a of missing) {
      ctx.report('warning', 'missing_image', a.source, a.id, `pas d'image retenue pour « ${a.id} » (assets/images/${a.id}.webp) : placeholder au rendu`);
    }
  },
};

// ---------------------------------------------------------------------------
// Obtenabilité et orphelins
// ---------------------------------------------------------------------------

/** Tout objet défini doit être obtenable : `give_item` quelque part, résultat de combinaison ou inventaire initial. */
export const obtainableItemsAnalyzer: Analyzer = {
  name: 'obtainable-items',
  level: 'refs',
  run(game, ctx) {
    const obtainable = new Set<string>(Object.keys(game.meta.initial.inventory));
    visitSteps(game, (s) => {
      if (s.kind === 'give_item') obtainable.add(s.item);
    });
    for (const it of Object.values(game.items)) for (const c of it.combine) if (c.result) obtainable.add(c.result);
    for (const it of Object.values(game.items)) {
      if (!obtainable.has(it.id)) {
        ctx.report(
          'error',
          'unobtainable_item',
          it.source,
          it.id,
          `l'objet « ${it.id} » n'est jamais obtenable (aucun give_item, aucune combinaison, absent de l'inventaire initial)`,
        );
      }
    }
  },
};

/** Avertissements : scènes et dialogues jamais référencés, nœuds inaccessibles, drapeaux testés jamais levés, intentions inutilisées. */
export const orphansAnalyzer: Analyzer = {
  name: 'orphans',
  level: 'refs',
  run(game, ctx) {
    const scenesUsed = new Set([game.meta.start_scene]);
    const dialoguesUsed = new Set<string>();
    const nodesUsed = new Map<string, Set<string>>();
    const flagsSet = new Set(game.meta.initial.flags);
    const intentsUsed = new Set<string>();
    for (const s of Object.values(game.scenes)) for (const e of s.exits) scenesUsed.add(e.to);
    visitSteps(game, (s) => {
      if (s.kind === 'goto_scene') scenesUsed.add(s.scene);
      if (s.kind === 'start_dialogue') {
        dialoguesUsed.add(s.dialogue);
        if (s.node) {
          if (!nodesUsed.has(s.dialogue)) nodesUsed.set(s.dialogue, new Set());
          nodesUsed.get(s.dialogue)!.add(s.node);
        }
      }
      if (s.kind === 'set_flag') flagsSet.add(s.flag);
    });
    for (const s of Object.values(game.scenes)) {
      if (!scenesUsed.has(s.id)) ctx.report('warning', 'orphan_scene', s.source, '', `la scène « ${s.id} » n'est jamais atteinte (aucune sortie ni goto_scene)`);
    }
    for (const d of Object.values(game.dialogues)) {
      if (!dialoguesUsed.has(d.id)) ctx.report('warning', 'orphan_dialogue', d.source, '', `le dialogue « ${d.id} » n'est jamais lancé`);
      // nœuds accessibles depuis start (et les nœuds d'entrée explicites)
      const seen = new Set<string>();
      const todo = [d.start, ...(nodesUsed.get(d.id) ?? [])];
      while (todo.length > 0) {
        const id = todo.pop()!;
        const n = d.nodes[id];
        if (!n || seen.has(id)) continue;
        seen.add(id);
        const nexts = [
          n.next,
          ...n.choices.map((c) => c.next),
          ...Object.values(n.free_text?.intents ?? {}).map((t) => t.next),
          n.free_text?.fallback.next ?? null,
          ...[n.on_give, n.on_show].flatMap((r) => (r ? [...Object.values(r.byItem), ...(r.default ? [r.default] : [])].map((t) => t.next) : [])),
        ];
        for (const x of nexts) if (x) todo.push(x);
        for (const c of n.choices) if (c.intent) intentsUsed.add(c.intent);
        for (const i of Object.keys(n.free_text?.intents ?? {})) intentsUsed.add(i);
      }
      for (const id of Object.keys(d.nodes)) {
        if (!seen.has(id)) ctx.report('warning', 'orphan_node', d.source, `nodes.${id}`, `nœud « ${id} » inaccessible`);
      }
    }
    visitConditions(game, (cond, loc) =>
      forEachCondition(cond, (c) => {
        if (c.kind === 'flag' && !flagsSet.has(c.flag)) {
          ctx.report('warning', 'flag_never_set', loc.file, loc.path, `le drapeau « ${c.flag} » est testé mais jamais levé (set)`);
        }
      }),
    );
    for (const i of Object.values(game.intents)) {
      if (!i.reserved && !intentsUsed.has(i.id) && i.source) {
        ctx.report('warning', 'unused_intent', i.source, i.id, `l'intention « ${i.id} » n'est utilisée par aucun dialogue`);
      }
    }
  },
};

/** Analyseurs exécutés par défaut, dans l'ordre. L'analyse de jouabilité viendra s'ajouter ici (niveau `playability`). */
export const defaultAnalyzers: readonly Analyzer[] = [
  gameRulesAnalyzer,
  referencesAnalyzer,
  obtainableItemsAnalyzer,
  orphansAnalyzer,
  missingImagesAnalyzer,
];

/** Utilitaire pour d'autres analyseurs : tous les scripts avec leur localisation. */
export function allScripts(game: GameData): { script: Script; loc: Location }[] {
  const out: { script: Script; loc: Location }[] = [];
  visitScripts(game, (script, loc) => out.push({ script, loc }));
  return out;
}
