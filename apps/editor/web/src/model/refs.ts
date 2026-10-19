/** Références vers les éléments du jeu et correspondance élément → fichier source. */
import type { GameData, Id, Status } from '@scroum/schema';

export type RefKind = 'scene' | 'dialogue' | 'dnode' | 'hotspot' | 'item' | 'quest' | 'character' | 'world' | 'gag' | 'doc';

/** Un élément sélectionnable dans l'éditeur. */
export interface Ref {
  kind: RefKind;
  id: Id;
  /** Dialogue : nœud ; hotspot : id de la scène est dans `parent`. */
  node?: Id;
  parent?: Id;
}

export const refKey = (r: Ref): string => `${r.kind}:${r.parent ? r.parent + '/' : ''}${r.id}${r.node ? '#' + r.node : ''}`;

export function sameRef(a: Ref | null, b: Ref | null): boolean {
  return !!a && !!b && refKey(a) === refKey(b);
}

/** Fichier source (relatif à `content/`) d'un élément, ou null s'il est inconnu. */
export function fileOf(game: GameData, r: Ref): string | null {
  switch (r.kind) {
    case 'scene':
      return game.scenes[r.id]?.source ?? null;
    case 'hotspot':
      return game.scenes[r.parent ?? '']?.source ?? null;
    case 'dialogue':
    case 'dnode':
      return game.dialogues[r.id]?.source ?? null;
    case 'item':
      return game.items[r.id]?.source ?? null;
    case 'quest':
      return game.quests[r.id]?.source ?? null;
    case 'character':
      return game.characters[r.id]?.source ?? null;
    case 'world':
      return game.worlds[r.id]?.source ?? null;
    case 'gag':
      return game.bible.gags[r.id]?.source ?? null;
    case 'doc':
      return game.bible.docs[r.id]?.source ?? null;
  }
}

/** Statut d'un élément (null si l'élément n'en a pas). */
export function statusOf(game: GameData, r: Ref): Status | null {
  switch (r.kind) {
    case 'scene':
      return game.scenes[r.id]?.status ?? null;
    case 'dialogue':
      return game.dialogues[r.id]?.status ?? null;
    case 'item':
      return game.items[r.id]?.status ?? null;
    case 'quest':
      return game.quests[r.id]?.status ?? null;
    case 'character':
      return game.characters[r.id]?.status ?? null;
    case 'world':
      return game.worlds[r.id]?.status ?? null;
    case 'gag':
      return game.bible.gags[r.id]?.status ?? null;
    case 'doc':
      return game.bible.docs[r.id]?.status ?? null;
    default:
      return null;
  }
}

/** Titre lisible d'un élément. */
export function titleOf(game: GameData, r: Ref): string {
  switch (r.kind) {
    case 'scene':
      return game.scenes[r.id]?.title ?? r.id;
    case 'hotspot':
      return game.scenes[r.parent ?? '']?.hotspots.find((h) => h.id === r.id)?.label ?? r.id;
    case 'item':
      return game.items[r.id]?.name ?? r.id;
    case 'quest':
      return game.quests[r.id]?.title ?? r.id;
    case 'character':
      return game.characters[r.id]?.identity.name ?? r.id;
    case 'world':
      return game.worlds[r.id]?.name ?? r.id;
    case 'dnode':
      return `${r.id} › ${r.node ?? ''}`;
    default:
      return r.id;
  }
}

export const KIND_LABEL: Record<RefKind, string> = {
  scene: 'Scène',
  dialogue: 'Dialogue',
  dnode: 'Nœud de dialogue',
  hotspot: 'Hotspot',
  item: 'Objet',
  quest: 'Quête',
  character: 'Personnage',
  world: 'Monde',
  gag: 'Gag',
  doc: 'Document',
};
