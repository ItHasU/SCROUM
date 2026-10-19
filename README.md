# SCROUM

Moteur d'aventure point-and-click à dialogues semi-scriptés, avec son éditeur assisté par Claude Code.
Spécification : `SCROUM_SPEC.md` ; format de contenu : `docs/FORMAT.md` ; architecture : `docs/ARCHITECTURE.md`.

Prérequis : Node ≥ 24, pnpm (via corepack ; dans le container : `export PATH=$HOME/.local/bin:$PATH`).

```sh
pnpm install                          # installation
pnpm test                             # tests Vitest
pnpm typecheck                        # vérification TypeScript
pnpm scroum validate examples/demo    # valider un jeu (dépôt de jeu ou dossier content/)
pnpm scroum build examples/demo       # produit examples/demo/dist/demo-<version>.scroum.zip
pnpm scroum edit examples/demo        # éditeur local : http://127.0.0.1:5317 (--port N pour changer)
```

Le playtest est servi par l'éditeur sous `/play/?source=/api`. `pnpm scroum --help` liste les commandes.

## Jouer

**Jeux de démo en ligne** (solutions dans [`docs/DEMOS.md`](docs/DEMOS.md)) :
- [Le Phare de Kerbrume](https://ithasu.github.io/SCROUM/?game=games/demo.scroum.zip)
- [Démo soft-lock](https://ithasu.github.io/SCROUM/?game=games/demo-softlock.scroum.zip)

- **Depuis l'éditeur** (source directe, rechargement à chaud) : `pnpm scroum edit examples/demo`, puis ouvrir
  http://127.0.0.1:5317/play/?source=/api (`&scene=<id>` pour démarrer dans une scène).
- **Player seul** : `pnpm --filter @scroum/player dev` (ou `build` → `apps/player/dist`, statique, base relative), puis
  ouvrir la page avec `?game=<url d'un .scroum.zip>` (serveur avec CORS ouvert, ex. GitHub Pages) ou choisir un fichier
  local `.scroum.zip` depuis l'écran d'accueil (`pnpm scroum build examples/demo` en produit un).
- Commandes : tap sur un élément → menu de verbes ; 🎒 Inventaire : tap = examiner, appui long / « En main » = sélectionner
  (puis tap sur un élément = utiliser, sur un autre objet = combiner, en dialogue = Donner / Montrer) ; ☰ : sauvegardes
  (3 emplacements + auto, export/import JSON), quêtes, galerie, réglages (surlignage des zones, Assistant IA).
- E2E : `pnpm --filter @scroum/player e2e` (Chromium via `pnpm exec playwright install chromium` ; dans le container,
  les bibliothèques système manquantes sont extraites dans `~/.cache/pw-libs` → `LD_LIBRARY_PATH=$HOME/.cache/pw-libs/root/usr/lib/x86_64-linux-gnu`).
