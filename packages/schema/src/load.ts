/**
 * Chargement d'un dossier `content/` : parse YAML/Markdown, validation de
 * schéma, normalisation et assemblage en un `GameData` canonique.
 *
 * `loadContent` est pur (pas d'accès disque) : l'appelant fournit les
 * fichiers. Il ne vérifie PAS les références croisées (rôle de
 * `@scroum/validate`), seulement la forme de chaque fichier et l'assemblage.
 */
import { LineCounter, parseDocument, isNode, type Document } from 'yaml';
import { z } from 'zod';
import {
  AssetsFileSchema,
  BibleDocFrontMatterSchema,
  CharacterFileSchema,
  DEFAULT_REFUSE_LINE,
  DialogueFileSchema,
  GagsFileSchema,
  GameFileSchema,
  IntentsFileSchema,
  ItemsFileSchema,
  QuestsFileSchema,
  SceneFileSchema,
  WorldsFileSchema,
  gameMetaFromFile,
  parseWithEndings,
} from './files';
import { ID_PATTERN } from './normalize';
import type { ContentError, Ending, GameData, Intent, Scene, Script } from './types';
import { RESERVED_INTENTS } from './types';
import { FORMAT_VERSION } from './version';
import { forEachStep } from './visit';

/** Fichiers du dossier `content/` : chemin relatif (séparateur `/`) → contenu. Le contenu des images n'est pas lu. */
export type ContentFiles = Map<string, string | Uint8Array> | Record<string, string | Uint8Array>;

export interface LoadResult {
  /**
   * Le jeu assemblé, ou `null` si `game.yaml` est absent ou invalide.
   * Si `errors` contient des erreurs, les fichiers fautifs sont omis : le
   * jeu est partiel et ne doit pas être joué ni exporté.
   */
  game: GameData | null;
  errors: ContentError[];
}

/** Extensions d'image reconnues pour `assets/images/<assetId>.<ext>`. */
export const IMAGE_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg'] as const;

const frLocale = z.locales.fr();

/** Rangement d'un fichier de contenu selon son chemin. */
export type FileKind =
  | 'game'
  | 'worlds'
  | 'quests'
  | 'gags'
  | 'bible_doc'
  | 'character'
  | 'scene'
  | 'dialogue'
  | 'intents'
  | 'items'
  | 'assets'
  | 'image'
  | 'ignored'
  | 'unknown';

/** Classe un chemin relatif à `content/`. */
export function classifyPath(path: string): FileKind {
  const p = normalizePath(path);
  const base = p.split('/').pop() ?? '';
  if (base.startsWith('.') || p.startsWith('assets/_candidates/') || p.startsWith('skins/')) return 'ignored';
  if (/^README(\.md)?$/i.test(p)) return 'ignored';
  const yaml = /\.ya?ml$/.test(p);
  if (yaml) {
    const stem = p.replace(/\.ya?ml$/, '');
    switch (stem) {
      case 'game':
        return 'game';
      case 'bible/worlds':
        return 'worlds';
      case 'bible/quests':
        return 'quests';
      case 'bible/gags':
        return 'gags';
      case 'intents':
        return 'intents';
      case 'items':
        return 'items';
      case 'assets/assets':
        return 'assets';
    }
    if (/^characters\/[^/]+$/.test(stem)) return 'character';
    if (/^scenes\/[^/]+$/.test(stem)) return 'scene';
    if (/^dialogues\/[^/]+$/.test(stem)) return 'dialogue';
  }
  if (/^bible\/[^/]+\.md$/.test(p)) return 'bible_doc';
  if (new RegExp(`^assets/images/[^/]+\\.(${IMAGE_EXTENSIONS.join('|')})$`, 'i').test(p)) return 'image';
  return 'unknown';
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function stemOf(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
}

/** Formate un chemin zod/yaml en notation pointée : `hotspots[0].actions.look`. */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += out ? `.${String(seg)}` : String(seg);
  }
  return out;
}

interface ParsedYaml {
  data: unknown;
  doc: Document | null;
  lines: LineCounter;
}

function parseYaml(file: string, text: string, errors: ContentError[], offsetLines = 0): ParsedYaml | null {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, uniqueKeys: true, prettyErrors: false });
  if (doc.errors.length > 0) {
    for (const e of doc.errors) {
      const pos = e.linePos?.[0];
      errors.push({
        severity: 'error',
        code: 'yaml',
        file,
        path: '',
        ...(pos ? { line: pos.line + offsetLines } : {}),
        message: `YAML invalide : ${e.message.split('\n')[0]}`,
      });
    }
    return null;
  }
  for (const w of doc.warnings) {
    errors.push({ severity: 'warning', code: 'yaml', file, path: '', message: w.message.split('\n')[0] ?? '' });
  }
  return { data: doc.toJS({ maxAliasCount: 1000 }), doc, lines };
}

/** Ligne (1-based) du nœud YAML le plus proche du chemin donné. */
function lineOf(parsed: ParsedYaml, path: readonly PropertyKey[]): number | undefined {
  if (!parsed.doc) return undefined;
  for (let n = path.length; n >= 0; n--) {
    const node = parsed.doc.getIn(path.slice(0, n) as unknown[], true);
    if (isNode(node) && node.range) return parsed.lines.linePos(node.range[0]).line;
  }
  return undefined;
}

function schemaErrors(file: string, parsed: ParsedYaml, error: z.ZodError, errors: ContentError[], offsetLines = 0): void {
  for (const issue of error.issues) {
    const line = lineOf(parsed, issue.path);
    errors.push({
      severity: 'error',
      code: 'schema',
      file,
      path: formatPath(issue.path),
      ...(line !== undefined ? { line: line + offsetLines } : {}),
      message: issue.message,
    });
  }
}

/** Parse + valide un fichier YAML avec un schéma ; renvoie null en cas d'erreur. */
function parseWith<S extends z.ZodType>(
  file: string,
  text: string,
  schema: S,
  errors: ContentError[],
  endings: { ending: Ending; file: string }[],
): z.output<S> | null {
  const parsed = parseYaml(file, text, errors);
  if (!parsed) return null;
  const { result, endings: inline } = parseWithEndings(() => schema.safeParse(parsed.data ?? {}, { error: frLocale.localeError }));
  if (!result.success) {
    schemaErrors(file, parsed, result.error, errors);
    return null;
  }
  for (const ending of inline) endings.push({ ending, file });
  return result.data as z.output<S>;
}

/** Sépare le front matter YAML (`---` … `---`) du corps d'un fichier Markdown. */
export function splitFrontMatter(text: string): { frontMatter: string | null; body: string; bodyLine: number } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { frontMatter: null, body: text, bodyLine: 1 };
  return { frontMatter: m[1] ?? '', body: text.slice(m[0].length), bodyLine: m[0].split('\n').length };
}

function textOf(content: string | Uint8Array): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

function fillSceneInScripts(scene: Scene): void {
  const fill = (script: Script) =>
    forEachStep(script, (s) => {
      if ((s.kind === 'reveal' || s.kind === 'hide') && s.scene === null) s.scene = scene.id;
    });
  fill(scene.on_enter);
  for (const h of scene.hotspots) {
    for (const a of Object.values(h.actions)) fill(a.script);
    if (h.use) {
      Object.values(h.use.byItem).forEach(fill);
      if (h.use.default) fill(h.use.default);
    }
  }
  for (const e of scene.exits) {
    fill(e.script);
    fill(e.else);
  }
}

const RESERVED_INTENT_DEFS: Record<string, Intent> = {
  give_item: {
    id: 'give_item',
    desc: 'Donner un objet de l’inventaire à l’interlocuteur (intention réservée, fournie par le moteur)',
    examples: ['tiens, prends ça', 'je te donne la clé'],
    keywords: ['donne', 'donner', 'tiens', 'prends', 'offre', 'offrir'],
    reserved: true,
    source: null,
  },
  show_item: {
    id: 'show_item',
    desc: 'Montrer un objet de l’inventaire à l’interlocuteur (intention réservée, fournie par le moteur)',
    examples: ['regarde ça', 'je te montre la photo'],
    keywords: ['montre', 'montrer', 'regarde', 'vois'],
    reserved: true,
    source: null,
  },
};

/** Crée un `GameData` vide (utile aux tests et à l'éditeur). */
export function emptyGameData(): GameData {
  return {
    formatVersion: FORMAT_VERSION,
    meta: {
      title: '',
      version: '0.0.0',
      formatVersion: FORMAT_VERSION,
      description: null,
      start_scene: '',
      player_character: null,
      refuse_line: DEFAULT_REFUSE_LINE,
      character_roles: [],
      validation: { characters: { require_age: false, min_age: null } },
      initial: { flags: [], vars: {}, inventory: {}, quests: [] },
    },
    counters: {},
    endings: {},
    collections: [],
    worlds: {},
    quests: {},
    bible: { docs: {}, gags: {} },
    characters: {},
    scenes: {},
    dialogues: {},
    intents: structuredClone(RESERVED_INTENT_DEFS),
    items: {},
    assets: {},
  };
}

/**
 * Charge le contenu d'un jeu.
 *
 * @param files chemins relatifs à `content/` (ex. `scenes/port.yaml`) → contenu texte
 *   (les images peuvent avoir un contenu vide : seule leur présence compte).
 */
export function loadContent(files: ContentFiles): LoadResult {
  const errors: ContentError[] = [];
  const entries = (files instanceof Map ? [...files.entries()] : Object.entries(files))
    .map(([p, c]) => [normalizePath(p), c] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  const byKind = new Map<FileKind, (readonly [string, string | Uint8Array])[]>();
  for (const e of entries) {
    const kind = classifyPath(e[0]);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind)!.push(e);
  }
  const of = (k: FileKind) => byKind.get(k) ?? [];

  for (const [file] of of('unknown')) {
    errors.push({ severity: 'warning', code: 'unknown_file', file, path: '', message: 'fichier non reconnu, ignoré' });
  }

  const endings: { ending: Ending; file: string }[] = [];

  // --- game.yaml -----------------------------------------------------------
  const gameEntry = of('game');
  if (gameEntry.length === 0) {
    errors.push({ severity: 'error', code: 'missing_file', file: 'game.yaml', path: '', message: 'game.yaml est obligatoire' });
    return { game: null, errors };
  }
  if (gameEntry.length > 1) {
    errors.push({ severity: 'error', code: 'duplicate_file', file: gameEntry[1]![0], path: '', message: 'game.yaml et game.yml coexistent' });
  }
  const [gameFile, gameText] = gameEntry[0]!;
  const gameParsed = parseYaml(gameFile, textOf(gameText), errors);
  if (!gameParsed) return { game: null, errors };
  const fv = (gameParsed.data as Record<string, unknown> | null)?.formatVersion;
  if (typeof fv === 'number' && fv !== FORMAT_VERSION) {
    errors.push({
      severity: 'error',
      code: 'format_version',
      file: gameFile,
      path: 'formatVersion',
      ...(lineOf(gameParsed, ['formatVersion']) !== undefined ? { line: lineOf(gameParsed, ['formatVersion'])! } : {}),
      message:
        fv > FORMAT_VERSION
          ? `format ${fv} plus récent que ce SCROUM (format ${FORMAT_VERSION}) : mettre à jour SCROUM`
          : `format ${fv} ancien : migrer le contenu vers le format ${FORMAT_VERSION}`,
    });
    return { game: null, errors };
  }
  const gameRes = parseWithEndings(() => GameFileSchema.safeParse(gameParsed.data ?? {}, { error: frLocale.localeError }));
  if (!gameRes.result.success) {
    schemaErrors(gameFile, gameParsed, gameRes.result.error, errors);
    return { game: null, errors };
  }
  const g = gameRes.result.data;
  const game = emptyGameData();
  game.meta = gameMetaFromFile(g);
  for (const [id, c] of Object.entries(g.counters)) game.counters[id] = { id, ...c };
  for (const [id, e] of Object.entries(g.endings)) game.endings[id] = { id, ...e };
  game.collections = g.collections;

  // --- bible -----------------------------------------------------------------
  for (const [file, content] of of('worlds')) {
    const worlds = parseWith(file, textOf(content), WorldsFileSchema, errors, endings);
    for (const [id, w] of Object.entries(worlds ?? {})) {
      game.worlds[id] = { id, ...w, refuse_line: w.refuse_line ?? g.refuse_line, source: file };
    }
  }
  for (const [file, content] of of('quests')) {
    const quests = parseWith(file, textOf(content), QuestsFileSchema, errors, endings);
    for (const [id, q] of Object.entries(quests ?? {})) game.quests[id] = { id, ...q, source: file };
  }
  for (const [file, content] of of('gags')) {
    const gags = parseWith(file, textOf(content), GagsFileSchema, errors, endings);
    for (const [id, x] of Object.entries(gags ?? {})) game.bible.gags[id] = { id, ...x, source: file };
  }
  for (const [file, content] of of('bible_doc')) {
    const { frontMatter, body } = splitFrontMatter(textOf(content));
    let status: 'draft' | 'review' | 'validated' | 'rejected' = 'draft';
    if (frontMatter !== null) {
      const fm = parseWith(file, frontMatter, BibleDocFrontMatterSchema, errors, endings);
      if (fm) status = fm.status;
    }
    const id = stemOf(file);
    game.bible.docs[id] = { id, status, body, source: file };
  }

  // --- fichiers à un élément ------------------------------------------------
  const single = <T extends { id?: string }>(kind: FileKind, schema: z.ZodType<T>, what: string): [string, string, T][] => {
    const out: [string, string, T][] = [];
    for (const [file, content] of of(kind)) {
      const id = stemOf(file);
      if (!ID_PATTERN.test(id)) {
        errors.push({ severity: 'error', code: 'bad_filename', file, path: '', message: `nom de fichier « ${id} » invalide : il sert d'id (${what})` });
        continue;
      }
      const v = parseWith(file, textOf(content), schema, errors, endings);
      if (!v) continue;
      if (v.id !== undefined && v.id !== id) {
        errors.push({ severity: 'error', code: 'id_mismatch', file, path: 'id', message: `id « ${v.id} » différent du nom de fichier « ${id} »` });
        continue;
      }
      if (out.some(([, other]) => other === id)) {
        errors.push({ severity: 'error', code: 'duplicate_id', file, path: '', message: `${what} « ${id} » défini deux fois (.yaml et .yml ?)` });
        continue;
      }
      out.push([file, id, v]);
    }
    return out;
  };

  for (const [file, id, c] of single('character', CharacterFileSchema, 'personnage')) {
    const { id: _ignored, ...rest } = c;
    game.characters[id] = { id, ...rest, source: file };
  }
  for (const [file, id, s] of single('scene', SceneFileSchema, 'scène')) {
    const { id: _ignored, ...rest } = s;
    const scene: Scene = { id, ...rest, source: file };
    fillSceneInScripts(scene);
    game.scenes[id] = scene;
  }
  for (const [file, id, d] of single('dialogue', DialogueFileSchema, 'dialogue')) {
    const { id: _ignored, ...rest } = d;
    game.dialogues[id] = { id, ...rest, source: file };
  }

  // --- catalogues --------------------------------------------------------------
  for (const [file, content] of of('intents')) {
    const intents = parseWith(file, textOf(content), IntentsFileSchema, errors, endings);
    for (const [id, i] of Object.entries(intents ?? {})) {
      if ((RESERVED_INTENTS as readonly string[]).includes(id)) {
        errors.push({ severity: 'error', code: 'reserved_intent', file, path: id, message: `l'intention « ${id} » est réservée et fournie par le moteur` });
        continue;
      }
      game.intents[id] = { id, ...i, reserved: false, source: file };
    }
  }
  for (const [file, content] of of('items')) {
    const items = parseWith(file, textOf(content), ItemsFileSchema, errors, endings);
    for (const [id, i] of Object.entries(items ?? {})) game.items[id] = { id, ...i, source: file };
  }
  const images = new Map<string, string>();
  for (const [file] of of('image')) {
    const id = stemOf(file);
    if (images.has(id)) {
      errors.push({ severity: 'warning', code: 'duplicate_image', file, path: '', message: `plusieurs images pour l'asset « ${id} » ; « ${images.get(id)} » est retenue` });
      continue;
    }
    images.set(id, file);
  }
  for (const [file, content] of of('assets')) {
    const assets = parseWith(file, textOf(content), AssetsFileSchema, errors, endings);
    for (const [id, a] of Object.entries(assets ?? {})) game.assets[id] = { id, ...a, file: images.get(id) ?? null, source: file };
  }

  // --- fins déclarées en ligne ---------------------------------------------------
  for (const e of [...gameRes.endings.map((ending) => ({ ending, file: gameFile })), ...endings]) {
    const prev = game.endings[e.ending.id];
    if (!prev) {
      game.endings[e.ending.id] = e.ending;
      continue;
    }
    const same = (k: keyof Ending) => e.ending[k] === null || e.ending[k] === prev[k];
    if (!(same('type') && same('title') && same('text') && same('image'))) {
      errors.push({
        severity: 'error',
        code: 'ending_conflict',
        file: e.file,
        path: '',
        message: `la fin « ${e.ending.id} » est décrite de deux façons différentes (la déclarer une fois dans game.yaml → endings)`,
      });
    }
  }

  return { game, errors };
}

/** Raccourci : erreurs bloquantes seulement. */
export function hasErrors(errors: readonly ContentError[]): boolean {
  return errors.some((e) => e.severity === 'error');
}
