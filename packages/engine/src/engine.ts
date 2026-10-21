/**
 * Exécution : `start(game)` et `step(game, state, action)`.
 *
 * Fonctions pures : l'état reçu n'est jamais modifié (le moteur travaille sur
 * une copie). Une action invalide (ou un contenu incohérent rencontré pendant
 * l'action) renvoie l'état inchangé et un unique événement `error` ; le moteur
 * ne lève jamais d'exception.
 *
 * Sémantique : docs/FORMAT.md (§7 scripts, §6 use/sorties, §10 dialogues).
 */
import { counterTitle, findCombination, type Checkpoint, type GameData, type Id, type Script, type Transition } from '@scroum/schema';
import { evalCondition } from './conditions';
import {
  canLeave,
  currentMode,
  currentNode,
  currentScene,
  currentWorld,
  inScope,
  isRevealed,
  isTargetVisible,
  nodeMode,
  playerSpeaker,
  refuseLine,
  resolveNext,
  resolveLines,
  resolveSpeaker,
  visibleChoices,
} from './queries';
import { clampCounter, clampVar, cloneState, createInitialState, maxQty, sortedAdd, sortedRemove, type GameState } from './state';
import { DEFAULT_THRESHOLD, type Action, type EngineEvent, type EngineOptions, type ErrorCode, type RefuseReason, type StepResult } from './types';

/** Fin de partie : interrompt toute l'exécution en cours. */
class EndSignal {}

/** Action invalide ou contenu incohérent : on annule l'action. */
class Abort {
  constructor(
    readonly code: ErrorCode,
    readonly message: string,
  ) {}
}

/** Effets différés d'un script (`goto_scene`, `start_dialogue`). */
interface Ctx {
  /** Scène où le script est écrit (pour `reveal`/`hide` sans `scene`), null = scène courante. */
  scene: Id | null;
  pendingScene: Id | null;
  pendingDialogue: { id: Id; node: Id | null } | null;
}

const ctx = (scene: Id | null): Ctx => ({ scene, pendingScene: null, pendingDialogue: null });

class Runtime {
  readonly events: EngineEvent[] = [];
  private transitions = 0;
  private readonly maxTransitions: number;

  constructor(
    readonly game: GameData,
    readonly state: GameState,
    readonly options: EngineOptions,
  ) {
    this.maxTransitions = options.maxTransitions ?? 200;
  }

  emit(e: EngineEvent): void {
    this.events.push(e);
  }

  private tick(): void {
    if (++this.transitions > this.maxTransitions)
      throw new Abort('loop_limit', `plus de ${this.maxTransitions} enchaînements de scènes/nœuds sans action du joueur (boucle dans le contenu ?)`);
  }

  refuse(reason: RefuseReason, item: Id | null): void {
    const s = resolveSpeaker(this.game, this.state, playerSpeaker(this.game));
    this.emit({ type: 'refuse', reason, item, text: refuseLine(this.game, this.state), ...s });
  }

  // ------------------------------------------------------------------ scripts

  exec(script: Script, c: Ctx): void {
    for (const st of script) {
      if (st.kind === 'if') {
        this.exec(evalCondition(st.condition, this.state) ? st.then : st.else, c);
        continue;
      }
      const s = this.state;
      switch (st.kind) {
        case 'set_flag':
          if (sortedAdd(s.flags, st.flag)) this.emit({ type: 'flag_changed', flag: st.flag, value: true });
          break;
        case 'unset_flag':
          if (sortedRemove(s.flags, st.flag)) this.emit({ type: 'flag_changed', flag: st.flag, value: false });
          break;
        case 'set_var':
          this.setVar(st.var, st.value);
          break;
        case 'add_var':
          this.setVar(st.var, (s.vars[st.var] ?? 0) + st.amount);
          break;
        case 'counter_add':
          this.setCounter(st.counter, (s.counters[st.counter] ?? 0) + st.amount);
          break;
        case 'counter_set':
          this.setCounter(st.counter, st.value);
          break;
        case 'give_item':
          this.giveItem(st.item, st.qty);
          break;
        case 'take_item':
          this.takeItem(st.item, st.qty);
          break;
        case 'reveal':
        case 'hide': {
          const scene = st.scene ?? c.scene ?? s.scene;
          const visible = st.kind === 'reveal';
          const map = (s.visibility[scene] ??= {});
          if (map[st.target] !== visible) {
            map[st.target] = visible;
            this.emit({ type: 'visibility_changed', scene, target: st.target, visible });
          }
          break;
        }
        case 'goto_scene':
          c.pendingScene = st.scene;
          break;
        case 'start_dialogue':
          c.pendingDialogue = { id: st.dialogue, node: st.node };
          break;
        case 'unlock_quest':
          this.unlockQuest(st.quest);
          break;
        case 'complete_quest':
          this.unlockQuest(st.quest);
          if (sortedAdd(s.quests.completed, st.quest))
            this.emit({ type: 'quest_completed', quest: st.quest, title: this.game.quests[st.quest]?.title ?? null });
          break;
        case 'say':
          this.emit({ type: 'say', text: st.text, dialogue: null, node: null, ...resolveSpeaker(this.game, s, st.speaker) });
          break;
        case 'end_game':
          this.endGame(st.ending);
      }
    }
  }

  private setVar(v: Id, value: number): void {
    const previous = this.state.vars[v] ?? 0;
    value = clampVar(this.game, v, value);
    if (value === 0) delete this.state.vars[v];
    else this.state.vars[v] = value;
    if (value !== previous) this.emit({ type: 'var_changed', var: v, value, previous });
  }

  private setCounter(id: Id, raw: number): void {
    const previous = this.state.counters[id] ?? 0;
    const value = clampCounter(this.game, id, raw);
    this.state.counters[id] = value;
    if (value === previous) return;
    const c = this.game.counters[id];
    this.emit({
      type: 'counter_changed',
      counter: id,
      label: c?.label ?? null,
      hud: c?.hud ?? false,
      value,
      previous,
      title: c ? counterTitle(c, value) : null,
      previous_title: c ? counterTitle(c, previous) : null,
    });
  }

  giveItem(item: Id, qty: number): void {
    const cur = this.state.inventory[item] ?? 0;
    const add = Math.max(0, Math.min(qty, maxQty(this.game, item) - cur));
    if (qty > 0) sortedAdd(this.state.ever_had, item);
    if (add <= 0) return;
    this.state.inventory[item] = cur + add;
    this.emit({ type: 'item_gained', item, qty: add, total: cur + add });
  }

  takeItem(item: Id, qty: number): void {
    const cur = this.state.inventory[item] ?? 0;
    const rem = Math.max(0, Math.min(qty, cur));
    if (rem <= 0) return;
    if (cur - rem > 0) this.state.inventory[item] = cur - rem;
    else delete this.state.inventory[item];
    this.emit({ type: 'item_lost', item, qty: rem, total: cur - rem });
  }

  private unlockQuest(q: Id): void {
    if (sortedAdd(this.state.quests.unlocked, q))
      this.emit({ type: 'quest_unlocked', quest: q, title: this.game.quests[q]?.title ?? null });
  }

  private endGame(id: Id): never {
    const e = this.game.endings[id];
    if (!e) throw new Abort('unknown_ending', `fin inconnue « ${id} »`);
    if (this.state.dialogue) {
      this.emit({ type: 'dialogue_ended', dialogue: this.state.dialogue.id, node: this.state.dialogue.node, reason: 'game_ended' });
      this.state.dialogue = null;
    }
    this.state.ending = { id, type: e.type };
    const text = e.text_if?.find((t) => evalCondition(t.condition, this.state))?.text ?? e.text;
    this.emit({ type: 'game_ended', ending: id, ending_type: e.type, title: e.title, text, image: e.image });
    throw new EndSignal();
  }

  /**
   * Applique les effets différés d'un script exécuté hors nœud de dialogue
   * (verbe, use, sortie, on_enter, look/combine d'objet).
   * - hors dialogue : changement de scène (avec son `on_enter`), puis ouverture
   *   du dialogue demandé si `on_enter` n'en a pas déjà ouvert un ;
   * - en dialogue (look/combine pendant un dialogue) : la scène est mise en
   *   attente jusqu'à la fin du dialogue, `start_dialogue` saute vers ce dialogue.
   */
  settle(c: Ctx): void {
    if (this.state.dialogue) {
      if (c.pendingScene) this.state.dialogue.pending_scene = c.pendingScene;
      if (c.pendingDialogue) this.openDialogue(c.pendingDialogue.id, c.pendingDialogue.node);
      return;
    }
    if (c.pendingScene) this.enterScene(c.pendingScene);
    if (c.pendingDialogue && !this.state.dialogue) this.openDialogue(c.pendingDialogue.id, c.pendingDialogue.node);
  }

  /** Script de scène / d'objet : exécution puis effets différés. */
  runScript(script: Script, scene: Id | null): void {
    const c = ctx(scene);
    this.exec(script, c);
    this.settle(c);
  }

  // ------------------------------------------------------------------ scènes

  enterScene(id: Id): void {
    this.tick();
    const scene = this.game.scenes[id];
    if (!scene) throw new Abort('unknown_scene', `scène inconnue « ${id} »`);
    const from = this.started ? this.state.scene : null;
    this.started = true;
    this.state.scene = id;
    this.emit({
      type: 'scene_entered',
      scene: id,
      from,
      title: scene.title,
      world: scene.world,
      skin: this.game.worlds[scene.world]?.ui_skin ?? 'plain',
    });
    this.runScript(scene.on_enter, id);
  }

  /** Vrai une fois la partie démarrée (faux pendant `start`). */
  started = true;

  // ------------------------------------------------------------------ dialogues

  openDialogue(id: Id, node: Id | null): void {
    const d = this.game.dialogues[id];
    if (!d) throw new Abort('unknown_dialogue', `dialogue inconnu « ${id} »`);
    const nodeId = node ?? d.start;
    const pending = this.state.dialogue?.pending_scene ?? null;
    this.state.dialogue = { id, node: nodeId, pending_scene: pending };
    this.emit({
      type: 'dialogue_started',
      dialogue: id,
      node: nodeId,
      skin: this.game.worlds[currentWorld(this.game, this.state)]?.ui_skin ?? 'plain',
      ...resolveSpeaker(this.game, this.state, d.speaker),
    });
    this.enterNode(nodeId);
  }

  /** Entre dans un nœud : répliques, effets, puis attente / enchaînement / fin. */
  enterNode(first: Id): void {
    let nodeId = first;
    for (;;) {
      this.tick();
      const dl = this.state.dialogue!;
      const d = this.game.dialogues[dl.id];
      const node = d?.nodes[nodeId];
      if (!node) throw new Abort('unknown_node', `nœud inconnu « ${nodeId} » dans le dialogue « ${dl.id} »`);
      dl.node = nodeId;
      const lines = resolveLines(this.game, this.state, node);
      for (const l of lines) this.emit({ type: 'say', dialogue: dl.id, node: nodeId, ...l });
      const c = ctx(null);
      this.exec(node.effects, c);
      if (c.pendingScene) dl.pending_scene = c.pendingScene;
      if (c.pendingDialogue) {
        this.openDialogue(c.pendingDialogue.id, c.pendingDialogue.node);
        return;
      }
      const mode = nodeMode(node, this.state);
      if (mode === 'pass') {
        nodeId = resolveNext(node, this.state)!;
        continue;
      }
      if (mode === 'end') {
        this.endDialogue('end');
        return;
      }
      this.emit({
        type: 'dialogue_node',
        dialogue: dl.id,
        node: nodeId,
        mode,
        lines,
        choices: visibleChoices(node, this.state),
        free_text: node.free_text ? { placeholder: node.free_text.placeholder, intents: Object.keys(node.free_text.intents) } : null,
        can_give: node.on_give !== null,
        can_show: node.on_show !== null,
        can_leave: canLeave(this.game, this.state),
      });
      return;
    }
  }

  endDialogue(reason: 'end' | 'leave'): void {
    const dl = this.state.dialogue!;
    this.emit({ type: 'dialogue_ended', dialogue: dl.id, node: dl.node, reason });
    this.state.dialogue = null;
    if (dl.pending_scene) this.enterScene(dl.pending_scene);
  }

  /** Transition de dialogue (choix, texte libre, on_give/on_show) : effets puis `next` (null = fin). */
  transition(t: Pick<Transition, 'effects' | 'next'>): void {
    const c = ctx(null);
    this.exec(t.effects, c);
    if (c.pendingScene) this.state.dialogue!.pending_scene = c.pendingScene;
    if (c.pendingDialogue) this.openDialogue(c.pendingDialogue.id, c.pendingDialogue.node);
    else if (t.next !== null) this.enterNode(t.next);
    else this.endDialogue('end');
  }

  // ------------------------------------------------------------------ post-traitement

  /** Révélations et collections, vérifiées après chaque action. */
  postCheck(): void {
    const s = this.state;
    for (const ch of Object.values(this.game.characters)) {
      if (!ch.persona) continue;
      const now = isRevealed(ch, s);
      const was = s.revealed.includes(ch.id);
      if (now === was) continue;
      if (now) sortedAdd(s.revealed, ch.id);
      else sortedRemove(s.revealed, ch.id);
      this.emit({ type: now ? 'character_revealed' : 'character_hidden', character: ch.id, persona_name: ch.persona.name, name: ch.identity.name });
    }
    for (const col of this.game.collections) {
      if (s.collections.includes(col.id) || !evalCondition(col.condition, s)) continue;
      sortedAdd(s.collections, col.id);
      this.emit({ type: 'collection_unlocked', collection: col.id, title: col.title });
    }
  }

  // ------------------------------------------------------------------ actions

  private owned(item: unknown): Id {
    if (typeof item !== 'string') throw new Abort('bad_action', 'objet attendu');
    if ((this.state.inventory[item] ?? 0) <= 0)
      throw new Abort(this.game.items[item] ? 'missing_item' : 'unknown_item', `objet non possédé « ${item} »`);
    return item;
  }

  private noDialogue(): void {
    if (this.state.dialogue) throw new Abort('in_dialogue', 'action impossible pendant un dialogue');
  }

  private dialogueNode() {
    const node = currentNode(this.game, this.state);
    if (!this.state.dialogue) throw new Abort('not_in_dialogue', 'aucun dialogue en cours');
    if (!node) throw new Abort('unknown_node', `nœud courant introuvable « ${this.state.dialogue.node} »`);
    return node;
  }

  private hotspot(id: unknown) {
    const scene = currentScene(this.game, this.state);
    const h = scene?.hotspots.find((x) => x.id === id);
    if (!scene || !h || !isTargetVisible(this.state, scene.id, h)) throw new Abort('unknown_hotspot', `hotspot absent ou invisible « ${String(id)} »`);
    return { scene, h };
  }

  dispatch(a: Action): void {
    const game = this.game;
    switch (a?.type) {
      case 'verb': {
        this.noDialogue();
        const { scene, h } = this.hotspot(a.hotspot);
        const v = Object.hasOwn(h.actions, a.verb) ? h.actions[a.verb] : undefined;
        if (!v) throw new Abort('unknown_verb', `verbe « ${String(a.verb)} » absent du hotspot « ${h.id} »`);
        this.runScript(v.script, scene.id);
        return;
      }
      case 'use': {
        this.noDialogue();
        const item = this.owned(a.item);
        const { scene, h } = this.hotspot(a.hotspot);
        const specific = h.use && Object.hasOwn(h.use.byItem, item) ? h.use.byItem[item] : undefined;
        if (specific) {
          const c = ctx(scene.id);
          this.exec(specific, c);
          if (game.items[item]?.consumable) this.takeItem(item, 1);
          this.settle(c);
        } else if (!inScope(game.items[item], scene.world)) this.refuse('out_of_scope', item);
        else if (h.use?.default) this.runScript(h.use.default, scene.id);
        else this.refuse('no_reaction', item);
        return;
      }
      case 'exit': {
        this.noDialogue();
        const scene = currentScene(game, this.state);
        const e = scene?.exits.find((x) => x.id === a.exit);
        if (!scene || !e || !isTargetVisible(this.state, scene.id, e)) throw new Abort('unknown_exit', `sortie absente ou invisible « ${String(a.exit)} »`);
        if (e.condition && !evalCondition(e.condition, this.state)) {
          this.runScript(e.else, scene.id);
          return;
        }
        const c = ctx(scene.id);
        this.exec(e.script, c);
        c.pendingScene = e.to;
        this.settle(c);
        return;
      }
      case 'choose': {
        const node = this.dialogueNode();
        const choice = Number.isInteger(a.choice) ? node.choices[a.choice] : undefined;
        if (currentMode(game, this.state) !== 'input' || !choice || !visibleChoices(node, this.state).some((c) => c.index === a.choice))
          throw new Abort('bad_choice', `choix ${String(a.choice)} indisponible`);
        this.echoChoice(choice.label);
        this.transition(choice);
        return;
      }
      case 'continue': {
        const node = this.dialogueNode();
        if (currentMode(game, this.state) !== 'continue') throw new Abort('cannot_continue', 'le nœud courant attend un choix');
        this.enterNode(resolveNext(node, this.state)!);
        return;
      }
      case 'intent': {
        const node = this.dialogueNode();
        const ft = node.free_text;
        if (!ft || currentMode(game, this.state) !== 'input') throw new Abort('no_free_text', 'le nœud courant n’accepte pas de texte libre');
        if (typeof a.confidence !== 'number' || (a.intent !== null && typeof a.intent !== 'string')) throw new Abort('bad_action', 'intention mal formée');
        const threshold = ft.threshold ?? this.options.threshold ?? DEFAULT_THRESHOLD;
        const intent = a.intent;
        const item = a.item ?? null;
        if (intent === null || a.confidence < threshold) return this.transition(ft.fallback);
        if (Object.hasOwn(ft.intents, intent)) return this.transition(ft.intents[intent]!);
        const ch = visibleChoices(node, this.state).find((c) => c.intent === intent);
        if (ch) return this.transition(node.choices[ch.index]!);
        if ((intent === 'give_item' || intent === 'show_item') && item !== null) {
          const reactions = intent === 'give_item' ? node.on_give : node.on_show;
          if (reactions) {
            if ((this.state.inventory[item] ?? 0) <= 0) return this.refuse('missing_item', item);
            return this.giveOrShow(intent === 'give_item' ? 'give' : 'show', item);
          }
        }
        return this.transition(ft.fallback);
      }
      case 'give':
      case 'show': {
        const node = this.dialogueNode();
        if (!(a.type === 'give' ? node.on_give : node.on_show)) throw new Abort(a.type === 'give' ? 'cannot_give' : 'cannot_show', `le nœud n’a pas de on_${a.type}`);
        this.giveOrShow(a.type, this.owned(a.item));
        return;
      }
      case 'combine': {
        const x = this.owned(a.item);
        const y = this.owned(a.with);
        if (x === y && (this.state.inventory[x] ?? 0) < 2) throw new Abort('missing_item', `il faut deux « ${x} » pour les combiner`);
        const found = findCombination(game, x, y);
        if (!found) return this.refuse('no_combination', x);
        const comb = found.combination;
        for (const it of comb.consume) this.takeItem(it, 1);
        if (comb.result) this.giveItem(comb.result, 1);
        this.runScript(comb.effects, null);
        return;
      }
      case 'look_item': {
        const item = this.owned(a.item);
        this.runScript(game.items[item]?.look ?? [], null);
        return;
      }
      case 'item_verb': {
        const item = this.owned(a.item);
        const v = Object.hasOwn(game.items[item]?.actions ?? {}, a.verb) ? game.items[item]!.actions[a.verb] : undefined;
        if (!v) throw new Abort('unknown_verb', `verbe « ${String(a.verb)} » absent de l'objet « ${item} »`);
        const c = ctx(null);
        this.exec(v.script, c);
        this.settle(c);
        return;
      }
      case 'leave': {
        this.dialogueNode();
        if (!canLeave(game, this.state)) throw new Abort('cannot_leave', 'impossible de quitter ce dialogue ici');
        this.endDialogue('leave');
        return;
      }
      default:
        throw new Abort('bad_action', `action inconnue « ${String((a as { type?: unknown })?.type)} »`);
    }
  }

  /** Option `dialogue.echo_choices` : le libellé retenu est dit par le personnage joué. */
  private echoChoice(label: string): void {
    const pc = this.game.meta.player_character;
    if (!this.game.meta.dialogue?.echo_choices || !pc) return;
    const dl = this.state.dialogue!;
    this.emit({ type: 'say', text: label, dialogue: dl.id, node: dl.node, ...resolveSpeaker(this.game, this.state, pc) });
  }

  private giveOrShow(kind: 'give' | 'show', item: Id): void {
    const node = currentNode(this.game, this.state)!;
    const r = kind === 'give' ? node.on_give! : node.on_show!;
    const t = Object.hasOwn(r.byItem, item) ? r.byItem[item] : r.default;
    if (!t) return this.refuse(kind === 'give' ? 'no_give_reaction' : 'no_show_reaction', item);
    this.transition(t);
  }
}

function run(game: GameData, base: GameState, original: GameState, options: EngineOptions, body: (rt: Runtime) => void, starting = false): StepResult {
  const rt = new Runtime(game, base, options);
  rt.started = !starting;
  try {
    body(rt);
  } catch (e) {
    if (!(e instanceof EndSignal)) {
      const code: ErrorCode = e instanceof Abort ? e.code : 'internal';
      const message = e instanceof Abort ? e.message : `erreur interne : ${e instanceof Error ? e.message : String(e)}`;
      return { state: original, events: [{ type: 'error', code, message }] };
    }
  }
  rt.postCheck();
  return { state: rt.state, events: rt.events };
}

/**
 * Démarre une partie : état initial (`createInitialState`) puis entrée dans la
 * scène de départ (`scene_entered` avec `from: null`, `on_enter`).
 */
export function start(game: GameData, options: EngineOptions = {}): StepResult {
  const initial = createInitialState(game);
  return run(game, cloneState(initial), initial, options, (rt) => rt.enterScene(game.meta.start_scene), true);
}

/** Applique une action du joueur. Pur : `state` n'est pas modifié. */
export function step(game: GameData, state: GameState, action: Action, options: EngineOptions = {}): StepResult {
  if (state.ending) return { state, events: [{ type: 'error', code: 'game_ended', message: 'la partie est terminée' }] };
  return run(game, cloneState(state), state, options, (rt) => rt.dispatch(action));
}

/** Fusionne un point de reprise par-dessus un état initial (voir `startFromCheckpoint`). */
export function checkpointState(game: GameData, cp: Checkpoint): GameState {
  const state = createInitialState(game);
  if (cp.scene) state.scene = cp.scene;
  for (const f of cp.flags) sortedAdd(state.flags, f);
  for (const [k, raw] of Object.entries(cp.vars)) {
    const v = clampVar(game, k, raw);
    if (v !== 0) state.vars[k] = v;
    else delete state.vars[k];
  }
  for (const [k, v] of Object.entries(cp.counters)) state.counters[k] = clampCounter(game, k, v);
  for (const [item, qty] of Object.entries(cp.inventory)) {
    const q = Math.min(qty, maxQty(game, item));
    if (q > 0) {
      state.inventory[item] = q;
      sortedAdd(state.ever_had, item);
    }
  }
  for (const [scene, targets] of Object.entries(cp.reveal)) for (const t of targets) (state.visibility[scene] ??= {})[t] = true;
  for (const [scene, targets] of Object.entries(cp.hide)) for (const t of targets) (state.visibility[scene] ??= {})[t] = false;
  for (const q of [...cp.quests, ...cp.completed]) sortedAdd(state.quests.unlocked, q);
  for (const q of cp.completed) sortedAdd(state.quests.completed, q);
  for (const ch of Object.values(game.characters)) {
    if (ch.persona && ch.revealed_by && evalCondition(ch.revealed_by, state)) sortedAdd(state.revealed, ch.id);
  }
  for (const col of game.collections) if (evalCondition(col.condition, state)) sortedAdd(state.collections, col.id);
  return state;
}

/**
 * Démarre depuis le point de reprise d'une quête : `start` mais sur l'état
 * `checkpointState`, avec entrée dans la scène du point de reprise (`on_enter`)
 * puis, si déclaré, ouverture du dialogue.
 */
export function startFromCheckpoint(game: GameData, cp: Checkpoint, options: EngineOptions = {}): StepResult {
  const initial = checkpointState(game, cp);
  return run(
    game,
    cloneState(initial),
    initial,
    options,
    (rt) => {
      rt.enterScene(initial.scene);
      if (cp.dialogue && !rt.state.dialogue && !rt.state.ending) rt.openDialogue(cp.dialogue.id, cp.dialogue.node);
    },
    true,
  );
}
