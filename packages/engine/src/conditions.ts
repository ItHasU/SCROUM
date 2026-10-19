/** Évaluation des conditions canoniques sur un état de jeu. */
import type { Comparison, Condition } from '@scroum/schema';
import type { GameState } from './state';

/** Vrai si `value` satisfait tous les opérateurs présents de `cmp`. */
export function compare(value: number, cmp: Comparison): boolean {
  if (cmp.eq !== undefined && !(value === cmp.eq)) return false;
  if (cmp.gte !== undefined && !(value >= cmp.gte)) return false;
  if (cmp.lte !== undefined && !(value <= cmp.lte)) return false;
  if (cmp.gt !== undefined && !(value > cmp.gt)) return false;
  if (cmp.lt !== undefined && !(value < cmp.lt)) return false;
  return true;
}

/** Évalue une condition (voir docs/FORMAT.md §8). */
export function evalCondition(cond: Condition, state: GameState): boolean {
  switch (cond.kind) {
    case 'flag':
      return state.flags.includes(cond.flag);
    case 'var':
      return compare(state.vars[cond.var] ?? 0, cond.cmp);
    case 'counter':
      return compare(state.counters[cond.counter] ?? 0, cond.cmp);
    case 'has_item':
      return (state.inventory[cond.item] ?? 0) > 0;
    case 'item_qty':
      return compare(state.inventory[cond.item] ?? 0, cond.cmp);
    case 'ever_had_item':
      return state.ever_had.includes(cond.item);
    case 'quest': {
      const unlocked = state.quests.unlocked.includes(cond.quest);
      const completed = state.quests.completed.includes(cond.quest);
      if (cond.state === 'completed') return completed;
      if (cond.state === 'active') return unlocked && !completed;
      return unlocked || completed;
    }
    case 'all':
      return cond.conditions.every((c) => evalCondition(c, state));
    case 'any':
      return cond.conditions.some((c) => evalCondition(c, state));
    case 'not':
      return !evalCondition(cond.condition, state);
  }
}

/** Condition optionnelle : null = vraie. */
export function evalOptional(cond: Condition | null, state: GameState): boolean {
  return cond === null || evalCondition(cond, state);
}
