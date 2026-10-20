/** ComfyUIProvider : upload des références, POST /prompt, progression WebSocket (repli : polling /history), GET /view. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import {
  ImageError,
  type Candidate,
  type EditRequest,
  type GenerateRequest,
  type ImageProvider,
  type Params,
  type Progress,
  type RunOptions,
} from './types';
import { loadWorkflow, placeholders, substitute, workflowDirs } from './workflow';

export interface ComfyUIOptions {
  /** URL de base, ex. `http://192.168.1.20:8188`. */
  url: string;
  /** Valeurs par défaut de `{{unet}}`, `{{clip}}`, `{{vae}}`, `{{checkpoint}}`… */
  models?: Record<string, string | number>;
  /** Dossier `workflows/` du jeu (cherché en premier). */
  gameWorkflowsDir?: string | null;
  /** Délai maximal par candidat (ms). Défaut 10 min. */
  timeoutMs?: number;
  /** Période du polling /history (ms). Défaut 1000. */
  pollMs?: number;
  /** Prend le pas sur le WebSocket global (tests, ancien Node). */
  WebSocketImpl?: typeof WebSocket;
  fetchImpl?: typeof fetch;
}

interface HistoryImage {
  filename: string;
  subfolder: string;
  type: string;
}
interface HistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
  outputs?: Record<string, { images?: HistoryImage[] }>;
}

const randomSeed = (): number => Math.floor(Math.random() * 2 ** 31);

export class ComfyUIProvider implements ImageProvider {
  readonly url: string;
  private readonly o: ComfyUIOptions;
  private readonly fetch: typeof fetch;

  constructor(options: ComfyUIOptions) {
    this.o = options;
    this.url = options.url.replace(/\/+$/, '');
    this.fetch = options.fetchImpl ?? fetch;
  }

  /** Vérifie que ComfyUI répond (`GET /system_stats`). */
  async ping(): Promise<{ ok: true; version?: string }> {
    const r = await this.http('/system_stats', undefined, 5000);
    const body = (await r.json().catch(() => ({}))) as { system?: { comfyui_version?: string } };
    return { ok: true, ...(body.system?.comfyui_version ? { version: body.system.comfyui_version } : {}) };
  }

  generate(req: GenerateRequest, opts: RunOptions = {}): Promise<Candidate[]> {
    return this.run(
      req.workflow,
      { prompt: req.prompt, negative: req.negative ?? '', width: req.width, height: req.height, ...(req.params as Params | undefined) },
      req.references ?? [],
      req.seed,
      opts,
    );
  }

  async edit(req: EditRequest, opts: RunOptions = {}): Promise<Candidate[]> {
    if (req.references.length === 0) throw new ImageError('missing_param', "edit : au moins une image de référence est requise");
    return this.run(
      req.workflow,
      {
        prompt: req.instruction,
        negative: req.negative ?? '',
        ...(req.width ? { width: req.width } : {}),
        ...(req.height ? { height: req.height } : {}),
        ...(req.params as Params | undefined),
      },
      req.references,
      req.seed,
      opts,
    );
  }

  // ---------------------------------------------------------------------------

  private async run(workflowName: string, base: Params, refs: string[], seed: number | undefined, opts: RunOptions): Promise<Candidate[]> {
    const n = Math.max(1, opts.n ?? 1);
    const wf = await loadWorkflow(workflowName, workflowDirs(this.o.gameWorkflowsDir ?? null));
    const baseSeed = seed ?? randomSeed();
    const notify = (p: Omit<Progress, 'total'> & { total?: number }): void => opts.onProgress?.({ total: n, ...p });

    const params: Record<string, unknown> = { ...(wf.meta.defaults ?? {}), ...(this.o.models ?? {}), ...base };
    // Références : upload une fois, `{{ref_image_1}}` = nom de fichier côté ComfyUI.
    for (let i = 0; i < refs.length; i++) {
      notify({ index: 0, phase: 'upload' });
      params[`ref_image_${i + 1}`] = await this.upload(refs[i]!);
    }
    const unused = [...placeholders(wf.graph)].filter((k) => /^ref_image_\d+$/.test(k) && params[k] === undefined);
    if (unused.length > 0) {
      throw new ImageError('missing_param', `le workflow « ${workflowName} » attend ${unused.length + refs.length} image(s) de référence (${refs.length} fournie(s)) : ${unused.map((k) => `{{${k}}}`).join(', ')}`);
    }

    const out: Candidate[] = [];
    for (let i = 0; i < n; i++) {
      if (opts.signal?.aborted) throw new ImageError('aborted', 'génération annulée');
      const s = baseSeed + i;
      const full: Record<string, unknown> = { ...params, seed: s };
      const graph = substitute(wf.graph, full, workflowName);
      const data = await this.runGraph(graph, { index: i, total: n }, opts);
      const modelKeys = ['unet', 'checkpoint'].map((k) => full[k]).filter((v): v is string => typeof v === 'string');
      const cand: Candidate = {
        data: data.bytes,
        ext: data.ext,
        seed: s,
        workflow: workflowName,
        prompt: String(full.prompt ?? ''),
        ...(full.negative ? { negative: String(full.negative) } : {}),
        ...(typeof full.width === 'number' ? { width: full.width } : {}),
        ...(typeof full.height === 'number' ? { height: full.height } : {}),
        ...(modelKeys.length ? { model: modelKeys.join(' + ') } : {}),
        ...(refs.length ? { references: refs.map((r) => basename(r)) } : {}),
      };
      out.push(cand);
      notify({ index: i, phase: 'done' });
      await opts.onCandidate?.(cand, i);
    }
    return out;
  }

  private async runGraph(graph: Record<string, unknown>, at: { index: number; total: number }, opts: RunOptions): Promise<{ bytes: Uint8Array; ext: string }> {
    const timeoutMs = this.o.timeoutMs ?? 600_000;
    const deadline = Date.now() + timeoutMs;
    const clientId = randomUUID();
    const notify = (p: Partial<Progress> & { phase: Progress['phase'] }): void => opts.onProgress?.({ ...at, ...p });
    const socket = await this.openSocket(clientId);
    try {
      notify({ phase: 'queued' });
      const promptId = await this.submit(graph, clientId);
      const entry = await this.waitDone(promptId, socket, deadline, timeoutMs, opts, (value, max) => notify({ phase: 'running', value, max }));
      notify({ phase: 'fetching' });
      const img = this.pickOutput(entry);
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
      const r = await this.http(`/view?${q}`, undefined, Math.max(1000, deadline - Date.now()));
      const ext = extname(img.filename).slice(1).toLowerCase() || 'png';
      return { bytes: new Uint8Array(await r.arrayBuffer()), ext };
    } finally {
      socket?.close();
    }
  }

  private async upload(path: string): Promise<string> {
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch {
      throw new ImageError('missing_param', `image de référence illisible : ${path}`);
    }
    const form = new FormData();
    const name = basename(path);
    form.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), name);
    form.append('type', 'input');
    form.append('overwrite', 'true');
    const r = await this.http('/upload/image', { method: 'POST', body: form }, 60_000);
    const body = (await r.json().catch(() => null)) as { name?: string; subfolder?: string } | null;
    if (!body?.name) throw new ImageError('rejected', `ComfyUI : réponse d'upload inattendue pour ${name}`);
    return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
  }

  private async submit(graph: Record<string, unknown>, clientId: string): Promise<string> {
    const r = await this.http('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: clientId }) }, 60_000, true);
    const body = (await r.json().catch(() => null)) as { prompt_id?: string } | null;
    if (!body?.prompt_id) throw new ImageError('rejected', 'ComfyUI : pas de prompt_id dans la réponse à /prompt');
    return body.prompt_id;
  }

  /** WebSocket de progression ; null si indisponible (on retombe alors sur le polling). */
  private async openSocket(clientId: string): Promise<WebSocket | null> {
    const WS = this.o.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) return null;
    const wsUrl = `${this.url.replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`;
    return new Promise((resolve) => {
      let ws: WebSocket;
      try {
        ws = new WS(wsUrl);
      } catch {
        return resolve(null);
      }
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve(null);
      }, 3000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(ws);
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  private waitDone(
    promptId: string,
    ws: WebSocket | null,
    deadline: number,
    timeoutMs: number,
    opts: RunOptions,
    onStep: (value: number, max: number) => void,
  ): Promise<HistoryEntry> {
    return new Promise<HistoryEntry>((resolve, reject) => {
      let settled = false;
      let failures = 0;
      let checking = false;
      const pollMs = this.o.pollMs ?? 1000;
      const done = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        opts.signal?.removeEventListener('abort', onAbort);
        fn();
      };
      const timer = setTimeout(() => done(() => reject(new ImageError('timeout', `ComfyUI : délai dépassé (${Math.round(timeoutMs / 1000)} s) pour la génération ${promptId}`))), Math.max(1, deadline - Date.now()));
      const onAbort = (): void => {
        void this.http('/interrupt', { method: 'POST' }, 3000).catch(() => undefined);
        done(() => reject(new ImageError('aborted', 'génération annulée')));
      };
      opts.signal?.addEventListener('abort', onAbort);
      const check = async (): Promise<void> => {
        if (checking || settled) return;
        checking = true;
        try {
          const r = await this.http(`/history/${encodeURIComponent(promptId)}`, undefined, 10_000);
          failures = 0;
          const entry = ((await r.json().catch(() => ({}))) as Record<string, HistoryEntry>)[promptId];
          if (!entry) return;
          if (entry.status?.status_str === 'error') {
            const m = entry.status.messages?.find((x) => x[0] === 'execution_error')?.[1];
            return done(() => reject(execError(m)));
          }
          if (entry.status?.completed || (entry.outputs && Object.keys(entry.outputs).length > 0)) done(() => resolve(entry));
        } catch (e) {
          if (++failures >= 3) done(() => reject(e));
        } finally {
          checking = false;
        }
      };
      const poll = setInterval(() => void check(), pollMs);
      ws?.addEventListener('message', (ev: MessageEvent) => {
        if (typeof ev.data !== 'string') return; // aperçus binaires
        let msg: { type?: string; data?: Record<string, unknown> };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        const d = msg.data ?? {};
        if (d.prompt_id !== undefined && d.prompt_id !== promptId) return;
        if (msg.type === 'progress' && typeof d.value === 'number' && typeof d.max === 'number') onStep(d.value, d.max);
        else if (msg.type === 'execution_error') done(() => reject(execError(d)));
        else if (msg.type === 'execution_success' || (msg.type === 'executing' && d.node === null)) void check();
      });
      ws?.addEventListener('close', () => void check());
      void check();
    });
  }

  private pickOutput(entry: HistoryEntry): HistoryImage {
    const all = Object.keys(entry.outputs ?? {})
      .sort((a, b) => Number(a) - Number(b))
      .flatMap((k) => entry.outputs![k]!.images ?? []);
    const img = all.find((i) => i.type === 'output') ?? all[0];
    if (!img) throw new ImageError('no_output', "ComfyUI a terminé sans produire d'image (le workflow a-t-il un noeud SaveImage ?)");
    return img;
  }

  /** `fetch` + traduction des erreurs réseau et des réponses d'erreur de ComfyUI. */
  private async http(path: string, init: RequestInit | undefined, timeoutMs: number, isPrompt = false): Promise<Response> {
    let r: Response;
    try {
      r = await this.fetch(this.url + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new ImageError('timeout', `ComfyUI : pas de réponse de ${this.url}${path.split('?')[0]} en ${Math.round(timeoutMs / 1000)} s`);
      throw new ImageError('unreachable', `ComfyUI injoignable à ${this.url} (${err.cause?.code ?? err.message}) — vérifier comfyui.url dans scroum.local.yaml et que ComfyUI tourne avec --listen`);
    }
    if (r.ok) return r;
    const text = await r.text().catch(() => '');
    if (isPrompt) throw promptError(text, r.status);
    throw new ImageError('rejected', `ComfyUI ${path.split('?')[0]} : HTTP ${r.status} ${text.slice(0, 300)}`);
  }
}

function execError(m: Record<string, unknown> | undefined): ImageError {
  const msg = String(m?.exception_message ?? 'erreur inconnue').trim();
  const node = m?.node_type ? ` (noeud ${String(m.node_type)})` : '';
  return new ImageError('execution', `ComfyUI : échec de l'exécution${node} : ${msg}`);
}

interface NodeErrors {
  [id: string]: { class_type?: string; errors?: { type?: string; message?: string; details?: string; extra_info?: { input_name?: string; received_value?: unknown; input_config?: unknown[] } }[] };
}

/** Traduit une réponse 400 de `POST /prompt` en erreur lisible (noeud ou modèle inconnu, sinon message brut). */
export function promptError(text: string, status: number): ImageError {
  let body: { error?: { type?: string; message?: string; details?: string } | string; node_errors?: NodeErrors } = {};
  try {
    body = JSON.parse(text);
  } catch {
    return new ImageError('rejected', `ComfyUI /prompt : HTTP ${status} ${text.slice(0, 300)}`);
  }
  const nodeErrors = body.node_errors ?? {};
  for (const [id, ne] of Object.entries(nodeErrors)) {
    for (const e of ne.errors ?? []) {
      if (e.type === 'missing_node_type') return new ImageError('unknown_node', `noeud ComfyUI inconnu « ${ne.class_type ?? e.extra_info?.received_value ?? `#${id}`} » : installer le noeud personnalisé correspondant (voir docs/IMAGES.md)`);
      if (e.type === 'value_not_in_list') {
        const opts = Array.isArray(e.extra_info?.input_config?.[0]) ? (e.extra_info!.input_config![0] as unknown[]).slice(0, 8).join(', ') : '';
        return new ImageError(
          'unknown_model',
          `valeur inconnue de ComfyUI pour « ${e.extra_info?.input_name ?? '?'} » : « ${String(e.extra_info?.received_value ?? '')} » (noeud ${ne.class_type ?? `#${id}`})${opts ? ` — disponibles : ${opts}` : ''} ; régler comfyui.models dans scroum.local.yaml`,
        );
      }
    }
  }
  const err = typeof body.error === 'string' ? { message: body.error } : (body.error ?? {});
  const msg = `${err.message ?? ''} ${err.details ?? ''}`.trim();
  if (err.type === 'missing_node_type' || /does not exist|missing_node_type/i.test(msg)) {
    return new ImageError('unknown_node', `noeud ComfyUI inconnu : ${msg} — installer le noeud personnalisé correspondant (voir docs/IMAGES.md)`);
  }
  const first = Object.values(nodeErrors)[0]?.errors?.[0];
  return new ImageError('rejected', `ComfyUI a refusé le workflow : ${msg || first?.message || text.slice(0, 300)}`);
}
