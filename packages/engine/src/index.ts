/**
 * @scroum/engine — machine à états pure du jeu (sans DOM).
 *
 * - `createInitialState`, `start`, `step` : exécution (docs/FORMAT.md) ;
 * - `listActions` : actions jouables (UI, tests, analyse de jouabilité) ;
 * - helpers de vue (`view`) ; `KeywordBackend` (classifieur de texte libre par défaut) ;
 * - `runScenario` : harnais de scénarios de test.
 */
export * from './types';
export * from './state';
export * from './conditions';
export * from './queries';
