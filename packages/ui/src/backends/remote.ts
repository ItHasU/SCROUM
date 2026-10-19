/**
 * `RemoteBackend` : endpoint compatible OpenAI (`POST <endpoint>/chat/completions`),
 * JSON mode pour la classification, délai max, repli sur `KeywordBackend`.
 */
import { KeywordBackend, type ClassifyRequest, type ClassifyResult, type LlmBackend, type RephraseRequest } from '@scroum/engine';
import { classifyMessages, parseClassifyResponse, rephraseMessages, type ChatMessage } from './prompts';
import { withTimeout } from './util';

export interface RemoteBackendOptions {
  /** URL de base, ex. `https://api.openai.com/v1` ou `http://localhost:11434/v1`. */
  endpoint: string;
  model: string;
  apiKey?: string | null;
  /** Délai max par requête (ms, défaut 8000). */
  timeoutMs?: number;
  /** Repli (défaut : `KeywordBackend`). */
  fallback?: LlmBackend;
  /** `fetch` injectable (tests). */
  fetch?: typeof fetch;
}

export class RemoteBackend implements LlmBackend {
  readonly id = 'remote';
  private readonly fallback: LlmBackend;
  private readonly timeoutMs: number;

  constructor(readonly options: RemoteBackendOptions) {
    this.fallback = options.fallback ?? new KeywordBackend();
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  private async chat(messages: ChatMessage[], extra: Record<string, unknown>): Promise<string> {
    const f = this.options.fetch ?? fetch;
    const ctrl = new AbortController();
    const url = this.options.endpoint.replace(/\/+$/, '') + '/chat/completions';
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;
    const req = f(url, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({ model: this.options.model, messages, temperature: 0, ...extra }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('réponse sans contenu');
      return content;
    });
    return withTimeout(req, this.timeoutMs, () => ctrl.abort());
  }

  async classify(req: ClassifyRequest): Promise<ClassifyResult> {
    if (!req.intents.length) return { intent: null, confidence: 0, item: null };
    try {
      const raw = await this.chat(classifyMessages(req), { response_format: { type: 'json_object' }, max_tokens: 60 });
      const parsed = parseClassifyResponse(req, raw);
      if (parsed) return parsed;
      throw new Error('JSON inexploitable');
    } catch (e) {
      console.warn('[scroum] RemoteBackend.classify : repli', e);
      return this.fallback.classify(req);
    }
  }

  async rephrase(req: RephraseRequest): Promise<string> {
    try {
      const out = await this.chat(rephraseMessages(req), { temperature: 0.7, max_tokens: Math.ceil(req.max_length / 2) });
      return out.trim() || req.text;
    } catch {
      return req.text;
    }
  }
}
