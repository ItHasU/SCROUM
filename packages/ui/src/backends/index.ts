/** Backends LLM du navigateur et sélection selon le réglage « Assistant IA ». */
import { KeywordBackend, type LlmBackend } from '@scroum/engine';
import type { PlayerSettings } from '../storage';
import { RemoteBackend } from './remote';
import { WllamaBackend } from './wllama';

export * from './prompts';
export * from './remote';
export * from './wllama';
export * from './util';

/**
 * Choisit classifieur et reformulateur selon les réglages. Un seul
 * `WllamaBackend` est conservé (le modèle chargé reste en mémoire).
 */
export class AssistantManager {
  readonly keyword = new KeywordBackend();
  private remote: RemoteBackend | null = null;
  private remoteKey = '';
  private _local: WllamaBackend | null = null;

  constructor(private settings: () => PlayerSettings) {}

  /** Backend local (créé à la demande, jamais chargé sans `load()` explicite). */
  get local(): WllamaBackend {
    return (this._local ??= new WllamaBackend({ fallback: this.keyword }));
  }

  private remoteBackend(): RemoteBackend | null {
    const r = this.settings().remote;
    if (!r.endpoint || !r.model) return null;
    const key = `${r.endpoint}|${r.model}|${r.apiKey}`;
    if (!this.remote || key !== this.remoteKey) {
      this.remote = new RemoteBackend({ endpoint: r.endpoint, model: r.model, apiKey: r.apiKey || null, fallback: this.keyword });
      this.remoteKey = key;
    }
    return this.remote;
  }

  /** Classifieur du texte libre (toujours défini : repli mots-clés). */
  classifier(): LlmBackend {
    const s = this.settings();
    if (s.assistant === 'remote') return this.remoteBackend() ?? this.keyword;
    if (s.assistant === 'local' && this._local?.status === 'ready') return this._local;
    return this.keyword;
  }

  /** Reformulateur, ou null s'il n'est pas activé / pas disponible. */
  rephraser(): LlmBackend | null {
    const s = this.settings();
    if (!s.rephrase) return null;
    if (s.assistant === 'remote') return this.remoteBackend();
    if (s.assistant === 'local' && this._local?.status === 'ready') return this._local;
    return null;
  }
}
