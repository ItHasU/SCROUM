# SCROUM — instructions pour Claude Code

La référence de ce dépôt est `SCROUM_SPEC.md` (lire §11 « Conventions »). Le format de contenu est documenté dans `docs/FORMAT.md`, l'architecture dans `docs/ARCHITECTURE.md`.

Commandes : `pnpm test`, `pnpm typecheck`, `pnpm scroum validate examples/demo` (avec `export PATH=$HOME/.local/bin:$PATH`).

- Monorepo pnpm, TypeScript strict, ESM, vanilla DOM côté front.
- Aucun contenu propre à un jeu ici, hormis `examples/demo`.
- Toute évolution du format : incrémenter `formatVersion`, mettre à jour `docs/FORMAT.md`, fournir une migration.
- Tests Vitest sur `@scroum/engine` et `@scroum/validate` pour chaque condition, effet et cas de blocage.
- Commits atomiques, messages en français.
