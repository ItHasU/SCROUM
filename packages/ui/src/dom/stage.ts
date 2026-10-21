/** Scène : fond 16:9 (image ou placeholder), hotspots, sorties, menu contextuel. */
import { sceneView, visibleExits, visibleHotspots, type HotspotView } from '@scroum/engine';
import type { Rect } from '@scroum/schema';
import { hueOf, verbLabel } from '../labels';
import type { ViewContext } from './context';
import { button, h, replace } from './h';

const pct = (r: Rect) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });

export class StageView {
  readonly el: HTMLElement;
  private readonly bg: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly menu: HTMLElement;
  private bgKey = '';
  /** Le fond affiche une vraie image (sinon placeholder : hotspots encadrés). */
  private hasImage = false;

  constructor(private readonly ctx: ViewContext) {
    this.bg = h('div.stage-bg');
    this.layer = h('div.stage-layer');
    this.menu = h('div.hotspot-menu', { role: 'menu', hidden: true });
    this.el = h('section.stage', { 'aria-label': 'Scène' }, this.bg, this.layer, this.menu);
    this.el.addEventListener('click', (ev) => {
      if (ev.target === this.layer || ev.target === this.bg || (ev.target as HTMLElement).closest?.('.stage-bg')) this.closeMenu();
    });
  }

  /** Hotspots apparus en cours de scène (reveal) : surlignés quelques secondes pour ne pas passer inaperçus. */
  private seen: Set<string> | null = null;
  private seenScene = '';
  private readonly freshUntil = new Map<string, number>();

  private trackFresh(sceneId: string, ids: string[]): void {
    if (this.seen && this.seenScene === sceneId) {
      for (const id of ids) if (!this.seen.has(id)) this.freshUntil.set(id, Date.now() + 6000);
    } else this.freshUntil.clear();
    this.seen = new Set(ids);
    this.seenScene = sceneId;
  }

  private isFresh(id: string): boolean {
    return (this.freshUntil.get(id) ?? 0) > Date.now();
  }

  private closeMenu(): void {
    if (this.ctx.ui.hotspotMenu) {
      this.ctx.ui.hotspotMenu = null;
      this.renderMenu([]);
    }
  }

  render(): void {
    const { ctrl } = this.ctx;
    const scene = sceneView(ctrl.game, ctrl.state);
    if (!scene) {
      replace(this.bg, h('div.stage-placeholder', null, h('p', null, 'Scène introuvable')));
      replace(this.layer);
      return;
    }
    const world = ctrl.game.worlds[scene.world];
    const url = this.ctx.assets.url(scene.background);
    const key = `${scene.id}|${url ?? ''}|${scene.title ?? ''}`;
    if (key !== this.bgKey) {
      this.bgKey = key;
      const hue = hueOf(scene.world);
      const ph = h(
        'div.stage-placeholder',
        { style: { background: `radial-gradient(ellipse at 30% 20%, hsl(${(hue + 30) % 360} 55% 48%), transparent 60%), linear-gradient(160deg, hsl(${hue} 50% 32%), hsl(${(hue + 60) % 360} 45% 12%))` } },
        h('div.stage-title', null, scene.title ?? scene.id),
        h('div.stage-world', null, world?.name ?? scene.world),
      );
      this.hasImage = false;
      if (url) {
        const img = h('img.stage-img', { src: url, alt: scene.title ?? scene.id, draggable: 'false' });
        img.addEventListener('load', () => {
          this.hasImage = true;
          this.el.classList.add('has-image');
        });
        img.addEventListener('error', () => {
          this.hasImage = false;
          this.el.classList.remove('has-image');
          img.replaceWith(ph);
        });
        replace(this.bg, img);
      } else replace(this.bg, ph);
      this.el.classList.toggle('has-image', false);
    }
    this.el.dataset.scene = scene.id;

    const blocked = !!ctrl.state.dialogue || !!ctrl.state.ending || !!ctrl.lingering;
    this.el.classList.toggle('blocked', blocked);
    const hotspots = visibleHotspots(ctrl.game, ctrl.state);
    const exits = visibleExits(ctrl.game, ctrl.state);
    this.trackFresh(scene.id, hotspots.map((x) => x.id));
    const sel = ctrl.selected;
    replace(
      this.layer,
      hotspots.map((hs) =>
        h(
          'button.hs',
          {
            type: 'button',
            style: pct(hs.rect),
            'data-hotspot': hs.id,
            'aria-label': hs.label,
            disabled: blocked,
            class: [sel ? 'target' : null, this.isFresh(hs.id) ? 'fresh' : null].filter(Boolean).join(' ') || null,
            onclick: (ev: Event) => {
              ev.stopPropagation();
              // Objet en main : un tap sur un hotspot déclenche directement `use` (SPEC §5.6).
              if (ctrl.selected) {
                this.ctx.ui.hotspotMenu = null;
                ctrl.useSelectedOn(hs.id);
                return;
              }
              this.ctx.ui.hotspotMenu = this.ctx.ui.hotspotMenu === hs.id ? null : hs.id;
              this.renderMenu(hotspots);
            },
          },
          hs.image ? this.sprite(hs) : null,
          h('span.hs-label', null, hs.label),
        ),
      ),
      exits.map((ex) =>
        h(
          'button.hs.exit',
          {
            type: 'button',
            style: pct(ex.rect),
            'data-exit': ex.id,
            'aria-label': `Sortie : ${ex.label}`,
            disabled: blocked,
            onclick: (ev: Event) => {
              ev.stopPropagation();
              this.ctx.ui.hotspotMenu = null;
              ctrl.dispatch({ type: 'exit', exit: ex.id });
            },
          },
          h('span.hs-label', null, '➜ ', ex.label),
        ),
      ),
    );
    if (blocked) this.ctx.ui.hotspotMenu = null;
    this.renderMenu(hotspots);
  }

  private sprite(hs: HotspotView): HTMLElement | null {
    const url = this.ctx.assets.url(hs.image);
    if (!url) return null;
    const img = h('img.hs-sprite', { src: url, alt: '', draggable: 'false' });
    img.addEventListener('error', () => img.remove(), { once: true });
    return img;
  }

  private renderMenu(hotspots: HotspotView[]): void {
    const { ctrl, ui } = this.ctx;
    const hs = ui.hotspotMenu ? hotspots.find((x) => x.id === ui.hotspotMenu) : undefined;
    if (!hs) {
      ui.hotspotMenu = null;
      this.menu.hidden = true;
      replace(this.menu);
      for (const b of this.layer.querySelectorAll('.hs.open')) b.classList.remove('open');
      return;
    }
    for (const b of this.layer.querySelectorAll<HTMLElement>('.hs')) b.classList.toggle('open', b.dataset.hotspot === hs.id);
    const run = (fn: () => void) => () => {
      ui.hotspotMenu = null;
      fn();
    };
    const sel = ctrl.selected;
    const selName = sel ? (ctrl.game.items[sel]?.name ?? sel) : null;
    replace(
      this.menu,
      h('div.hm-title', null, hs.character?.name ?? hs.label),
      sel ? button('hm-verb use', [`Utiliser ${selName}`], run(() => ctrl.useSelectedOn(hs.id)), { 'data-verb': 'use', role: 'menuitem' }) : null,
      hs.verbs.map((v) => button('hm-verb', verbLabel(v.verb, v.label), run(() => ctrl.dispatch({ type: 'verb', hotspot: hs.id, verb: v.verb })), { 'data-verb': v.verb, role: 'menuitem' })),
      button('hm-cancel', 'Annuler', () => this.closeMenu()),
    );
    // Position : centrée sur le hotspot, bornée pour rester à l'écran (le menu peut déborder sur le panneau).
    const cx = hs.rect.x + hs.rect.w / 2;
    const cy = hs.rect.y + hs.rect.h / 2;
    Object.assign(this.menu.style, { left: `${Math.min(Math.max(cx * 100, 25), 75)}%`, top: `${Math.min(Math.max(cy * 100, 8), 45)}%`, bottom: '' });
    this.menu.hidden = false;
  }

  /** Surligne brièvement les hotspots (accessibilité). */
  flash(): void {
    this.el.classList.remove('flash');
    void this.el.offsetWidth;
    this.el.classList.add('flash');
    setTimeout(() => this.el.classList.remove('flash'), 1600);
  }

  get imageShown(): boolean {
    return this.hasImage;
  }
}
