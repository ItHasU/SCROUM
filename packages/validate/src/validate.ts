import { loadContent, normalizePath, type ContentFiles, type GameData, type Severity } from '@scroum/schema';
import { defaultAnalyzers } from './analyzers';
import { createPlayabilityAnalyzer, type PlayabilityReport } from './playability';
import type { Analyzer, AnalyzerContext, Issue, ValidateOptions, ValidationReport } from './types';

const LEVELS: Analyzer['level'][] = ['rules', 'refs', 'playability'];

/**
 * Exécute les analyseurs sur un jeu déjà chargé sans erreur.
 * Ordre : niveau `rules`, puis `refs`, puis `playability` ; ce dernier n'est
 * exécuté que si les niveaux précédents n'ont produit aucune erreur.
 */
export function validateGame(game: GameData, options: ValidateOptions = {}, files: Iterable<string> = []): ValidationReport {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const skipped: ValidationReport['skipped'] = [];
  const ctx: AnalyzerContext = {
    files: new Set([...files].map(normalizePath)),
    report(severity: Severity, code, file, path, message) {
      (severity === 'error' ? errors : warnings).push({ severity, code, file, path, message });
    },
  };
  let playability: PlayabilityReport | null = null;
  const analyzers = allAnalyzers(options, (r) => (playability = r));
  for (const level of LEVELS) {
    for (const a of analyzers.filter((x) => x.level === level)) {
      if (level === 'playability' && errors.length > 0) {
        skipped.push({ analyzer: a.name, reason: 'contenu incohérent : corriger les erreurs avant l’analyse de jouabilité' });
        continue;
      }
      a.run(game, ctx);
    }
  }
  return { ok: errors.length === 0, errors, warnings, game, skipped, playability };
}

function allAnalyzers(options: ValidateOptions, onPlayability?: (r: PlayabilityReport) => void): Analyzer[] {
  const out = [...(options.analyzers ?? defaultAnalyzers), ...(options.extraAnalyzers ?? [])];
  if (options.playability) out.push(createPlayabilityAnalyzer(options.playability === true ? {} : options.playability, onPlayability));
  return out;
}

/**
 * Validation complète d'un dossier `content/` fourni en mémoire :
 * chargement (YAML + schéma), puis analyseurs. Si le chargement produit des
 * erreurs, les analyseurs ne sont pas exécutés (le jeu serait partiel).
 */
export function validateContent(files: ContentFiles, options: ValidateOptions = {}): ValidationReport {
  const { game, errors: loadIssues } = loadContent(files);
  const loadErrors = loadIssues.filter((e) => e.severity === 'error');
  const loadWarnings = loadIssues.filter((e) => e.severity === 'warning');
  const names = files instanceof Map ? [...files.keys()] : Object.keys(files);
  if (!game || loadErrors.length > 0) {
    const analyzers = allAnalyzers(options);
    return {
      ok: false,
      errors: loadErrors,
      warnings: loadWarnings,
      game,
      skipped: analyzers.map((a) => ({ analyzer: a.name, reason: 'erreurs de chargement (YAML ou schéma) à corriger d’abord' })),
      playability: null,
    };
  }
  const report = validateGame(game, options, names);
  return { ...report, warnings: [...loadWarnings, ...report.warnings] };
}
