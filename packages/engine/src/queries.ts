/**
 * Requêtes pures sur (jeu, état), partagées par `step`, `listActions` et les
 * helpers de vue.
 */
import { NARRATOR, type Character, type Condition, type Dialogue, type DialogueNode, type Exit, type GameData, type Hotspot, type Id, type Item, type Scene } from '@scroum/schema';
import { evalCondition, evalOptional } from './conditions';
import type { GameState } from './state';
import type { ChoiceView, DialogueMode, Face, ResolvedLine, ResolvedSpeaker } from './types';

export function currentScene(game: GameData, state: GameState): Scene | null {
  return game.scenes[state.scene] ?? null;
}

/** Monde de la scène courante ('' si la scène est inconnue). */
export function currentWorld(game: GameData, state: GameState): Id {
  return currentScene(game, state)?.world ?? '';
}

/** Visibilité d'un hotspot ou d'une sortie de la scène `sceneId`. */
export function isTargetVisible(
  state: GameState,
  sceneId: Id,
  target: { id: Id; hidden: boolean; visible_if: Condition | null },
): boolean {
  const override = state.visibility[sceneId]?.[target.id];
  const base = override ?? !target.hidden;
  return base && evalOptional(target.visible_if, state);
}

/** Hotspots visibles de la scène courante, dans l'ordre du fichier. */
export function visibleHotspotList(game: GameData, state: GameState): Hotspot[] {
  const scene = currentScene(game, state);
  if (!scene) return [];
  return scene.hotspots.filter((h) => isTargetVisible(state, scene.id, h));
}

/** Sorties visibles de la scène courante, dans l'ordre du fichier. */
export function visibleExitList(game: GameData, state: GameState): Exit[] {
  const scene = currentScene(game, state);
  if (!scene) return [];
  return scene.exits.filter((e) => isTargetVisible(state, scene.id, e));
}

/** Vrai si l'identité du personnage est révélée (toujours vrai sans persona). */
export function isRevealed(character: Character, state: GameState): boolean {
  if (!character.persona) return true;
  return character.revealed_by !== null && evalCondition(character.revealed_by, state);
}

/** Résout un locuteur : nom persona/identité selon la révélation courante, monde courant. */
export function resolveSpeaker(game: GameData, state: GameState, speaker: Id): ResolvedSpeaker {
  const world = currentWorld(game, state);
  const ch = speaker === NARRATOR ? undefined : game.characters[speaker];
  if (!ch) return { speaker, name: null, face: null, world };
  const face: Face = isRevealed(ch, state) ? 'identity' : 'persona';
  const name = (face === 'persona' ? ch.persona : ch.identity)?.name ?? ch.identity.name;
  return { speaker, name, face, world };
}

/** Locuteur des répliques de refus : le personnage joué, sinon le narrateur. */
export function playerSpeaker(game: GameData): Id {
  return game.meta.player_character ?? NARRATOR;
}

/** Réplique de refus du monde courant. */
export function refuseLine(game: GameData, state: GameState): string {
  return game.worlds[currentWorld(game, state)]?.refuse_line ?? game.meta.refuse_line;
}

/** Vrai si l'objet peut servir dans le monde courant (`scope`). */
export function inScope(item: Item | undefined, world: Id): boolean {
  return !item || item.scope === null || item.scope.includes(world);
}

export function currentDialogue(game: GameData, state: GameState): Dialogue | null {
  return state.dialogue ? (game.dialogues[state.dialogue.id] ?? null) : null;
}

export function currentNode(game: GameData, state: GameState): DialogueNode | null {
  const d = currentDialogue(game, state);
  return d && state.dialogue ? (d.nodes[state.dialogue.node] ?? null) : null;
}

/** Choix visibles d'un nœud (avec leur index dans `node.choices`). */
export function visibleChoices(node: DialogueNode, state: GameState): ChoiceView[] {
  const out: ChoiceView[] = [];
  node.choices.forEach((c, index) => {
    if (evalOptional(c.condition, state)) out.push({ index, label: c.label, intent: c.intent });
  });
  return out;
}

/**
 * Comportement d'un nœud une fois ses répliques affichées et ses effets exécutés :
 * - `input` : choix visibles ou texte libre → attend le joueur ;
 * - `continue` : `next` et des répliques (ou `on_give`/`on_show`) → attend `continue` ;
 * - `pass` : `next` sans répliques ni `on_give`/`on_show` → enchaîne sans attendre ;
 * - `end` : rien de tout cela → fin du dialogue.
 */
export function nodeMode(node: DialogueNode, state: GameState): DialogueMode | 'pass' | 'end' {
  if (node.free_text || visibleChoices(node, state).length > 0) return 'input';
  if (node.next !== null) return node.lines.length > 0 || node.on_give || node.on_show ? 'continue' : 'pass';
  return 'end';
}

/** Mode du nœud courant si le dialogue attend le joueur, sinon null. */
export function currentMode(game: GameData, state: GameState): DialogueMode | null {
  const node = currentNode(game, state);
  if (!node) return null;
  const m = nodeMode(node, state);
  return m === 'input' || m === 'continue' ? m : null;
}

/** Quitter le dialogue est permis sur un nœud à texte libre sans aucun choix visible. */
export function canLeave(game: GameData, state: GameState): boolean {
  const node = currentNode(game, state);
  return !!node && node.free_text !== null && visibleChoices(node, state).length === 0;
}

/** Répliques d'un nœud, locuteurs résolus avec l'état donné. */
export function resolveLines(game: GameData, state: GameState, node: DialogueNode): ResolvedLine[] {
  return node.lines.map((l) => ({ ...resolveSpeaker(game, state, l.speaker), text: l.text }));
}

/**
 * Intentions autorisées dans le nœud courant (pour le classifieur) : clés de
 * `free_text.intents`, `intent` des choix visibles, puis `give_item`/`show_item`
 * si le nœud a `on_give`/`on_show`. Vide hors d'un nœud à texte libre.
 */
export function allowedIntents(game: GameData, state: GameState): Id[] {
  const node = currentNode(game, state);
  if (!node?.free_text || currentMode(game, state) !== 'input') return [];
  const out: Id[] = [];
  const add = (id: Id) => {
    if (!out.includes(id)) out.push(id);
  };
  Object.keys(node.free_text.intents).forEach(add);
  for (const c of visibleChoices(node, state)) if (c.intent) add(c.intent);
  if (node.on_give) add('give_item');
  if (node.on_show) add('show_item');
  return out;
}

/** Ids des objets possédés, dans l'ordre de déclaration de `items.yaml` (puis inconnus, triés). */
export function ownedItems(game: GameData, state: GameState): Id[] {
  const owned = Object.keys(state.inventory).filter((id) => (state.inventory[id] ?? 0) > 0);
  const declared = Object.keys(game.items).filter((id) => owned.includes(id));
  const unknown = owned.filter((id) => !game.items[id]).sort();
  return [...declared, ...unknown];
}
