/** Scénarios sur examples/demo (« Le Phare de Kerbrume ») et examples/demo-softlock. */
import type { Scenario, ScenarioStep } from '../../src';

/** Préparation commune : mèche, deux coquillages, briquet de Loïc. */
const port: ScenarioStep[] = [
  { do: 'take caisse', expect: { inventory: { meche: 1 }, events: [{ type: 'item_gained', item: 'meche' }] } },
  { do: 'take caisse', expect: { inventory: { meche: 1 }, noEvents: [{ type: 'item_gained' }] } },
  {
    do: 'take rochers',
    expect: { inventory: { coquillage: 1 }, counters: { maladresses: 1 }, flags: ['a_glisse'], events: [{ type: 'counter_changed', counter: 'maladresses', title: 'Gardienne prometteuse' }] },
  },
  { do: 'take rochers', expect: { inventory: { coquillage: 2 }, counters: { maladresses: 1 } } },
  { do: 'talk loic', expect: { dialogue: 'loic', node: 'accueil', events: [{ type: 'dialogue_started', name: 'Loïc' }, { type: 'say', speaker: 'margot', name: 'Margot' }] } },
  { do: 'continue', expect: { node: 'menu', actions: { exclude: ['choose 2'], include: ['choose 1'] } } },
  { do: 'choose "Comment rallumer le phare ?"', expect: { node: 'phare', flags: ['sait_pour_le_feu'] } },
  { do: 'continue', expect: { node: 'menu', actions: { include: ['choose 2'] } } },
  { do: 'choose "Offrir deux coquillages"', expect: { node: 'cadeau', vars: { humeur_loic: 2 }, inventory: { coquillage: 0 } } },
  'continue',
  { do: 'choose "Vous me prêtez votre briquet ?"', expect: { node: 'demande_briquet' } },
  {
    do: 'choose "S\'il vous plaît"',
    expect: { dialogue: null, inventory: { briquet: 1 }, counters: { courage: 2 }, events: [{ type: 'dialogue_ended', node: 'recompense' }] },
  },
];

const versLeHaut: ScenarioStep[] = [
  { do: 'exit exit_phare_bas', expect: { scene: 'phare_bas', flags: ['visite_phare'] } },
  { do: 'exit exit_lanterne', expect: { scene: 'phare_bas', events: [{ type: 'say', text: "La porte de l'escalier est fermée à clé." }] } },
  { do: 'take cle_rouillee', expect: { error: 'unknown_hotspot' } },
  { do: 'open coffre', expect: { flags: ['coffre_ouvert'], events: [{ type: 'visibility_changed', target: 'cle_rouillee', visible: true }] } },
  { do: 'take cle_rouillee', expect: { inventory: { cle_rouillee: 1 }, actions: { exclude: ['take cle_rouillee'] } } },
  { do: 'use cle_rouillee on porte_escalier', expect: { flags: ['porte_ouverte'], inventory: { cle_rouillee: 0 }, everHad: ['cle_rouillee'] } },
];

export const walkthrough: Scenario = {
  name: 'démo : partie complète gagnante',
  start: {
    scene: 'port',
    flags: ['arrivee'],
    quests: { unlocked: ['rallumer_phare'] },
    events: [{ type: 'scene_entered', scene: 'port', from: null }, { type: 'quest_unlocked', quest: 'rallumer_phare', title: 'Rallumer le phare' }],
  },
  steps: [
    ...port,
    ...versLeHaut,
    { do: 'fouiller commode', expect: { inventory: { photo_ancienne: 1 }, collections: ['souvenir_photo'], events: [{ type: 'collection_unlocked', collection: 'souvenir_photo' }] } },
    { do: 'fouiller commode', expect: { inventory: { photo_ancienne: 1 }, events: [{ type: 'say', text: "Rien d'autre que des cartes marines." }] } },
    { do: 'dormir lit', expect: { scene: 'songe_grotte', quests: { unlocked: ['secret_gardien'] }, events: [{ type: 'scene_entered', world: 'songe', skin: 'rpg_bubbles' }] } },
    { do: 'use briquet on bassin', expect: { events: [{ type: 'refuse', reason: 'out_of_scope', text: 'Dans le Songe, cet objet se dissout comme de la brume.' }] } },
    { do: 'talk gardien', expect: { dialogue: 'gardien', node: 'n1', events: [{ type: 'say', name: 'Le Gardien des Marées', face: 'persona' }] } },
    { do: 'show photo_ancienne', expect: { node: 'trouble', inventory: { photo_ancienne: 1 } } },
    'continue',
    { do: 'give briquet', expect: { node: 'refus', inventory: { briquet: 1 } } },
    'continue',
    {
      do: 'give photo_ancienne',
      expect: {
        dialogue: null,
        inventory: { photo_ancienne: 0, huile: 1 },
        flags: ['gardien_demasque'],
        counters: { courage: 3 },
        quests: { completed: ['secret_gardien'] },
        revealed: ['gardien'],
        collections: ['souvenir_gardien'],
        events: [
          { type: 'say', text: '…Margot ? Ma petite Margot ?', name: 'Yves Le Goff', face: 'identity' },
          { type: 'character_revealed', character: 'gardien', name: 'Yves Le Goff' },
          { type: 'collection_unlocked', collection: 'souvenir_gardien' },
        ],
      },
    },
    {
      do: 'talk gardien',
      expect: { dialogue: null, events: [{ type: 'say', node: 'apres', name: 'Yves Le Goff' }, { type: 'dialogue_ended', node: 'apres' }] },
    },
    { do: 'exit exit_phare_bas', expect: { scene: 'phare_bas', events: [{ type: 'say', text: 'Margot se réveille en sursaut sur le lit de camp.' }] } },
    { do: 'combine meche huile', expect: { inventoryExact: { briquet: 1, meche_huilee: 1 } } },
    { do: 'exit exit_lanterne', expect: { scene: 'lanterne' } },
    { do: 'use briquet on lampe', expect: { ending: null, events: [{ type: 'say', text: 'Allumer une lampe sans mèche ? Audacieux.' }] } },
    { do: 'use meche_huilee on lampe', expect: { flags: ['lampe_prete'], inventory: { meche_huilee: 0 } } },
    {
      do: 'use briquet on lampe',
      expect: {
        ending: 'phare_rallume',
        endingType: 'win',
        counters: { courage: 5 },
        quests: { completed: ['rallumer_phare'] },
        events: [{ type: 'game_ended', ending: 'phare_rallume', ending_type: 'win', title: 'Le phare veille' }],
        actions: { none: true },
      },
    },
  ],
};

export const gameOver: Scenario = {
  name: 'démo : game over (chute du balcon)',
  steps: [
    ...versLeHaut,
    { do: 'exit exit_lanterne', expect: { scene: 'lanterne' } },
    { do: 'look balcon' },
    {
      do: 'enjamber balcon',
      expect: {
        ending: 'chute',
        endingType: 'game_over',
        counters: { maladresses: 1 },
        events: [{ type: 'game_ended', ending: 'chute', ending_type: 'game_over', title: 'Plouf' }],
      },
    },
    { do: 'look balcon', expect: { error: 'game_ended' } },
  ],
};

export const freeText: Scenario = {
  name: 'démo : texte libre avec Loïc (KeywordBackend)',
  steps: [
        { do: 'exit exit_phare_bas' },
        { do: 'fouiller commode', expect: { inventory: { photo_ancienne: 1 } } },
        { do: 'exit exit_port' },
        { do: 'talk loic' },
        'continue',
        { text: 'Bonjour Loïc !', expect: { node: 'salut' } },
        'continue',
        { text: 'Quelle belle barbe !', expect: { node: 'compliment', vars: { humeur_loic: 1 } } },
        'continue',
        { text: 'Ça mord ?', expect: { node: 'blague', counters: { maladresses: 1 } } },
        'continue',
        { text: 'gloubiboulga', expect: { node: 'incompris' } },
        'continue',
        { text: 'Comment je rallume le phare ?', expect: { node: 'phare', flags: ['sait_pour_le_feu'] } },
        'continue',
        { text: 'je vous montre le briquet', expect: { node: 'menu', events: [{ type: 'refuse', reason: 'missing_item', item: 'briquet' }] } },
        { text: 'Regardez cette photo', expect: { node: 'photo', flags: ['indice_reve'], inventory: { photo_ancienne: 1 } } },
        'continue',
        { do: 'show coquillage', expect: { error: 'missing_item' } },
        { do: 'intent - 0', expect: { node: 'incompris' } },
        'continue',
        { do: 'choose "Au revoir"', expect: { dialogue: null, scene: 'port' } },
  ],
};

export const softlock: Scenario = {
  name: 'demo-softlock : la clé consommée à la porte 1 bloque la porte 2',
  steps: [
    { do: 'take cle', expect: { inventory: { cle: 1 } } },
    { do: 'exit exit_cave', expect: { scene: 'couloir', events: [{ type: 'say', text: 'Fermé.' }] } },
    { do: 'use cle on porte1', expect: { flags: ['porte1_ouverte'], inventoryExact: {} } },
    {
      do: 'exit exit_cave',
      expect: {
        scene: 'cave',
        ending: null,
        inventoryExact: {},
        everHad: ['cle'],
        // impasse : aucune action ne peut plus mener à la fin
        actions: { include: ['look porte2', 'exit exit_couloir'], exclude: ['use cle on porte2'] },
      },
    },
    { do: 'exit exit_couloir', expect: { scene: 'couloir', actions: { exclude: ['take cle'] } } },
  ],
};
