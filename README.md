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
