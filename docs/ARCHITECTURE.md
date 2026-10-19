# Architecture de SCROUM

Décisions d'architecture transverses (reprises du document de coordination
`DECISIONS.md`), complétées par l'état du dépôt. La spécification fonctionnelle
reste `SCROUM_SPEC.md` ; le format de contenu est décrit dans `docs/FORMAT.md`.

## Outillage

- Node ≥ 24, pnpm 12 (via corepack ; `export PATH=$HOME/.local/bin:$PATH` dans le container).
- Monorepo pnpm workspaces (`packages/*`, `apps/*`, `apps/editor/*`), TypeScript strict
  (`tsconfig.base.json`), ESM, Vitest, Vite.
- **Paquets « source-first »** : chaque `package.json` exporte directement
  `./src/index.ts` (`"exports": { ".": "./src/index.ts" }`, `"types"` idem). Aucune étape
  de build pour consommer un paquet : Vite, Vitest et tsx lisent le TypeScript.
  Les imports relatifs internes sont sans extension (`moduleResolution: Bundler`).
- **CLI exécutée via tsx** : `packages/cli/bin/scroum.js` (`#!/usr/bin/env node`)
  enregistre tsx (`register()` de `tsx/esm/api`) puis importe `../src/index.ts`. Un dépôt
  de jeu peut donc utiliser `pnpm scroum …` via un lien local sans compiler SCROUM.
- Commandes à la racine :
  - `pnpm test` — Vitest sur tout le dépôt ;
  - `pnpm typecheck` — `tsc --noEmit -p .` sur tout le dépôt ;
  - `pnpm scroum validate examples/demo` — CLI.

## Paquets

| Paquet | Rôle | État |
|---|---|---|
| `@scroum/schema` | Types canoniques, schémas zod des fichiers, normalisation, `loadContent`, `FORMAT_VERSION`, `migrate`, visiteurs | M0 ✔ |
| `@scroum/validate` | Validation niveau 1 (schéma, règles, références, obtenabilité) ; `@scroum/validate/node` pour la lecture disque ; point d'extension `Analyzer` | M0 ✔ (jouabilité : M1b) |
| `@scroum/build` | Résolution d'un dépôt de jeu (`resolveProject`) et `buildProject` (validation → images sharp/webp → zip) | M2 ✔ |
| `@scroum/cli` | Binaire `scroum` : `validate`, `build`, `edit` ✔ ; `gen-image` (message « non implémenté », M5) | M2 ✔ |
| `@scroum/engine` | Machine à états pure : `start`/`step`/`listActions`, vues, `KeywordBackend`, harnais de scénarios | M1 ✔ (logique) |
| `@scroum/ui` | Rendu DOM mobile, backends LLM navigateur | squelette (M1) |
| `@scroum/player` (`apps/player`) | Page statique GitHub Pages | squelette (M1) |
| `@scroum/editor-server` (`apps/editor/server`) | Serveur local de l'éditeur (voir ci-dessous) | M2 ✔ |
| `@scroum/editor-web` (`apps/editor/web`) | Front de l'éditeur (TS vanilla, Cytoscape + ELK) | M3 ✔ + panneau Claude (M4 front) |

Graphe de dépendances : `schema` ← `engine` ← `ui` ← `player` ; `schema` ← `validate` ← `build` ←
`cli`, `editor-server` (`cli` charge `editor-server` à la demande pour `edit`) ; `validate` dépendra de `engine` pour l'analyse de jouabilité.

## Branches

- `main` : commit initial. `dev` : branche d'intégration, chaque jalon y est fusionné
  (`merge --no-ff`). Un jalon = une branche `feat/mX-…`.
- Travail parallèle dans des worktrees git séparés (`SCROUM_workspace/wt/<nom>`).
- Pas de push sans demande. Messages de commit en français, terminés par
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Données

- `@scroum/schema` fournit les types et schémas zod de chaque fichier, la
  **normalisation** des formes abrégées en forme canonique (le moteur ne voit que la
  forme canonique), `FORMAT_VERSION` (= 1) et `migrate()`, et
  `loadContent(files: Map<chemin, string>) → { game: GameData | null, errors }` qui parse
  le YAML et assemble un objet unique `GameData` (JSON-sérialisable).
  `loadContent` ne vérifie pas les références croisées : c'est le rôle de `@scroum/validate`.
- Le zip `.scroum.zip` contient : `manifest.json` (formatVersion, title, version,
  buildDate, liste des images), `game.json` (le `GameData` canonique et validé),
  `images/<assetId>.webp` (ou png/jpg tant qu'on n'a pas d'images). Le player ne parse
  jamais de YAML.
- Mode « source directe » : le serveur de l'éditeur sert `GET /api/game.json` (compilé à
  la volée depuis `content/`), `GET /api/images/<assetId>` et un flux SSE `/events` ; le
  player recharge le `GameData` à chaque changement en conservant l'état de jeu.
- Images absentes : le player affiche un placeholder (dégradé + libellé), jamais d'erreur
  bloquante.

## Moteur (`@scroum/engine`)

- Fonctions pures : `createInitialState(game)`, `step(game, state, action) → { state, events }`,
  `listActions(game, state) → Action[]` (toutes les actions jouables dans l'état courant ;
  utilisé par l'UI, les tests et la validation de jouabilité).
- L'état est un objet JSON simple, sérialisable, canonisable (clés triées) pour le
  hachage en BFS.
- Le texte libre est classé **hors** du moteur (backend LLM asynchrone, `KeywordBackend`
  par défaut) ; le moteur reçoit une action `{ type: 'intent', intent, confidence, item? }`
  et applique seuil / fallback / vérification d'objet.
- `KeywordBackend` vit dans `@scroum/engine` (pur, testable) ; `WllamaBackend` et
  `RemoteBackend` dans `@scroum/ui`.
- `listActions(game, state, { exhaustive? })` est déterministe ; une action
  `intent` par intention autorisée (confiance 1) plus le repli `{ intent: null,
  confidence: 0 }`. `stateKey(state)` = JSON à clés triées (listes de l'état triées,
  variables nulles et quantités nulles omises), pour la déduplication en BFS.
- Harnais de scénarios (`runScenario(game, scenario)`) : actions en forme courte
  (`take caisse`, `use cle on porte`, `choose "Au revoir"`…), texte libre classé par un
  `LlmBackend`, attentes sur l'état et les événements. Scénarios de la démo :
  `packages/engine/test/scenarios/demo.ts`.
- Les tests du moteur lisent les exemples via `@scroum/schema` (`loadContent`) et
  `node:fs`, sans dépendre de `@scroum/validate` (qui dépendra du moteur).
- La sémantique d'exécution (ordre des étapes, différé de `goto_scene`/`start_dialogue`,
  `consumable`, résolution de `use`, `on_give`/`on_show`, texte libre) est **spécifiée
  dans `docs/FORMAT.md`** : le moteur doit s'y conformer.

## Validation (`@scroum/validate`)

- Niveaux : chargement (YAML + schéma zod) → règles du jeu (`game.yaml → validation`) →
  cohérence des références → jouabilité (BFS sur l'état réel du moteur via
  `listActions`/`step`, borné).
- Point d'extension : interface `Analyzer { name, level: 'rules' | 'refs' | 'playability', run(game, ctx) }`.
  L'analyse de jouabilité s'ajoute comme analyseur de niveau `playability` (dans
  `defaultAnalyzers` ou via `validateContent(files, { extraAnalyzers })`) ; elle n'est
  exécutée que si les niveaux précédents n'ont produit aucune erreur.
- Soft-lock = état non terminal depuis lequel aucune fin de type `win` n'est atteignable ;
  rapporté avec le chemin d'actions le plus court. Fixture : `examples/demo-softlock`.

## Extensions génériques du format (non prévues explicitement par la spec)

- `game.yaml → player_character` (id du personnage joué) ; `narrator` est un locuteur réservé.
- `counters.<id>.titles: [{ min, label }]` : titre affiché selon la valeur ; et
  `initial`, `min`, `max`.
- `game.yaml → collections` : galeries à débloquer. Chaque entrée :
  `{ id, title, text?, character?, images?, if: <condition> }` ; avec `character`, l'UI
  montre `persona.avatar` à côté de `identity.portrait`.
- `end_game: { ending: <id>, type: win | game_over, text }` ; `game.yaml → endings`
  optionnel pour les décrire (les fins en ligne y sont remontées).
- Quêtes : `bible/quests.yaml`, effet `unlock_quest`, et `complete_quest` ajouté ;
  condition `quest` (`unlocked` / `active` / `completed`) ; journal des quêtes dans le HUD.

Ajouts du jalon M0 (choix d'implémentation, documentés dans `docs/FORMAT.md`) :

- `game.yaml → initial` (drapeaux, variables, inventaire, quêtes de départ) et
  `refuse_line` par défaut.
- Comparateurs `gt` / `lt` en plus de `gte` / `lte` / `eq`.
- Sorties : `id` (défaut `exit_<to>`), `hidden`, `visible_if`, `if` / `else`, `do`.
- Hotspots : `image`, `character`, `label` de verbe personnalisé.
- Nœuds de dialogue : `speaker` par nœud, lignes `{ speaker, text }`,
  `free_text.threshold` et `placeholder`.
- `notes` accepté partout ; clés inconnues refusées.

## Zip et build (M2)

- `@scroum/schema/zip` : `writeGameZip(game, images)` et `readGameZip(bytes) → { manifest, game, images: Map<assetId, Uint8Array> }`
  (navigateur + Node, fflate). `readGameZip` lève `FormatVersionError` si `formatVersion` est plus récent que le moteur
  (ou sans migration), `GameZipError` si l'archive est illisible/incomplète ; un format plus ancien est migré.
- `manifest.json` : `{ formatVersion, title, version, buildDate, images: [{ id, file }] }`. Dans `game.json`,
  `assets.<id>.file` est réécrit en `images/<id>.<ext>` pour les images embarquées.
- `scroum build` : validation complète (échec = aucun zip) → images `content/assets/images/*` converties par sharp au
  format `images.format` (webp) et limitées à `images.max_width` (1280) de `scroum.project.yaml` ; sans sharp, copie brute et
  avertissement ; `_candidates/` jamais embarqué ; sortie `<output>/<name>-<version>.scroum.zip`.

## Serveur de l'éditeur (M2)

`scroum edit [chemin] [--port N] [--host H]` → `startEditorServer({ project, port, host })`. `http` natif, écoute sur
`127.0.0.1` (port : `--port`, puis `editor.port`, défaut **5317**) ; en loopback, les en-têtes `Host`/`Origin` étrangers
sont refusés (403). Corps JSON pour les écritures. Routes :

| Route | Rôle |
|---|---|
| `GET /api/project` | `{ name, root, contentDir, config, notes, git, playerAvailable }` |
| `GET /api/files` | `{ files: [{ path, size, kind }] }` (chemins relatifs à `content/`) |
| `GET /api/files/<chemin>` | `{ path, content }` (texte) ou octets (images) ; 404 si absent |
| `PUT /api/files/<chemin>` | corps `{ content }` ; validation du fichier (YAML + zod) : 200 `{ ok, errors: [], warnings }` ou **422** `{ ok: false, errors }` sans écriture. Image : corps binaire (content-type ≠ JSON) |
| `DELETE /api/files/<chemin>` | supprime |
| `GET /api/game.json` | `GameData` compilé à la volée ; 422 `{ errors }` si le contenu ne se charge pas |
| `GET /api/validate` | `{ ok, errors, warnings, skipped, title }` |
| `GET /api/images/<assetId>` | image retenue (`assets/images/<id>.{webp,png,jpg,jpeg}`) |
| `GET /events` | SSE : `{type:'hello'}`, puis `{type:'change', files:[…]}` (chokidar, debounce 120 ms, y compris les écritures de Claude Code) |
| `POST /api/build` | `{ ok, zip, manifest, warnings }` ou 422 `{ ok:false, errors }` |
| `POST /api/claude` | corps `{ prompt, selected?: { kind, id, file } }` ; réponse SSE : `{type:'claude', event}` (une ligne stream-json), puis `{type:'done', code, files, git, error?, stderr?}` ; `files` = fichiers modifiés (relatifs à la racine du dépôt, via instantané `git status`+empreinte avant/après), `null` hors dépôt git. Une demande à la fois (409) |
| `POST /api/claude/revert` | corps `{ files }` : `git checkout HEAD -- f` (fichiers suivis) ou suppression (fichiers créés par Claude) |
| `GET /api/diff?file=` | `{ file, diff }` (diff git ; fichier non suivi : diff contre /dev/null) |
| `POST /api/gen-image` | 501 « génération d'images non implémentée (M5) » |
| `/play/…` | player : Vite `middlewareMode` sur `apps/player` (base `/play/`) si `apps/player/index.html` existe, sinon page 503 « Player non disponible » ; ouvrir `/play/?source=/api` |
| `/` | front de l'éditeur (`apps/editor/web`, TS vanilla) servi par Vite en `middlewareMode` (sans HMR ; pas d'étape de build) ; l'option `webDir` sert un dossier statique à la place (tests) |

Claude Code : `claude -p "<demande>" --output-format stream-json --verbose --append-system-prompt "<…>" --permission-mode acceptEdits`,
`cwd` = racine du dépôt de jeu. Le prompt système contient le chemin absolu de `docs/FORMAT.md`, `content/bible/tone.md`,
les éléments `status: validated` et l'élément sélectionné. Commande configurable : option `claudeCommand`, sinon `$SCROUM_CLAUDE_BIN`,
sinon `claude.command` de `scroum.local.yaml` (`claude.permission_mode` pour le mode de permission, vide = aucun), sinon `claude`.

## Front de l'éditeur (M3)

`apps/editor/web` : TypeScript strict sans framework. `src/model/` contient la logique pure testée (graphe, table des
objets, résumé de la bible, changement de statut dans le YAML, champs de formulaire, protocole playtest, flux Claude) ;
`src/ui/` les vues (Bible, Graphe, Objets, Fichiers, Playtest, Claude), l'inspecteur et le rapport de validation ;
`src/store.ts` l'état global (rechargement de `/api/game.json` + `/api/validate` à chaque événement SSE `change`).
Le test `src/app.test.ts` lance `scroum edit` sur une copie de `examples/demo` et pilote le front dans jsdom.

## Protocole playtest

L'éditeur (`/`) embarque le player dans une iframe `/play/?source=/api[&scene=<id>]` et dialogue avec lui par
`postMessage`. Les deux côtés **n'acceptent que les messages de même origine** (`event.origin === location.origin`)
et, côté éditeur, dont `event.source` est l'iframe. Tout message est un objet avec une clé `scroum` (type). Le côté
éditeur est implémenté dans `apps/editor/web/src/model/protocol.ts` (types + validation) et `ui/playtest.ts`.

**Paramètres d'URL du player** (en plus de `source`) : `scene=<id>` démarre une nouvelle partie directement dans cette
scène (état initial du jeu, `state.scene = <id>`, `on_enter` exécuté) au lieu de `meta.start_scene`. Ignoré si la scène n'existe pas.

**player → éditeur** (`window.parent.postMessage(msg, location.origin)`, seulement si `window.parent !== window`) :

| Message | Quand |
|---|---|
| `{ scroum: 'ready', version: 1 }` | une fois le jeu chargé et la première partie démarrée |
| `{ scroum: 'state', state, lastEvents, intent? }` | **après chaque action** du joueur (et après le démarrage, un `set_state` ou un `restart`) |

- `state` : le `GameState` du moteur tel quel (JSON). L'éditeur lit `scene`, `flags` (liste), `vars`, `counters`,
  `inventory` (objet → quantité), `dialogue` (`{ id, node, … }` ou `null`), `ending`, `quests` ; il renvoie l'objet
  entier (champs inconnus compris) dans `set_state`.
- `lastEvents` : les `EngineEvent` produits par la dernière action (`StepResult.events`), pour le journal de debug.
- `intent` (optionnel, uniquement après une saisie de texte libre) :
  `{ text?: string, intent: Id | null, confidence: number, threshold?: number, accepted?: boolean }` — résultat du classifieur
  (`intent: null` si aucune intention) et si le moteur l'a retenue (seuil atteint).

**éditeur → player** (`iframe.contentWindow.postMessage(msg, location.origin)`) :

| Message | Effet attendu |
|---|---|
| `{ scroum: 'set_state', state }` | le player **remplace l'état du moteur** par `state` (sans relancer la partie ni vider le journal), réaffiche la scène/le dialogue courant, puis renvoie un message `state`. Sert à éditer inventaire, drapeaux, etc. depuis le panneau de debug. |
| `{ scroum: 'restart', scene? }` | nouvelle partie (`createInitialState`), dans `scene` si fournie, sinon la scène de départ ; puis renvoie un message `state`. |

Le player doit ignorer silencieusement tout message inconnu. Le rechargement de contenu (SSE `/events`) ne
déclenche aucun message : le player conserve son état et renvoie un `state` s'il l'a modifié.
