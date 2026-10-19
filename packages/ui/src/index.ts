/**
 * @scroum/ui — rendu DOM mobile (vanilla) consommant les événements du moteur.
 *
 * - `GameController` : état + dispatch + journal (sans DOM, testable) ;
 * - `PlayerView` / `createPlayer` : vues DOM (scène, dialogues skinnés, HUD,
 *   inventaire, menus, fin) ;
 * - sauvegardes et réglages (`storage`) ;
 * - backends LLM navigateur : `RemoteBackend`, `WllamaBackend`, `AssistantManager`.
 *
 * Styles : importer `@scroum/ui/style.css` (base + skins intégrés).
 */
export * from './controller';
export * from './log';
export * from './labels';
export * from './assets';
export * from './storage';
export * from './backends';
export { PlayerView, createPlayer, type PlayerViewOptions, type CreatePlayerOptions } from './dom/view';
export type { ViewContext, UiState, ModalKind } from './dom/context';
export { h } from './dom/h';
