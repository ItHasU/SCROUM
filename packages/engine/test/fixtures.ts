/** Mini-jeux de test couvrant chaque construction du format. */
import { makeGame } from './helpers';

const R = 'rect: [0, 0, 0.1, 0.1]';

export const mini = () =>
  makeGame(
    {
      'scenes/a.yaml': `world: w
on_enter:
  - "Entrée A"
  - { add: { entrees: 1 } }
hotspots:
  - id: bouton
    label: Bouton
    ${R}
    actions:
      look: "Un bouton."
      push:
        - { set: f }
        - { unset: g }
        - { set: { v: 5 } }
        - { add: { v: -2 } }
        - { counter: c, add: 3 }
        - { give_item: pomme, qty: 2 }
        - { take_item: pomme }
        - { unlock_quest: q1 }
        - { complete_quest: q2 }
        - { say: masque, text: "Coucou" }
      raz:
        - { set: { v: 0 } }
        - { counter: c, set: -50 }
        - { take_item: pomme, qty: 99 }
        - { unset: f }
      ordre:
        - { goto_scene: b }
        - { say: narrator, text: "encore en A" }
        - { start_dialogue: d2 }
      double_goto:
        - { goto_scene: c }
        - { goto_scene: b }
      cacher: [ { hide: bouton2 }, { reveal: secret }, { reveal: exit_cache } ]
      revele_b: { reveal: porte, scene: b }
      fin:
        - "avant"
        - { end_game: perdu }
        - { set: jamais }
      fin_inconnue: { end_game: nope }
      boucle: { goto_scene: boucle }
      parler: { dialogue: d }
      parler_noeud: { start_dialogue: d, node: menu }
      branche:
        - if: { flag: f }
          then: "oui"
          else:
            - if: { var: v, gte: 1 }
              do: "v"
              else: "non"
  - id: bouton2
    label: Bouton 2
    ${R}
    actions: { look: "B2" }
  - id: secret
    label: Secret
    ${R}
    hidden: true
    actions: { look: "S" }
  - id: cond
    label: Cond
    ${R}
    visible_if: { flag: f }
    actions: { look: "C" }
  - id: machine
    label: Machine
    ${R}
    actions:
      look: "M"
      use:
        cle: [ "La clé tourne.", { set: ouvert } ]
        onirique: "Ça marche quand même."
        default: "Pas ça."
  - id: mur
    label: Mur
    ${R}
    actions:
      look: "Un mur."
exits:
  - to: b
    label: B
    ${R}
    if: { flag: ouvert }
    else: "Fermé."
    do: [ "Tu passes.", { goto_scene: c }, { start_dialogue: d2 } ]
  - { id: exit_cache, to: c, label: C, ${R}, hidden: true }
`,
      'scenes/b.yaml': `world: v
title: Scène B
on_enter: [ "Entrée B" ]
hotspots:
  - id: porte
    label: Porte
    ${R}
    hidden: true
    actions: { look: "P" }
  - id: autel
    label: Autel
    ${R}
    actions:
      look: "A"
      use: { default: "Rien." }
exits:
  - { to: a, label: A, ${R} }
`,
      'scenes/c.yaml': 'world: w\non_enter: [ "Entrée C" ]\n',
      'scenes/boucle.yaml': 'world: w\non_enter: { goto_scene: boucle }\n',
      'items.yaml': `pomme: { name: Pomme, stackable: true, look: [ "Une pomme.", { set: pomme_vue } ] }
cle: { name: Clé, consumable: true, scope: w }
onirique: { name: Onirique, scope: v }
partout: { name: Partout }
meche:
  name: Mèche
  combine:
    - { with: huile, result: meche_huilee, consume: [meche, huile], effects: [ "Huilée." ] }
huile: { name: Huile }
meche_huilee: { name: Mèche huilée }
caillou:
  name: Caillou
  stackable: true
  combine: [ { with: caillou, result: tas, consume: [caillou, caillou] } ]
tas: { name: Tas }
`,
      'bible/quests.yaml': 'q1: { title: Q1 }\nq2: { title: Q2 }\n',
      'characters/masque.yaml': 'persona: { name: Masque }\nidentity: { name: Vrai Nom }\nrevealed_by: { flag: f }\n',
      'characters/heros.yaml': 'name: Héros\n',
      'dialogues/d.yaml': `speaker: masque
nodes:
  start:
    lines: ["Bonjour."]
    next: menu
  menu:
    lines: ["Alors ?"]
    choices:
      - { label: "Révèle-toi", effects: [ { set: f } ], next: revele }
      - { label: "Caché", if: { flag: zzz }, next: menu }
      - { label: "Bye", intent: bye }
      - { label: "Saute", effects: [ { start_dialogue: d2 } ], next: menu }
      - { label: "Va en C", effects: [ { goto_scene: c } ], next: menu }
      - { label: "Libre", next: libre }
      - { label: "Perds", effects: [ { end_game: perdu } ], next: menu }
      - { label: "Chaîne", next: route }
    free_text:
      threshold: 0.7
      intents:
        salut: { next: menu, effects: [ { add: { saluts: 1 } } ] }
      fallback: incompris
    on_give:
      pomme: { next: merci, effects: [ { take_item: pomme } ] }
    on_show:
      cle: menu
      default: { effects: [ "Bof." ] }
  revele:
    lines: ["C'est moi !"]
  incompris:
    lines: ["Hein ?"]
    next: menu
  merci:
    lines: ["Merci."]
    next: menu
  libre:
    lines: ["Parle."]
    free_text:
      intents: { salut: menu }
    on_give:
      default: menu
  route:
    effects: [ { set: route_vue } ]
    next: apres_route
  apres_route:
    lines: ["Après la route."]
    next: menu
`,
      'dialogues/d2.yaml': `speaker: heros
nodes:
  n:
    lines: ["D2."]
    choices: [ { label: Fin } ]
`,
      'intents.yaml': 'salut: { desc: Saluer, keywords: [salut] }\nbye: { desc: Partir, keywords: [revoir] }\n',
    },
    `player_character: heros
counters:
  c: { label: C, hud: true, min: -10, max: 10, titles: [ { min: 0, label: Bas }, { min: 3, label: Haut } ] }
endings:
  perdu: { type: game_over, title: Perdu, text: "Raté." }
collections:
  - { id: col_f, title: Col F, if: { flag: f } }
`,
  );
