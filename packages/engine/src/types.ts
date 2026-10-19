/** Actions du joueur, événements émis par le moteur, options. */
import type { EndingType, Id } from '@scroum/schema';
import type { GameState } from './state';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Action du joueur. Toutes sont des objets JSON simples (rejouables, sérialisables).
 *
 * Hors dialogue : `verb`, `use`, `exit`. En dialogue : `choose`, `continue`,
 * `intent`, `give`, `show`, `leave`. Partout (sauf partie finie) : `look_item`,
 * `combine`.
 */
export type Action =
  /** Verbe d'un hotspot visible de la scène courante (`look`, `talk`, `take`, `fouiller`…). */
  | { type: 'verb'; hotspot: Id; verb: string }
  /** Utiliser un objet de l'inventaire sur un hotspot visible. */
  | { type: 'use'; item: Id; hotspot: Id }
  /** Toucher une sortie visible (par id, ex. `exit_port`). */
  | { type: 'exit'; exit: Id }
  /** Choix du nœud courant, par **index dans `node.choices`** (le choix doit être visible). */
  | { type: 'choose'; choice: number }
  /** Passer au nœud suivant (`next`) d'un nœud sans choix. */
  | { type: 'continue' }
  /**
   * Texte libre classé hors du moteur. `intent: null` = rien reconnu (fallback).
   * `item` pour `give_item` / `show_item`.
   */
  | { type: 'intent'; intent: string | null; confidence: number; item?: Id | null }
  /** Donner un objet à l'interlocuteur (nœud avec `on_give`). */
  | { type: 'give'; item: Id }
  /** Montrer un objet à l'interlocuteur (nœud avec `on_show`). */
  | { type: 'show'; item: Id }
  /** Combiner deux objets de l'inventaire. */
  | { type: 'combine'; item: Id; with: Id }
  /** Examiner un objet de l'inventaire. */
  | { type: 'look_item'; item: Id }
  /** Verbe personnalisé d'un objet de l'inventaire (`items.yaml → actions`). */
  | { type: 'item_verb'; item: Id; verb: string }
  /** Quitter le dialogue (seulement si autorisé : nœud à texte libre sans choix visible). */
  | { type: 'leave' };

export type ActionType = Action['type'];

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------

/** Face affichée d'un personnage. */
export type Face = 'persona' | 'identity';

/** Locuteur résolu au moment de la réplique. */
export interface ResolvedSpeaker {
  /** `narrator` ou id de personnage. */
  speaker: Id;
  /** Nom affiché (persona ou identité selon la révélation) ; null pour le narrateur ou un id inconnu. */
  name: string | null;
  /** Face utilisée pour `name` ; null pour le narrateur. */
  face: Face | null;
  /** Monde de la scène courante (pour le skin). */
  world: Id;
}

/** Réplique résolue d'un nœud de dialogue. */
export interface ResolvedLine extends ResolvedSpeaker {
  text: string;
}

/** Choix visible d'un nœud. */
export interface ChoiceView {
  /** Index dans `node.choices` (à passer à l'action `choose`). */
  index: number;
  label: string;
  intent: Id | null;
}

export type DialogueMode =
  /** Le nœud attend un choix / du texte libre. */
  | 'input'
  /** Le nœud a un `next` : il attend `continue`. */
  | 'continue';

export type ErrorCode =
  | 'game_ended'
  | 'in_dialogue'
  | 'not_in_dialogue'
  | 'unknown_hotspot'
  | 'unknown_verb'
  | 'unknown_exit'
  | 'unknown_item'
  | 'missing_item'
  | 'no_use'
  | 'bad_choice'
  | 'cannot_continue'
  | 'no_free_text'
  | 'cannot_give'
  | 'cannot_show'
  | 'cannot_leave'
  | 'unknown_scene'
  | 'unknown_dialogue'
  | 'unknown_node'
  | 'unknown_ending'
  | 'loop_limit'
  | 'bad_action'
  | 'internal';

export type RefuseReason =
  /** Hotspot sans réaction pour cet objet (ni `use.<objet>` ni `default`). */
  | 'no_reaction'
  /** Objet hors de son `scope` dans le monde courant. */
  | 'out_of_scope'
  /** Aucune combinaison pour ces deux objets. */
  | 'no_combination'
  /** `give_item` / `show_item` en texte libre pour un objet non possédé. */
  | 'missing_item'
  /** Don / présentation sans réaction ni `default`. */
  | 'no_give_reaction'
  | 'no_show_reaction';

export type EngineEvent =
  /** Réplique (script `say`, ligne de dialogue). `dialogue`/`node` renseignés pour les lignes de nœud. */
  | ({ type: 'say'; text: string; dialogue: Id | null; node: Id | null } & ResolvedSpeaker)
  | { type: 'scene_entered'; scene: Id; from: Id | null; title: string | null; world: Id; skin: string }
  | ({ type: 'dialogue_started'; dialogue: Id; node: Id; skin: string } & ResolvedSpeaker)
  /**
   * Le dialogue attend le joueur sur `node` (émis après les répliques et les effets du nœud,
   * à chaque entrée dans un nœud qui attend). `lines` rappelle les répliques du nœud
   * (déjà émises en `say`, utile pour réafficher le nœud).
   */
  | {
      type: 'dialogue_node';
      dialogue: Id;
      node: Id;
      mode: DialogueMode;
      lines: ResolvedLine[];
      choices: ChoiceView[];
      free_text: { placeholder: string | null; intents: Id[] } | null;
      can_give: boolean;
      can_show: boolean;
      can_leave: boolean;
    }
  | { type: 'dialogue_ended'; dialogue: Id; node: Id; reason: 'end' | 'leave' | 'game_ended' }
  | { type: 'item_gained'; item: Id; qty: number; total: number }
  | { type: 'item_lost'; item: Id; qty: number; total: number }
  | {
      type: 'counter_changed';
      counter: Id;
      label: string | null;
      hud: boolean;
      value: number;
      previous: number;
      title: string | null;
      previous_title: string | null;
    }
  | { type: 'flag_changed'; flag: Id; value: boolean }
  | { type: 'var_changed'; var: Id; value: number; previous: number }
  | { type: 'visibility_changed'; scene: Id; target: Id; visible: boolean }
  | { type: 'quest_unlocked'; quest: Id; title: string | null }
  | { type: 'quest_completed'; quest: Id; title: string | null }
  | { type: 'collection_unlocked'; collection: Id; title: string }
  | { type: 'character_revealed'; character: Id; persona_name: string | null; name: string }
  | { type: 'character_hidden'; character: Id; persona_name: string | null; name: string }
  | ({ type: 'refuse'; reason: RefuseReason; text: string; item: Id | null } & ResolvedSpeaker)
  | {
      type: 'game_ended';
      ending: Id;
      ending_type: EndingType;
      title: string | null;
      text: string | null;
      image: Id | null;
    }
  | { type: 'error'; code: ErrorCode; message: string };

export type EngineEventType = EngineEvent['type'];

/** Résultat de `start` / `step`. */
export interface StepResult {
  state: GameState;
  events: EngineEvent[];
}

/** Options du moteur. */
export interface EngineOptions {
  /** Seuil global de confiance du texte libre (défaut `DEFAULT_THRESHOLD`). */
  threshold?: number;
  /**
   * Garde-fou contre les boucles de contenu (enchaînements de scènes / nœuds
   * sans action du joueur) : nombre maximal de transitions par action (défaut 200).
   */
  maxTransitions?: number;
}

/** Seuil global par défaut de confiance du texte libre. */
export const DEFAULT_THRESHOLD = 0.5;
