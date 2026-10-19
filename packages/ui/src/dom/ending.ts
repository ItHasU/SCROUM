/** Écran de fin : victoire, ou game over façon Sierra (« Recommencer » / « Charger »). */
import { endingView } from '@scroum/engine';
import { assetImage, type ViewContext } from './context';
import { button, h, replace } from './h';

export class EndingView {
  readonly el: HTMLElement;

  constructor(private readonly ctx: ViewContext) {
    this.el = h('div.ending', { hidden: true, role: 'dialog', 'aria-modal': 'true' });
  }

  render(): void {
    const { ctrl } = this.ctx;
    const e = endingView(ctrl.game, ctrl.state);
    if (!e) {
      this.el.hidden = true;
      replace(this.el);
      return;
    }
    this.el.hidden = false;
    this.el.dataset.type = e.type;
    const lines = ctrl.lastEvents.flatMap((ev) => (ev.type === 'say' ? [ev] : []));
    const img = this.ctx.assets.url(e.image) ? assetImage(this.ctx, e.image, e.title ?? e.id, 'ending-img') : null;
    replace(
      this.el,
      h(
        'div.ending-box',
        { 'data-ending': e.id },
        h('div.ending-kicker', null, e.type === 'win' ? '★ Victoire ★' : 'Partie terminée'),
        img,
        h('h2.ending-title', null, e.title ?? (e.type === 'win' ? 'Bravo !' : 'Perdu !')),
        lines.length ? h('div.ending-lines', null, lines.slice(-3).map((l) => h('p', null, l.name ? h('span.who', null, `${l.name} : `) : null, l.text))) : null,
        e.text ? h('p.ending-text', null, e.text) : null,
        h(
          'div.ending-actions',
          null,
          button('btn primary', '↺ Recommencer', () => ctrl.newGame(), { 'data-action': 'restart' }),
          button('btn', '💾 Charger', () => this.ctx.openModal('saves'), { 'data-action': 'load' }),
          button('btn ghost', '🖼 Galerie', () => this.ctx.openModal('gallery')),
          this.ctx.onHome ? button('btn ghost', '⌂ Accueil', () => this.ctx.onHome?.()) : null,
        ),
      ),
    );
  }
}
