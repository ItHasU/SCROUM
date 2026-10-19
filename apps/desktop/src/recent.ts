/** Projets récents, persistés dans un fichier JSON du dossier de données de l'application. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface RecentEntry {
  kind: 'repo' | 'zip';
  path: string;
  name: string;
  openedAt: number;
}

const MAX = 10;

export async function loadRecent(file: string): Promise<RecentEntry[]> {
  try {
    const v = JSON.parse(await readFile(file, 'utf8')) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((e): e is RecentEntry => !!e && typeof e.path === 'string' && (e.kind === 'repo' || e.kind === 'zip') && typeof e.name === 'string');
  } catch {
    return [];
  }
}

export async function pushRecent(file: string, entry: Omit<RecentEntry, 'openedAt'>): Promise<RecentEntry[]> {
  const list = (await loadRecent(file)).filter((e) => !(e.kind === entry.kind && e.path === entry.path));
  list.unshift({ ...entry, openedAt: Date.now() });
  const out = list.slice(0, MAX);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(out, null, 2));
  return out;
}

export async function clearRecent(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, '[]');
}
