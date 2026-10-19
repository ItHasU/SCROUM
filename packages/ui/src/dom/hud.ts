/** HUD : compteurs `hud: true` (avec titre), objet en main, boutons quêtes / galerie / loupe / menu, inventaire. */
import { hudCounters, inventoryView, questLog, unlockedCollections } from '@scroum/engine';
import { assetImage, type ViewContext } from './context';
import { button, h, replace } from './h';

export class HudView {
  readonly top: HTMLElement;
  readonly bottom: HTMLElement;

  constructor(
    private readonly ctx: ViewContext,
    private readonly onFlash: () => void,
  ) {
    this.top = h('header.hud', { 'aria-label': 'Tableau de bord' });
    this.bottom = h('nav.bottom-bar', { 'aria-label': 'Actions' });
  }

  render(): void {
    const { ctrl, ui } = this.ctx;
    const counters = hudCounters(ctrl.game, ctrl.state);
    const quests = questLog(ctrl.game, ctrl.state);
    const gallery = unlockedCollections(ctrl.game, ctrl.state);
    replace(
      this.top,
      h(
        'div.hud-counters',
        null,
        counters.map((c) =>
          h('div.counter', { 'data-counter': c.id, title: c.title ?? c.label }, h('span.counter-label', null, c.label), h('span.counter-value', null, String(c.value)), c.title ? h('span.counter-title', null, c.title) : null),
        ),
      ),
      h(
        'div.hud-buttons',
        null,
        button('icon-btn', ['📜', quests.length ? h('span.badge', null, String(quests.filter((q) => q.state === 'active').length || '✓')) : null], () => this.ctx.openModal('quests'), {
          'aria-label': 'Journal des quêtes',
          title: 'Journal des quêtes',
          'data-hud': 'quests',
        }),
        button('icon-btn', ['🖼', gallery.length ? h('span.badge', null, String(gallery.length)) : null], () => this.ctx.openModal('gallery'), {
          'aria-label': 'Galerie',
          title: 'Galerie',
          'data-hud': 'gallery',
        }),
        button('icon-btn', '🔍', this.onFlash, { 'aria-label': 'Montrer les zones interactives', title: 'Montrer les zones interactives', 'data-hud': 'flash' }),
        button('icon-btn', '☰', () => this.ctx.openModal('menu'), { 'aria-label': 'Menu', title: 'Menu', 'data-hud': 'menu' }),
      ),
    );

    const inv = inventoryView(ctrl.game, ctrl.state);
    const count = inv.reduce((n, i) => n + i.qty, 0);
    const sel = ctrl.selected ? inv.find((i) => i.id === ctrl.selected) : undefined;
    replace(
      this.bottom,
      button('inv-btn', ['🎒 Inventaire', h('span.badge', null, String(count))], () => this.ctx.setDrawer(!ui.drawerOpen), {
        'aria-expanded': String(ui.drawerOpen),
        'data-hud': 'inventory',
      }),
      sel
        ? h(
            'div.held',
            { 'data-held': sel.id },
            assetImage(this.ctx, sel.icon, sel.name, 'held-icon'),
            h('span.held-name', null, sel.name),
            button('held-clear', '✕', () => ctrl.select(null), { 'aria-label': 'Ranger l’objet' }),
          )
        : null,
    );
  }

  /** Position du bouton d'inventaire (cible de l'animation d'acquisition). */
  inventoryTarget(): HTMLElement | null {
    return this.bottom.querySelector<HTMLElement>('.inv-btn');
  }
}
