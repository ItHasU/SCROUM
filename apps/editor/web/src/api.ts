/** Appels à l'API du serveur de l'éditeur. */
import type { ContentError, GameData } from '@scroum/schema';

export interface ProjectInfo {
  name: string | null;
  root: string;
  git: boolean;
  playerAvailable: boolean;
  claude?: { command: string; available: boolean };
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

export interface AssetRow {
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
export interface CandidateRow {
  n: number;
  file: string;
  userPrompt: string;
  prompt: string;
  seed: number;
  workflow: string;
  references: string[];
  model: string | null;
  variantOf: number | null;
}
export interface GenRequest {
  assetId: string;
  n: number;
  prompt?: string;
  workflow?: string;
  references?: string[];
  seed?: number;
  variantOf?: number;
}
export interface GenEvent {
  type: 'start' | 'progress' | 'candidate' | 'done';
  index?: number;
  total?: number;
  phase?: string;
  value?: number;
  max?: number;
  candidate?: CandidateRow;
  ok?: boolean;
  error?: string;
}

const postJson = (url: string, body: object) => json<{ ok?: boolean; error?: string }>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const imagesApi = {
  assets: async (): Promise<AssetRow[]> => (await json<{ assets: AssetRow[] }>('/api/assets')).body.assets ?? [],
  candidates: async (id: string): Promise<CandidateRow[]> => (await json<{ candidates: CandidateRow[] }>(`/api/candidates/${encodeURIComponent(id)}`)).body.candidates ?? [],
  comfyui: async (): Promise<{ url: string; ok: boolean; error?: string }> => (await json<{ url: string; ok: boolean; error?: string }>('/api/comfyui')).body,
  select: async (id: string, candidate: number) => (await postJson(`/api/assets/${encodeURIComponent(id)}/select`, { candidate })).body,
  /** Action humaine explicite (bouton « Valider »). */
  validate: async (id: string) => (await postJson(`/api/assets/${encodeURIComponent(id)}/validate`, { confirm: true })).body,
  /** Génère en suivant le flux SSE ; résout à la fin (`done`). */
  generate: async (req: GenRequest, onEvent: (e: GenEvent) => void): Promise<GenEvent> => {
    const res = await fetch('/api/gen-image', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(req) });
    if (!res.body || !(res.headers.get('content-type') ?? '').includes('event-stream')) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      return { type: 'done', ok: false, error: b.error ?? `Erreur ${res.status}` };
    }
    let last: GenEvent = { type: 'done', ok: false, error: 'flux interrompu' };
    let buf = '';
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
        buf = buf.slice(i + 2);
        if (!line) continue;
        const ev = JSON.parse(line.slice(5)) as GenEvent;
        onEvent(ev);
        if (ev.type === 'done') last = ev;
      }
    }
    return last;
  },
};
