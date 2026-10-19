/**
 * `scroum gen-image` : passe par le serveur de l'éditeur s'il tourne, sinon génère directement.
 * Ne valide jamais un asset (les candidats restent dans `_candidates/`).
 */
import { join } from 'node:path';
import { generateForAsset, type CandidateMeta } from '@scroum/images';
import type { ResolvedProject } from '@scroum/build';
import type { Io } from './index';

const FLAGS = new Set(['asset', 'n', 'prompt', 'workflow', 'seed', 'variant-of', 'url', 'no-server']);

function intOpt(values: Map<string, string>, name: string, min: number): number | undefined | null {
  const v = values.get(name);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= min ? n : null;
}

interface Request {
  assetId: string;
  n: number;
  prompt?: string;
  workflow?: string;
  seed?: number;
  variantOf?: number;
}

/** Serveur d'éditeur de CE dépôt de jeu, ou null s'il ne tourne pas. */
async function findEditor(project: ResolvedProject, explicit: string | undefined): Promise<string | null> {
  const url = (explicit ?? `http://127.0.0.1:${project.config?.editor.port ?? 5317}`).replace(/\/+$/, '');
  try {
    const r = await fetch(`${url}/api/project`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const info = (await r.json()) as { root?: string };
    return info.root === project.root ? url : null;
  } catch {
    return null;
  }
}

async function viaServer(url: string, req: Request, io: Io): Promise<{ ok: boolean; error?: string; candidates: CandidateMeta[] }> {
  const res = await fetch(`${url}/api/gen-image`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(req),
  });
  if (!res.body || !(res.headers.get('content-type') ?? '').includes('event-stream')) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `HTTP ${res.status}`, candidates: [] };
  }
  let buf = '';
  let last = '';
  let done: { ok: boolean; error?: string; candidates?: CandidateMeta[] } = { ok: false, error: 'flux interrompu' };
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!chunk.startsWith('data: ')) continue;
      const ev = JSON.parse(chunk.slice(6)) as { type: string; phase?: string; index?: number; total?: number; value?: number; max?: number } & typeof done;
      if (ev.type === 'progress') {
        const line = `candidat ${(ev.index ?? 0) + 1}/${ev.total}: ${ev.phase}${ev.max ? ` ${ev.value}/${ev.max}` : ''}`;
        if (line !== last) io.out(line);
        last = line;
      } else if (ev.type === 'done') done = ev;
    }
  }
  return { ok: done.ok, ...(done.error ? { error: done.error } : {}), candidates: done.candidates ?? [] };
}

export async function genImageCommand(project: ResolvedProject, flags: Set<string>, values: Map<string, string>, io: Io): Promise<number> {
  const unknown = [...flags].filter((f) => !FLAGS.has(f));
  if (unknown.length > 0) {
    io.err(`option inconnue : ${unknown.map((f) => `--${f}`).join(' ')}`);
    return 2;
  }
  const assetId = values.get('asset');
  if (!assetId) {
    io.err('usage : scroum gen-image --asset <id> [--n 4] [--prompt "…"] [--workflow w] [--seed N] [--variant-of N] [--no-server] [chemin]');
    return 2;
  }
  const n = intOpt(values, 'n', 1);
  const seed = intOpt(values, 'seed', 0);
  const variantOf = intOpt(values, 'variant-of', 1);
  if (n === null || seed === null || variantOf === null) {
    io.err('--n, --seed et --variant-of attendent un entier (n >= 1, variant-of >= 1)');
    return 2;
  }
  const prompt = values.get('prompt');
  const workflow = values.get('workflow');
  const req: Request = {
    assetId,
    n: n ?? 4,
    ...(prompt ? { prompt } : {}),
    ...(workflow ? { workflow } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(variantOf !== undefined ? { variantOf } : {}),
  };

  try {
    const editor = flags.has('no-server') ? null : await findEditor(project, values.get('url'));
    let candidates: CandidateMeta[];
    if (editor) {
      io.out(`Via l'éditeur (${editor})`);
      const r = await viaServer(editor, req, io);
      if (!r.ok) {
        io.err(`gen-image : ${r.error}`);
        return 1;
      }
      candidates = r.candidates;
    } else {
      io.out('Éditeur non détecté : génération directe via ComfyUI');
      let last = '';
      candidates = await generateForAsset(
        { root: project.root, contentDir: project.contentDir, config: project.config },
        req,
        {
          onProgress: (p) => {
            const line = `candidat ${p.index + 1}/${p.total}: ${p.phase}`;
            if (line !== last) io.out(line);
            last = line;
          },
        },
      );
    }
    for (const c of candidates) io.out(`  #${c.n} seed ${c.seed} → ${join(project.contentDir, 'assets', '_candidates', assetId, c.file)}`);
    io.out(`${candidates.length} candidat(s) proposé(s). Statut inchangé : la sélection et la validation se font dans l'Atelier d'images.`);
    return 0;
  } catch (e) {
    io.err(`gen-image : ${(e as Error).message}`);
    return 1;
  }
}
