/**
 * Contrôleur du player : état de jeu + dispatch + boucle d'événements.
 *
 * Indépendant du DOM (testable dans Node) : les vues s'abonnent avec
 * `subscribe()` et relisent l'état à chaque mise à jour. Le moteur
 * (`@scroum/engine`) reste la seule source de vérité des transitions ; le
 * contrôleur ajoute l'état d'interface (journal, objet sélectionné, sessions de
 * dialogue, dialogue « en cours de fermeture »).
 */
import { NARRATOR, type GameData, type Id } from '@scroum/schema';
import {
  DEFAULT_THRESHOLD,
  KeywordBackend,
  buildClassifyRequest,
  buildRephraseRequest,
  cloneState,
  createInitialState,
  currentNode,
  intentAction,
  resolveLines,
  sceneView,
  start,
  step,
  type Action,
  type ClassifyResult,
  type EngineEvent,
  type EngineOptions,
  type GameState,
  type LlmBackend,
  type StepResult,
} from '@scroum/engine';
import { describeEvent, type InfoEntry, type LineEntry, type LogEntry } from './log';
import { withTimeout } from './backends/util';

/** Résultat du classifieur pour une saisie libre (protocole playtest : champ `intent`). */
export interface IntentInfo {
  text: string;
  intent: Id | null;
  confidence: number;
  threshold: number;
  accepted: boolean;
  item?: Id | null;
}

export type ControllerUpdate =
  /** Nouvelle partie, chargement, `set_state` : tout réafficher. */
  | { type: 'reset'; events: EngineEvent[] }
  /** Une action a été jouée. */
  | { type: 'step'; action: Action; events: EngineEvent[]; intent?: IntentInfo }
  /** Sélection d'objet modifiée. */
  | { type: 'selection' }
  /** `GameData` remplacé (rechargement de contenu). */
  | { type: 'game'; stateChanged: boolean }
  /** Journal modifié hors action (reformulation). */
  | { type: 'log' }
  /** Le dialogue terminé a été refermé par le joueur. */
  | { type: 'dialogue_closed' }
  /** Occupation (classification de texte libre en cours). */
  | { type: 'busy'; busy: boolean };

export type ControllerListener = (u: ControllerUpdate, c: GameController) => void;

export interface ControllerOptions {
  engine?: EngineOptions;
  /** Classifieur du texte libre (relu à chaque saisie ; défaut : `KeywordBackend`). */
  classifier?: () => LlmBackend;
  /** Délai max du classifieur avant repli sur les mots-clés (ms, défaut 8000). */
  classifyTimeoutMs?: number;
  /** Reformulateur (null = désactivé, défaut). */
  rephraser?: () => LlmBackend | null;
  /** Délai max d'une reformulation (ms, défaut 6000). */
  rephraseTimeoutMs?: number;
  /** Longueur max d'une réplique reformulée (défaut 240). */
  rephraseMaxLength?: number;
  /** Nombre max d'entrées conservées dans le journal (défaut 400). */
  maxLog?: number;
}

/** Dialogue terminé dont les dernières répliques restent affichées jusqu'à « Suite ». */
export interface LingeringDialogue {
  dialogue: Id;
  session: number;
  skin: string;
}

/** Ce qui est sauvegardé en plus de l'état du moteur. */
export interface ControllerSnapshot {
  state: GameState;
  log: LogEntry[];
}

const keyword = new KeywordBackend();

/** Borne une reformulation : rejette les réponses vides, trop longues ou multi-lignes suspectes. */
export function boundRephrase(original: string, candidate: string, maxLength: number): string {
  let s = (candidate ?? '').trim().replace(/^["«“]\s*|\s*["»”]$/g, '').trim();
  if (!s) return original;
  const limit = Math.max(maxLength, Math.ceil(original.length * 1.6));
  if (s.length > limit) {
    const cut = s.slice(0, limit);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = end > limit * 0.5 ? cut.slice(0, end + 1) : original;
  }
  return s;
}

export class GameController {
  private _game: GameData;
  private _state: GameState;
  private _log: LogEntry[] = [];
  private _selected: Id | null = null;
  private _lastEvents: EngineEvent[] = [];
  private _lingering: LingeringDialogue | null = null;
  private _busy = false;
  private nextId = 1;
  private sessionCounter = 0;
  private session: number | null = null;
  private readonly listeners = new Set<ControllerListener>();

  constructor(
    game: GameData,
    readonly options: ControllerOptions = {},
  ) {
    this._game = game;
    this._state = createInitialState(game);
  }

  get game(): GameData {
    return this._game;
  }
  get state(): GameState {
    return this._state;
  }
  get log(): readonly LogEntry[] {
    return this._log;
  }
  get selected(): Id | null {
    return this._selected;
  }
  get lastEvents(): readonly EngineEvent[] {
    return this._lastEvents;
  }
  /** Dialogue terminé à refermer (« Suite »), null sinon. */
  get lingering(): LingeringDialogue | null {
    return this._lingering;
  }
  get busy(): boolean {
    return this._busy;
  }
  /** Session de dialogue courante (pour filtrer le journal du dialogue). */
  get currentSession(): number | null {
    return this.session ?? this._lingering?.session ?? null;
  }

  subscribe(fn: ControllerListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(u: ControllerUpdate): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(u, this);
      } catch (e) {
        console.error('[scroum] écouteur du contrôleur en erreur', e);
      }
    }
  }

  // ---------------------------------------------------------------- parties

  /** Nouvelle partie, dans `scene` si elle existe (paramètre `?scene=`), sinon la scène de départ. */
  newGame(scene?: Id | null): StepResult {
    const g = scene && this._game.scenes[scene] ? { ...this._game, meta: { ...this._game.meta, start_scene: scene } } : this._game;
    const r = start(g, this.options.engine);
    this._log = [];
    this.nextId = 1;
    this.sessionCounter = 0;
    this.session = null;
    this._selected = null;
    this._lingering = null;
    this._state = r.state;
    this._lastEvents = r.events;
    this.ingest(r.events);
    this.emit({ type: 'reset', events: r.events });
    return r;
  }

  /**
   * Remplace l'état (chargement de sauvegarde, `set_state` du playtest) sans
   * relancer la partie. `log` remplace le journal s'il est fourni (sinon il est conservé).
   */
  loadState(state: GameState, log?: readonly LogEntry[]): void {
    this._state = this.sanitize(cloneState(state)).state;
    if (log) {
      this._log = log.map((e) => ({ ...e }));
      this.nextId = this._log.reduce((m, e) => Math.max(m, e.id), 0) + 1;
      this.sessionCounter = this._log.reduce((m, e) => Math.max(m, e.session ?? 0), 0);
    }
    this._lingering = null;
    this._lastEvents = [];
    if (this._selected && !(this._state.inventory[this._selected] ?? 0)) this._selected = null;
    this.syncSession();
    this.emit({ type: 'reset', events: [] });
  }

  /**
   * Remplace le `GameData` (rechargement depuis l'éditeur) en conservant l'état.
   * Corrige l'état s'il référence des éléments disparus ; renvoie true si l'état a changé.
   */
  replaceGame(game: GameData): boolean {
    this._game = game;
    const { state, changed } = this.sanitize(this._state);
    this._state = state;
    if (this._lingering && !game.dialogues[this._lingering.dialogue]) this._lingering = null;
    this.syncSession();
    this.emit({ type: 'game', stateChanged: changed });
    return changed;
  }

  /** Rend un état compatible avec le jeu courant (scène / dialogue / compteurs disparus). */
  private sanitize(input: GameState): { state: GameState; changed: boolean } {
    const g = this._game;
    const s = cloneState(input);
    let changed = false;
    if (!g.scenes[s.scene]) {
      s.scene = g.meta.start_scene;
      changed = true;
    }
    if (s.dialogue && !g.dialogues[s.dialogue.id]?.nodes[s.dialogue.node]) {
      s.dialogue = null;
      changed = true;
    }
    for (const c of Object.values(g.counters)) {
      if (s.counters[c.id] === undefined) {
        s.counters[c.id] = c.initial;
        changed = true;
      }
    }
    return { state: s, changed };
  }

  /** Session de dialogue : en reprendre une si l'état est en dialogue, avec les répliques du nœud. */
  private syncSession(): void {
    if (!this._state.dialogue) {
      this.session = null;
      return;
    }
    const d = this._state.dialogue;
    const last = [...this._log].reverse().find((e) => e.session !== null);
    if (this.session !== null && last && last.session === this.session) return;
    this.session = ++this.sessionCounter;
    const node = this._game.dialogues[d.id]?.nodes[d.node];
    if (!node) return;
    for (const l of resolveLines(this._game, this._state, node)) {
      this.push({ kind: 'line', speaker: l.speaker, name: l.name, text: l.text, world: l.world, player: l.speaker === this._game.meta.player_character });
    }
  }

  snapshot(): ControllerSnapshot {
    return { state: cloneState(this._state), log: this._log.map((e) => ({ ...e })) };
  }

  // ---------------------------------------------------------------- actions

  /** Joue une action. Les erreurs du moteur sont rapportées en événement `error` (état inchangé). */
  dispatch(action: Action, intent?: IntentInfo): StepResult {
    this._lingering = null;
    const r = step(this._game, this._state, action, this.options.engine);
    this._state = r.state;
    this._lastEvents = r.events;
    if (r.events.some((e) => e.type === 'error')) console.warn('[scroum]', action, r.events);
    const added = this.ingest(r.events);
    if (this._selected && !(this._state.inventory[this._selected] ?? 0)) this._selected = null;
    this.emit(intent ? { type: 'step', action, events: r.events, intent } : { type: 'step', action, events: r.events });
    this.rephrase(added);
    return r;
  }

  /** Texte libre : classification (backend configuré, repli mots-clés) puis action `intent`. */
  async submitText(text: string): Promise<IntentInfo | null> {
    const t = text.trim();
    if (!t || this._busy || !this._state.dialogue) return null;
    const node = currentNode(this._game, this._state);
    if (!node?.free_text) return null;
    const stateBefore = this._state;
    const req = buildClassifyRequest(this._game, this._state, t);
    const backend = this.options.classifier?.() ?? keyword;
    let res: ClassifyResult;
    this.setBusy(true);
    try {
      res = backend === keyword ? keyword.classifySync(req) : await withTimeout(backend.classify(req), this.options.classifyTimeoutMs ?? 8000);
      if (typeof res?.confidence !== 'number') throw new Error('réponse de classifieur invalide');
    } catch (e) {
      console.warn('[scroum] classifieur indisponible, repli sur les mots-clés', e);
      res = keyword.classifySync(req);
    } finally {
      this.setBusy(false);
    }
    if (this._state !== stateBefore) return null;
    const threshold = node.free_text.threshold ?? this.options.engine?.threshold ?? DEFAULT_THRESHOLD;
    const info: IntentInfo = {
      text: t,
      intent: res.intent,
      confidence: res.confidence,
      threshold,
      accepted: res.intent !== null && res.confidence >= threshold,
      item: res.item ?? null,
    };
    const pc = this._game.meta.player_character;
    const pcName = pc ? (this._game.characters[pc]?.identity.name ?? null) : null;
    this.push({ kind: 'line', speaker: pc ?? 'player', name: pcName ?? 'Vous', text: t, world: sceneView(this._game, this._state)?.world ?? '', player: true, typed: true });
    this.dispatch(intentAction(res), info);
    return info;
  }

  private setBusy(b: boolean): void {
    this._busy = b;
    this.emit({ type: 'busy', busy: b });
  }

  // ------------------------------------------------------------ inventaire

  /** Sélectionne (ou désélectionne avec null / le même objet) un objet possédé. */
  select(item: Id | null): void {
    const next = item && item !== this._selected && (this._state.inventory[item] ?? 0) > 0 ? item : null;
    if (next === this._selected) return;
    this._selected = next;
    this.emit({ type: 'selection' });
  }

  /** Tap sur un objet du tiroir : combine avec l'objet sélectionné, sinon examine. */
  tapItem(item: Id): StepResult | null {
    if (this._state.ending) return null;
    const sel = this._selected;
    if (sel && sel !== item) {
      this._selected = null;
      return this.dispatch({ type: 'combine', item: sel, with: item });
    }
    if (sel === item) {
      this.select(null);
      return null;
    }
    return this.dispatch({ type: 'look_item', item });
  }

  /** Utilise l'objet sélectionné sur un hotspot. */
  useSelectedOn(hotspot: Id): StepResult | null {
    const item = this._selected;
    if (!item) return null;
    this._selected = null;
    return this.dispatch({ type: 'use', item, hotspot });
  }

  /** Donne / montre l'objet sélectionné à l'interlocuteur. */
  offerSelected(kind: 'give' | 'show'): StepResult | null {
    const item = this._selected;
    if (!item) return null;
    this._selected = null;
    return this.dispatch({ type: kind, item });
  }

  /** Referme le dialogue terminé affiché (« Suite »). */
  closeLingering(): void {
    if (!this._lingering) return;
    this._lingering = null;
    this.emit({ type: 'dialogue_closed' });
  }

  // ---------------------------------------------------------------- journal

  private push(e: Omit<LineEntry, 'id' | 'session'> | Omit<InfoEntry, 'id' | 'session'>): LogEntry {
    const entry = { ...e, id: this.nextId++, session: this.session } as LogEntry;
    this._log.push(entry);
    const max = this.options.maxLog ?? 400;
    if (this._log.length > max) this._log.splice(0, this._log.length - max);
    return entry;
  }

  /** Ajoute au journal les entrées d'une suite d'événements, en suivant les sessions de dialogue. */
  private ingest(events: readonly EngineEvent[]): LogEntry[] {
    const added: LogEntry[] = [];
    let endedSession: { session: number; dialogue: Id; lines: boolean; reason: string } | null = null;
    for (const e of events) {
      if (e.type === 'dialogue_started') {
        this.session = ++this.sessionCounter;
        endedSession = null;
        continue;
      }
      if (e.type === 'dialogue_ended') {
        if (this.session !== null) {
          const s = this.session;
          endedSession = { session: s, dialogue: e.dialogue, reason: e.reason, lines: added.some((a) => a.session === s && a.kind === 'line') };
        }
        this.session = null;
        continue;
      }
      const d = describeEvent(this._game, e);
      if (!d) continue;
      added.push(this.push(d.kind === 'line' ? d.line : d.info));
    }
    if (endedSession && endedSession.lines && endedSession.reason === 'end' && !this._state.dialogue && !this._state.ending) {
      this._lingering = { dialogue: endedSession.dialogue, session: endedSession.session, skin: sceneView(this._game, this._state)?.skin ?? 'plain' };
    }
    return added;
  }

  /** Reformulation asynchrone des répliques de personnages (si un reformulateur est actif). */
  private rephrase(entries: LogEntry[]): void {
    const backend = this.options.rephraser?.();
    if (!backend) return;
    const max = this.options.rephraseMaxLength ?? 240;
    for (const e of entries) {
      if (e.kind !== 'line' || e.speaker === NARRATOR || e.refuse || e.typed || !this._game.characters[e.speaker]) continue;
      const req = buildRephraseRequest(this._game, this._state, { speaker: e.speaker, text: e.text }, max);
      withTimeout(backend.rephrase(req), this.options.rephraseTimeoutMs ?? 6000)
        .then((out) => {
          const text = boundRephrase(e.text, out, max);
          if (text === e.text) return;
          e.original = e.text;
          e.text = text;
          this.emit({ type: 'log' });
        })
        .catch(() => undefined);
    }
  }
}
