/** Contexte partagé entre les vues DOM du player. */
import type { Id } from '@scroum/schema';
import type { AssetResolver } from '../assets';
import type { AssistantManager } from '../backends';
import type { GameController } from '../controller';
import type { PlayerSettings, SaveStore } from '../storage';
import { h } from './h';
import { hueOf, initials } from '../labels';

export type ModalKind = 'menu' | 'saves' | 'quests' | 'gallery' | 'settings' | 'item' | 'confirm_new';

/** État purement visuel (non sauvegardé). */
export interface UiState {
  drawerOpen: boolean;
  /** Hotspot dont le menu contextuel est ouvert. */
  hotspotMenu: Id | null;
  modal: ModalKind | null;
  /** Objet affiché dans la fiche d'objet (modal `item`). */
  itemDetail: Id | null;
  /** Brouillon du champ de texte libre (conservé entre les rendus). */
  draft: string;
  /** Surlignage temporaire des hotspots (bouton loupe). */
  flash: boolean;
  /** Message d'état temporaire (sauvegarde, import…). */
  notice: string | null;
}

export interface ViewContext {
  ctrl: GameController;
  assets: AssetResolver;
  readonly settings: PlayerSettings;
  saves: SaveStore;
  assistant: AssistantManager;
  ui: UiState;
  root: HTMLElement;
  /** Réaffiche toute l'interface. */
  render(): void;
  setSettings(patch: Partial<PlayerSettings>): void;
  openModal(kind: ModalKind | null): void;
  setDrawer(open: boolean): void;
  /** Retour à l'écran d'accueil (fourni par l'application hôte), si disponible. */
  onHome?: (() => void) | undefined;
  /** Message bref (toast). */
  toast(text: string, tone?: string): void;
}

/** Image d'asset, ou placeholder (dégradé + initiales) si absente ou en erreur. */
export function assetImage(ctx: ViewContext, assetId: Id | null | undefined, label: string, cls = 'thumb'): HTMLElement {
  const url = ctx.assets.url(assetId);
  const ph = placeholder(label, assetId ?? label, cls);
  if (!url) return ph;
  const img = h('img', { class: cls, src: url, alt: label, loading: 'lazy', draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(ph), { once: true });
  return img;
}

export function placeholder(label: string, seed: string, cls = 'thumb'): HTMLElement {
  const hue = hueOf(seed);
  return h(`div.${cls}.placeholder` as 'div', { style: { background: `linear-gradient(135deg, hsl(${hue} 45% 42%), hsl(${(hue + 50) % 360} 50% 24%))` }, 'aria-hidden': 'true' }, initials(label));
}

/** Smileys texte → émoticônes (skin `chat_retro`). */
export function smileys(text: string): string {
  const map: [RegExp, string][] = [
    [/(^|\s):-?\)/g, '$1☺'],
    [/(^|\s);-?\)/g, '$1😉'],
    [/(^|\s):-?\(/g, '$1☹'],
    [/(^|\s):-?D\b/g, '$1😄'],
    [/(^|\s):-?[pP]\b/g, '$1😛'],
    [/(^|\s):-?[oO]\b/g, '$1😮'],
    [/(^|\s)<3/g, '$1♥'],
  ];
  return map.reduce((s, [re, r]) => s.replace(re, r), text);
}
