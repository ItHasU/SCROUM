# Format de contenu SCROUM — référence

> Format **version 1** (`formatVersion: 1`). Ce document est la référence pour écrire
> le contenu d'un jeu SCROUM, à la main ou avec Claude Code. Il décrit chaque fichier,
> chaque construction et sa **sémantique d'exécution** (ce que fait le moteur).
>
> Exemple complet et à jour : [`examples/demo`](../examples/demo) (« Le Phare de Kerbrume »).
> Vérifier son travail : `pnpm scroum validate` à la racine du dépôt de jeu.

## Sommaire

1. [Dépôt de jeu](#1-dépôt-de-jeu)
2. [Conventions générales](#2-conventions-générales)
3. [`game.yaml`](#3-gameyaml)
4. [La bible](#4-la-bible)
5. [Personnages](#5-personnages-characterssidyaml)
6. [Scènes](#6-scènes-scenesidyaml)
7. [Scripts](#7-scripts)
8. [Conditions](#8-conditions)
9. [Effets](#9-effets)
10. [Dialogues](#10-dialogues-dialoguesidyaml)
11. [Intentions](#11-intentions-intentsyaml)
12. [Objets et inventaire](#12-objets-et-inventaire-itemsyaml)
13. [Assets](#13-assets-assetsassetsyaml)
14. [Validation](#14-validation-scroum-validate)
15. [Forme canonique (développeurs)](#15-forme-canonique-développeurs)
16. [Versions et migrations](#16-versions-et-migrations)
17. [Aide-mémoire pour Claude Code](#17-aide-mémoire-pour-claude-code)

---

## 1. Dépôt de jeu

```
<jeu>/
├── CLAUDE.md                  # conventions du jeu + pointeur vers ce document
├── scroum.project.yaml        # configuration du projet (versionnée)
├── scroum.local.yaml          # (gitignoré) URL ComfyUI, chemins locaux
├── content/                   # le jeu
│   ├── game.yaml              # OBLIGATOIRE
│   ├── bible/
│   │   ├── pitch.md  tone.md  style.md   # (et tout autre .md)
│   │   ├── worlds.yaml
│   │   ├── quests.yaml
│   │   └── gags.yaml
│   ├── characters/<id>.yaml
│   ├── scenes/<id>.yaml
│   ├── dialogues/<id>.yaml
│   ├── intents.yaml
│   ├── items.yaml
│   ├── skins/<skin>.css       # skins d'interface propres au jeu (optionnel)
│   └── assets/
│       ├── assets.yaml        # registre des assets
│       ├── images/<assetId>.webp     # images retenues (.webp, .png, .jpg)
│       └── _candidates/<assetId>/    # propositions générées, jamais exportées
├── workflows/                 # workflows ComfyUI propres au jeu
└── dist/                      # (gitignoré) zips produits
```

Tous les fichiers sont optionnels sauf `game.yaml`. Un fichier non reconnu dans
`content/` produit un avertissement. Les extensions `.yaml` et `.yml` sont équivalentes.

### `scroum.project.yaml`

```yaml
formatVersion: 1          # doit valoir la version du format gérée par SCROUM
name: phare               # nom de sortie : dist/phare-<version>.scroum.zip  ([a-z0-9_-])
content: content          # défaut : content
output: dist              # défaut : dist
workflows: workflows      # défaut : workflows
editor:
  port: 5180              # défaut : 5180 (l'éditeur n'écoute que sur localhost)
images:
  format: webp            # webp | png | jpg (défaut webp)
  max_width: 1280         # largeur max des images au build
```

### `scroum.local.yaml` (gitignoré)

```yaml
comfyui:
  url: http://192.168.1.20:8188
```

Clés libres en plus : ce fichier est propre à la machine.

---

## 2. Conventions générales

### Identifiants

- Forme : **minuscules ASCII, chiffres et `_`**, commençant par une lettre ou un chiffre
  (`^[a-z0-9][a-z0-9_]*$`). Ex. : `cle_rouillee`, `n1`, `img_port_bg`.
- Pas d'accents, d'espaces, de tirets ni de majuscules.
- **Fichiers à un élément** (`characters/`, `scenes/`, `dialogues/`) : l'id est le **nom
  du fichier** sans extension. Un champ `id` peut être écrit, mais il doit alors être
  identique au nom du fichier.
- **Fichiers catalogue** (`items.yaml`, `intents.yaml`, `worlds.yaml`, `quests.yaml`,
  `gags.yaml`, `assets.yaml`) : l'id est la **clé** de chaque entrée.
- Espaces de noms séparés : un objet et une scène peuvent porter le même id, mais
  c'est déconseillé. Préfixes recommandés : `img_` pour les assets, `exit_` est
  réservé aux ids implicites des sorties.
- Les **drapeaux** (flags) et **variables** n'ont pas besoin d'être déclarés : ils
  existent dès qu'on les utilise. Un drapeau est faux tant qu'il n'a pas été levé ;
  une variable vaut 0 tant qu'elle n'a pas été affectée.

### Locuteurs

- `narrator` : locuteur réservé pour la narration.
- Tout id de personnage (`characters/<id>.yaml`), y compris le personnage joué
  (`game.yaml → player_character`).

### Coordonnées des rectangles

Les zones cliquables (`rect`) sont en **coordonnées normalisées** relatives à l'image de
fond de la scène (format 16:9) : origine **en haut à gauche**, `x` vers la droite, `y`
vers le bas, toutes les valeurs entre 0 et 1.

```yaml
rect: [0.62, 0.40, 0.12, 0.30]           # [x, y, largeur, hauteur]
rect: { x: 0.62, y: 0.40, w: 0.12, h: 0.30 }   # forme équivalente
```

Contraintes : `w > 0`, `h > 0`, `x + w ≤ 1`, `y + h ≤ 1`. Les rectangles peuvent se
chevaucher ; en cas de chevauchement, le dernier déclaré est au-dessus.

### Statut de validation

Chaque élément de la bible, chaque personnage et chaque asset (ainsi que scènes,
dialogues et objets) peut porter `status` :

| Valeur | Sens |
|---|---|
| `draft` (défaut) | Brouillon, modifiable librement |
| `review` | Proposé, en attente de relecture humaine |
| `validated` | Validé par l'humain : **Claude Code ne le modifie jamais sans demande explicite** |
| `rejected` | Rejeté, à retravailler ou supprimer |

Pour les fichiers Markdown de la bible, le statut est dans un front matter :

```markdown
---
status: validated
---
# Pitch
…
```

### Notes d'auteur

Le champ texte `notes` est accepté sur tous les objets principaux (personnage, scène,
hotspot, sortie, nœud, choix, objet, combinaison, monde, quête, intention, asset…). Il
est ignoré par le moteur. Les commentaires YAML (`# …`) sont aussi permis.

### Clés inconnues

Toute clé non documentée ici est une **erreur** (pour attraper les fautes de frappe :
`consomable` au lieu de `consumable`…).

### Textes

Texte brut UTF-8 (pas de Markdown dans les répliques). Les longues répliques peuvent
utiliser les blocs YAML `>` (replié) ou `|` (lignes conservées). Préférer des
répliques courtes : l'écran cible est un téléphone.

---

## 3. `game.yaml`

```yaml
title: "Le Phare de Kerbrume"         # obligatoire
version: 0.1.0                        # obligatoire (version du jeu, libre)
formatVersion: 1                      # obligatoire
description: "Rallumer le phare avant la tempête."
start_scene: port                     # obligatoire : scène de départ
player_character: margot              # personnage joué (optionnel)
refuse_line: "Ça ne donne rien."      # refus par défaut si le monde n'en déclare pas

counters:                             # compteurs nommés par le jeu
  courage: { label: "Courage", hud: true, initial: 1, min: 0 }
  maladresses:
    label: "Maladresses"
    hud: false                        # défaut : false
    initial: 0                        # défaut : 0
    min: null                         # bornes optionnelles (valeur bornée par le moteur)
    max: null
    titles:                           # titre affiché selon la valeur
      - { min: 0, label: "Gardienne prometteuse" }
      - { min: 2, label: "Marin d'eau douce" }
      - { min: 4, label: "Catastrophe ambulante" }

character_roles: [heroine, habitant, esprit]   # rôles autorisés pour les personnages

validation:                           # règles éditoriales, bloquantes au build
  characters:
    require_age: true                 # tout personnage doit avoir un âge
    min_age: 18                       # âge minimal

initial:                              # état de départ (tout est optionnel)
  flags: [porte_entrouverte]
  vars: { confiance: 1 }
  inventory: [carnet]                 # liste (1 de chaque) ou { carnet: 1, piece: 3 }
  quests: [premiere_quete]            # quêtes débloquées dès le départ

collections:                          # galeries à débloquer
  - id: souvenir_gardien
    title: "Le Gardien des Marées"
    text: "Sous le masque d'écume, le vieil Yves."
    character: gardien                # optionnel : l'UI montre persona.avatar ↔ identity.portrait
    images: [img_photo]               # optionnel : assets à montrer
    if: { flag: gardien_demasque }    # condition de déblocage (obligatoire)

endings:                              # fins (optionnel, voir aussi end_game en ligne)
  phare_rallume:
    type: win                         # win | game_over
    title: "Le phare veille"
    text: "Le faisceau balaie la mer."
    image: img_fin_phare
```

**Compteurs.** Valeur initiale `initial`, modifiée par l'effet `counter`. Si `min`/`max`
sont donnés, la valeur est bornée. Un compteur `hud: true` est affiché en permanence ;
les autres servent aux conditions, aux titres et aux collections. Le **titre courant**
est le `label` du dernier palier dont `min ≤ valeur` (aucun si la valeur est sous tous
les paliers).

**Collections.** Une entrée est débloquée dès que sa condition devient vraie (vérifiée
après chaque action) et **reste débloquée** ensuite.

**Fins.** Une fin est déclenchée par l'effet `end_game`. Elle peut être déclarée ici ou
directement en ligne dans l'effet (voir [§9](#9-effets)). Le jeu doit avoir au moins une
fin `win` (sinon avertissement).

---

## 4. La bible

La bible regroupe les éléments fondateurs, à valider avant de générer la suite.

### Fichiers Markdown (`bible/*.md`)

Texte libre, avec front matter `status` optionnel. Conventionnellement :
`pitch.md` (l'histoire), `tone.md` (ton et ligne éditoriale, injecté dans le prompt de
Claude), `style.md` (direction artistique, préfixes de prompt par monde, palette,
négatif commun). D'autres fichiers sont permis (`personnages.md`…).

### Mondes (`bible/worlds.yaml`)

```yaml
ile:
  status: validated
  name: "L'île de Kerbrume"               # obligatoire
  description: "Un port, un phare."
  ui_skin: plain                          # défaut : plain
  refuse_line: "Ça ne sert à rien ici."   # défaut : game.yaml → refuse_line
songe:
  name: "Le Songe des Marées"
  ui_skin: rpg_bubbles
  refuse_line: "Dans le Songe, cet objet se dissout comme de la brume."
```

- `ui_skin` : skin des dialogues et de l'interface dans ce monde. Fournis par le moteur :
  `plain`, `chat_retro`, `rpg_bubbles`, `swipe_cards`. Un jeu peut en ajouter dans
  `content/skins/<nom>.css` (sinon avertissement).
- `refuse_line` : réplique quand un objet ne sert à rien (objet hors `scope`, ou
  hotspot sans réaction pour cet objet — voir [§6](#6-scènes-scenesidyaml)).

### Quêtes (`bible/quests.yaml`)

```yaml
rallumer_phare:
  status: validated
  title: "Rallumer le phare"              # obligatoire
  description: "Trouver une mèche, de l'huile et du feu."
```

Une quête est **verrouillée** au départ (sauf `game.yaml → initial.quests`), devient
**active** avec l'effet `unlock_quest`, **terminée** avec `complete_quest` (qui la
débloque aussi si besoin). Le journal des quêtes du HUD montre les quêtes débloquées.

### Gags (`bible/gags.yaml`)

Réservoir d'idées pour l'écriture (non utilisé par le moteur).

```yaml
mouette_critique:
  status: validated
  text: "Une mouette regarde Margot avec un mépris professionnel."
  tags: [port, animaux]
barbe_salee: "Forme courte : juste le texte (statut draft)."
```

---

## 5. Personnages (`characters/<id>.yaml`)

### Forme simple

```yaml
status: validated
role: habitant                 # parmi game.yaml → character_roles
age: 62                        # entier ; requis si validation.characters.require_age
name: "Loïc"                   # obligatoire en forme simple
description: "Pêcheur bourru, ami d'Yves."
world: ile                     # monde d'appartenance (optionnel)
portrait: img_loic             # asset (optionnel)
avatar: null                   # asset (optionnel)
motivation: "Veiller sur l'île."
voice: "Bourru, phrases sans sujet."          # utilisé par le reformulateur LLM
dislikes: [blagues sur la pêche]
llm_persona_prompt: >
  Tu joues Loïc, vieux pêcheur bourru…
```

### Double identité

Un personnage peut avoir une **persona** (ce qu'on voit dans un monde) et une
**identity** (la vraie personne, révélée plus tard). Le moteur affiche la persona tant
que la condition `revealed_by` est fausse, puis l'identité.

```yaml
status: review
role: esprit
age: 78
persona:
  name: "Le Gardien des Marées"
  description: "Silhouette d'écume et de lanternes."
  world: songe
  avatar: img_gardien_persona
identity:
  name: "Yves Le Goff"
  description: "Ancien gardien du phare."
  world: ile
  portrait: img_yves
revealed_by: { flag: gardien_demasque }   # n'importe quelle condition
```

Règles : `name` au premier niveau **ou** `identity`, pas les deux ; avec `identity`,
`description`/`world`/`avatar`/`portrait` vont dans `identity` ou `persona` ;
`revealed_by` n'est permis qu'avec une `persona`. La révélation est évaluée en
continu : il suffit de lever le drapeau (`{ set: gardien_demasque }`).

---

## 6. Scènes (`scenes/<id>.yaml`)

```yaml
status: review
title: "Le bas du phare"       # optionnel
world: ile                     # obligatoire
background: img_phare_bas_bg   # asset (placeholder si image absente)
music: null                    # réservé (audio hors périmètre)
on_enter:                      # script exécuté à CHAQUE entrée dans la scène
  - if: { not: { flag: visite_phare } }
    do:
      - { say: narrator, text: "Ça sent le sel et l'huile froide." }
      - { set: visite_phare }
hotspots: [ … ]
exits: [ … ]
```

`on_enter` s'exécute à chaque entrée (y compris au retour) : pour un texte de première
visite, tester un drapeau comme ci-dessus.

### Hotspots

```yaml
hotspots:
  - id: coffre                 # unique dans la scène (hotspots et sorties confondus)
    label: "Coffre de marine"  # nom affiché
    rect: [0.05, 0.55, 0.22, 0.25]
    hidden: false              # défaut false ; true = invisible jusqu'à un effet reveal
    visible_if: null           # condition de visibilité supplémentaire
    image: null                # asset de sprite optionnel
    character: null            # personnage représenté (optionnel, pour l'UI et l'éditeur)
    actions:                   # verbes proposés dans le menu contextuel
      look: "Un coffre de marine."
      open:
        if: { flag: coffre_ouvert }
        do: "Il ne contient plus que des cordages."
        else:
          - { set: coffre_ouvert }
          - { reveal: cle_rouillee }
      use:                     # utilisation d'un objet de l'inventaire
        pied_de_biche: [ … ]
        default: "Ça n'ouvre pas un coffre, ça."
```

**Verbes.** Chaque clé de `actions` (hors `use`) est un verbe affiché dans le menu
contextuel du hotspot, dans l'ordre du fichier. Verbes usuels, avec libellé par défaut
fourni par l'UI : `look` (Regarder), `talk` (Parler), `take` (Prendre), `open` (Ouvrir),
`push`, `pull`, `close`. Tout autre id de verbe est permis (`fouiller`, `dormir`…) : lui
donner alors un `label`. La valeur d'un verbe est un [script](#7-scripts) ; sur la forme
objet, `label` personnalise le libellé :

```yaml
      dormir:
        label: "Faire une sieste"
        do: [ { goto_scene: songe_grotte } ]
```

**Visibilité.** Un hotspot est visible si (il n'est pas `hidden`, ou a été révélé par
`reveal`, et n'a pas été caché par `hide`) **et** `visible_if` est vrai (ou absent).
`reveal`/`hide` posent un état persistant par scène ; `visible_if` est réévalué en
continu.

**Objet ramassable.** Pas de verbe spécial : un `take` qui donne l'objet, et un
`visible_if` qui fait disparaître le hotspot. Utiliser `ever_had_item` plutôt que
`has_item` : sinon le hotspot réapparaît quand l'objet est consommé ou donné.

```yaml
  - id: cle_rouillee
    label: "Clé rouillée"
    rect: [0.12, 0.6, 0.06, 0.06]
    hidden: true                                  # objet caché, révélé par le coffre
    visible_if: { not: { ever_had_item: cle_rouillee } }
    actions:
      take: { give_item: cle_rouillee }
```

**`use` : réactions indexées par objet.** Quand le joueur sélectionne un objet puis
touche le hotspot, le moteur choisit la réaction ainsi :

1. une réaction pour **cet objet** (`use.<id_objet>`) existe → elle est exécutée (même si
   l'objet est hors de son `scope`) ; si l'objet est `consumable`, **une unité est
   retirée après** l'exécution ;
2. sinon, si l'objet est **hors scope** (le monde de la scène n'est pas dans son
   `scope`) → réplique `refuse_line` du monde ;
3. sinon, `use.default` s'il existe ;
4. sinon → réplique `refuse_line` du monde.

Les répliques de refus sont dites par `player_character` s'il est défini, sinon par
`narrator`.

### Sorties

```yaml
exits:
  - { to: port, label: "Retour au port", rect: [0, 0.3, 0.06, 0.5] }
  - id: exit_lanterne          # optionnel ; défaut : exit_<to>
    to: lanterne               # scène cible (obligatoire)
    label: "Monter à la lanterne"
    rect: [0.86, 0.22, 0.12, 0.5]
    hidden: false              # comme les hotspots (reveal/hide par id)
    visible_if: null
    if: { flag: porte_ouverte }          # condition de passage (optionnel)
    else: "La porte est fermée à clé."   # script si la condition est fausse
    do: [ { say: narrator, text: "Tu montes." } ]   # script exécuté avant de partir
```

Toucher une sortie visible : si `if` est faux, `else` est exécuté et on reste ; sinon
`do` est exécuté, puis le moteur change de scène (et exécute `on_enter` de la cible).
Si deux sorties vont vers la même scène, leur donner des `id` distincts.

---

## 7. Scripts

Un **script** est une suite d'**étapes** exécutées dans l'ordre. On en trouve dans
`on_enter`, les verbes et `use` des hotspots, `do`/`else` des sorties, `effects` des
nœuds/choix/transitions de dialogue, `look` et `combine.effects` des objets.

### Formes acceptées

Partout où un script est attendu, on peut écrire :

| Forme | Exemple | Équivaut à |
|---|---|---|
| Absent / `null` | | script vide |
| Texte seul | `"Un vieux coffre."` | `[ { say: narrator, text: "Un vieux coffre." } ]` |
| Une étape seule | `{ say: margot, text: "Hop." }` | `[ cette étape ]` |
| Raccourci dialogue | `{ dialogue: loic }` | `[ { start_dialogue: loic } ]` |
| Liste d'étapes | `[ { set: a }, "Texte." ]` | la liste |
| Bloc `do` | `{ do: [ … ] }` | la liste (aplatie) |
| Condition | `{ if: <condition>, do: <script>, else: <script> }` | une étape conditionnelle |

Dans une liste, chaque élément est une étape ou un texte seul (`say narrator`).
`then` est un synonyme de `do` dans un `if`. `else` est optionnel. Les `if` s'imbriquent :

```yaml
take:
  - if: { not: { flag: a_glisse } }
    do:
      - "Margot glisse sur les algues."
      - { counter: maladresses, add: 1 }
      - { set: a_glisse }
  - if: { item_qty: coquillage, lt: 3 }
    do: { give_item: coquillage }
    else: { say: margot, text: "J'ai les poches pleines." }
```

**Une étape = un effet.** `{ set: a, goto_scene: b }` est une erreur : écrire deux
étapes dans une liste. Exceptions naturelles (clés qui vont ensemble) : `say` + `text`,
`counter` + `add`/`set`, `give_item`/`take_item` + `qty`, `reveal`/`hide` + `scene`,
`start_dialogue`/`dialogue` + `node`, `if` + `do`/`then` + `else`.

### Sémantique d'exécution

- Les étapes s'exécutent dans l'ordre ; une condition `if` est évaluée **au moment où
  l'étape est atteinte** (elle voit les effets des étapes précédentes).
- Les répliques `say` sont affichées dans l'ordre, l'une après l'autre.
- `goto_scene` et `start_dialogue` sont **différés à la fin du script** : les étapes
  suivantes s'exécutent encore (dans le contexte de la scène courante). S'il y en a
  plusieurs, la dernière l'emporte. Un `start_dialogue` différé s'ouvre après
  l'éventuel changement de scène.
- `end_game` **interrompt immédiatement** le script et termine la partie (le dialogue
  en cours est fermé, aucun changement de scène en attente n'a lieu).
- **Ordre des effets différés.** Après le script d'une action (verbe, `use`, sortie,
  objet), le moteur change de scène (en exécutant le `on_enter` de la cible, qui peut
  lui-même changer de scène ou ouvrir un dialogue), puis ouvre le dialogue demandé —
  sauf si le `on_enter` en a déjà ouvert un. Pour une **sortie**, sa cible `to`
  l'emporte sur un `goto_scene` de son `do`.
- Un enchaînement sans fin (scènes dont le `on_enter` se renvoient l'une à l'autre,
  nœuds sans répliques en boucle) est interrompu au-delà de 200 transitions : l'action
  est annulée avec une erreur `loop_limit`.
- Les effets ne modifient jamais rien en dehors de l'état de jeu sérialisé ; le LLM
  ne déclenche jamais d'effet.

---

## 8. Conditions

Une condition s'écrit avec **un seul type** par objet ; on combine avec `all`, `any`,
`not`.

| Condition | Exemple | Vraie si… |
|---|---|---|
| `flag` | `{ flag: porte_ouverte }` | le drapeau est levé |
| *(texte seul)* | `porte_ouverte` | raccourci de `{ flag: porte_ouverte }` |
| `var` | `{ var: humeur_loic, gte: 2 }` | la variable (0 si jamais affectée) satisfait la comparaison |
| `counter` | `{ counter: courage, lt: 3 }` | le compteur (déclaré dans game.yaml) satisfait la comparaison |
| `has_item` | `{ has_item: briquet }` | l'inventaire contient au moins un exemplaire |
| `item_qty` | `{ item_qty: coquillage, gte: 2 }` | la quantité possédée (0 si absent) satisfait la comparaison |
| `ever_had_item` | `{ ever_had_item: meche }` | l'objet a été possédé à un moment (même consommé/donné depuis) |
| `quest` | `{ quest: rallumer_phare, state: completed }` | la quête est dans l'état : `unlocked` (défaut : débloquée, terminée ou non), `active` (débloquée, non terminée), `completed` |
| `all` | `{ all: [c1, c2] }` | toutes vraies (liste vide → vrai) |
| *(liste)* | `[c1, c2]` | raccourci de `{ all: [c1, c2] }` |
| `any` | `{ any: [c1, c2] }` | au moins une vraie (liste vide → faux) |
| `not` | `{ not: c }` | `c` est fausse |

**Comparateurs** (pour `var`, `counter`, `item_qty`) : `eq` (=), `gte` (≥), `lte` (≤),
`gt` (>), `lt` (<). Au moins un ; s'il y en a plusieurs, tous doivent être vrais :
`{ counter: courage, gte: 2, lte: 5 }`.

Exemple composé :

```yaml
if:
  all:
    - { flag: sait_pour_le_feu }
    - { not: { ever_had_item: briquet } }
    - any: [ { var: humeur_loic, gte: 2 }, { has_item: coquillage } ]
```

---

## 9. Effets

| Effet | Exemple | Effet sur l'état |
|---|---|---|
| `set` (drapeau) | `{ set: porte_ouverte }` / `{ set: [a, b] }` | lève le(s) drapeau(x) |
| `set` (variable) | `{ set: { humeur_loic: 0 } }` | affecte la/les variable(s) |
| `unset` | `{ unset: porte_ouverte }` / `{ unset: [a, b] }` | baisse le(s) drapeau(x) |
| `add` | `{ add: { humeur_loic: 1, peur: -2 } }` | ajoute aux variables (négatif permis) |
| `counter` | `{ counter: courage, add: 2 }` / `{ counter: courage, set: 0 }` | modifie un compteur déclaré (borné par min/max) |
| `give_item` | `{ give_item: briquet }` / `{ give_item: coquillage, qty: 3 }` | ajoute à l'inventaire (`qty` défaut 1) et à l'historique `ever_had` ; un objet non `stackable` n'est jamais possédé en plus d'un exemplaire |
| `take_item` | `{ take_item: coquillage, qty: 2 }` | retire de l'inventaire (`qty` défaut 1, jamais sous 0) |
| `reveal` | `{ reveal: cle_rouillee }` / `{ reveal: cle_rouillee, scene: phare_bas }` | rend visible un hotspot ou une sortie (par id) |
| `hide` | `{ hide: tiroir }` | cache un hotspot ou une sortie |
| `goto_scene` | `{ goto_scene: songe_grotte }` | change de scène (différé en fin de script) |
| `start_dialogue` | `{ start_dialogue: gardien }` / `{ start_dialogue: gardien, node: apres }` / `{ dialogue: gardien }` | ouvre un dialogue, au nœud `start` ou au nœud donné (différé) |
| `unlock_quest` | `{ unlock_quest: rallumer_phare }` | débloque une quête |
| `complete_quest` | `{ complete_quest: rallumer_phare }` | termine une quête |
| `say` | `{ say: margot, text: "Hop." }` / `"Texte du narrateur."` | affiche une réplique (`text` obligatoire) |
| `end_game` | `{ end_game: phare_rallume }` | termine la partie sur cette fin (immédiat) |

**`reveal`/`hide` : quelle scène ?** Sans `scene`, la cible est cherchée dans la scène où
le script est **écrit** (scripts de scène) ou dans la **scène courante** (scripts de
dialogue ou d'objet). Préciser `scene` pour agir sur une autre scène.

**`end_game` en ligne.** Une fin peut être décrite directement dans l'effet ; elle est
alors ajoutée aux fins du jeu (et ne doit pas contredire une déclaration de
`game.yaml → endings` portant le même id) :

```yaml
- end_game:
    ending: chute              # id de la fin (obligatoire)
    type: game_over            # win | game_over (obligatoire)
    title: "Plouf"
    text: "Une rafale, un cri, un plongeon."
    image: null
```

---

## 10. Dialogues (`dialogues/<id>.yaml`)

Dialogues **semi-scriptés** : un graphe de nœuds ; le joueur avance par des **choix**,
du **texte libre** classé en **intentions**, ou en **donnant / montrant** un objet.

```yaml
status: review
speaker: loic                  # interlocuteur (personnage) : obligatoire
start: accueil                 # nœud de départ ; défaut : le premier nœud du fichier
nodes:
  accueil:
    lines:
      - "Tiens, la petite-nièce d'Yves."                    # dite par le speaker
      - { speaker: margot, text: "Bonjour Loïc." }          # autre locuteur
    next: menu                 # enchaînement automatique

  menu:
    speaker: loic              # optionnel : locuteur par défaut des lignes de ce nœud
    lines: "Alors, qu'est-ce que tu veux ?"                 # texte seul = une ligne
    effects: [ { set: a_parle_a_loic } ]                   # exécutés à l'entrée du nœud
    choices:
      - { label: "Comment rallumer le phare ?", intent: question_phare, next: phare }
      - label: "Offrir deux coquillages"
        if: { item_qty: coquillage, gte: 2 }                # choix affiché seulement si vrai
        effects: [ { take_item: coquillage, qty: 2 }, { add: { humeur_loic: 2 } } ]
        next: cadeau
      - { label: "Au revoir" }                              # pas de next : fin du dialogue
    free_text:
      placeholder: "Dire quelque chose à Loïc…"
      threshold: 0.6           # optionnel : seuil de confiance propre au nœud
      intents:                 # intention → transition
        compliment: compliment
        blague: { next: blague, effects: [ { counter: maladresses, add: 1 } ] }
      fallback: incompris      # si rien n'est reconnu ; défaut : rester sur ce nœud
    on_give:                   # le joueur donne un objet
      bouquet: { next: touche, effects: [ { take_item: bouquet } ] }
      default: refus
    on_show:                   # le joueur montre un objet
      photo_ancienne: photo
```

### Nœuds

| Clé | Rôle |
|---|---|
| `lines` | Répliques : texte, ou `{ speaker, text }`, ou liste des deux. Locuteur par défaut : `speaker` du nœud, sinon celui du dialogue. |
| `effects` | Script exécuté à l'entrée du nœud, après l'affichage des répliques. |
| `choices` | Choix proposés (filtrés par leur `if`). |
| `free_text` | Saisie libre classée en intentions. |
| `next` | Nœud suivant automatique. **Exclusif** avec `choices` et `free_text`. |
| `on_give` / `on_show` | Réactions au don / à la présentation d'un objet. |
| `speaker` | Locuteur par défaut des lignes du nœud. |

**Déroulement d'un nœud.** Le moteur affiche les `lines`, exécute `effects`, puis :
- s'il y a des choix visibles ou un `free_text` → il attend le joueur ;
- sinon, s'il y a `next` → il passe au nœud suivant : si le nœud a des répliques (ou
  `on_give`/`on_show`), le moteur attend d'abord que le joueur **continue** (« Suite ») ;
  un nœud sans répliques (aiguillage, effets seuls) enchaîne sans attendre ;
- sinon → **fin du dialogue** (retour à la scène), juste après les répliques.

Si un effet de nœud fait `goto_scene`, le changement de scène a lieu à la fin du
dialogue ; `end_game` termine la partie immédiatement. Un `start_dialogue` dans un
effet de nœud, de choix ou de transition **saute** vers ce dialogue (le `next` est
ignoré) ; un changement de scène en attente est conservé.

**Quitter un dialogue.** Le joueur ne peut quitter un dialogue que par un choix sans
`next`, ou sur un nœud à `free_text` **sans aucun choix visible** (bouton « Quitter »
fourni par l'UI, pour ne jamais rester bloqué face au texte libre). Prévoir un choix
« Au revoir » dans les autres cas.

### Transitions

Les cibles de `free_text.intents`, `fallback`, `on_give`, `on_show` sont des
**transitions** :

| Forme | Sens |
|---|---|
| `n2` | aller au nœud `n2` |
| `{ next: n2, effects: [ … ] }` | exécuter `effects` puis aller à `n2` |
| `{ effects: [ … ] }` ou `null` | exécuter `effects` (s'il y en a) puis **fin du dialogue** |

Un choix suit la même règle : `effects` puis `next` (absent = fin du dialogue).

### Texte libre

1. L'UI envoie le texte au classifieur (LLM local ou repli par mots-clés) avec la liste
   des intentions **autorisées dans le nœud** : les clés de `free_text.intents`, les
   `intent` des choix visibles, et `give_item`/`show_item` si le nœud a
   `on_give`/`on_show`. Le classifieur renvoie `{ intent, confidence, item? }`.
2. Le moteur applique, dans l'ordre :
   - confiance sous le seuil (`threshold` du nœud, sinon seuil global) → `fallback` ;
   - intention présente dans `free_text.intents` → sa transition ;
   - intention portée par un **choix visible** (`intent: …`) → ce choix, comme s'il
     avait été touché ;
   - `give_item` / `show_item` avec un `item` → comme `on_give` / `on_show` ci-dessous ;
   - sinon → `fallback`.
3. Sans `fallback`, un texte non compris laisse le joueur sur le même nœud (les
   répliques sont réaffichées et ses `effects` rejoués).
4. Seuil global par défaut : **0.5** (option `threshold` du moteur). Le repli par
   mots-clés (`KeywordBackend`) donne 0.75 pour un mot-clé reconnu (+0.1 par mot-clé
   supplémentaire, max 0.95), et jusqu'à 1 par similarité avec les `examples`.

Les intentions `give_item` et `show_item` sont **réservées** : ne pas les déclarer dans
`intents.yaml` ni dans `free_text.intents` (utiliser `on_give` / `on_show`).

### Donner et montrer un objet

Dans un nœud qui a `on_give` (resp. `on_show`), le joueur peut sélectionner un objet de
l'inventaire et choisir « Donner » (resp. « Montrer ») :

1. si le joueur **ne possède pas** l'objet (cas du texte libre) → réplique de refus,
   aucun effet ;
2. réaction de l'objet (`on_give.<id_objet>`) si elle existe, sinon `default` ;
3. sans réaction ni `default` → réplique de refus du monde, on reste sur le nœud.

**Donner ne retire pas l'objet automatiquement** : écrire `{ take_item: … }` dans les
effets de la réaction (cela permet aussi les échanges : `take_item` + `give_item`).
Montrer ne retire jamais rien. « Donner » / « Montrer » est possible dès que le nœud
courant a `on_give` / `on_show`, y compris sur un nœud qui attend « Suite ».

---

## 11. Intentions (`intents.yaml`)

Catalogue des intentions propres au jeu, utilisé par le classifieur LLM, le repli par
mots-clés et l'éditeur.

```yaml
compliment:
  desc: "Faire un compliment"                       # obligatoire
  examples: ["belle barbe !", "j'adore votre bateau"]
  keywords: [belle, beau, joli, jolie, adore, bravo]
question_phare:
  desc: "Demander comment rallumer le phare"
  examples: ["comment je rallume le phare ?"]
  keywords: [phare, lampe, rallumer]
```

- `desc` : description courte, donnée telle quelle au LLM.
- `examples` : phrases types (pour le prompt du LLM).
- `keywords` : mots-clés du repli sans LLM (`KeywordBackend`), en minuscules ; écrire
  les variantes utiles (accents, genre, nombre).
- `give_item`, `show_item` : réservées, fournies par le moteur.

---

## 12. Objets et inventaire (`items.yaml`)

```yaml
meche:
  status: validated
  name: "Mèche de coton"                  # obligatoire
  description: "Une mèche de lampe, toute sèche."   # affichée dans l'inventaire
  icon: img_item_meche                    # asset (placeholder si absent)
  scope: ile                              # any (défaut) | id de monde | liste de mondes
  consumable: false                       # défaut false
  stackable: false                        # défaut false
  look: { say: margot, text: "Sèche comme un biscuit de mer." }   # script
  combine:
    - with: huile                         # l'autre objet
      result: meche_huilee                # objet obtenu (null = aucun)
      consume: [meche, huile]             # objets retirés (une unité chacun) ; défaut : aucun
      effects: [ { say: margot, text: "Voilà qui brûlera longtemps." } ]
```

| Champ | Sens |
|---|---|
| `scope` | Mondes où l'objet peut servir. Utilisé ailleurs, il produit la `refuse_line` du monde courant, sauf réaction `use` spécifique prévue (voir [§6](#6-scènes-scenesidyaml)). |
| `consumable` | Une unité est retirée **automatiquement** après chaque utilisation réussie via une réaction `use.<id_objet>` d'un hotspot. Attention : la réaction compte comme réussie même si elle contient un `if` dont la branche `else` est un refus ; pour un usage conditionnel, préférer `consumable: false` et un `take_item` explicite dans la bonne branche. |
| `stackable` | L'objet peut être possédé en plusieurs exemplaires (quantité affichée). Sinon, la quantité est plafonnée à 1. |
| `look` | Script exécuté quand on examine l'objet dans l'inventaire (en plus de l'affichage de `description`). |
| `combine` | Combinaisons. **Symétriques** : déclarer `meche + huile` sur `meche` suffit ; la déclarer aussi sur `huile` est redondant (avertissement). |

**Combiner** : sélectionner un objet puis toucher un autre objet de l'inventaire. Si une
combinaison existe (déclarée sur l'un ou l'autre) : retrait des objets de `consume`,
ajout de `result` (une unité), puis `effects`. Sinon : réplique de refus. Combiner un
objet avec lui-même (`with: <lui-même>`) demande d'en posséder deux exemplaires.
Examiner (`look`) et combiner sont possibles aussi pendant un dialogue ; un
`goto_scene` y est alors différé à la fin du dialogue.

### Obtenir un objet

Tout objet doit être **obtenable** (sinon erreur de validation) : présent dans un
`give_item` quelque part, résultat d'une combinaison, ou dans `game.yaml → initial.inventory`.
Les manières d'obtenir un objet :

| Manière | Construction | Exemple dans la démo |
|---|---|---|
| Ramasser | verbe `take` d'un hotspot + `give_item` | `meche` (port), `coquillage` (port) |
| Objet caché révélé | hotspot `hidden: true` + `reveal` depuis une autre action | `cle_rouillee` (phare_bas) |
| Donné en dialogue (échange) | `on_give` avec `take_item` + `give_item` | `huile` (dialogue gardien) |
| Récompense de dialogue | `give_item` dans les `effects` d'un nœud | `briquet` (dialogue loic) |
| Combinaison | `combine.result` | `meche_huilee` |

### État de l'inventaire

L'inventaire sérialisé contient : objet → quantité, et l'historique `ever_had` (objets
possédés au moins une fois). Chaque acquisition est signalée par l'UI et notée au
journal.

---

## 13. Assets (`assets/assets.yaml`)

Registre des images : métadonnées de génération et statut. L'image retenue est
`assets/images/<assetId>.webp` (ou `.png`, `.jpg`). Tant qu'elle manque, le player
affiche un **placeholder** et la validation émet un simple avertissement.

```yaml
img_port_bg:
  status: draft                 # validated = image retenue validée par l'humain
  kind: background              # background | character | portrait | avatar | sprite | item | ending | other
  prompt: "petit port breton, barques, ciel d'orage"
  negative: "texte, filigrane"
  seed: 123456
  workflow: bg                  # bg | char_sheet | char_edit | transform | remove_bg | item_icon | <propre au jeu>
  references: [img_margot]      # autres assets servant de référence
  model: "qwen-image-q4"
  width: 1280
  height: 720
```

Toute référence à un asset (`background`, `avatar`, `portrait`, `icon`, `image`,
`images`) doit être déclarée ici. Claude Code peut **proposer** des candidats dans
`assets/_candidates/<assetId>/` mais ne **valide jamais** un asset.

---

## 14. Validation (`scroum validate`)

```
pnpm scroum validate [chemin] [--json] [--quiet]
```

`[chemin]` : racine du dépôt de jeu (avec `scroum.project.yaml`), ou dossier `content/`.
Code de retour non nul s'il y a au moins une erreur. Chaque problème est localisé :
fichier, chemin dans le fichier (`hotspots[0].actions.look`), ligne si connue, et code.

Niveaux, dans l'ordre (un niveau en erreur peut empêcher les suivants) :

1. **Chargement** : YAML valide, schéma de chaque fichier (`yaml`, `schema`,
   `id_mismatch`, `bad_filename`, `reserved_intent`, `ending_conflict`,
   `format_version`, `missing_file`…). Si ce niveau échoue, les suivants ne sont pas
   exécutés.
2. **Règles du jeu** (`game.yaml → validation`) : `age_required`, `age_min`,
   `unknown_role`.
3. **Cohérence** : toute référence existe (`unknown_scene`, `unknown_dialogue`,
   `unknown_node`, `unknown_item`, `unknown_asset`, `unknown_intent`, `unknown_world`,
   `unknown_character`, `unknown_quest`, `unknown_counter`, `unknown_ending`,
   `unknown_speaker`, `unknown_target`) ; tout objet est obtenable
   (`unobtainable_item`).
   Avertissements : `missing_image`, `orphan_scene`, `orphan_dialogue`, `orphan_node`,
   `flag_never_set`, `unused_intent`, `unknown_skin`, `inert_hotspot`,
   `duplicate_combine`, `consume_other`, `no_win_ending`, `unknown_file`.
4. **Jouabilité** (à venir, jalon M1b) : exploration de l'espace d'états depuis
   `start_scene` ; fin `win` atteignable, éléments jamais atteints, *soft-locks*
   (avec le chemin qui y mène).

---

## 15. Forme canonique (développeurs)

`@scroum/schema` normalise toutes les formes abrégées ci-dessus en une **forme
canonique** unique, la seule que voient le moteur, le player et l'éditeur. C'est le
contenu du `game.json` du zip.

```ts
import { loadContent, type GameData } from '@scroum/schema';
const { game, errors } = loadContent(files); // files : Map<chemin relatif à content/, texte>
```

- Toutes les unions sont discriminées par `kind`.
- Aucune valeur `undefined` : `null`, `[]` ou `{}` explicites.
- **Script** = `Step[]` ; `Step` = `Effect | { kind: 'if', condition, then, else }`.
- **Effect** : `set_flag`, `unset_flag`, `set_var`, `add_var`, `counter_add`,
  `counter_set`, `give_item` (`qty`), `take_item` (`qty`), `reveal`/`hide`
  (`target`, `scene` — remplie pour les scripts de scène), `goto_scene`,
  `start_dialogue` (`node` ou null), `unlock_quest`, `complete_quest`, `say`
  (`speaker`, `text`), `end_game` (`ending` → `GameData.endings`).
- **Condition** : `flag`, `var`/`counter`/`item_qty` (`cmp: { eq?, gte?, lte?, gt?, lt? }`),
  `has_item`, `ever_had_item`, `quest` (`state`), `all`/`any` (`conditions`), `not`
  (`condition`).
- Hotspot : `actions: Record<verbe, { label, script }>` et `use: { byItem, default } | null`.
- Sortie : `condition` (← `if`), `script` (← `do`), `else` ; `id` toujours rempli.
- Nœud : `lines: { speaker, text }[]` (locuteur résolu), `choices[].condition` (← `if`),
  `free_text: { intents, fallback, threshold, placeholder } | null` (fallback par défaut :
  `{ next: <ce nœud>, effects: [] }`), `on_give`/`on_show: { byItem, default } | null`
  de `Transition = { effects, next }`.
- Personnage : `identity` toujours présent (forme simple remontée dedans), `persona` ou null.
- Monde : `refuse_line` toujours renseignée. Objet : `scope: string[] | null` (null = partout).
- `GameData.intents` contient toujours `give_item` et `show_item` (`reserved: true`).
- Chaque entité de premier niveau porte `source` (fichier relatif à `content/`).

Utilitaires : `forEachStep`, `forEachCondition`, `visitScripts`, `visitSteps`,
`visitConditions`, `findCombination`, `displayFace`, `counterTitle`.

---

## 16. Versions et migrations

- `formatVersion` (dans `game.yaml`, `scroum.project.yaml`, `game.json` et
  `manifest.json`) vaut la version du format. SCROUM refuse proprement un contenu
  d'une version plus récente.
- Toute évolution du format incrémente `FORMAT_VERSION`, met à jour ce document et
  fournit une migration (`MIGRATIONS[n]` : version n → n+1) appliquée par `migrate()`.

Historique :

| Version | Changements |
|---|---|
| 1 | Version initiale. |

---

## 17. Aide-mémoire pour Claude Code

- Lire `bible/tone.md` et les éléments `validated` avant d'écrire ; **ne jamais
  modifier un élément `validated`** sans demande explicite ; marquer ce qu'on crée
  `status: draft` (ou `review` pour demander une relecture).
- Ids en `snake_case` ASCII ; nom de fichier = id pour personnages, scènes, dialogues.
- Un nouvel objet doit être **obtenable** (un `give_item` ou une combinaison) et
  **utile** (un `use`, un `on_give`/`on_show`, une combinaison ou une condition).
- Un hotspot ramassable : `take` + `give_item` + `visible_if: { not: { ever_had_item: … } }`.
- Un texte de première visite : `if: { not: { flag: … } }` + `set` du même drapeau.
- Ne pas déclarer `give_item`/`show_item` dans `intents.yaml` ni dans `free_text`.
- Chaque intention utilisée dans `free_text` ou un choix doit exister dans `intents.yaml`.
- Chaque asset référencé doit être déclaré dans `assets/assets.yaml` (l'image peut
  manquer).
- Rectangles en coordonnées normalisées `[x, y, w, h]`, dans l'image 16:9.
- Terminer par `pnpm scroum validate` : **zéro erreur** exigée ; lire les
  avertissements (orphelins, drapeaux jamais levés).
