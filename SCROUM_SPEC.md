# SCROUM — Spécification du moteur et de l'éditeur

> **SCROUM** : *Système de Conversation et de Rencontres Opérationnel Un peu Minable*, en hommage ringard aux moteurs AGI, SCI et SCUMM.
> Moteur générique d'aventure point-and-click à dialogues semi-scriptés, avec son éditeur assisté par Claude Code.
> Ce document est la référence du dépôt `scroum`. Le référencer depuis `CLAUDE.md`.
> Le premier jeu, **Boris**, vit dans un dépôt séparé (voir `BORIS_SPEC.md` dans ce dépôt-là).

---

## 1. Vue d'ensemble

| Produit | Rôle | Exécution |
|---|---|---|
| **Moteur / Player** | Charger un `.scroum.zip` et le faire jouer (scripts, choix, texte libre, mini LLM optionnel) | Page 100 % statique, déployée sur GitHub Pages, mobile-first |
| **Éditeur** | Ouvrir un **dépôt de jeu**, éditer son contenu avec l'aide de Claude Code, générer les images, valider la jouabilité, exporter le zip | Serveur Node local + front web, sur la machine de dev |
| **CLI** | `scroum edit / validate / build / gen-image`, utilisée par l'humain, par Claude Code et par la CI des dépôts de jeu | Node |

**Principes directeurs.** Le moteur ne connaît aucun jeu en particulier : tout ce qui est propre à un jeu (noms des compteurs, rôles de personnages, mondes, skins, règles de validation éditoriales) est déclaré par le jeu. La source de vérité d'un jeu est un **dossier de fichiers texte** dans son propre dépôt, lisible et modifiable à la fois par l'humain, l'éditeur et Claude Code ; le zip n'est qu'un artefact de build.

**Séparation des dépôts.**

| Dépôt | Contenu | Publication |
|---|---|---|
| `scroum` | Moteur, player, éditeur, CLI, schéma du format, workflows ComfyUI génériques, jeu de démo | Player sur GitHub Pages (`https://<user>.github.io/scroum/`), packages `@scroum/*` |
| `<jeu>` (ex. `boris`) | Contenu du jeu, workflows propres au jeu, config projet | Zip publié sur le GitHub Pages du dépôt de jeu |

---

## 2. Architecture du dépôt `scroum`

Monorepo **pnpm workspaces**, TypeScript partout, **vanilla** côté front (pas de framework UI), Vite pour le bundling.

```
scroum/
├── CLAUDE.md
├── SCROUM_SPEC.md
├── packages/
│   ├── schema/        # @scroum/schema — types + schémas zod, formatVersion, migrations
│   ├── engine/        # @scroum/engine — machine à états du jeu (TS pur, sans DOM)
│   ├── ui/            # @scroum/ui — rendu DOM/canvas mobile
│   ├── validate/      # @scroum/validate — validation de schéma + analyse de jouabilité
│   └── cli/           # @scroum/cli — binaire `scroum` (edit, validate, build, gen-image)
├── apps/
│   ├── player/        # page statique GitHub Pages (engine + ui)
│   └── editor/
│       ├── server/    # Node : API, SSE, watch, build, images, Claude Code
│       └── web/       # front de l'éditeur
├── workflows/         # workflows ComfyUI génériques (format API, placeholders)
├── docs/
│   └── FORMAT.md      # référence du format de contenu, livrée avec @scroum/cli
└── examples/
    └── demo/          # mini-jeu neutre servant aux tests et au développement du moteur
```

Le développement du moteur se fait **sur `examples/demo`**, jamais sur un vrai jeu. La démo doit couvrir chaque fonctionnalité du format (au moins une énigme par type d'obtention d'objet, un dialogue à texte libre, un soft-lock volontaire dans une variante de test).

**Dépendances pressenties** : `zod`, `fflate` (zip, navigateur et Node), `chokidar`, `sharp`, `cytoscape` + `cytoscape-elk`, `yaml`. LLM navigateur : `@wllama/wllama` (CPU/WASM) et/ou `@mlc-ai/web-llm` (WebGPU).

**Consommation par un dépôt de jeu.** Le dépôt de jeu déclare `@scroum/cli` en devDependency (dépendance Git sur une version taguée, ou `pnpm link` en développement simultané des deux dépôts). Il dispose ainsi de `pnpm scroum edit`, `validate`, `build` et `gen-image`.

---

## 3. Dépôt de jeu attendu

```
<jeu>/
├── CLAUDE.md                  # conventions du jeu + pointeur vers docs/FORMAT.md de SCROUM
├── scroum.project.yaml        # formatVersion, nom de sortie, workflows, config éditeur
├── scroum.local.yaml          # (gitignoré) URL ComfyUI, chemins locaux
├── content/                   # le jeu (voir §4)
├── workflows/                 # workflows ComfyUI propres au jeu (surchargent les génériques)
└── dist/                      # (gitignoré) zips produits
```

---

## 4. Format de contenu (`content/`)

Les exemples ci-dessous sont tirés de Boris à titre d'illustration ; rien de ce qu'ils nomment n'est codé en dur dans le moteur.

### 4.1 Arborescence

```
content/
├── game.yaml                  # méta, scène de départ, compteurs, rôles, règles de validation
├── bible/                     # éléments fondateurs, à valider avant génération
│   ├── pitch.md
│   ├── tone.md                # ton et ligne éditoriale (injectés dans le prompt Claude)
│   ├── style.md               # direction artistique, prompts de base par monde
│   ├── worlds.yaml            # mondes, avec leur skin d'interface
│   ├── gags.yaml
│   └── quests.yaml
├── characters/<id>.yaml
├── scenes/<id>.yaml
├── dialogues/<id>.yaml
├── intents.yaml
├── items.yaml
└── assets/
    ├── images/<assetId>.webp  # images retenues
    ├── _candidates/<assetId>/ # propositions générées (non exportées)
    └── assets.yaml            # registre : prompt, seed, workflow, références, statut
```

### 4.2 `game.yaml`

```yaml
title: "Boris"
version: 0.1.0
formatVersion: 1
start_scene: appart_boris
counters:                      # compteurs génériques, nommés par le jeu
  points:   { label: "Points", hud: true }
  honte:    { label: "Mur de la honte", hud: false }
character_roles: [catfish, real_woman, npc, ai_bot]
validation:
  characters:
    require_age: true
    min_age: 18                # règle bloquante au build
```

### 4.3 Statut de validation

Tout élément de la bible, chaque personnage et chaque asset porte un champ `status` : `draft` → `review` → `validated` (ou `rejected`). Claude Code **ne modifie jamais** un élément `validated` sans demande explicite, et s'appuie sur les éléments validés pour générer la suite.

### 4.4 Personnage

Un personnage peut avoir une **double identité** optionnelle : `persona` (ce qu'on voit dans un monde) et `identity` (la vraie personne, révélée plus tard). Le moteur sait afficher l'une ou l'autre selon un flag de révélation.

```yaml
id: lea_elfe
status: draft
role: catfish                  # parmi game.yaml → character_roles
age: 34
persona:
  name: "Léandra des Brumes"
  world: royaumes_azerine
  description: "Elfe archère, mystérieuse, poétique"
  avatar: img_lea_avatar
identity:
  name: "Jean-Michel"
  description: "Comptable, vit avec sa mère et trois chats"
  portrait: img_jm_real
revealed_by: { flag: rdv_jm_fait }
motivation: "Se sent enfin écouté quand il joue une elfe"
voice: "Phrases fleuries, abuse des points de suspension, dérape en langage de comptable sous le stress"
dislikes: [vulgarité, questions sur le salaire]
llm_persona_prompt: >
  Tu joues Léandra, une elfe poétique...
```

### 4.5 Scène

```yaml
id: azerine_taverne
world: royaumes_azerine
background: img_taverne_bg
music: null
on_enter:
  - if: { not: { flag: first_visit_taverne } }
    do: [ { say: narrator, text: "La taverne sent le pixel moisi." }, { set: first_visit_taverne } ]
hotspots:
  - id: barde
    label: "Barde"
    rect: [0.62, 0.40, 0.12, 0.30]     # coordonnées normalisées x,y,w,h
    actions:
      look: { say: narrator, text: "Un barde de niveau 3. Il joue faux, même en MIDI." }
      talk: { dialogue: barde_intro }
exits:
  - { to: azerine_place, label: "Sortir", rect: [0, 0.3, 0.08, 0.5] }
```

### 4.6 Dialogue (semi-scripté par intentions)

```yaml
id: lea_premier_contact
speaker: lea_elfe
start: n1
nodes:
  n1:
    lines: ["Bonsoir, voyageur... la lune est belle sur Azerine..."]
    choices:
      - { label: "Complimenter son arc", intent: compliment, next: n2 }
      - { label: "« T'habites où en vrai ? »", intent: ask_irl, next: n_fuite, effects: [ { add: { lea_trust: -2 } } ] }
    free_text:
      intents:
        compliment: n2
        joke_lourde: n_gene
        ask_irl: n_fuite
      fallback: n1_relance
  n2:
    lines: ["Oh... personne ne remarque jamais mon arc..."]
    effects: [ { add: { lea_trust: 1 } } ]
    next: n3
```

**Conditions** : `flag`, `var` (`gte`/`lte`/`eq`), `counter` (idem), `has_item`, `item_qty`, `ever_had_item`, `all`, `any`, `not`.
**Effets** : `set`, `unset`, `add` (variable), `counter` (`{ counter: points, add: 10 }`), `give_item` (`qty` optionnel), `take_item`, `reveal`, `hide`, `goto_scene`, `start_dialogue`, `unlock_quest`, `say`, `end_game`.

### 4.7 Intentions (`intents.yaml`)

Catalogue d'intentions propre au jeu, chacune avec une description, des exemples et des mots-clés. Il sert au classifieur LLM, au repli par mots-clés et à l'éditeur. Les intentions `give_item` et `show_item` sont **réservées** et fournies par le moteur.

```yaml
compliment: { desc: "Faire un compliment", examples: ["t'es jolie", "j'adore ton armure"], keywords: [jolie, belle, beau, adore] }
ask_irl:    { desc: "Proposer de se voir en vrai / demander des infos perso", examples: ["on se voit ?", "t'habites où"] }
```

### 4.8 Objets et inventaire

La progression repose sur les objets : la plupart des verrous (accéder à une scène, débloquer une réplique, réussir une rencontre) se lèvent en possédant, utilisant, combinant ou donnant un objet. On les obtient **en explorant une scène** (hotspot à ramasser, objet caché révélé par une action) ou **en discutant** (un personnage le donne, l'échange, ou le joueur l'obtient en récompense d'un dialogue réussi).

```yaml
cle_usb_neveu:
  name: "Clé USB du neveu"
  description: "Une clé USB étiquetée « NE PAS OUVRIR ». Évidemment."
  icon: img_item_cle_usb
  scope: irl                # any | <id de monde> — où l'objet peut servir
  consumable: false
  stackable: false
  look: "Boris la renifle. Elle sent le Doritos."
  combine:
    - with: ordinateur_portable
      result: null
      effects: [ { set: mot_de_passe_trouve } ]
    - with: scotch
      result: cle_usb_reparee
      consume: [cle_usb_neveu, scotch]
```

Un objet utilisé hors de son `scope` produit la réplique de refus par défaut du monde courant (déclarée dans `worlds.yaml`), sauf réaction spécifique prévue.

**Dans une scène** : action `take`, hotspot `hidden` / `visible_if`, effet `reveal` déclenché par une autre action, et action `use` indexée par objet :

```yaml
  - id: tiroir
    actions:
      open: { do: [ { reveal: telecommande } ] }
  - id: telecommande
    hidden: true
    visible_if: { not: { has_item: telecommande } }
    actions:
      take: { do: [ { give_item: telecommande } ] }
  - id: tele
    actions:
      use:
        telecommande: { do: [ { set: tele_allumee }, { goto_scene: salon_tele_on } ] }
        default: { say: boris, text: "Ça ne marche pas. Comme moi le lundi." }
```

**En dialogue** : `give_item` en effet, `has_item` en condition de choix, et réactions `on_give` / `on_show` :

```yaml
  n4:
    lines: ["Tu as quelque chose pour moi, voyageur ?"]
    on_give:
      bouquet_fane: { next: n_touchee, effects: [ { take_item: bouquet_fane }, { give_item: code_promo_kebab } ] }
      default: { next: n_refus }
    on_show:
      photo_profil_boris: { next: n_rire }
```

### 4.9 Mondes (`worlds.yaml`)

```yaml
royaumes_azerine:
  name: "Les Royaumes d'Azerine"
  ui_skin: rpg_bubbles         # skin fourni par @scroum/ui ou déclaré par le jeu
  refuse_line: "Ça ne fait rien ici."
irl:
  name: "Le Monde Réel"
  ui_skin: plain
```

Le moteur fournit quelques skins de base (`plain`, `chat_retro`, `rpg_bubbles`, `swipe_cards`) ; un jeu peut en ajouter via une feuille CSS et des gabarits HTML dans `content/skins/`.

---

## 5. Moteur et player

### 5.1 Contraintes

Page statique sans backend, **mobile-first** (portrait prioritaire, paysage supporté, cibles tactiles ≥ 44 px), installable en PWA avec service worker pour le hors-ligne une fois le jeu chargé.

### 5.2 Chargement

Trois modes : `?game=<url>` vers un zip hébergé (typiquement le GitHub Pages du dépôt de jeu, servi avec CORS ouvert, à vérifier dès M1) ; sélecteur de fichier local ; et **source directe** en dev, où le moteur lit les fichiers servis par l'éditeur. Décompression en mémoire avec fflate, vérification de `formatVersion` avec refus propre en cas d'incompatibilité.

### 5.3 Séparation logique / rendu

`@scroum/engine` est une machine à états pure, sérialisable, testable sans DOM : (état, action) → (nouvel état, événements). `@scroum/ui` consomme les événements. Sauvegardes dans IndexedDB/localStorage, encapsulées dans un try/catch, avec export/import JSON.

### 5.4 Interface

- **Scènes** : fond 16:9 en haut, zone d'interaction en bas en portrait. Un tap sur un hotspot ouvre un menu contextuel limité aux verbes qu'il définit ; l'utilisation d'un objet passe par l'inventaire (§5.6).
- **Dialogues** : rendus avec le `ui_skin` du monde courant, ce qui permet des interfaces **diégétiques** (fenêtre de chat, bulle de RPG, cartes de profil…).
- **Saisie** : choix proposés plus champ de texte libre quand le nœud a un `free_text`.
- **HUD** : compteurs déclarés `hud: true`, inventaire, menu, journal des quêtes.

### 5.5 Mini LLM

**Règle absolue : le LLM ne modifie jamais l'état du jeu.** Toute transition est décidée par le script. Deux rôles, chacun désactivable :

1. **Classifieur d'intention** : texte libre + intentions autorisées dans le nœud + inventaire → `{ "intent", "confidence", "item"? }` en JSON contraint (grammaire GBNF avec wllama, ou JSON mode). Sous le seuil, on passe au `fallback`. Pour `give_item`/`show_item`, le moteur vérifie la présence de l'objet ; s'il manque, réplique de refus, jamais d'effet.
2. **Reformulateur** : réécrit la réplique scriptée dans la voix du personnage (`voice`, `llm_persona_prompt`), longueur bornée, sans ajout d'information. Repli sur la réplique scriptée en cas d'échec ou de délai dépassé.

Interface `LlmBackend { classify(), rephrase() }`, trois implémentations : `KeywordBackend` (par défaut, sans téléchargement), `WllamaBackend` (GGUF de 0,5 à 1,5 milliard de paramètres, téléchargé à la demande, mis en cache via la Cache API), `RemoteBackend` optionnel (endpoint compatible OpenAI). L'activation est proposée au joueur avec la taille affichée. Un jeu est **entièrement jouable sans LLM**.

### 5.6 Inventaire

L'inventaire fait partie de l'état sérialisé (objets, quantités, historique `ever_had`). Sur mobile, il s'ouvre dans un tiroir en bas d'écran depuis le HUD. Un tap décrit l'objet, un appui long le **sélectionne** : un tap sur un hotspot déclenche alors `use`, sur un personnage en conversation `on_give` ou `on_show` (choix « Donner / Montrer »), sur un autre objet `combine`. Chaque acquisition est signalée par une animation vers le tiroir et une ligne de journal. Une option d'accessibilité surligne brièvement les hotspots pour éviter la chasse au pixel.

---

## 6. Éditeur

### 6.1 Lancement

`pnpm scroum edit` depuis la racine d'un dépôt de jeu (ou `scroum edit <chemin>`). Le serveur lit `scroum.project.yaml` et `scroum.local.yaml`, et n'écoute que sur `localhost`.

### 6.2 Serveur

- **API REST** : CRUD sur `content/`, validation zod à chaque écriture.
- **SSE `/events`** : chokidar surveille `content/` et pousse les changements au front, y compris ceux de Claude Code.
- **Build** : validation complète, conversion d'images (sharp → webp, tailles cibles), exclusion de `_candidates/`, écriture de `manifest.json`, production de `dist/<nom>-<version>.scroum.zip`.
- **Playtest** : sert `content/` au player en mode source directe.
- **Images** : pilotage de ComfyUI (§7).
- **Claude Code** : lance `claude -p "<demande>" --output-format stream-json` avec `cwd` = **racine du dépôt de jeu**, et relaie le flux. Le prompt système ajouté contient le chemin de `docs/FORMAT.md`, le contenu de `bible/tone.md`, la liste des éléments `validated` et l'élément sélectionné dans l'éditeur.

### 6.3 Front

1. **Bible** : pitch, ton, style, mondes, gags, quêtes, personnages, avec statut et tableau de bord de ce qui reste à valider.
2. **Graphe** (vue centrale, Cytoscape + ELK) : scènes, dialogues dépliables, quêtes, objets ; arêtes de sorties, choix, intentions, conditions, « objet obtenu ici » / « objet requis là ». Code couleur par monde et statut, orphelins en évidence, « Jouer depuis ici » avec état forgé.
3. **Inspecteur** : édition des répliques, choix, conditions et effets (formulaire + YAML brut).
4. **Panneau Claude** : demande contextualisée, flux en direct, liste des fichiers modifiés avec diff et annulation (`git checkout` sur les fichiers touchés).
5. **Atelier d'images** : prompt, références, workflow ; N candidats en grille, sélection, retouche, variante à partir d'un candidat, comparaison côte à côte de deux assets liés (ex. `persona.avatar` / `identity.portrait`), validation qui copie dans `assets/images/`.
6. **Objets** : pour chaque objet, où on l'obtient et où il sert.
7. **Playtest** : player en iframe, debug (flags, variables, compteurs, inventaire modifiable, nœud courant, intention et confiance).

### 6.4 Validation de la jouabilité (`scroum validate`)

- **Schéma** et **règles du jeu** déclarées dans `game.yaml → validation` (ex. âge requis et minimal), bloquantes au build.
- **Cohérence** : toute référence (scène, dialogue, objet, asset, intention) existe ; tout objet défini est obtenable.
- **Atteignabilité** : exploration en largeur sur un état abstrait (scène, flags, compteurs, inventaire) depuis `start_scene` ; la fin doit être atteignable, et les scènes, nœuds et objets jamais atteints sont signalés.
- **Blocages** : détection des *soft-locks* (consommable requis deux fois mais obtenable une fois, objet obtenable seulement après le point où il est indispensable, don irréversible fermant la seule voie), avec le chemin qui y mène, rejouable dans le playtest.

L'exploration est bornée (profondeur, nombre d'états) ; au-delà, le rapport le dit au lieu de conclure.

---

## 7. Génération d'images

### 7.1 Abstraction

```ts
interface ImageProvider {
  generate(req: { prompt: string; negative?: string; width: number; height: number; seed?: number; workflow: string; params?: Record<string, unknown> }): Promise<Candidate[]>;
  edit(req: { references: string[]; instruction: string; workflow: string; seed?: number }): Promise<Candidate[]>;
}
```

Implémentation **`ComfyUIProvider`** : `POST /upload/image` pour les références, `POST /prompt` avec un workflow au format API, `ws /ws` pour la progression, `GET /history/<id>` puis `GET /view`. Les workflows sont des JSON à placeholders (`{{prompt}}`, `{{seed}}`, `{{ref_image_1}}`…), cherchés d'abord dans `workflows/` du dépôt de jeu, puis dans les génériques de SCROUM. L'URL de ComfyUI est dans `scroum.local.yaml`.

### 7.2 Workflows génériques

| Workflow | Usage |
|---|---|
| `bg` | Décor de scène |
| `char_sheet` | Planche de référence d'un personnage |
| `char_edit` | Variation à partir d'une référence (Qwen Image Edit) : pose, expression, tenue |
| `transform` | Même cadrage et même pose, sujet transformé selon une instruction |
| `remove_bg` | Détourage de sprites (BiRefNet ou équivalent) |
| `item_icon` | Icône d'objet carrée, fond transparent |

### 7.3 Post-traitement et traçabilité

`bible/style.md` fournit préfixe et suffixe de prompt par monde, palette et négatif commun. Sharp gère redimensionnement, webp, et en option quantification de palette ou pixelisation par monde. Chaque asset garde dans `assets.yaml` prompt, seed, workflow, références et modèle.

### 7.4 Accès pour Claude Code

`pnpm scroum gen-image --asset <id> [--n 4] [--prompt "..."]` passe par le serveur de l'éditeur et dépose les candidats dans `_candidates/`. Claude Code **propose** des candidats mais ne **valide jamais** un asset. Évolution possible : exposer ces fonctions en serveur MCP.

---

## 8. Publication

- **Player** : GitHub Actions du dépôt `scroum` → build de `apps/player` → GitHub Pages.
- **Jeux** : chaque dépôt de jeu a sa propre action qui lance `scroum validate` puis `scroum build`, publie le zip sur son GitHub Pages, et une petite page d'accueil qui redirige vers `https://<user>.github.io/scroum/?game=<url du zip>`.

---

## 9. Feuille de route

| Jalon | Contenu | Critère de fin |
|---|---|---|
| **M0** | Monorepo, `@scroum/schema`, `docs/FORMAT.md`, `examples/demo`, `scroum validate` (schéma) | Validation de la démo au vert |
| **M1** | Moteur + player : scènes, hotspots, dialogues à choix, flags, compteurs, inventaire complet, sauvegarde, chargement de zip | Démo jouable sur mobile depuis GitHub Pages, chargée par `?game=` depuis un autre dépôt |
| **M1b** | Validation de jouabilité (§6.4) | Un soft-lock volontaire de la démo est détecté avec son chemin |
| **M2** | Serveur éditeur, `scroum edit`, SSE, build zip, playtest direct | Une modification sur disque apparaît dans le playtest sans recharger |
| **M3** | Front éditeur : bible, graphe, inspecteur, vue objets | Navigation complète de la démo dans le graphe |
| **M4** | Panneau Claude Code | Une demande en langage naturel produit un dialogue valide dans le dépôt de jeu |
| **M5** | Images : ComfyUIProvider, workflows, atelier, post-traitement | Personnage avec deux variantes cohérentes produit depuis l'éditeur |
| **M6** | Texte libre : KeywordBackend, puis WllamaBackend | Dialogue en texte libre jouable avec et sans LLM |
| **M7** | Skins diégétiques, PWA, polish | — |

---

## 10. Questions ouvertes

1. **Machine ComfyUI** : URL/port, modèles installés (Qwen Image / Qwen Image Edit quantifiés, Z-Image), nœuds custom.
2. **Modèle LLM navigateur** : choix après benchmark iPhone et Android milieu de gamme (classification visée < 1,5 s).
3. Résolution cible des décors et poids maximal recommandé d'un zip.
4. Audio : hors périmètre pour l'instant.
5. Distribution de `@scroum/cli` : dépendance Git taguée ou registre npm.

---

## 11. Conventions pour Claude Code (dépôt `scroum`)

- TypeScript strict, ESM, vanilla DOM côté front. Pas de framework UI sans accord.
- Aucun contenu propre à un jeu dans ce dépôt, hormis `examples/demo`.
- Toute évolution du format incrémente `formatVersion`, met à jour `docs/FORMAT.md` et fournit une migration.
- Tests Vitest sur `@scroum/engine` et `@scroum/validate` pour chaque condition, effet et cas de blocage.
- Commits atomiques, messages en français, un jalon par branche.
