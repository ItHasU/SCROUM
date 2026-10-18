/**
 * @scroum/validate — validation d'un contenu SCROUM.
 *
 * Niveaux : chargement (YAML + schéma zod, via `@scroum/schema`) → règles du
 * jeu (`game.yaml → validation`) → cohérence des références → jouabilité.
 *
 * Point d'extension : un `Analyzer` de niveau `playability` (analyse BFS sur
 * le moteur, §6.4) se branche via `validateContent(files, { extraAnalyzers: [...] })`
 * ou en l'ajoutant à `defaultAnalyzers`.
 *
 * Les accès disque sont dans `@scroum/validate/node`.
 */
export * from './types';
export * from './validate';
export * from './analyzers';
