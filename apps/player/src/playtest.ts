/**
 * Protocole playtest (docs/ARCHITECTURE.md) : quand le player est dans une
 * iframe de même origine, envoie `ready` puis `state` après chaque action, et
 * gère `set_state` / `restart`. Tout autre message est ignoré.
 */
import type { GameState } from '@scroum/engine';
import type { GameController, IntentInfo } from '@scroum/ui';

export const PROTOCOL_VERSION = 1;

/** Branche le protocole sur un contrôleur ; renvoie la fonction de débranchement (no-op hors iframe). */
export function attachPlaytest(ctrl: GameController, win: Window = window): () => void {
  const parent = win.parent;
  if (!parent || parent === win) return () => undefined;
  const origin = win.location.origin;
  const post = (msg: unknown) => {
    try {
      parent.postMessage(msg, origin);
    } catch (e) {
      console.warn('[scroum] postMessage impossible', e);
    }
  };
  const sendState = (intent?: IntentInfo) => {
    const msg: Record<string, unknown> = { scroum: 'state', state: ctrl.state, lastEvents: ctrl.lastEvents };
    if (intent) msg.intent = intent;
    post(msg);
  };
  const unsub = ctrl.subscribe((u) => {
    if (u.type === 'step') sendState(u.intent);
    else if (u.type === 'reset') sendState();
    else if (u.type === 'game' && u.stateChanged) sendState();
  });
  const onMessage = (ev: MessageEvent) => {
    if (ev.origin !== origin || ev.source !== parent) return;
    const msg = ev.data as { scroum?: unknown; state?: unknown; scene?: unknown; quest?: unknown } | null;
    if (!msg || typeof msg !== 'object') return;
    if (msg.scroum === 'set_state' && msg.state && typeof msg.state === 'object') {
      ctrl.loadState(msg.state as GameState);
    } else if (msg.scroum === 'restart') {
      ctrl.newGame(typeof msg.scene === 'string' ? msg.scene : null, typeof msg.quest === 'string' ? msg.quest : null);
    }
  };
  win.addEventListener('message', onMessage);
  post({ scroum: 'ready', version: PROTOCOL_VERSION });
  sendState();
  return () => {
    unsub();
    win.removeEventListener('message', onMessage);
  };
}
