/** Résumé de la bible : comptes par statut et éléments restant à valider. */
import type { GameData, Status } from '@scroum/schema';
import type { Ref } from './refs';
import { titleOf } from './refs';

export type BibleCategory = 'docs' | 'worlds' | 'quests' | 'gags' | 'characters' | 'scenes' | 'dialogues' | 'items';

export interface BibleEntry {
  category: BibleCategory;
  ref: Ref;
  title: string;
  status: Status;
}

export interface BibleSummary {
  entries: BibleEntry[];
  byStatus: Record<Status, number>;
  /** draft + review, regroupés par catégorie. */
  todo: Record<BibleCategory, BibleEntry[]>;
  total: number;
}

export const CATEGORY_LABEL: Record<BibleCategory, string> = {
  docs: 'Documents',
  worlds: 'Mondes',
  quests: 'Quêtes',
  gags: 'Gags',
  characters: 'Personnages',
  scenes: 'Scènes',
  dialogues: 'Dialogues',
  items: 'Objets',
};

export function bibleSummary(game: GameData): BibleSummary {
  const entries: BibleEntry[] = [];
  const add = (category: BibleCategory, ref: Ref, status: Status, title?: string): void => {
    entries.push({ category, ref, title: title ?? titleOf(game, ref), status });
  };
  for (const d of Object.values(game.bible.docs)) add('docs', { kind: 'doc', id: d.id }, d.status);
  for (const w of Object.values(game.worlds)) add('worlds', { kind: 'world', id: w.id }, w.status);
  for (const q of Object.values(game.quests)) add('quests', { kind: 'quest', id: q.id }, q.status);
  for (const g of Object.values(game.bible.gags)) add('gags', { kind: 'gag', id: g.id }, g.status, g.id);
  for (const c of Object.values(game.characters)) add('characters', { kind: 'character', id: c.id }, c.status);
  for (const s of Object.values(game.scenes)) add('scenes', { kind: 'scene', id: s.id }, s.status);
  for (const d of Object.values(game.dialogues)) add('dialogues', { kind: 'dialogue', id: d.id }, d.status, `${game.characters[d.speaker]?.identity.name ?? d.speaker} (${d.id})`);
  for (const i of Object.values(game.items)) add('items', { kind: 'item', id: i.id }, i.status);

  const byStatus: Record<Status, number> = { draft: 0, review: 0, validated: 0, rejected: 0 };
  const todo = {} as Record<BibleCategory, BibleEntry[]>;
  for (const k of Object.keys(CATEGORY_LABEL) as BibleCategory[]) todo[k] = [];
  for (const e of entries) {
    byStatus[e.status]++;
    if (e.status === 'draft' || e.status === 'review') todo[e.category].push(e);
  }
  return { entries, byStatus, todo, total: entries.length };
}
