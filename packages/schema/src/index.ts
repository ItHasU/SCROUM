/**
 * @scroum/schema — format de contenu SCROUM.
 *
 * - `types` : types CANONIQUES (ce que voient le moteur et l'éditeur) ;
 * - `files` : schémas zod des fichiers source, qui normalisent vers la forme canonique ;
 * - `normalize` : normalisation des formes abrégées (conditions, scripts, transitions) ;
 * - `load` : `loadContent(files)` → `{ game, errors }` ;
 * - `version` : `FORMAT_VERSION`, `migrate()` ;
 * - `visit` : parcours des scripts/conditions et utilitaires ;
 * - `project` : `scroum.project.yaml` / `scroum.local.yaml`.
 *
 * Référence auteur : docs/FORMAT.md.
 */
export * from './types';
export * from './version';
export * from './visit';
export * from './zip';
export * from './project';
export {
  ID_PATTERN,
  createNormCtx,
  normalizeCondition,
  normalizeOptionalCondition,
  normalizeScript,
  normalizeStep,
  normalizeTransition,
  normalizeVerbAction,
  normalizeItemReactions,
  normalizeHotspotActions,
  type NormCtx,
  type NormIssue,
  type Path,
  type PathSeg,
} from './normalize';
export {
  IdSchema,
  StatusSchema,
  RectSchema,
  ConditionSchema,
  ScriptSchema,
  GameFileSchema,
  WorldsFileSchema,
  QuestsFileSchema,
  GagsFileSchema,
  BibleDocFrontMatterSchema,
  CharacterFileSchema,
  SceneFileSchema,
  DialogueFileSchema,
  IntentsFileSchema,
  ItemsFileSchema,
  AssetsFileSchema,
  ASSET_KINDS,
  DEFAULT_REFUSE_LINE,
  type GameFile,
} from './files';
export {
  loadContent,
  classifyPath,
  normalizePath,
  formatPath,
  splitFrontMatter,
  emptyGameData,
  hasErrors,
  IMAGE_EXTENSIONS,
  type ContentFiles,
  type FileKind,
  type LoadResult,
} from './load';
