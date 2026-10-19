/** Orchestration par asset : candidats dans `_candidates/`, sélection (assets.yaml), validation humaine. */
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse, parseDocument } from 'yaml';
import { IMAGE_EXTENSIONS, loadContent, type AssetKind, type GameData, type ProjectConfig } from '@scroum/schema';
import { readContentDir } from '@scroum/validate/node';
import { createProvider } from './config';
import { buildPrompt, parseStyle, type StyleGuide } from './style';
import { ImageError, type Candidate, type ImageProvider, type Progress } from './types';

export interface ImagesContext {
  root: string;
  contentDir: string;
  config: ProjectConfig | null;
  /** Fournisseur injecté (tests) ; sinon ComfyUI selon scroum.local.yaml. */
  provider?: ImageProvider;
}

export interface GenRequest {
  assetId: string;
  n?: number;
  prompt?: string;
  negative?: string;
  workflow?: string;
  /** Ids d'assets, ou `candidate:<n>` / `candidate:<assetId>/<n>`. */
  references?: string[];
  seed?: number;
  /** Variante : numéro d'un candidat de cet asset pris comme référence (workflow d'édition). */
  variantOf?: number;
  world?: string;
}

export interface CandidateMeta {
  n: number;
  assetId: string;
  file: string;
  /** Prompt utilisateur (sans préfixe/suffixe de style). */
  userPrompt: string;
  /** Prompt envoyé à ComfyUI. */
  prompt: string;
  negative: string;
  seed: number;
  workflow: string;
  references: string[];
  model: string | null;
  width: number | null;
  height: number | null;
  world: string | null;
  variantOf: number | null;
  createdAt: string;
}

export interface GenHooks {
  onProgress?: (p: Progress & { assetId: string }) => void;
  onCandidate?: (m: CandidateMeta) => void;
  signal?: AbortSignal;
}

const ID_RE = /^[A-Za-z0-9_-]+$/;
const DEFAULT_SIZE: Record<AssetKind, [number, number]> = {
  background: [1280, 720],
  ending: [1280, 720],
  character: [1024, 1024],
  portrait: [1024, 1024],
  avatar: [1024, 1024],
  sprite: [768, 1024],
  item: [512, 512],
  other: [1024, 1024],
};
const DEFAULT_WORKFLOW: Record<AssetKind, string> = {
  background: 'bg',
  ending: 'bg',
  character: 'char_sheet',
  portrait: 'char_sheet',
  avatar: 'char_sheet',
  sprite: 'char_sheet',
  item: 'item_icon',
  other: 'bg',
};

export const candidatesDir = (contentDir: string, id: string): string => join(contentDir, 'assets', '_candidates', id);
const assetsYaml = (contentDir: string): string => join(contentDir, 'assets', 'assets.yaml');

export function checkId(id: unknown): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new ImageError('missing_param', `identifiant d'asset invalide : ${String(id)}`);
  return id;
}

async function readAssets(contentDir: string): Promise<Record<string, Record<string, unknown>>> {
  try {
    const v = parse(await readFile(assetsYaml(contentDir), 'utf8'));
    return v && typeof v === 'object' ? (v as Record<string, Record<string, unknown>>) : {};
  } catch {
    return {};
  }
}

export async function loadStyle(contentDir: string): Promise<StyleGuide | null> {
  try {
    return parseStyle(await readFile(join(contentDir, 'bible', 'style.md'), 'utf8'));
  } catch {
    return null;
  }
}

/** Monde d'un asset : champ `world`, sinon scène dont c'est le décor, sinon personnage dont c'est l'avatar/portrait. */
export function assetWorld(game: GameData | null, id: string, declared?: string | null): string | null {
  if (declared) return declared;
  if (!game) return null;
  for (const s of Object.values(game.scenes)) if (s.background === id) return s.world;
  for (const c of Object.values(game.characters)) {
    for (const face of [c.persona, c.identity]) {
      if (face && (face.avatar === id || face.portrait === id) && face.world) return face.world;
    }
  }
  return null;
}

export function imagePath(contentDir: string, id: string): string | null {
  for (const ext of IMAGE_EXTENSIONS) {
    const f = join(contentDir, 'assets', 'images', `${id}.${ext}`);
    if (existsSync(f)) return f;
  }
  return null;
}

export async function listCandidates(contentDir: string, id: string): Promise<CandidateMeta[]> {
  const dir = candidatesDir(contentDir, checkId(id));
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: CandidateMeta[] = [];
  for (const n of names.filter((x) => /^\d+\.json$/.test(x))) {
    try {
      out.push(JSON.parse(await readFile(join(dir, n), 'utf8')) as CandidateMeta);
    } catch {
      /* métadonnées illisibles : ignorées */
    }
  }
  return out.sort((a, b) => a.n - b.n);
}

async function resolveRef(ctx: ImagesContext, assetId: string, ref: string): Promise<string> {
  const c = /^candidate:(?:([A-Za-z0-9_-]+)\/)?(\d+)$/.exec(ref);
  if (c) {
    const f = join(candidatesDir(ctx.contentDir, c[1] ?? assetId), `${c[2]}.png`);
    const alt = (await readdir(candidatesDir(ctx.contentDir, c[1] ?? assetId)).catch(() => [] as string[])).find((x) => x.startsWith(`${c[2]}.`) && !x.endsWith('.json'));
    if (existsSync(f)) return f;
    if (alt) return join(candidatesDir(ctx.contentDir, c[1] ?? assetId), alt);
    throw new ImageError('missing_param', `candidat introuvable : ${ref}`);
  }
  const p = ID_RE.test(ref) ? imagePath(ctx.contentDir, ref) : null;
  if (!p) throw new ImageError('missing_param', `référence « ${ref} » : aucune image retenue pour cet asset (assets/images/${ref}.*)`);
  return p;
}

/** Génère `n` candidats pour un asset de `assets.yaml` et les écrit dans `_candidates/<assetId>/`. */
export async function generateForAsset(ctx: ImagesContext, req: GenRequest, hooks: GenHooks = {}): Promise<CandidateMeta[]> {
  const id = checkId(req.assetId);
  const asset = (await readAssets(ctx.contentDir))[id];
  if (!asset) throw new ImageError('missing_param', `asset « ${id} » absent de assets/assets.yaml`);
  const kind = (typeof asset.kind === 'string' && asset.kind in DEFAULT_SIZE ? asset.kind : 'other') as AssetKind;
  const n = Math.min(16, Math.max(1, Math.floor(req.n ?? 1)));
  const userPrompt = (req.prompt ?? (typeof asset.prompt === 'string' ? asset.prompt : '')).trim();
  if (!userPrompt) throw new ImageError('missing_param', `asset « ${id} » : aucun prompt (le renseigner dans assets.yaml ou le passer à la génération)`);

  const refs = [...(req.references ?? (Array.isArray(asset.references) ? (asset.references as string[]) : []))];
  if (req.variantOf !== undefined) refs.unshift(`candidate:${req.variantOf}`);
  const refPaths = await Promise.all(refs.map((r) => resolveRef(ctx, id, r)));
  const workflow = req.workflow ?? (typeof asset.workflow === 'string' && asset.workflow && !(refs.length === 0 && asset.workflow === 'char_edit') ? asset.workflow : refs.length > 0 ? 'char_edit' : DEFAULT_WORKFLOW[kind]);
  const editing = refPaths.length > 0;

  const loaded = await readContentDir(ctx.contentDir).then((f) => loadContent(f).game ?? null).catch(() => null);
  const world = req.world ?? assetWorld(loaded, id, typeof asset.world === 'string' ? asset.world : null);
  const style = await loadStyle(ctx.contentDir);
  const userNeg = req.negative ?? (typeof asset.negative === 'string' ? asset.negative : '');
  const built = editing ? { prompt: userPrompt, negative: userNeg } : buildPrompt(style, world, userPrompt, userNeg);
  const [dw, dh] = DEFAULT_SIZE[kind];
  const width = typeof asset.width === 'number' ? asset.width : dw;
  const height = typeof asset.height === 'number' ? asset.height : dh;
  const seed = req.seed;

  const provider = ctx.provider ?? (await createProvider(ctx.root, ctx.config));
  const dir = candidatesDir(ctx.contentDir, id);
  await mkdir(dir, { recursive: true });
  let next = Math.max(0, ...(await listCandidates(ctx.contentDir, id)).map((c) => c.n)) + 1;
  const metas: CandidateMeta[] = [];
  const opts = {
    n,
    ...(hooks.signal ? { signal: hooks.signal } : {}),
    onProgress: (p: Progress) => hooks.onProgress?.({ ...p, assetId: id }),
    onCandidate: async (c: Candidate) => {
      const k = next++;
      const file = `${k}.${c.ext}`;
      await writeFile(join(dir, file), c.data);
      const meta: CandidateMeta = {
        n: k,
        assetId: id,
        file,
        userPrompt,
        prompt: c.prompt,
        negative: c.negative ?? built.negative,
        seed: c.seed,
        workflow: c.workflow,
        references: refs,
        model: c.model ?? null,
        width: c.width ?? width,
        height: c.height ?? height,
        world,
        variantOf: req.variantOf ?? null,
        createdAt: new Date().toISOString(),
      };
      await writeFile(join(dir, `${k}.json`), JSON.stringify(meta, null, 2) + '\n');
      metas.push(meta);
      hooks.onCandidate?.(meta);
    },
  };
  if (editing) await provider.edit({ references: refPaths, instruction: built.prompt, negative: built.negative, workflow, ...(seed !== undefined ? { seed } : {}), width, height }, opts);
  else await provider.generate({ prompt: built.prompt, negative: built.negative, width, height, workflow, ...(seed !== undefined ? { seed } : {}) }, opts);
  return metas;
}

/** Écrit des champs dans l'entrée d'un asset en conservant commentaires et ordre du YAML. */
async function patchAsset(contentDir: string, id: string, patch: Record<string, unknown>): Promise<void> {
  const file = assetsYaml(contentDir);
  const doc = parseDocument(await readFile(file, 'utf8'));
  if (!doc.hasIn([id])) throw new ImageError('missing_param', `asset « ${id} » absent de assets/assets.yaml`);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0 && !doc.hasIn([id, k]))) continue;
    doc.setIn([id, k], v);
  }
  await writeFile(file, String(doc), 'utf8');
}

/**
 * Retient un candidat : copie dans `assets/images/<id>.<ext>`, met à jour assets.yaml
 * (prompt, seed, workflow, références, modèle) et passe le statut à `review`. Jamais `validated`.
 */
export async function selectCandidate(contentDir: string, id: string, n: number): Promise<{ file: string; meta: CandidateMeta }> {
  checkId(id);
  const meta = (await listCandidates(contentDir, id)).find((c) => c.n === n);
  if (!meta) throw new ImageError('missing_param', `candidat ${n} introuvable pour « ${id} »`);
  const src = join(candidatesDir(contentDir, id), meta.file);
  if (!existsSync(src)) throw new ImageError('missing_param', `fichier du candidat ${n} manquant`);
  const ext = meta.file.split('.').pop()!;
  const imgDir = join(contentDir, 'assets', 'images');
  await mkdir(imgDir, { recursive: true });
  for (const e of IMAGE_EXTENSIONS) if (e !== ext) await rm(join(imgDir, `${id}.${e}`), { force: true });
  await copyFile(src, join(imgDir, `${id}.${ext}`));
  await patchAsset(contentDir, id, {
    status: 'review',
    prompt: meta.userPrompt,
    seed: meta.seed,
    workflow: meta.workflow,
    references: meta.references.filter((r) => ID_RE.test(r) && !r.startsWith('candidate')),
    model: meta.model,
    width: meta.width,
    height: meta.height,
  });
  return { file: `assets/images/${id}.${ext}`, meta };
}

/** Action humaine (bouton « Valider » de l'Atelier) : l'image doit exister. Jamais appelée par la CLI. */
export async function validateAsset(contentDir: string, id: string): Promise<void> {
  checkId(id);
  if (!imagePath(contentDir, id)) throw new ImageError('missing_param', `« ${id} » n'a pas d'image retenue à valider`);
  await patchAsset(contentDir, id, { status: 'validated' });
}

export interface AssetSummary {
  id: string;
  status: string;
  kind: string;
  prompt: string | null;
  workflow: string | null;
  seed: number | null;
  references: string[];
  hasImage: boolean;
  candidates: number;
  world: string | null;
}

export async function listAssets(contentDir: string): Promise<AssetSummary[]> {
  const assets = await readAssets(contentDir);
  const out: AssetSummary[] = [];
  for (const [id, a] of Object.entries(assets)) {
    if (!ID_RE.test(id)) continue;
    out.push({
      id,
      status: typeof a?.status === 'string' ? a.status : 'draft',
      kind: typeof a?.kind === 'string' ? a.kind : 'other',
      prompt: typeof a?.prompt === 'string' ? a.prompt : null,
      workflow: typeof a?.workflow === 'string' ? a.workflow : null,
      seed: typeof a?.seed === 'number' ? a.seed : null,
      references: Array.isArray(a?.references) ? (a.references as string[]) : [],
      hasImage: imagePath(contentDir, id) !== null,
      candidates: (await listCandidates(contentDir, id)).length,
      world: typeof a?.world === 'string' ? a.world : null,
    });
  }
  return out;
}
