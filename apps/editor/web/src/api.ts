/** Appels à l'API du serveur de l'éditeur. */
import type { ContentError, GameData } from '@scroum/schema';

export interface ProjectInfo {
  name: string | null;
  root: string;
  git: boolean;
  playerAvailable: boolean;
}
export interface FileEntry {
  path: string;
  size: number;
  kind: string;
}
export interface Report {
  ok: boolean;
  errors: ContentError[];
  warnings: ContentError[];
  skipped: { analyzer: string; reason: string }[];
  title: string | null;
}
export interface PutResult {
  status: number;
  ok: boolean;
  errors: ContentError[];
  warnings: ContentError[];
  error?: string;
}

async function json<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const r = await fetch(url, init);
  let body: unknown = null;
  try {
    body = await r.json();
  } catch {
    /* corps vide */
  }
  return { status: r.status, body: body as T };
}

export const api = {
  project: async (): Promise<ProjectInfo> => (await json<ProjectInfo>('/api/project')).body,
  files: async (): Promise<FileEntry[]> => (await json<{ files: FileEntry[] }>('/api/files')).body.files,
  validate: async (): Promise<Report> => (await json<Report>('/api/validate')).body,
  /** `game` est null si le contenu ne se charge pas (422). */
  game: async (): Promise<{ game: GameData | null; errors: ContentError[] }> => {
    const r = await json<GameData & { errors?: ContentError[] }>('/api/game.json');
    return r.status === 200 ? { game: r.body, errors: [] } : { game: null, errors: r.body.errors ?? [] };
  },
  readFile: async (path: string): Promise<string | null> => {
    const r = await json<{ content: string }>(`/api/files/${path.split('/').map(encodeURIComponent).join('/')}`);
    return r.status === 200 ? r.body.content : null;
  },
  writeFile: async (path: string, content: string): Promise<PutResult> => {
    const r = await json<Partial<PutResult>>(`/api/files/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return { status: r.status, ok: r.status === 200, errors: r.body.errors ?? [], warnings: r.body.warnings ?? [], ...(r.body.error ? { error: r.body.error } : {}) };
  },
  diff: async (file: string): Promise<string> => {
    const r = await json<{ diff?: string; error?: string }>(`/api/diff?file=${encodeURIComponent(file)}`);
    return r.body.diff ?? r.body.error ?? '';
  },
  revert: async (files: string[]): Promise<{ ok: boolean; error?: string }> => {
    const r = await json<{ ok: boolean; error?: string }>('/api/claude/revert', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files }) });
    return r.body;
  },
  build: async (): Promise<{ ok: boolean; zip?: string; errors?: ContentError[]; warnings?: ContentError[] }> => (await json<{ ok: boolean; zip?: string; errors?: ContentError[]; warnings?: ContentError[] }>('/api/build', { method: 'POST' })).body,
};
