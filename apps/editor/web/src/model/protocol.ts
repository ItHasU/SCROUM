/**
 * Protocole de playtest entre l'éditeur (parent) et le player (iframe `/play/`).
 * Spécifié dans docs/ARCHITECTURE.md (« Protocole playtest »).
 * Les types sont structurels : l'éditeur n'importe pas le moteur.
 */

export const PROTOCOL_VERSION = 1;

/** État tel que sérialisé par le moteur (`GameState`) ; seuls les champs utiles au debug sont typés. */
export interface DebugState {
  scene: string;
  flags: string[];
  vars: Record<string, number>;
  counters: Record<string, number>;
  inventory: Record<string, number>;
  dialogue: { id: string; node: string } | null;
  ending?: { id: string; type: string } | null;
  quests?: { unlocked: string[]; completed: string[] };
  /** Le reste de l'état est conservé tel quel pour le renvoyer dans `set_state`. */
  [k: string]: unknown;
}

export interface IntentInfo {
  text?: string;
  intent: string | null;
  confidence: number;
  threshold?: number;
  accepted?: boolean;
}

/** player → éditeur. */
export type PlayerMessage =
  | { scroum: 'ready'; version?: number }
  | { scroum: 'state'; state: DebugState; lastEvents: { type: string; [k: string]: unknown }[]; intent?: IntentInfo | null };

/** éditeur → player. */
export type EditorMessage = { scroum: 'set_state'; state: DebugState } | { scroum: 'restart'; scene?: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numMap = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isObj(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'number') out[k] = x;
  return out;
};

/** Valide/normalise un message reçu du player ; null si ce n'en est pas un. */
export function parsePlayerMessage(data: unknown): PlayerMessage | null {
  if (!isObj(data)) return null;
  if (data.scroum === 'ready') return { scroum: 'ready', ...(typeof data.version === 'number' ? { version: data.version } : {}) };
  if (data.scroum !== 'state' || !isObj(data.state)) return null;
  const s = data.state;
  const d = isObj(s.dialogue) && typeof s.dialogue.id === 'string' ? { id: s.dialogue.id, node: String(s.dialogue.node ?? '') } : null;
  const state: DebugState = {
    ...s,
    scene: typeof s.scene === 'string' ? s.scene : '',
    flags: Array.isArray(s.flags) ? s.flags.filter((f): f is string => typeof f === 'string') : isObj(s.flags) ? Object.keys(s.flags).filter((k) => s.flags && (s.flags as Record<string, unknown>)[k]) : [],
    vars: numMap(s.vars),
    counters: numMap(s.counters),
    inventory: numMap(s.inventory),
    dialogue: d,
  };
  const events = Array.isArray(data.lastEvents) ? data.lastEvents.filter((e): e is { type: string } => isObj(e) && typeof e.type === 'string') : [];
  let intent: IntentInfo | null = null;
  if (isObj(data.intent) && typeof data.intent.confidence === 'number') {
    intent = {
      intent: typeof data.intent.intent === 'string' ? data.intent.intent : null,
      confidence: data.intent.confidence,
      ...(typeof data.intent.text === 'string' ? { text: data.intent.text } : {}),
      ...(typeof data.intent.threshold === 'number' ? { threshold: data.intent.threshold } : {}),
      ...(typeof data.intent.accepted === 'boolean' ? { accepted: data.intent.accepted } : {}),
    };
  }
  return { scroum: 'state', state, lastEvents: events, intent };
}

/** Cible de « Jouer depuis ici » : un id de scène, ou `quest:<id>` pour le checkpoint d'une quête. */
export const questTarget = (id: string): string => `quest:${id}`;
export const questOfTarget = (target?: string | null): string | null => (target?.startsWith('quest:') ? target.slice(6) : null);

/** URL du player en mode source directe, éventuellement positionné sur une scène. */
export function playUrl(scene?: string | null): string {
  const quest = questOfTarget(scene);
  if (quest) return `/play/?source=/api&quest=${encodeURIComponent(quest)}`;
  return `/play/?source=/api${scene ? `&scene=${encodeURIComponent(scene)}` : ''}`;
}
