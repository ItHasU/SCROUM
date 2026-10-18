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
| `@scroum/cli` | Binaire `scroum` : `validate` ✔ ; `build`, `edit`, `gen-image` à venir | M0 partiel |
| `@scroum/engine` | Machine à états pure | squelette (M1) |
| `@scroum/ui` | Rendu DOM mobile, backends LLM navigateur | squelette (M1) |
| `@scroum/player` (`apps/player`) | Page statique GitHub Pages | squelette (M1) |
| `@scroum/editor-server` (`apps/editor/server`) | Serveur local de l'éditeur | squelette (M2) |
| `@scroum/editor-web` (`apps/editor/web`) | Front de l'éditeur | squelette (M3) |

Graphe de dépendances : `schema` ← `engine` ← `ui` ← `player` ; `schema` ← `validate` ←
`cli`, `editor-server` ; `validate` dépendra de `engine` pour l'analyse de jouabilité.

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
