/**
 * @scroum/validate — validation d'un contenu SCROUM.
 *
 * Niveaux : chargement (YAML + schéma zod, via `@scroum/schema`) → règles du
 * jeu (`game.yaml → validation`) → cohérence des références → jouabilité.
 *
 * Point d'extension : `Analyzer` (niveaux `rules`, `refs`, `playability`), via
 * `validateContent(files, { extraAnalyzers: [...] })`. L'analyse de jouabilité
 * (BFS sur le moteur, §6.4) est `playabilityAnalyzer` / `analyzePlayability` ;
 * `validateContent(files, { playability: true })` l'exécute et joint son rapport.
 *
 * Les accès disque sont dans `@scroum/validate/node`.
 */
export * from './types';
export * from './validate';
export * from './analyzers';
export * from './playability';
export * from './segments';
