/** Journal du player : répliques et notifications dérivées des `EngineEvent`. */
import type { GameData, Id } from '@scroum/schema';
import type { EngineEvent } from '@scroum/engine';

export type InfoTone = 'item' | 'lost' | 'quest' | 'collection' | 'counter' | 'reveal' | 'scene' | 'dialogue' | 'ending' | 'error';

export interface LineEntry {
  id: number;
  kind: 'line';
  /** `narrator` ou id de personnage. */
  speaker: Id;
  /** Nom affiché au moment de la réplique (null : narrateur). */
  name: string | null;
  text: string;
  /** Réplique scriptée d'origine quand `text` a été reformulé. */
  original?: string;
  world: Id;
  /** Session de dialogue (null : hors dialogue). */
  session: number | null;
  /** Réplique de refus (objet inutile…). */
  refuse?: boolean;
  /** Réplique du personnage joué (ou saisie du joueur). */
  player?: boolean;
  /** Texte libre tapé par le joueur. */
  typed?: boolean;
}

export interface InfoEntry {
  id: number;
  kind: 'info';
  tone: InfoTone;
  text: string;
  session: number | null;
  /** Objet concerné (acquisition, perte). */
  item?: Id;
}

export type LogEntry = LineEntry | InfoEntry;

/** Construit les entrées de journal d'une suite d'événements (sans id ni session : voir `GameController`). */
export function describeEvent(game: GameData, e: EngineEvent): { kind: 'line'; line: Omit<LineEntry, 'id' | 'session'> } | { kind: 'info'; info: Omit<InfoEntry, 'id' | 'session'> } | null {
  const pc = game.meta.player_character;
  switch (e.type) {
    case 'say':
      return { kind: 'line', line: { kind: 'line', speaker: e.speaker, name: e.name, text: e.text, world: e.world, player: pc !== null && e.speaker === pc } };
    case 'refuse':
      return { kind: 'line', line: { kind: 'line', speaker: e.speaker, name: e.name, text: e.text, world: e.world, refuse: true, player: pc !== null && e.speaker === pc } };
    case 'item_gained': {
      const name = game.items[e.item]?.name ?? e.item;
      return { kind: 'info', info: { kind: 'info', tone: 'item', item: e.item, text: `Obtenu : ${name}${e.qty > 1 ? ` ×${e.qty}` : ''}` } };
    }
    case 'item_lost': {
      const name = game.items[e.item]?.name ?? e.item;
      return { kind: 'info', info: { kind: 'info', tone: 'lost', item: e.item, text: `En moins : ${name}${e.qty > 1 ? ` ×${e.qty}` : ''}` } };
    }
    case 'quest_unlocked':
      return { kind: 'info', info: { kind: 'info', tone: 'quest', text: `Nouvelle quête : ${e.title ?? e.quest}` } };
    case 'quest_completed':
      return { kind: 'info', info: { kind: 'info', tone: 'quest', text: `Quête terminée : ${e.title ?? e.quest}` } };
    case 'collection_unlocked':
      return { kind: 'info', info: { kind: 'info', tone: 'collection', text: `Galerie débloquée : ${e.title}` } };
    case 'character_revealed':
      return { kind: 'info', info: { kind: 'info', tone: 'reveal', text: e.persona_name ? `${e.persona_name} est en réalité ${e.name}.` : `${e.name} se révèle.` } };
    case 'counter_changed': {
      if (!e.hud) return null;
      const d = e.value - e.previous;
      const title = e.title && e.title !== e.previous_title ? ` — ${e.title}` : '';
      return { kind: 'info', info: { kind: 'info', tone: 'counter', text: `${e.label ?? e.counter} ${d >= 0 ? '+' : ''}${d} (${e.value})${title}` } };
    }
    case 'scene_entered':
      return { kind: 'info', info: { kind: 'info', tone: 'scene', text: e.title ?? game.scenes[e.scene]?.title ?? e.scene } };
    case 'game_ended':
      return { kind: 'info', info: { kind: 'info', tone: 'ending', text: e.ending_type === 'win' ? `Fin : ${e.title ?? e.ending}` : `Partie perdue : ${e.title ?? e.ending}` } };
    case 'error':
      return { kind: 'info', info: { kind: 'info', tone: 'error', text: `Action impossible (${e.code}) : ${e.message}` } };
    default:
      return null;
  }
}
