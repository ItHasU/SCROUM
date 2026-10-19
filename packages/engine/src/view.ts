/** Helpers de vue pour l'UI (lecture seule, purs). */
import { counterTitle, type CharacterFace, type EndingType, type GameData, type Id, type Rect } from '@scroum/schema';
import {
  canLeave,
  currentDialogue,
  currentMode,
  currentNode,
  currentScene,
  isRevealed,
  ownedItems,
  resolveLines,
  visibleChoices,
  visibleExitList,
  visibleHotspotList,
} from './queries';
import type { GameState } from './state';
import type { ChoiceView, DialogueMode, Face, ResolvedLine } from './types';

export interface CharacterView {
  id: Id;
  /** Face affichée : `persona` tant que l'identité n'est pas révélée. */
  face: Face;
  revealed: boolean;
  /** Champs de la face affichée. */
  name: string;
  description: string | null;
  world: Id | null;
  avatar: Id | null;
  portrait: Id | null;
  persona: CharacterFace | null;
  identity: CharacterFace;
}

/** Personnage tel qu'affiché (persona ou identité selon `revealed_by`). */
export function characterView(game: GameData, state: GameState, id: Id): CharacterView | null {
  const ch = game.characters[id];
  if (!ch) return null;
  const revealed = isRevealed(ch, state);
  const shown = !revealed && ch.persona ? ch.persona : ch.identity;
  return {
    id,
    face: shown === ch.identity ? 'identity' : 'persona',
    revealed,
    name: shown.name,
    description: shown.description,
    world: shown.world,
    avatar: shown.avatar,
    portrait: shown.portrait,
    persona: ch.persona,
    identity: ch.identity,
  };
}

export interface SceneView {
  id: Id;
  title: string | null;
  world: Id;
  skin: string;
  background: Id | null;
}

export function sceneView(game: GameData, state: GameState): SceneView | null {
  const s = currentScene(game, state);
  if (!s) return null;
  return { id: s.id, title: s.title, world: s.world, skin: game.worlds[s.world]?.ui_skin ?? 'plain', background: s.background };
}

export interface HotspotView {
  id: Id;
  label: string;
  rect: Rect;
  image: Id | null;
  character: CharacterView | null;
  /** Verbes du menu contextuel, dans l'ordre (label null = libellé par défaut de l'UI). */
  verbs: { verb: string; label: string | null }[];
  /** Le hotspot a des réactions `use` (spécifiques ou `default`). */
  accepts_items: boolean;
}

/** Hotspots visibles de la scène courante (ordre du fichier : le dernier est au-dessus). */
export function visibleHotspots(game: GameData, state: GameState): HotspotView[] {
  return visibleHotspotList(game, state).map((h) => ({
    id: h.id,
    label: h.label,
    rect: h.rect,
    image: h.image,
    character: h.character ? characterView(game, state, h.character) : null,
    verbs: Object.entries(h.actions).map(([verb, a]) => ({ verb, label: a.label })),
    accepts_items: h.use !== null,
  }));
}

export interface ExitView {
  id: Id;
  label: string;
  to: Id;
  rect: Rect;
}

export function visibleExits(game: GameData, state: GameState): ExitView[] {
  return visibleExitList(game, state).map((e) => ({ id: e.id, label: e.label, to: e.to, rect: e.rect }));
}

export interface CounterView {
  id: Id;
  label: string;
  value: number;
  /** Titre courant (palier `titles`), null si aucun. */
  title: string | null;
  hud: boolean;
}

/** Tous les compteurs déclarés (ordre de game.yaml). */
export function counterViews(game: GameData, state: GameState): CounterView[] {
  return Object.values(game.counters).map((c) => {
    const value = state.counters[c.id] ?? c.initial;
    return { id: c.id, label: c.label, value, title: counterTitle(c, value), hud: c.hud };
  });
}

/** Compteurs affichés dans le HUD (`hud: true`). */
export function hudCounters(game: GameData, state: GameState): CounterView[] {
  return counterViews(game, state).filter((c) => c.hud);
}

export interface InventoryEntry {
  id: Id;
  name: string;
  description: string | null;
  icon: Id | null;
  qty: number;
  stackable: boolean;
  consumable: boolean;
}

/** Inventaire détaillé (ordre de items.yaml). */
export function inventoryView(game: GameData, state: GameState): InventoryEntry[] {
  return ownedItems(game, state).map((id) => {
    const it = game.items[id];
    return {
      id,
      name: it?.name ?? id,
      description: it?.description ?? null,
      icon: it?.icon ?? null,
      qty: state.inventory[id] ?? 0,
      stackable: it?.stackable ?? false,
      consumable: it?.consumable ?? false,
    };
  });
}

export interface QuestEntry {
  id: Id;
  title: string;
  description: string | null;
  state: 'active' | 'completed';
}

/** Journal des quêtes : quêtes débloquées (ordre de quests.yaml). */
export function questLog(game: GameData, state: GameState): QuestEntry[] {
  const ids = [...Object.keys(game.quests), ...state.quests.unlocked.filter((q) => !game.quests[q])];
  return ids
    .filter((q) => state.quests.unlocked.includes(q) || state.quests.completed.includes(q))
    .map((q) => ({
      id: q,
      title: game.quests[q]?.title ?? q,
      description: game.quests[q]?.description ?? null,
      state: state.quests.completed.includes(q) ? 'completed' : 'active',
    }));
}

export interface CollectionView {
  id: Id;
  title: string;
  text: string | null;
  images: Id[];
  /** Avec un personnage : l'UI montre `persona.avatar` à côté de `identity.portrait`. */
  character: CharacterView | null;
}

/** Collections débloquées (ordre de game.yaml). */
export function unlockedCollections(game: GameData, state: GameState): CollectionView[] {
  return game.collections
    .filter((c) => state.collections.includes(c.id))
    .map((c) => ({ id: c.id, title: c.title, text: c.text, images: c.images, character: c.character ? characterView(game, state, c.character) : null }));
}

export interface DialogueView {
  dialogue: Id;
  node: Id;
  skin: string;
  speaker: CharacterView | null;
  mode: DialogueMode;
  lines: ResolvedLine[];
  choices: ChoiceView[];
  free_text: { placeholder: string | null; intents: Id[] } | null;
  can_give: boolean;
  can_show: boolean;
  can_leave: boolean;
}

/** Dialogue en cours (pour réafficher le nœud, p. ex. après chargement d'une sauvegarde). */
export function dialogueView(game: GameData, state: GameState): DialogueView | null {
  const d = currentDialogue(game, state);
  const node = currentNode(game, state);
  const mode = currentMode(game, state);
  if (!d || !node || !mode || !state.dialogue) return null;
  return {
    dialogue: d.id,
    node: node.id,
    skin: sceneView(game, state)?.skin ?? 'plain',
    speaker: characterView(game, state, d.speaker),
    mode,
    lines: resolveLines(game, state, node),
    choices: mode === 'input' ? visibleChoices(node, state) : [],
    free_text: node.free_text ? { placeholder: node.free_text.placeholder, intents: Object.keys(node.free_text.intents) } : null,
    can_give: node.on_give !== null,
    can_show: node.on_show !== null,
    can_leave: canLeave(game, state),
  };
}

export interface EndingView {
  id: Id;
  type: EndingType;
  title: string | null;
  text: string | null;
  image: Id | null;
}

export function endingView(game: GameData, state: GameState): EndingView | null {
  if (!state.ending) return null;
  const e = game.endings[state.ending.id];
  return { id: state.ending.id, type: state.ending.type, title: e?.title ?? null, text: e?.text ?? null, image: e?.image ?? null };
}
