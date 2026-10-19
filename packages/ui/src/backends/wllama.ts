/**
 * `WllamaBackend` : LLM local dans le navigateur (llama.cpp en WebAssembly via
 * `@wllama/wllama`, importé dynamiquement). Le modèle GGUF n'est téléchargé
 * qu'après consentement explicite (`load()`), puis mis en cache par wllama
 * (Cache API / OPFS). Tant qu'il n'est pas chargé, ou en cas d'échec / délai
 * dépassé, repli sur `KeywordBackend`. Désactivé par défaut.
 */
import { KeywordBackend, type ClassifyRequest, type ClassifyResult, type LlmBackend, type RephraseRequest } from '@scroum/engine';
import { classifyGrammar, classifyMessages, parseClassifyResponse, rephraseMessages } from './prompts';
import { withTimeout } from './util';

/** Modèle par défaut : Qwen2.5 0,5 B Instruct, quantifié Q4_K_M. */
export const DEFAULT_WLLAMA_MODEL = {
  url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  /** Taille approximative affichée avant téléchargement (octets). */
  sizeBytes: 491_000_000,
  label: 'Qwen2.5 0,5B Instruct (Q4_K_M)',
};

export interface WllamaBackendOptions {
  modelUrl?: string;
  sizeBytes?: number;
  /** Contexte (tokens, défaut 2048). */
  nCtx?: number;
  /** Délai max d'une inférence (ms, défaut 15000). */
  timeoutMs?: number;
  fallback?: LlmBackend;
}

export type WllamaStatus = 'idle' | 'loading' | 'ready' | 'error';

interface WllamaLike {
  loadModelFromUrl(url: string, params: Record<string, unknown>): Promise<void>;
  createChatCompletion(params: Record<string, unknown>): Promise<{ choices: { message?: { content?: string | null } }[] }>;
  isModelLoaded(): boolean;
  exit(): Promise<void>;
}

export class WllamaBackend implements LlmBackend {
  readonly id = 'wllama';
  private readonly fallback: LlmBackend;
  private wllama: WllamaLike | null = null;
  private loading: Promise<void> | null = null;
  private _status: WllamaStatus = 'idle';
  private _error: string | null = null;
  /** Une seule inférence à la fois (wllama n'est pas réentrant). */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly options: WllamaBackendOptions = {}) {
    this.fallback = options.fallback ?? new KeywordBackend();
  }

  get status(): WllamaStatus {
    return this._status;
  }
  get error(): string | null {
    return this._error;
  }
  get sizeBytes(): number {
    return this.options.sizeBytes ?? DEFAULT_WLLAMA_MODEL.sizeBytes;
  }

  /**
   * Télécharge (ou relit depuis le cache) et charge le modèle. À n'appeler
   * qu'après consentement du joueur (taille affichée : `sizeBytes`).
   */
  load(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    if (this.loading) return this.loading;
    this._status = 'loading';
    this.loading = (async () => {
      try {
        const [{ Wllama }, wasm] = await Promise.all([import('@wllama/wllama/esm/index.js'), import('@wllama/wllama/esm/wasm/wllama.wasm?url')]);
        const w = new Wllama({ default: wasm.default }) as unknown as WllamaLike;
        await w.loadModelFromUrl(this.options.modelUrl ?? DEFAULT_WLLAMA_MODEL.url, {
          n_ctx: this.options.nCtx ?? 2048,
          useCache: true,
          progressCallback: ({ loaded, total }: { loaded: number; total: number }) => onProgress?.(loaded, total),
        });
        this.wllama = w;
        this._status = 'ready';
      } catch (e) {
        this._status = 'error';
        this._error = e instanceof Error ? e.message : String(e);
        this.loading = null;
        throw e;
      }
    })();
    return this.loading;
  }

  private run<T>(fn: (w: WllamaLike) => Promise<T>): Promise<T> {
    const w = this.wllama;
    if (!w || this._status !== 'ready') return Promise.reject(new Error('modèle non chargé'));
    const p = this.queue.then(() => fn(w));
    this.queue = p.catch(() => undefined);
    return withTimeout(p, this.options.timeoutMs ?? 15000);
  }

  async classify(req: ClassifyRequest): Promise<ClassifyResult> {
    if (!req.intents.length) return { intent: null, confidence: 0, item: null };
    try {
      const out = await this.run((w) =>
        w.createChatCompletion({ messages: classifyMessages(req), grammar: classifyGrammar(req), max_tokens: 60, temperature: 0 }),
      );
      const parsed = parseClassifyResponse(req, out.choices[0]?.message?.content ?? '');
      if (parsed) return parsed;
      throw new Error('JSON inexploitable');
    } catch (e) {
      if (this._status === 'ready') console.warn('[scroum] WllamaBackend.classify : repli', e);
      return this.fallback.classify(req);
    }
  }

  async rephrase(req: RephraseRequest): Promise<string> {
    try {
      const out = await this.run((w) =>
        w.createChatCompletion({ messages: rephraseMessages(req), max_tokens: Math.ceil(req.max_length / 2), temperature: 0.7 }),
      );
      return out.choices[0]?.message?.content?.trim() || req.text;
    } catch {
      return req.text;
    }
  }

  async dispose(): Promise<void> {
    await this.wllama?.exit().catch(() => undefined);
    this.wllama = null;
    this.loading = null;
    this._status = 'idle';
  }
}
