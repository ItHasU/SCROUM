/**
 * Persistance locale : réglages et sauvegardes (localStorage, chaque accès
 * protégé par try/catch : navigation privée, quota, stockage bloqué…), export /
 * import JSON.
 */
import type { GameData } from '@scroum/schema';
import { STATE_VERSION, type GameState } from '@scroum/engine';
import type { LogEntry } from './log';

/** Accès clé/valeur minimal (localStorage ou substitut en mémoire). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage si disponible et utilisable, sinon une Map en mémoire. */
export function defaultStore(): KeyValueStore {
  try {
    const ls = globalThis.localStorage;
    const k = '__scroum_probe__';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return ls;
  } catch {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  }
}

function readJson<T>(store: KeyValueStore, key: string): T | null {
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(store: KeyValueStore, key: string, value: unknown): boolean {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('[scroum] écriture impossible dans le stockage local', e);
    return false;
  }
}

// ------------------------------------------------------------------ réglages

/** Assistant IA : désactivé (choix seulement), mots-clés (défaut), distant (OpenAI-compatible), local (wllama). */
export type AssistantMode = 'off' | 'keyword' | 'remote' | 'local';

export interface PlayerSettings {
  /** Surligner en permanence les hotspots (accessibilité). */
  highlightHotspots: boolean;
  assistant: AssistantMode;
  /** Reformulation des répliques par le LLM (distant / local seulement). */
  rephrase: boolean;
  remote: { endpoint: string; model: string; apiKey: string };
  /** Le joueur a accepté le téléchargement du modèle local. */
  localConsent: boolean;
  /** Taille du texte (1 = normal). */
  textScale: number;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  highlightHotspots: false,
  assistant: 'keyword',
  rephrase: false,
  remote: { endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' },
  localConsent: false,
  textScale: 1,
};

const SETTINGS_KEY = 'scroum:settings';

export function loadSettings(store: KeyValueStore): PlayerSettings {
  const s = readJson<Partial<PlayerSettings>>(store, SETTINGS_KEY) ?? {};
  const assistant: AssistantMode = s.assistant && ['off', 'keyword', 'remote', 'local'].includes(s.assistant) ? s.assistant : DEFAULT_SETTINGS.assistant;
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    assistant,
    remote: { ...DEFAULT_SETTINGS.remote, ...(s.remote ?? {}) },
    textScale: typeof s.textScale === 'number' && s.textScale >= 0.8 && s.textScale <= 1.5 ? s.textScale : 1,
  };
}

export function saveSettings(store: KeyValueStore, s: PlayerSettings): void {
  writeJson(store, SETTINGS_KEY, s);
}

// --------------------------------------------------------------- sauvegardes

export const SAVE_FORMAT = 'scroum-save';
export const SAVE_SLOTS = 3;

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: 1;
  game: { title: string; version: string };
  savedAt: string;
  /** Résumé lisible (scène). */
  label: string;
  state: GameState;
  log: LogEntry[];
}

export type SlotId = 'auto' | number;

/** Clé de jeu pour l'espace de noms des sauvegardes (titre normalisé). */
export function gameKey(game: GameData): string {
  return (
    game.meta.title
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'jeu'
  );
}

export function makeSave(game: GameData, state: GameState, log: readonly LogEntry[]): SaveFile {
  return {
    format: SAVE_FORMAT,
    version: 1,
    game: { title: game.meta.title, version: game.meta.version },
    savedAt: new Date().toISOString(),
    label: game.scenes[state.scene]?.title ?? state.scene,
    state,
    log: log.slice(-120).map((e) => ({ ...e })),
  };
}

/** Valide un objet de sauvegarde (import JSON) ; lève une erreur lisible sinon. */
export function parseSave(data: unknown): SaveFile {
  const d = (typeof data === 'string' ? JSON.parse(data) : data) as Partial<SaveFile> | null;
  if (!d || typeof d !== 'object' || d.format !== SAVE_FORMAT) throw new Error("ce fichier n'est pas une sauvegarde SCROUM");
  const s = d.state as Partial<GameState> | undefined;
  if (!s || typeof s.scene !== 'string' || !Array.isArray(s.flags) || typeof s.inventory !== 'object') throw new Error('sauvegarde incomplète ou corrompue');
  if (typeof s.version === 'number' && s.version > STATE_VERSION) throw new Error('sauvegarde produite par une version plus récente de SCROUM');
  return {
    format: SAVE_FORMAT,
    version: 1,
    game: { title: String(d.game?.title ?? ''), version: String(d.game?.version ?? '') },
    savedAt: String(d.savedAt ?? ''),
    label: String(d.label ?? s.scene),
    state: s as GameState,
    log: Array.isArray(d.log) ? d.log : [],
  };
}

export class SaveStore {
  constructor(
    private readonly store: KeyValueStore,
    private readonly key: string,
  ) {}

  private slotKey(slot: SlotId): string {
    return `scroum:save:${this.key}:${slot}`;
  }

  read(slot: SlotId): SaveFile | null {
    const raw = readJson<unknown>(this.store, this.slotKey(slot));
    if (!raw) return null;
    try {
      return parseSave(raw);
    } catch {
      return null;
    }
  }

  write(slot: SlotId, save: SaveFile): boolean {
    return writeJson(this.store, this.slotKey(slot), save);
  }

  remove(slot: SlotId): void {
    try {
      this.store.removeItem(this.slotKey(slot));
    } catch {
      /* stockage indisponible */
    }
  }

  /** Emplacements : sauvegarde auto puis emplacements manuels 1..n. */
  list(): { slot: SlotId; save: SaveFile | null }[] {
    const out: { slot: SlotId; save: SaveFile | null }[] = [{ slot: 'auto', save: this.read('auto') }];
    for (let i = 1; i <= SAVE_SLOTS; i++) out.push({ slot: i, save: this.read(i) });
    return out;
  }
}
