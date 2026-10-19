/**
 * Extraction des « faits » du jeu utilisés par le graphe et la table des objets :
 * où un objet est obtenu, où il est requis, quels scripts changent de scène,
 * lancent un dialogue ou touchent une quête.
 */
import { forEachCondition, visitConditions, visitSteps } from '@scroum/schema';
import type { GameData, Id, Location } from '@scroum/schema';
import type { Ref } from './refs';

export interface Place {
  /** Élément à sélectionner pour y aller (null pour l'état initial). */
  ref: Ref | null;
  /** Libellé lisible, ex. « Le port › Caisse de pêche ». */
  text: string;
  scene?: Id;
  dialogue?: Id;
  node?: Id;
  item?: Id;
  /** Détail (verbe, chemin dans le fichier…). */
  detail?: string;
}

export type GiveHow = 'give_item' | 'combine' | 'initial';
export type NeedHow = 'use' | 'on_give' | 'on_show' | 'condition' | 'combine';

export interface Give {
  item: Id;
  how: GiveHow;
  from: Place;
}
export interface Need {
  item: Id;
  how: NeedHow;
  from: Place;
}
export interface Jump {
  type: 'goto_scene' | 'start_dialogue' | 'unlock_quest' | 'complete_quest';
  from: Place;
  target: Id;
  /** start_dialogue : nœud de départ explicite. */
  node: Id | null;
}

export interface Facts {
  gives: Give[];
  needs: Need[];
  jumps: Jump[];
}

/** Traduit une localisation de contenu en lieu lisible et sélectionnable. */
export function placeOf(game: GameData, loc: Location): Place {
  if (loc.scene) {
    const scene = game.scenes[loc.scene];
    const title = scene?.title ?? loc.scene;
    const hm = /^hotspots\[(\d+)\](?:\.actions\.([\w]+))?/.exec(loc.path);
    if (hm) {
      const h = scene?.hotspots[Number(hm[1])];
      if (h) {
        return {
          ref: { kind: 'hotspot', id: h.id, parent: loc.scene },
          text: `${title} › ${h.label}`,
          scene: loc.scene,
          detail: hm[2],
        };
      }
    }
    const em = /^exits\[(\d+)\]/.exec(loc.path);
    if (em) {
      const e = scene?.exits[Number(em[1])];
      return { ref: { kind: 'scene', id: loc.scene }, text: `${title} › sortie « ${e?.label ?? '?'} »`, scene: loc.scene };
    }
    return { ref: { kind: 'scene', id: loc.scene }, text: title, scene: loc.scene, detail: loc.path };
  }
  if (loc.dialogue) {
    const d = game.dialogues[loc.dialogue];
    const who = d ? (game.characters[d.speaker]?.identity.name ?? d.speaker) : loc.dialogue;
    return {
      ref: loc.node ? { kind: 'dnode', id: loc.dialogue, node: loc.node } : { kind: 'dialogue', id: loc.dialogue },
      text: `Dialogue ${who} › ${loc.node ?? ''}`,
      dialogue: loc.dialogue,
      ...(loc.node ? { node: loc.node } : {}),
    };
  }
  if (loc.item) {
    return { ref: { kind: 'item', id: loc.item }, text: `Objet ${game.items[loc.item]?.name ?? loc.item}`, item: loc.item };
  }
  return { ref: null, text: loc.file };
}

export function collectFacts(game: GameData): Facts {
  const gives: Give[] = [];
  const needs: Need[] = [];
  const jumps: Jump[] = [];

  visitSteps(game, (step, loc) => {
    switch (step.kind) {
      case 'give_item':
        gives.push({ item: step.item, how: 'give_item', from: placeOf(game, loc) });
        break;
      case 'goto_scene':
        jumps.push({ type: 'goto_scene', from: placeOf(game, loc), target: step.scene, node: null });
        break;
      case 'start_dialogue':
        jumps.push({ type: 'start_dialogue', from: placeOf(game, loc), target: step.dialogue, node: step.node });
        break;
      case 'unlock_quest':
      case 'complete_quest':
        jumps.push({ type: step.kind, from: placeOf(game, loc), target: step.quest, node: null });
        break;
    }
  });

  for (const [item, qty] of Object.entries(game.meta.initial.inventory)) {
    if (qty > 0) gives.push({ item, how: 'initial', from: { ref: null, text: 'Inventaire de départ (game.yaml)' } });
  }

  visitConditions(game, (cond, loc) => {
    forEachCondition(cond, (c) => {
      if (c.kind === 'has_item' || c.kind === 'item_qty' || c.kind === 'ever_had_item') {
        needs.push({ item: c.item, how: 'condition', from: placeOf(game, loc) });
      }
    });
  });

  for (const scene of Object.values(game.scenes)) {
    for (const h of scene.hotspots) {
      if (!h.use) continue;
      const from = placeOf(game, { file: scene.source, scene: scene.id, path: `hotspots[${scene.hotspots.indexOf(h)}]` });
      for (const item of Object.keys(h.use.byItem)) needs.push({ item, how: 'use', from });
    }
  }
  for (const d of Object.values(game.dialogues)) {
    for (const n of Object.values(d.nodes)) {
      const from = placeOf(game, { file: d.source, dialogue: d.id, node: n.id, path: `nodes.${n.id}` });
      for (const item of Object.keys(n.on_give?.byItem ?? {})) needs.push({ item, how: 'on_give', from });
      for (const item of Object.keys(n.on_show?.byItem ?? {})) needs.push({ item, how: 'on_show', from });
    }
  }
  for (const it of Object.values(game.items)) {
    const from = placeOf(game, { file: it.source, item: it.id, path: it.id });
    for (const c of it.combine) {
      needs.push({ item: it.id, how: 'combine', from: { ...from, detail: `avec ${c.with}` } });
      needs.push({ item: c.with, how: 'combine', from: { ...from, detail: `avec ${it.id}` } });
      if (c.result) gives.push({ item: c.result, how: 'combine', from: { ...from, detail: `${it.id} + ${c.with}` } });
    }
  }
  return { gives, needs, jumps };
}
