/** Résolution sûre de chemins relatifs à une racine (anti-traversée). */
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Renvoie le chemin absolu de `rel` sous `root`, ou lève HttpError 400/403. */
export function safeJoin(root: string, rel: string): string {
  if (rel.includes('\0')) throw new HttpError(400, 'chemin invalide');
  const clean = rel.replace(/\\/g, '/');
  if (isAbsolute(clean) || clean.split('/').some((s) => s === '..')) throw new HttpError(403, 'chemin hors du dossier autorisé');
  const full = resolve(root, clean);
  if (full !== root && !full.startsWith(root + sep)) throw new HttpError(403, 'chemin hors du dossier autorisé');
  // Un lien symbolique ne doit pas faire sortir de la racine.
  let probe = full;
  for (;;) {
    try {
      const real = realpathSync(probe);
      const realRoot = realpathSync(root);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new HttpError(403, 'chemin hors du dossier autorisé');
      break;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  return full;
}

export const relPosix = (root: string, full: string): string => full.slice(root.length + 1).split(sep).join('/');
export { join };
