/** Aide git pour le panneau Claude : instantanés, diff, annulation. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError, safeJoin } from './paths';

export function git(cwd: string, args: string[], okCodes: number[] = [0]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      if (code === 0 || okCodes.includes(code)) return resolve({ stdout, code });
      reject(new HttpError(500, `git ${args[0]} : ${(stderr || String(err)).trim()}`));
    });
  });
}

export async function isGitRepo(root: string): Promise<boolean> {
  try {
    const r = await git(root, ['rev-parse', '--show-toplevel']);
    return r.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Chemin → empreinte (statut + contenu) de chaque fichier modifié ou non suivi. */
export type Snapshot = Map<string, string>;

export async function snapshot(root: string): Promise<Snapshot> {
  const snap: Snapshot = new Map();
  const { stdout } = await git(root, ['status', '--porcelain', '-uall', '-z']);
  const parts = stdout.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++; // entrée suivante : ancien nom
    let h = 'absent';
    try {
      h = createHash('sha1').update(await readFile(join(root, path))).digest('hex');
    } catch {
      /* supprimé */
    }
    snap.set(path, `${xy}:${h}`);
  }
  return snap;
}

/** Fichiers dont l'état diffère entre deux instantanés (modifiés, créés, supprimés, annulés). */
export function changedFiles(before: Snapshot, after: Snapshot): string[] {
  const out = new Set<string>();
  for (const [p, v] of after) if (before.get(p) !== v) out.add(p);
  for (const p of before.keys()) if (!after.has(p)) out.add(p);
  return [...out].sort();
}

export async function diffFile(root: string, file: string): Promise<string> {
  safeJoin(root, file);
  const tracked = (await git(root, ['ls-files', '--error-unmatch', '--', file], [1])).code === 0;
  if (tracked) return (await git(root, ['diff', 'HEAD', '--', file])).stdout;
  return (await git(root, ['diff', '--no-index', '--', '/dev/null', file], [1])).stdout;
}

/** `git checkout --` pour les fichiers suivis ; suppression pour les fichiers créés (non suivis). */
export async function revertFiles(root: string, files: string[]): Promise<{ reverted: string[]; removed: string[] }> {
  const { rm } = await import('node:fs/promises');
  const reverted: string[] = [];
  const removed: string[] = [];
  for (const f of files) {
    const full = safeJoin(root, f);
    const tracked = (await git(root, ['ls-files', '--error-unmatch', '--', f], [1])).code === 0;
    if (tracked) {
      await git(root, ['checkout', 'HEAD', '--', f]);
      reverted.push(f);
    } else {
      await rm(full, { force: true });
      removed.push(f);
    }
  }
  return { reverted, removed };
}
