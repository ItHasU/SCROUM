/**
 * Format du `.scroum.zip` (navigateur + Node) :
 *
 *   manifest.json            { formatVersion, title, version, buildDate, images: [{ id, file }] }
 *   game.json                GameData canonique et validé
 *   images/<assetId>.<ext>   images retenues (webp en général)
 *
 * `writeGameZip` sert au build, `readGameZip` au player (refus propre si le
 * `formatVersion` est inconnu ou plus récent que ce moteur).
 */
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import type { GameData } from './types';
import { FORMAT_VERSION, FormatVersionError, migrate, readFormatVersion } from './version';

export interface ZipManifestImage {
  /** assetId (nom de fichier sans extension). */
  id: string;
  /** Chemin dans le zip, ex. `images/img_port_bg.webp`. */
  file: string;
}

export interface ZipManifest {
  formatVersion: number;
  title: string;
  version: string;
  /** Date ISO 8601 du build. */
  buildDate: string;
  images: ZipManifestImage[];
}

export interface GameZip {
  manifest: ZipManifest;
  game: GameData;
  /** assetId → octets de l'image. */
  images: Map<string, Uint8Array>;
}

/** Zip illisible ou incohérent (hors incompatibilité de version, voir `FormatVersionError`). */
export class GameZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameZipError';
  }
}

/** Fichiers de contenu d'image portés par un zip : `images/<assetId>.<ext>`. */
export const ZIP_IMAGE_RE = /^images\/([^/]+)\.(webp|png|jpe?g)$/i;

/** Produit le zip. `images` : assetId → { ext, bytes }. */
export function writeGameZip(
  game: GameData,
  images: Map<string, { ext: string; bytes: Uint8Array }>,
  opts: { buildDate?: string } = {},
): { bytes: Uint8Array; manifest: ZipManifest } {
  const manifest: ZipManifest = {
    formatVersion: FORMAT_VERSION,
    title: game.meta.title,
    version: game.meta.version,
    buildDate: opts.buildDate ?? new Date().toISOString(),
    images: [...images.keys()].sort().map((id) => ({ id, file: `images/${id}.${images.get(id)!.ext}` })),
  };
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'game.json': strToU8(JSON.stringify(game)),
  };
  for (const img of manifest.images) files[img.file] = images.get(img.id)!.bytes;
  // Les images sont déjà compressées : niveau 0 pour elles, 6 pour le JSON.
  const zipInput: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [k, v] of Object.entries(files)) zipInput[k] = [v, { level: k.endsWith('.json') ? 6 : 0 }];
  return { bytes: zipSync(zipInput), manifest };
}

function parseJson(files: Record<string, Uint8Array>, name: string): unknown {
  const raw = files[name];
  if (!raw) throw new GameZipError(`${name} absent du zip`);
  try {
    return JSON.parse(strFromU8(raw));
  } catch (e) {
    throw new GameZipError(`${name} : JSON invalide (${(e as Error).message})`);
  }
}

/**
 * Lit un `.scroum.zip`. Lève `FormatVersionError` si le format est plus récent
 * que ce moteur (ou si aucune migration n'existe), `GameZipError` si le zip est
 * illisible ou incomplet. Un format plus ancien est migré.
 */
export function readGameZip(bytes: Uint8Array): GameZip {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (e) {
    throw new GameZipError(`archive illisible : ${(e as Error).message}`);
  }
  const rawManifest = parseJson(files, 'manifest.json');
  const version = readFormatVersion(rawManifest);
  if (version === undefined) throw new FormatVersionError('manifest.json : formatVersion absent ou invalide', undefined);
  if (version > FORMAT_VERSION) {
    throw new FormatVersionError(
      `ce jeu est au format ${version}, ce moteur ne connaît que le format ${FORMAT_VERSION} : mettre à jour SCROUM`,
      version,
    );
  }
  const manifest = migrate<ZipManifest>(rawManifest);
  const game = migrate<GameData>(parseJson(files, 'game.json'));
  const images = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(files)) {
    const m = ZIP_IMAGE_RE.exec(path);
    if (m) images.set(m[1]!, data);
  }
  return { manifest, game, images };
}

/** Type MIME d'après l'extension d'une image. */
export function imageMime(fileOrExt: string): string {
  const ext = fileOrExt.split('.').pop()!.toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/webp';
}
