/** Énumération des actions jouables. */
import { findCombination, type GameData, type Id } from '@scroum/schema';
import { allowedIntents, canLeave, currentMode, currentNode, ownedItems, visibleChoices, visibleExitList, visibleHotspotList } from './queries';
import type { GameState } from './state';
import type { Action } from './types';

export interface ListActionsOptions {
  /**
   * Inclut aussi les actions sans réaction possible : `use` de chaque objet sur
   * **chaque** hotspot visible (y compris sans `use`, qui produit toujours un
   * refus) et `combine` de **toutes** les paires d'objets (refus si aucune
   * combinaison). Utile pour tester les refus ou une UI « tout essayer » ;
   * inutile pour l'exploration d'états (ces actions ne changent jamais l'état).
   */
  exhaustive?: boolean;
}

/**
 * Toutes les actions jouables dans l'état courant, dans un ordre stable :
 *
 * - en dialogue, nœud qui attend `continue` : `continue`, puis `give`/`show` ;
 * - en dialogue, nœud à choix / texte libre : `choose` (choix visibles, dans
 *   l'ordre), puis une action `intent` (confiance 1) par intention autorisée
 *   (clés de `free_text.intents`, intentions des choix visibles,
 *   `give_item`/`show_item` pour chaque objet possédé si le nœud a
 *   `on_give`/`on_show`), puis le repli `{ intent: null, confidence: 0 }`,
 *   puis `give`/`show` de chaque objet possédé, puis `leave` si permis ;
 * - hors dialogue : `verb` (hotspots visibles × verbes, ordre du fichier),
 *   `use` (objets possédés × hotspots visibles ayant `use`), `exit` (sorties visibles) ;
 * - toujours (partie non finie) : `look_item` de chaque objet possédé, puis
 *   `combine` des paires d'objets possédés ayant une combinaison (un objet avec
 *   lui-même s'il est possédé en deux exemplaires).
 *
 * Objets dans l'ordre de `items.yaml`. Partie finie → `[]`.
 */
export function listActions(game: GameData, state: GameState, options: ListActionsOptions = {}): Action[] {
  if (state.ending) return [];
  const out: Action[] = [];
  const items = ownedItems(game, state);

  if (state.dialogue) {
    const node = currentNode(game, state);
    const mode = currentMode(game, state);
    if (!node || !mode) return [];
    if (mode === 'continue') out.push({ type: 'continue' });
    else {
      for (const c of visibleChoices(node, state)) out.push({ type: 'choose', choice: c.index });
      if (node.free_text) {
        for (const intent of allowedIntents(game, state)) {
          if (intent === 'give_item' || intent === 'show_item') {
            for (const item of items) out.push({ type: 'intent', intent, confidence: 1, item });
          } else out.push({ type: 'intent', intent, confidence: 1, item: null });
        }
        out.push({ type: 'intent', intent: null, confidence: 0, item: null });
      }
    }
    if (node.on_give) for (const item of items) out.push({ type: 'give', item });
    if (node.on_show) for (const item of items) out.push({ type: 'show', item });
    if (mode === 'input' && canLeave(game, state)) out.push({ type: 'leave' });
  } else {
    const hotspots = visibleHotspotList(game, state);
    for (const h of hotspots) for (const verb of Object.keys(h.actions)) out.push({ type: 'verb', hotspot: h.id, verb });
    for (const h of hotspots) {
      if (!h.use && !options.exhaustive) continue;
      for (const item of items) out.push({ type: 'use', item, hotspot: h.id });
    }
    for (const e of visibleExitList(game, state)) out.push({ type: 'exit', exit: e.id });
  }

  for (const item of items) out.push({ type: 'look_item', item });
  out.push(...combineActions(game, state, items, !!options.exhaustive));
  return out;
}

function combineActions(game: GameData, state: GameState, items: Id[], exhaustive: boolean): Action[] {
  const out: Action[] = [];
  items.forEach((a, i) => {
    for (const b of items.slice(i)) {
      if (a === b && (state.inventory[a] ?? 0) < 2) continue;
      if (exhaustive || findCombination(game, a, b)) out.push({ type: 'combine', item: a, with: b });
    }
  });
  return out;
}

/** Libellé court et stable d'une action (journal, chemins de soft-lock, scénarios). */
export function describeAction(a: Action): string {
  switch (a.type) {
    case 'verb':
      return `${a.verb} ${a.hotspot}`;
    case 'use':
      return `use ${a.item} on ${a.hotspot}`;
    case 'exit':
      return `exit ${a.exit}`;
    case 'choose':
      return `choose ${a.choice}`;
    case 'continue':
      return 'continue';
    case 'intent':
      return `intent ${a.intent ?? '-'}${a.item ? ` ${a.item}` : ''} ${a.confidence}`;
    case 'give':
      return `give ${a.item}`;
    case 'show':
      return `show ${a.item}`;
    case 'combine':
      return `combine ${a.item} ${a.with}`;
    case 'look_item':
      return `inspect ${a.item}`;
    case 'leave':
      return 'leave';
  }
}
