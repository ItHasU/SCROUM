/**
 * Types CANONIQUES du format SCROUM.
 *
 * C'est la forme que voient le moteur, le player, la validation et l'éditeur
 * après `loadContent()` : toutes les formes abrégées acceptées dans les fichiers
 * YAML ont été normalisées, toutes les valeurs par défaut sont explicites
 * (pas de champ `undefined` : on utilise `null`, `[]` ou `{}`), et l'objet
 * `GameData` est entièrement JSON-sérialisable (c'est le `game.json` du zip).
 *
 * Convention : chaque union canonique est discriminée par le champ `kind`.
 */

/** Identifiant : minuscules ASCII, chiffres et `_`, commence par une lettre ou un chiffre. */
export type Id = string;

/** Statut de validation éditoriale (§4.3). */
export type Status = 'draft' | 'review' | 'validated' | 'rejected';

/** Rectangle en coordonnées normalisées (0..1) relatives à l'image de fond : origine en haut à gauche. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Locuteur réservé pour la narration. */
export const NARRATOR = 'narrator';

/** Intentions réservées, fournies par le moteur (§4.7). */
export const RESERVED_INTENTS = ['give_item', 'show_item'] as const;
export type ReservedIntent = (typeof RESERVED_INTENTS)[number];

/** Skins d'interface fournis par `@scroum/ui`. */
export const BUILTIN_SKINS = ['plain', 'chat_retro', 'rpg_bubbles', 'swipe_cards'] as const;

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/**
 * Comparaison numérique. Au moins un opérateur est présent ; s'il y en a
 * plusieurs, ils doivent tous être vrais (ex. `{ gte: 2, lte: 5 }`).
 */
export interface Comparison {
  eq?: number;
  gte?: number;
  lte?: number;
  gt?: number;
  lt?: number;
}

export type Condition =
  /** Vrai si le drapeau est levé. */
  | { kind: 'flag'; flag: Id }
  /** Compare une variable de jeu (0 si jamais affectée). */
  | { kind: 'var'; var: Id; cmp: Comparison }
  /** Compare un compteur déclaré dans `game.yaml`. */
  | { kind: 'counter'; counter: Id; cmp: Comparison }
  /** Vrai si l'inventaire contient au moins un exemplaire de l'objet. */
  | { kind: 'has_item'; item: Id }
  /** Compare la quantité de l'objet dans l'inventaire (0 si absent). */
  | { kind: 'item_qty'; item: Id; cmp: Comparison }
  /** Vrai si l'objet a été possédé à un moment quelconque (même consommé depuis). */
  | { kind: 'ever_had_item'; item: Id }
  /**
   * État d'une quête : `unlocked` (débloquée, terminée ou non), `active`
   * (débloquée et non terminée), `completed` (terminée).
   */
  | { kind: 'quest'; quest: Id; state: 'unlocked' | 'active' | 'completed' }
  /** Toutes les sous-conditions (vrai si liste vide). */
  | { kind: 'all'; conditions: Condition[] }
  /** Au moins une sous-condition (faux si liste vide). */
  | { kind: 'any'; conditions: Condition[] }
  | { kind: 'not'; condition: Condition };

export type ConditionKind = Condition['kind'];

// ---------------------------------------------------------------------------
// Scripts et effets
// ---------------------------------------------------------------------------

/**
 * Un effet atomique. Sémantique d'exécution (voir docs/FORMAT.md) : les étapes
 * d'un script s'exécutent dans l'ordre ; `goto_scene` et `start_dialogue` sont
 * appliqués à la fin du script courant (le dernier gagne) ; `end_game`
 * interrompt immédiatement le script.
 */
export type Effect =
  | { kind: 'set_flag'; flag: Id }
  | { kind: 'unset_flag'; flag: Id }
  | { kind: 'set_var'; var: Id; value: number }
  | { kind: 'add_var'; var: Id; amount: number }
  | { kind: 'counter_add'; counter: Id; amount: number }
  | { kind: 'counter_set'; counter: Id; value: number }
  | { kind: 'give_item'; item: Id; qty: number }
  | { kind: 'take_item'; item: Id; qty: number }
  /**
   * Rend visible un hotspot ou une sortie. `scene: null` = scène où le script
   * est défini, ou à défaut scène courante (le chargeur remplit `scene` pour
   * les scripts définis dans une scène).
   */
  | { kind: 'reveal'; target: Id; scene: Id | null }
  | { kind: 'hide'; target: Id; scene: Id | null }
  | { kind: 'goto_scene'; scene: Id }
  /** `node: null` = nœud `start` du dialogue. */
  | { kind: 'start_dialogue'; dialogue: Id; node: Id | null }
  | { kind: 'unlock_quest'; quest: Id }
  | { kind: 'complete_quest'; quest: Id }
  /** `speaker` : `narrator` ou id de personnage. */
  | { kind: 'say'; speaker: Id; text: string }
  /** Fin de partie ; la fin est décrite dans `GameData.endings[ending]`. */
  | { kind: 'end_game'; ending: Id };

export type EffectKind = Effect['kind'];

/** Branchement conditionnel. */
export interface IfStep {
  kind: 'if';
  condition: Condition;
  then: Script;
  else: Script;
}

/** Une étape de script : un effet ou un branchement. */
export type Step = Effect | IfStep;
export type StepKind = Step['kind'];

/** Un script canonique : liste ordonnée d'étapes (éventuellement vide). */
export type Script = Step[];

// ---------------------------------------------------------------------------
// game.yaml
// ---------------------------------------------------------------------------

export interface CounterTitle {
  /** Seuil minimal (inclus) à partir duquel le titre s'applique. */
  min: number;
  label: string;
}

export interface Counter {
  id: Id;
  label: string;
  /** Affiché dans le HUD. */
  hud: boolean;
  initial: number;
  /** Bornes optionnelles (la valeur est bornée par le moteur). */
  min: number | null;
  max: number | null;
  /** Titres triés par `min` croissant ; le titre courant est le dernier dont `min <= valeur`. */
  titles: CounterTitle[];
}

export type EndingType = 'win' | 'game_over';

export interface Ending {
  id: Id;
  type: EndingType;
  title: string | null;
  text: string | null;
  /** Variantes de texte conditionnelles : la première dont la condition est vraie remplace `text`. */
  text_if: { condition: Condition; text: string }[];
  image: Id | null;
}

/** Variable de jeu déclarée dans `game.yaml → vars` (bornes optionnelles appliquées par le moteur). */
export interface VarDef {
  id: Id;
  min: number | null;
  max: number | null;
}

export interface Collection {
  id: Id;
  title: string;
  text: string | null;
  /** Avec `character`, l'UI montre `persona.avatar` à côté de `identity.portrait`. */
  character: Id | null;
  images: Id[];
  /** Condition de déblocage. */
  condition: Condition;
}

export interface ValidationRules {
  characters: {
    require_age: boolean;
    min_age: number | null;
  };
}

/** État initial optionnel de la partie. */
export interface InitialState {
  flags: Id[];
  vars: Record<Id, number>;
  /** Objet → quantité. */
  inventory: Record<Id, number>;
  /** Quêtes débloquées dès le départ. */
  quests: Id[];
}

export interface GameMeta {
  title: string;
  version: string;
  formatVersion: number;
  description: string | null;
  start_scene: Id;
  /** Personnage incarné par le joueur (locuteur des répliques « joueur »). */
  player_character: Id | null;
  /** Réplique de refus par défaut si le monde n'en déclare pas. */
  refuse_line: string;
  character_roles: Id[];
  validation: ValidationRules;
  initial: InitialState;
  /** Options des dialogues. */
  dialogue: DialogueOptions;
}

export interface DialogueOptions {
  /** Affiche le libellé du choix retenu comme réplique du `player_character`. */
  echo_choices: boolean;
}

// ---------------------------------------------------------------------------
// Bible
// ---------------------------------------------------------------------------

export interface World {
  id: Id;
  status: Status;
  name: string;
  description: string | null;
  ui_skin: string;
  /** Réplique de refus (objet hors scope / sans réaction). Toujours renseignée (repli sur `GameMeta.refuse_line`). */
  refuse_line: string;
  source: string;
}

export interface Quest {
  id: Id;
  status: Status;
  title: string;
  description: string | null;
  source: string;
}

export interface Gag {
  id: Id;
  status: Status;
  text: string;
  tags: string[];
  source: string;
}

/** Fichier Markdown de la bible (`bible/*.md`), avec front matter YAML optionnel. */
export interface BibleDoc {
  id: Id;
  status: Status;
  /** Corps Markdown sans le front matter. */
  body: string;
  source: string;
}

export interface Bible {
  /** Clé = nom du fichier sans `.md` (`pitch`, `tone`, `style`…). */
  docs: Record<Id, BibleDoc>;
  gags: Record<Id, Gag>;
}

// ---------------------------------------------------------------------------
// Personnages
// ---------------------------------------------------------------------------

/** Une « face » d'un personnage : persona (vue en jeu) ou identité réelle. */
export interface CharacterFace {
  name: string;
  description: string | null;
  world: Id | null;
  avatar: Id | null;
  portrait: Id | null;
}

export interface Character {
  id: Id;
  status: Status;
  role: Id | null;
  age: number | null;
  /**
   * Identité réelle (toujours présente). Pour un personnage sans double
   * identité, c'est simplement le personnage (`name`, `description`… au
   * premier niveau du fichier).
   */
  identity: CharacterFace;
  /** Persona optionnelle, montrée tant que `revealed_by` est faux. */
  persona: CharacterFace | null;
  /** Condition de révélation de l'identité (null = jamais / pas de persona). */
  revealed_by: Condition | null;
  motivation: string | null;
  voice: string | null;
  dislikes: string[];
  llm_persona_prompt: string | null;
  source: string;
}

// ---------------------------------------------------------------------------
// Scènes
// ---------------------------------------------------------------------------

export interface VerbAction {
  /** Libellé du verbe dans le menu contextuel (null = libellé par défaut de l'UI). */
  label: string | null;
  script: Script;
}

/** Réactions indexées par objet, avec réaction par défaut optionnelle. */
export interface ItemReactions<T> {
  byItem: Record<Id, T>;
  default: T | null;
}

export interface Hotspot {
  id: Id;
  label: string;
  rect: Rect;
  /** Caché au départ (rendu visible par l'effet `reveal`). */
  hidden: boolean;
  /** Condition de visibilité supplémentaire (null = toujours). */
  visible_if: Condition | null;
  image: Id | null;
  character: Id | null;
  /** Verbes (hors `use`) dans l'ordre du fichier : `look`, `talk`, `take`, `open`… */
  actions: Record<string, VerbAction>;
  /** Réactions à l'utilisation d'un objet ; null = aucune (refus du monde). */
  use: ItemReactions<Script> | null;
}

export interface Exit {
  id: Id;
  to: Id;
  label: string;
  rect: Rect;
  hidden: boolean;
  visible_if: Condition | null;
  /** Condition de passage (null = libre). */
  condition: Condition | null;
  /** Exécuté au passage, avant le changement de scène. */
  script: Script;
  /** Exécuté si `condition` est fausse (ex. « C'est fermé à clé. »). */
  else: Script;
}

export interface Scene {
  id: Id;
  status: Status;
  title: string | null;
  world: Id;
  background: Id | null;
  music: Id | null;
  on_enter: Script;
  hotspots: Hotspot[];
  exits: Exit[];
  source: string;
}

// ---------------------------------------------------------------------------
// Dialogues
// ---------------------------------------------------------------------------

export interface Line {
  speaker: Id;
  text: string;
  /** Condition d'affichage de la réplique, évaluée à l'entrée dans le nœud (null = toujours). */
  condition: Condition | null;
}

/** Branche conditionnelle de `next` : première condition vraie gagne. */
export interface NextBranch {
  condition: Condition;
  next: Id | null;
}

/** Transition : effets puis nœud suivant (`next: null` = fin du dialogue). */
export interface Transition {
  effects: Script;
  next: Id | null;
}

export interface Choice {
  label: string;
  intent: Id | null;
  /** Condition d'affichage du choix (null = toujours). */
  condition: Condition | null;
  effects: Script;
  next: Id | null;
}

export interface FreeText {
  /** Intention → transition. Ne contient jamais `give_item`/`show_item`. */
  intents: Record<Id, Transition>;
  /** Si aucune intention reconnue (ou sous le seuil). Par défaut : rester sur le nœud. */
  fallback: Transition;
  /** Seuil de confiance propre au nœud (null = seuil global du moteur). */
  threshold: number | null;
  placeholder: string | null;
}

export interface DialogueNode {
  id: Id;
  lines: Line[];
  /** Exécutés à l'entrée dans le nœud, après l'affichage des répliques. */
  effects: Script;
  choices: Choice[];
  free_text: FreeText | null;
  /** Enchaînement automatique (exclusif avec choices/free_text). null = fin si aucune autre sortie. Sert de repli quand `next_if` est non vide. */
  next: Id | null;
  /** Branches conditionnelles essayées avant `next` (exclusives avec choices/free_text). */
  next_if: NextBranch[];
  on_give: ItemReactions<Transition> | null;
  on_show: ItemReactions<Transition> | null;
}

export interface Dialogue {
  id: Id;
  status: Status;
  /** Personnage interlocuteur (pour `on_give`/`on_show` et le skin). */
  speaker: Id;
  start: Id;
  nodes: Record<Id, DialogueNode>;
  source: string;
}

// ---------------------------------------------------------------------------
// Intentions, objets, assets
// ---------------------------------------------------------------------------

export interface Intent {
  id: Id;
  desc: string;
  examples: string[];
  keywords: string[];
  /** true pour `give_item`/`show_item`, injectées par le chargeur. */
  reserved: boolean;
  source: string | null;
}

export interface Combination {
  with: Id;
  result: Id | null;
  /** Objets retirés de l'inventaire (une unité chacun). */
  consume: Id[];
  effects: Script;
}

export interface Item {
  id: Id;
  status: Status;
  name: string;
  description: string | null;
  icon: Id | null;
  /** Mondes où l'objet peut servir ; null = partout (`any`). */
  scope: Id[] | null;
  consumable: boolean;
  stackable: boolean;
  /** Réaction à « regarder » l'objet dans l'inventaire. */
  look: Script;
  /** Verbes personnalisés depuis l'inventaire (`boire`, `lire`…), dans l'ordre du fichier. */
  actions: Record<string, VerbAction>;
  /** Combinaisons déclarées sur cet objet (symétriques : voir `findCombination`). */
  combine: Combination[];
  source: string;
}

export type AssetKind = 'background' | 'character' | 'portrait' | 'avatar' | 'sprite' | 'item' | 'ending' | 'other';

export interface Asset {
  id: Id;
  status: Status;
  kind: AssetKind;
  prompt: string | null;
  negative: string | null;
  seed: number | null;
  workflow: string | null;
  references: Id[];
  model: string | null;
  width: number | null;
  height: number | null;
  world: Id | null;
  /** Chemin (relatif à `content/`) de l'image retenue si présente, sinon null. */
  file: string | null;
  source: string;
}

// ---------------------------------------------------------------------------
// GameData : l'objet assemblé
// ---------------------------------------------------------------------------

export interface GameData {
  formatVersion: number;
  meta: GameMeta;
  counters: Record<Id, Counter>;
  /** Variables déclarées (bornes). Une variable non déclarée reste non bornée. */
  vars: Record<Id, VarDef>;
  /** CSS des skins propres au jeu : nom → contenu de `content/skins/<nom>.css`. */
  skins: Record<string, string>;
  endings: Record<Id, Ending>;
  collections: Collection[];
  worlds: Record<Id, World>;
  quests: Record<Id, Quest>;
  bible: Bible;
  characters: Record<Id, Character>;
  scenes: Record<Id, Scene>;
  dialogues: Record<Id, Dialogue>;
  /** Contient toujours les intentions réservées `give_item` et `show_item`. */
  intents: Record<Id, Intent>;
  items: Record<Id, Item>;
  assets: Record<Id, Asset>;
}

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

export type Severity = 'error' | 'warning';

/** Erreur localisée dans un fichier de contenu. */
export interface ContentError {
  severity: Severity;
  /** Code stable (ex. `yaml`, `schema`, `duplicate_id`, `unknown_ref`). */
  code: string;
  /** Fichier relatif à `content/` (ex. `scenes/port.yaml`). */
  file: string;
  /** Chemin dans le fichier, notation pointée (ex. `hotspots[0].actions.look`). Vide = racine. */
  path: string;
  /** Ligne (1-based) dans le fichier quand elle est connue. */
  line?: number;
  message: string;
}
