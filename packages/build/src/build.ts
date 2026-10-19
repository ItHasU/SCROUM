/** Build du `.scroum.zip` d'un dépôt de jeu. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { assetWorld, loadStyle, postprocessFor } from '@scroum/images';
import { IMAGE_EXTENSIONS, writeGameZip, type ContentError, type GameData, type Postprocess, type ProjectConfig, type ZipManifest } from '@scroum/schema';
import { readContentDir } from '@scroum/validate/node';
import { validateContent, type ValidationReport } from '@scroum/validate';
import { resolveProject, type ResolvedProject } from './project';

export interface BuildOptions {
  /** Date du build (tests : reproductibilité). */
  buildDate?: string;
  /** Force la copie brute des images (sans sharp). */
  noSharp?: boolean;
  /** Post-traitement (pixelisation, palette) d'un asset ; null = aucun. */
  postprocess?: (assetId: string) => Postprocess | null;
}

export interface BuildResult {
  ok: boolean;
  /** Chemin absolu du zip (si ok). */
  zipPath?: string;
  manifest?: ZipManifest;
  report: ValidationReport;
  warnings: string[];
}

type Sharp = typeof import('sharp').default;

async function loadSharp(): Promise<Sharp | null> {
  try {
    return (await import('sharp')).default;
  } catch {
    return null;
  }
}

/** Images retenues de `assets/images/` (jamais `_candidates/`) : assetId → chemin. */
async function listImages(contentDir: string): Promise<Map<string, string>> {
  const dir = join(contentDir, 'assets', 'images');
  const out = new Map<string, string>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  const re = new RegExp(`^(.+)\\.(${IMAGE_EXTENSIONS.join('|')})$`, 'i');
  for (const n of names.sort()) {
    const m = re.exec(n);
    if (m && !n.startsWith('.')) out.set(m[1]!, join(dir, n));
  }
  return out;
}

export async function processImages(
  contentDir: string,
  cfg: { format: 'webp' | 'png' | 'jpg'; max_width: number },
  opts: BuildOptions,
  warnings: string[],
): Promise<Map<string, { ext: string; bytes: Uint8Array }>> {
  const result = new Map<string, { ext: string; bytes: Uint8Array }>();
  const files = await listImages(contentDir);
  if (files.size === 0) return result;
  const sharp = opts.noSharp ? null : await loadSharp();
  if (!sharp) warnings.push('sharp indisponible : images copiées sans conversion ni redimensionnement');
  for (const [id, path] of files) {
    const raw = await readFile(path);
    const origExt = path.split('.').pop()!.toLowerCase().replace('jpeg', 'jpg');
    if (!sharp) {
      result.set(id, { ext: origExt, bytes: new Uint8Array(raw) });
      continue;
    }
    try {
      let img = sharp(raw).rotate().resize({ width: cfg.max_width, withoutEnlargement: true });
      const pp = opts.postprocess?.(id) ?? null;
      if (pp?.pixelate || pp?.colors) img = sharp(await stylize(sharp, await img.png().toBuffer(), pp));
      img = cfg.format === 'webp' ? img.webp({ quality: 85 }) : cfg.format === 'png' ? img.png() : img.jpeg({ quality: 88 });
      result.set(id, { ext: cfg.format, bytes: new Uint8Array(await img.toBuffer()) });
    } catch (e) {
      warnings.push(`${basename(path)} : conversion impossible (${(e as Error).message}), copie brute`);
      result.set(id, { ext: origExt, bytes: new Uint8Array(raw) });
    }
  }
  return result;
}

/** Pixelisation (réduction puis agrandissement au plus proche voisin) et quantification de palette. */
async function stylize(sharp: Sharp, png: Buffer, pp: Postprocess): Promise<Buffer> {
  let buf = png;
  if (pp.pixelate) {
    const { width = 0, height = 0 } = await sharp(buf).metadata();
    const w = Math.max(1, Math.round(width / pp.pixelate));
    const h = Math.max(1, Math.round(height / pp.pixelate));
    const small = await sharp(buf).resize(w, h, { kernel: 'nearest', fit: 'fill' }).png().toBuffer();
    buf = await sharp(small).resize(width, height, { kernel: 'nearest', fit: 'fill' }).png().toBuffer();
  }
  if (pp.colors) buf = await sharp(buf).png({ palette: true, colors: pp.colors, dither: 0 }).toBuffer();
  return buf;
}

/** Réglage par monde : scroum.project.yaml (`images.postprocess`) prime sur le front-matter de bible/style.md. */
export async function postprocessResolver(contentDir: string, config: ProjectConfig | null, game: GameData): Promise<(id: string) => Postprocess | null> {
  const style = await loadStyle(contentDir);
  const fromProject = config?.images.postprocess;
  return (id) => {
    const world = assetWorld(game, id, game.assets[id]?.world);
    return (fromProject && ((world && fromProject[world]) || fromProject.default)) || postprocessFor(style, world);
  };
}

/** Valide complètement puis produit `<output>/<nom>-<version>.scroum.zip`. Aucun zip si la validation échoue. */
export async function buildProject(target: string | ResolvedProject, options: BuildOptions = {}): Promise<BuildResult> {
  const project = typeof target === 'string' ? resolveProject(target) : target;
  const report = validateContent(await readContentDir(project.contentDir));
  const warnings: string[] = [];
  if (!report.ok || !report.game) return { ok: false, report, warnings };
  const game: GameData = report.game;
  const images = await processImages(
    project.contentDir,
    project.config?.images ?? { format: 'webp', max_width: 1280 },
    { ...options, postprocess: options.postprocess ?? (await postprocessResolver(project.contentDir, project.config, game)) },
    warnings,
  );
  for (const [id, img] of images) if (game.assets[id]) game.assets[id].file = `images/${id}.${img.ext}`;
  const { bytes, manifest } = writeGameZip(game, images, { buildDate: options.buildDate });
  const outDir = join(project.root, project.config?.output ?? 'dist');
  const name = project.config?.name ?? slug(game.meta.title);
  const zipPath = join(outDir, `${name}-${game.meta.version}.scroum.zip`);
  await mkdir(outDir, { recursive: true });
  await writeFile(zipPath, bytes);
  return { ok: true, zipPath, manifest, report, warnings };
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';
}

export type { ContentError };
