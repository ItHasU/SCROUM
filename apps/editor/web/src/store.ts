/** État global de l'éditeur et rechargement des données (SSE). */
import type { ContentError, GameData } from '@scroum/schema';
import { api, type FileEntry, type ProjectInfo, type Report } from './api';
import { refKey, type Ref } from './model/refs';

export type ViewName = 'bible' | 'graph' | 'items' | 'files' | 'playtest' | 'claude';

export interface AppState {
  project: ProjectInfo | null;
  game: GameData | null;
  /** Erreurs de chargement quand `game` est inutilisable. */
  gameErrors: ContentError[];
  report: Report | null;
  files: FileEntry[];
  selection: Ref | null;
  view: ViewName;
  /** Chemin de fichier sélectionné sans élément (vue Fichiers, rapport). */
  file: string | null;
  /** Fichiers modifiés lors du dernier rechargement SSE. */
  lastChanged: string[];
  /** Scène demandée par « Jouer depuis ici » (null = départ normal). */
  playScene: string | null;
}

type Topic = 'data' | 'selection' | 'view' | 'play';
const listeners: Record<Topic, Set<() => void>> = { data: new Set(), selection: new Set(), view: new Set(), play: new Set() };

export const state: AppState = { project: null, game: null, gameErrors: [], report: null, files: [], selection: null, view: 'graph', file: null, lastChanged: [], playScene: null };

export function on(topic: Topic, fn: () => void): void {
  listeners[topic].add(fn);
}
const emit = (topic: Topic): void => listeners[topic].forEach((f) => f());

export function select(ref: Ref | null, file: string | null = null): void {
  if (ref && state.selection && refKey(ref) === refKey(state.selection) && !file) return;
  state.selection = ref;
  state.file = file;
  emit('selection');
}

export function setView(v: ViewName): void {
  if (state.view === v) return;
  state.view = v;
  emit('view');
}

/** « Jouer depuis ici » : ouvre le playtest sur une scène. */
export function requestPlay(scene: string | null): void {
  state.playScene = scene;
  state.view = 'playtest';
  emit('play');
  emit('view');
}

export async function reload(changed: string[] = []): Promise<void> {
  const [g, report, files] = await Promise.all([api.game(), api.validate(), api.files()]);
  if (g.game) {
    state.game = g.game;
    state.gameErrors = [];
  } else {
    state.gameErrors = g.errors;
  }
  state.report = report;
  state.files = files;
  state.lastChanged = changed;
  emit('data');
}

/** Ouvre le flux SSE ; recharge à chaque changement (regroupé). */
export function connectEvents(): void {
  let timer: number | undefined;
  let pending: string[] = [];
  const es = new EventSource('/events');
  es.onmessage = (m) => {
    let msg: { type?: string; files?: string[] };
    try {
      msg = JSON.parse(m.data) as typeof msg;
    } catch {
      return;
    }
    if (msg.type !== 'change') return;
    pending.push(...(msg.files ?? []));
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const files = [...new Set(pending)];
      pending = [];
      void reload(files);
    }, 80);
  };
  es.onopen = () => {
    document.body.dataset.live = 'on';
  };
  es.onerror = () => {
    document.body.dataset.live = 'off';
  };
}
