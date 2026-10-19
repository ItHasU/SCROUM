/**
 * Tiroir d'inventaire (bas d'écran). Tap = examiner (ou combiner avec l'objet
 * sélectionné) ; appui long ou bouton « En main » = sélectionner.
 */
import { dialogueView, inventoryView } from '@scroum/engine';
import { assetImage, type ViewContext } from './context';
import { button, h, replace } from './h';

const LONG_PRESS_MS = 450;

export class InventoryView {
  readonly el: HTMLElement;

  constructor(private readonly ctx: ViewContext) {
    this.el = h('aside.drawer', { 'aria-label': 'Inventaire', 'aria-hidden': 'true' });
  }

  render(): void {
    const { ctrl, ui } = this.ctx;
    const items = inventoryView(ctrl.game, ctrl.state);
    const open = ui.drawerOpen && !ctrl.state.ending;
    this.el.classList.toggle('open', open);
    this.el.setAttribute('aria-hidden', String(!open));
    if (!open) {
      replace(this.el);
      return;
    }
    const sel = ctrl.selected;
    const selName = sel ? (ctrl.game.items[sel]?.name ?? sel) : null;
    const dv = ctrl.state.dialogue ? dialogueView(ctrl.game, ctrl.state) : null;
    let hint: string;
    if (!items.length) hint = 'Votre inventaire est vide.';
    else if (sel) hint = dv ? `${selName} en main : donnez-le, montrez-le, ou touchez un autre objet pour combiner.` : `${selName} en main : touchez un élément de la scène pour l'utiliser, ou un autre objet pour combiner.`;
    else hint = "Touchez un objet pour l'examiner ; appui long (ou « En main ») pour le sélectionner.";

    const offer = sel && dv && (dv.can_give || dv.can_show)
      ? h(
          'div.offer',
          null,
          dv.can_give ? button('btn give', `Donner ${selName}`, () => this.offer('give'), { 'data-action': 'give' }) : null,
          dv.can_show ? button('btn show', `Montrer ${selName}`, () => this.offer('show'), { 'data-action': 'show' }) : null,
        )
      : null;

    replace(
      this.el,
      h('div.drawer-head', null, h('h2', null, 'Inventaire'), button('btn ghost close', '✕', () => this.ctx.setDrawer(false), { 'aria-label': "Fermer l'inventaire" })),
      h('p.drawer-hint', null, hint),
      offer,
      h(
        'ul.inv-grid',
        null,
        items.map((it) => {
          const selected = it.id === sel;
          const card = h(
            'button.inv-item',
            { type: 'button', 'data-item': it.id, 'aria-pressed': String(selected), class: selected ? 'selected' : null, title: it.description ?? it.name },
            assetImage(this.ctx, it.icon, it.name, 'inv-icon'),
            h('span.inv-name', null, it.name),
            it.qty > 1 ? h('span.inv-qty', null, `×${it.qty}`) : null,
          );
          this.bindPress(card, it.id);
          return h(
            'li',
            null,
            card,
            button('inv-select', selected ? '✓ En main' : 'En main', () => ctrl.select(selected ? null : it.id), { 'data-select': it.id, 'aria-pressed': String(selected) }),
          );
        }),
      ),
    );
  }

  private offer(kind: 'give' | 'show'): void {
    this.ctx.setDrawer(false);
    this.ctx.ctrl.offerSelected(kind);
  }

  /** Tap / appui long sur une carte d'objet. */
  private bindPress(card: HTMLElement, id: string): void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let long = false;
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    card.addEventListener('pointerdown', () => {
      long = false;
      cancel();
      timer = setTimeout(() => {
        long = true;
        this.ctx.ctrl.select(id);
        navigator.vibrate?.(20);
      }, LONG_PRESS_MS);
    });
    card.addEventListener('pointerup', cancel);
    card.addEventListener('pointerleave', cancel);
    card.addEventListener('pointercancel', cancel);
    card.addEventListener('contextmenu', (ev) => ev.preventDefault());
    card.addEventListener('click', () => {
      if (long) {
        long = false;
        return;
      }
      const { ctrl } = this.ctx;
      const before = ctrl.selected;
      ctrl.tapItem(id);
      if (!before) {
        this.ctx.ui.itemDetail = id;
        this.ctx.openModal('item');
      }
    });
  }
}
