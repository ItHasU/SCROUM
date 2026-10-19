/** Résolution des assets (images) vers des URL affichables. */
import type { Id } from '@scroum/schema';

/** Donne l'URL d'une image d'asset, ou null (→ placeholder). */
export interface AssetResolver {
  url(assetId: Id | null | undefined): string | null;
  /** CSS d'un skin propre au jeu (`content/skins/<nom>.css`), si disponible. */
  skinCss?(name: string): Promise<string | null>;
}

/** Aucune image : placeholders partout (tests, jeux sans images). */
export const noAssets: AssetResolver = { url: () => null };
