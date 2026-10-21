import type { ContentError, GameData, Severity } from '@scroum/schema';
import type { PlayabilityOptions, PlayabilityReport } from './playability';
import type { SegmentsReport } from './segments';

/** Un problème de validation (même forme que les erreurs de chargement). */
export type Issue = ContentError;

/** Rapport structuré de `scroum validate`. */
export interface ValidationReport {
  /** Vrai s'il n'y a aucune erreur bloquante. */
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** Jeu assemblé (null si game.yaml absent ou invalide). */
  game: GameData | null;
  /** Analyseurs non exécutés (ex. références tant que le schéma est en erreur), avec la raison. */
  skipped: { analyzer: string; reason: string }[];
  /** Rapport d'analyse de jouabilité (null si non demandée ou non exécutée). */
  playability: PlayabilityReport | null;
  /** Rapport par quête (segments) quand des quêtes ont un `checkpoint`, sinon null. */
  segments: SegmentsReport | null;
}

/** Contexte fourni aux analyseurs. */
export interface AnalyzerContext {
  /** Fichiers présents dans `content/` (chemins relatifs), pour les vérifications de présence. */
  files: ReadonlySet<string>;
  /** Signale un problème. */
  report(severity: Severity, code: string, file: string, path: string, message: string): void;
}

/**
 * Point d'extension de la validation. Les analyseurs s'exécutent dans l'ordre
 * des niveaux (`rules` → `refs` → `playability`) sur un `GameData` issu d'un
 * chargement sans erreur. L'analyse de jouabilité (BFS sur le moteur, §6.4)
 * s'enregistre comme un analyseur de niveau `playability`.
 */
export interface Analyzer {
  name: string;
  level: 'rules' | 'refs' | 'playability';
  run(game: GameData, ctx: AnalyzerContext): void;
}

export interface ValidateOptions {
  /** Remplace la liste des analyseurs (par défaut `defaultAnalyzers`). */
  analyzers?: Analyzer[];
  /** Analyseurs ajoutés à la liste (ex. l'analyse de jouabilité). */
  extraAnalyzers?: Analyzer[];
  /**
   * Analyse de jouabilité (BFS sur le moteur) : `true` (bornes par défaut) ou
   * options. Désactivée par défaut (coûteuse ; l'éditeur ne la lance pas à chaque
   * modification). Le rapport complet est dans `ValidationReport.playability`.
   */
  playability?: boolean | PlayabilityOptions;
}
