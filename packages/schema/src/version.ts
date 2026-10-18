/**
 * Version du format et migrations.
 *
 * Toute évolution incompatible du format incrémente `FORMAT_VERSION`, met à
 * jour docs/FORMAT.md et enregistre dans `MIGRATIONS[n]` la fonction qui fait
 * passer une donnée de la version `n` à `n + 1`.
 */

/** Version courante du format de contenu (`game.yaml → formatVersion`, `game.json`, `manifest.json`). */
export const FORMAT_VERSION = 1;

/** Fait passer une donnée de la version `n` à `n + 1`. */
export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** Registre des migrations, indexé par version de départ. Vide tant que le format est en v1. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export class FormatVersionError extends Error {
  constructor(
    message: string,
    readonly found: unknown,
    readonly expected: number = FORMAT_VERSION,
  ) {
    super(message);
    this.name = 'FormatVersionError';
  }
}

/** Lit `formatVersion` au premier niveau ou dans `meta` (forme `GameData`). */
export function readFormatVersion(data: unknown): number | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const d = data as Record<string, unknown>;
  const v = d.formatVersion ?? (d.meta as Record<string, unknown> | undefined)?.formatVersion;
  return typeof v === 'number' && Number.isInteger(v) ? v : undefined;
}

/**
 * Met à niveau une donnée versionnée (typiquement le `game.json` d'un zip,
 * ou le contenu brut de `game.yaml`) jusqu'à `FORMAT_VERSION`.
 *
 * - version absente ou invalide → `FormatVersionError` ;
 * - version plus récente que le moteur → `FormatVersionError` (refus propre) ;
 * - version plus ancienne → application successive des migrations.
 *
 * La donnée d'entrée n'est pas modifiée.
 */
export function migrate<T = unknown>(data: unknown, migrations: Readonly<Record<number, Migration>> = MIGRATIONS): T {
  const from = readFormatVersion(data);
  if (from === undefined) throw new FormatVersionError('formatVersion absent ou invalide', from);
  if (from > FORMAT_VERSION) {
    throw new FormatVersionError(
      `ce contenu est au format ${from}, ce moteur ne connaît que le format ${FORMAT_VERSION} : mettre à jour SCROUM`,
      from,
    );
  }
  let current = structuredClone(data) as Record<string, unknown>;
  for (let v = from; v < FORMAT_VERSION; v++) {
    const m = migrations[v];
    if (!m) throw new FormatVersionError(`aucune migration du format ${v} vers ${v + 1}`, from);
    current = m(current);
    if ('meta' in current && typeof current.meta === 'object' && current.meta !== null && 'formatVersion' in current.meta) {
      (current.meta as Record<string, unknown>).formatVersion = v + 1;
    }
    if ('formatVersion' in current) current.formatVersion = v + 1;
  }
  return current as T;
}
