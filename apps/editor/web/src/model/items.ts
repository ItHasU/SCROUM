/** Table des objets : où chaque objet est obtenu et où il sert. */
import type { GameData, Id, Status } from '@scroum/schema';
import { collectFacts, type Give, type Need } from './facts';

export interface ItemRow {
  id: Id;
  name: string;
  status: Status;
  obtained: Give[];
  used: Need[];
}

export function itemTable(game: GameData): ItemRow[] {
  const { gives, needs } = collectFacts(game);
  return Object.values(game.items)
    .map((it) => ({
      id: it.id,
      name: it.name,
      status: it.status,
      obtained: gives.filter((g) => g.item === it.id),
      used: needs.filter((n) => n.item === it.id),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export const GIVE_LABEL = { give_item: 'obtenu', combine: 'combinaison', initial: 'départ' } as const;
export const NEED_LABEL = { use: 'utilisé sur', on_give: 'donné à', on_show: 'montré à', condition: 'requis', combine: 'combiné' } as const;
