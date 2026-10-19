/**
 * `PlayerView` : assemble les vues DOM autour d'un `GameController`.
 * `createPlayer()` construit l'ensemble (réglages, backends, sauvegardes, vue).
 */
import { BUILTIN_SKINS, type GameData } from '@scroum/schema';
import { sceneView } from '@scroum/engine';
import { noAssets, type AssetResolver } from '../assets';
import { AssistantManager } from '../backends';
import { GameController, type ControllerOptions, type ControllerUpdate } from '../controller';
import { defaultStore, gameKey, loadSettings, makeSave, saveSettings, SaveStore, type KeyValueStore, type PlayerSettings } from '../storage';
import type { ModalKind, UiState, ViewContext } from './context';
import { EndingView } from './ending';
import { flyTo, Toasts } from './fx';
import { h, replace } from './h';
import { HudView } from './hud';
import { InventoryView } from './inventory';
import { ModalView } from './modals';
import { PanelView } from './panel';
import { StageView } from './stage';

export interface PlayerViewOptions {
  root: HTMLElement;
  controller: GameController;
  assistant: AssistantManager;
  assets?: AssetResolver;
  store?: KeyValueStore;
  settings?: PlayerSettings;
  onHome?: () => void;
  /** Sauvegarde automatique après chaque action (défaut true). */
  autosave?: boolean;
}

export class PlayerView implements ViewContext {
  readonly ctrl: GameController;
  assets: AssetResolver;
  saves: SaveStore;
  readonly assistant: AssistantManager;
  readonly root: HTMLElement;
  readonly ui: UiState = { drawerOpen: false, hotspotMenu: null, modal: null, itemDetail: null, draft: '', flash: false, notice: null };
  onHome?: (() => void) | undefined;
  private _settings: PlayerSettings;
  private readonly store: KeyValueStore;
  private readonly stage: StageView;
  private readonly panel: PanelView;
  private readonly hud: HudView;
  private readonly inventory: InventoryView;
  private readonly modals: ModalView;
  private readonly ending: EndingView;
  private readonly toasts = new Toasts();
  private readonly app: HTMLElement;
  private readonly unsub: () => void;
  private readonly loadedSkins = new Set<string>();
  private readonly autosave: boolean;

  constructor(opts: PlayerViewOptions) {
    this.ctrl = opts.controller;
    this.assistant = opts.assistant;
    this.assets = opts.assets ?? noAssets;
    this.store = opts.store ?? defaultStore();
    this._settings = opts.settings ?? loadSettings(this.store);
    this.saves = new SaveStore(this.store, gameKey(this.ctrl.game));
    this.root = opts.root;
    this.onHome = opts.onHome;
    this.autosave = opts.autosave ?? true;

    this.stage = new StageView(this);
    this.panel = new PanelView(this);
    this.hud = new HudView(this, () => this.stage.flash());
    this.inventory = new InventoryView(this);
    this.modals = new ModalView(this);
    this.ending = new EndingView(this);
    this.stage.el.append(this.toasts.el);
    this.app = h('div.scroum', null, this.hud.top, this.stage.el, this.panel.el, this.hud.bottom, this.inventory.el, this.ending.el, this.modals.el);
    replace(this.root, this.app);
    this.unsub = this.ctrl.subscribe((u) => this.onUpdate(u));
    this.app.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        if (this.ui.modal) this.openModal(null);
        else if (this.ui.drawerOpen) this.setDrawer(false);
      }
    });
    this.render();
  }

  get settings(): PlayerSettings {
    return this._settings;
  }

  destroy(): void {
    this.unsub();
    replace(this.root);
  }

  private onUpdate(u: ControllerUpdate): void {
    if (u.type === 'step' || u.type === 'reset') {
      this.ui.hotspotMenu = null;
      this.ui.notice = null;
      if (u.type === 'reset') {
        this.ui.drawerOpen = false;
        this.ui.modal = null;
      }
      if (this.ctrl.state.ending) {
        this.ui.drawerOpen = false;
        if (this.ui.modal === 'item') this.ui.modal = null;
      }
      if (u.type === 'step' && u.action.type === 'combine') this.ui.modal = null;
    }
    if (u.type === 'game') this.saves = new SaveStore(this.store, gameKey(this.ctrl.game));
    this.render();
    if (u.type === 'step') {
      this.toasts.fromEvents(this.ctrl.game, u.events.filter((e) => e.type !== 'item_gained'));
      for (const e of u.events) {
        if (e.type === 'item_gained') {
          const from = this.lastTapRect();
          flyTo(this.app, `🎒 ${this.ctrl.game.items[e.item]?.name ?? e.item}`, from, this.hud.inventoryTarget());
        }
      }
      if (this.autosave && !this.ctrl.state.ending) this.saveAuto();
    }
    if (u.type === 'reset' && this.autosave && !this.ctrl.state.ending) this.saveAuto();
  }

  private lastTapRect(): DOMRect | null {
    const el = document.activeElement;
    return el instanceof HTMLElement && this.app.contains(el) ? el.getBoundingClientRect() : null;
  }

  saveAuto(): void {
    this.saves.write('auto', makeSave(this.ctrl.game, this.ctrl.state, this.ctrl.log));
  }

  render(): void {
    const scene = sceneView(this.ctrl.game, this.ctrl.state);
    const skin = scene?.skin ?? 'plain';
    this.app.className = 'scroum';
    this.app.classList.add(`skin-${skin}`);
    this.app.classList.toggle('highlight', this._settings.highlightHotspots);
    this.app.classList.toggle('in-dialogue', !!this.ctrl.state.dialogue || !!this.ctrl.lingering);
    this.app.classList.toggle('drawer-open', this.ui.drawerOpen);
    this.app.classList.toggle('ended', !!this.ctrl.state.ending);
    this.app.dataset.skin = skin;
    this.app.style.setProperty('--text-scale', String(this._settings.textScale));
    this.ensureSkin(skin);
    this.hud.render();
    this.stage.render();
    this.panel.render();
    this.inventory.render();
    this.ending.render();
    this.modals.render();
  }

  /** Charge le CSS d'un skin propre au jeu (`content/skins/<nom>.css`) une seule fois. */
  private ensureSkin(skin: string): void {
    if ((BUILTIN_SKINS as readonly string[]).includes(skin) || this.loadedSkins.has(skin) || !this.assets.skinCss) return;
    this.loadedSkins.add(skin);
    this.assets
      .skinCss(skin)
      .then((css) => {
        if (!css) return console.warn(`[scroum] skin « ${skin} » introuvable : rendu « plain »`);
        document.head.append(h('style', { 'data-scroum-skin': skin }, css));
      })
      .catch(() => undefined);
  }

  setSettings(patch: Partial<PlayerSettings>): void {
    this._settings = { ...this._settings, ...patch };
    saveSettings(this.store, this._settings);
    this.render();
  }

  openModal(kind: ModalKind | null): void {
    this.ui.modal = kind;
    this.ui.notice = null;
    if (kind) this.ui.drawerOpen = false;
    this.render();
    if (kind) this.modals.el.querySelector<HTMLElement>('.modal button')?.focus({ preventScroll: true });
  }

  setDrawer(open: boolean): void {
    this.ui.drawerOpen = open;
    this.render();
  }

  toast(text: string, tone?: string): void {
    this.toasts.show(text, tone);
  }
}

export interface CreatePlayerOptions extends Omit<PlayerViewOptions, 'root' | 'controller' | 'assistant'> {
  controller?: Omit<ControllerOptions, 'classifier' | 'rephraser'>;
}

/** Construit contrôleur + backends + vue dans `root`. La partie n'est pas démarrée (`controller.newGame()`). */
export function createPlayer(root: HTMLElement, game: GameData, opts: CreatePlayerOptions = {}): { controller: GameController; view: PlayerView; assistant: AssistantManager } {
  const store = opts.store ?? defaultStore();
  const settings = opts.settings ?? loadSettings(store);
  let view: PlayerView | null = null;
  const assistant = new AssistantManager(() => view?.settings ?? settings);
  const controller = new GameController(game, {
    ...opts.controller,
    classifier: () => assistant.classifier(),
    rephraser: () => assistant.rephraser(),
  });
  view = new PlayerView({ ...opts, root, controller, assistant, store, settings });
  if (settings.assistant === 'local' && settings.localConsent) {
    assistant.local.load().catch((e: unknown) => console.warn('[scroum] modèle local indisponible', e));
  }
  return { controller, view, assistant };
}
