/**
 * Application player : écran d'accueil (Nouvelle partie / Continuer / Charger un
 * fichier), démarrage du jeu, mode source directe (rechargement SSE en
 * conservant l'état), protocole playtest.
 */
import type { GameData } from '@scroum/schema';
import { createPlayer, defaultStore, gameKey, h, SaveStore, type GameController, type KeyValueStore, type PlayerView } from '@scroum/ui';
import { describeLoadError, fetchSourceGame, loadSource, loadZipFile, loadZipUrl, watchSource, type LoadedGame, type LoadError } from './loader';
import { attachPlaytest } from './playtest';

export interface AppParams {
  game: string | null;
  source: string | null;
  scene: string | null;
  quest: string | null;
}

export function readParams(search = location.search): AppParams {
  const p = new URLSearchParams(search);
  return { game: p.get('game'), source: p.get('source'), scene: p.get('scene'), quest: p.get('quest') };
}

export class PlayerApp {
  loaded: LoadedGame | null = null;
  controller: GameController | null = null;
  view: PlayerView | null = null;
  private stopWatch: (() => void) | null = null;
  private stopPlaytest: (() => void) | null = null;
  readonly store: KeyValueStore;
  readonly embedded: boolean;

  constructor(
    readonly root: HTMLElement,
    readonly params: AppParams,
    opts: { store?: KeyValueStore; embedded?: boolean } = {},
  ) {
    this.store = opts.store ?? defaultStore();
    this.embedded = opts.embedded ?? (typeof window !== 'undefined' && window.parent !== window);
  }

  async boot(): Promise<void> {
    const { game, source, scene } = this.params;
    if (!game && !source) return this.home();
    this.loadingScreen(source ? 'Connexion à l’éditeur…' : 'Téléchargement du jeu…');
    try {
      if (source) {
        const s = await loadSource(source);
        this.loaded = s;
        this.stopWatch = watchSource(s.base, () => void this.reloadSource(s.base));
      } else this.loaded = await loadZipUrl(game!);
    } catch (e) {
      return this.home(describeLoadError(e));
    }
    document.title = this.loaded.game.meta.title;
    if (this.embedded || scene || this.params.quest) this.play('new', scene);
    else this.home();
  }

  /** Rechargement du contenu (SSE) en conservant l'état. */
  async reloadSource(base: string): Promise<void> {
    let game: GameData;
    try {
      game = await fetchSourceGame(base);
    } catch (e) {
      const err = describeLoadError(e);
      this.view?.toast(`Contenu non rechargé : ${err.message}${err.detail ? ` — ${err.detail}` : ''}`, 'error');
      return;
    }
    if (!this.loaded) return;
    this.loaded.game = game;
    if (this.controller) {
      this.controller.replaceGame(game);
      this.view?.toast('Contenu rechargé.');
    }
  }

  private saves(): SaveStore | null {
    return this.loaded ? new SaveStore(this.store, gameKey(this.loaded.game)) : null;
  }

  private loadingScreen(text: string): void {
    this.root.replaceChildren(h('div.home', null, h('div.home-box', null, h('p.boot', null, text))));
  }

  /** Démarre le jeu chargé : nouvelle partie (dans `scene` éventuellement) ou reprise de la sauvegarde auto. */
  play(mode: 'new' | 'continue', scene?: string | null): void {
    if (!this.loaded) return;
    this.teardownPlayer();
    const loaded = this.loaded;
    const { controller, view } = createPlayer(this.root, loaded.game, {
      assets: loaded.assets,
      store: this.store,
      onHome: this.embedded ? undefined : () => this.home(),
    });
    this.controller = controller;
    this.view = view;
    const auto = mode === 'continue' ? view.saves.read('auto') : null;
    if (auto) controller.loadState(auto.state, auto.log);
    else controller.newGame(scene ?? null, this.params.quest);
    if (this.embedded) this.stopPlaytest = attachPlaytest(controller);
  }

  private teardownPlayer(): void {
    this.stopPlaytest?.();
    this.stopPlaytest = null;
    this.view?.destroy();
    this.view = null;
    this.controller = null;
  }

  /** Écran d'accueil. */
  home(error?: LoadError): void {
    this.teardownPlayer();
    const game = this.loaded?.game ?? null;
    const auto = this.saves()?.read('auto') ?? null;
    const file = h('input', { type: 'file', accept: '.zip,.scroum.zip,application/zip', hidden: true, 'data-input': 'zip' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      this.loadingScreen('Ouverture du fichier…');
      try {
        this.loaded?.dispose();
        this.stopWatch?.();
        this.stopWatch = null;
        this.loaded = await loadZipFile(f);
        document.title = this.loaded.game.meta.title;
        this.home();
      } catch (e) {
        this.home(describeLoadError(e));
      }
    });
    const url = h('input.home-url', { type: 'url', placeholder: 'https://…/jeu.scroum.zip', 'aria-label': 'Adresse d’un jeu' });
    const btn = (label: string, cls: string, on: () => void, action: string) => h(`button.btn.${cls}` as 'button', { type: 'button', onclick: on, 'data-action': action }, label);
    this.root.replaceChildren(
      h(
        'div.home',
        null,
        h(
          'div.home-box',
          null,
          h('div.home-logo', { 'aria-hidden': 'true' }, '⛯'),
          h('h1', null, game?.meta.title ?? 'SCROUM'),
          h('p.home-desc', null, game?.meta.description ?? (game ? '' : 'Aventure point-and-click à dialogues semi-scriptés. Ouvrez un jeu (.scroum.zip) pour commencer.')),
          error ? h('div.home-error', { role: 'alert' }, h('strong', null, error.message), error.detail ? h('p', null, error.detail) : null) : null,
          h(
            'div.home-actions',
            null,
            game ? btn('Nouvelle partie', 'primary', () => this.play('new', this.params.scene), 'new-game') : null,
            game && auto ? btn(`Continuer — ${auto.label}`, 'secondary', () => this.play('continue'), 'continue') : null,
            btn('Charger un fichier…', 'ghost', () => file.click(), 'load-file'),
            file,
          ),
          !game || error
            ? h(
                'form.home-form',
                {
                  onsubmit: (ev: Event) => {
                    ev.preventDefault();
                    const v = url.value.trim();
                    if (v) location.search = `?game=${encodeURIComponent(v)}`;
                  },
                },
                url,
                h('button.btn', { type: 'submit' }, 'Ouvrir'),
              )
            : null,
          h('p.home-foot', null, game ? `v${game.meta.version} · moteur SCROUM` : 'moteur SCROUM'),
        ),
      ),
    );
  }
}
