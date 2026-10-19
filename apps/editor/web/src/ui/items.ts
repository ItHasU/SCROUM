/** Vue Objets : où chaque objet est obtenu et où il sert. */
import { h, render } from '../dom';
import { GIVE_LABEL, itemTable, NEED_LABEL } from '../model/items';
import { badge, refLink } from './common';
import { state } from '../store';
import type { View } from './view';

export function createItemsView(): View {
  const el = h('div', { class: 'view items' });
  function update(): void {
    const game = state.game;
    if (!game) return render(el, h('p', { class: 'muted pad' }, 'Aucun jeu chargé.'));
    const rows = itemTable(game);
    render(
      el,
      h('h2', null, 'Objets'),
      h(
        'table',
        { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Objet'), h('th', null, 'Statut'), h('th', null, 'Où on l’obtient'), h('th', null, 'Où il sert'))),
        h(
          'tbody',
          null,
          rows.map((r) =>
            h(
              'tr',
              null,
              h('td', null, refLink({ kind: 'item', id: r.id }, r.name), h('div', null, h('small', { class: 'muted' }, r.id))),
              h('td', null, badge(r.status)),
              h(
                'td',
                { class: r.obtained.length === 0 ? 'warnbg' : '' },
                r.obtained.length === 0 ? h('span', { class: 'err-text' }, 'jamais obtenu') : null,
                h('ul', { class: 'plain' }, r.obtained.map((o) => h('li', null, h('small', { class: 'tag' }, GIVE_LABEL[o.how]), refLink(o.from.ref, o.from.text), o.from.detail ? h('small', { class: 'muted' }, ` (${o.from.detail})`) : null))),
              ),
              h(
                'td',
                { class: r.used.length === 0 ? 'warnbg' : '' },
                r.used.length === 0 ? h('span', { class: 'muted' }, 'ne sert nulle part') : null,
                h('ul', { class: 'plain' }, r.used.map((o) => h('li', null, h('small', { class: 'tag' }, NEED_LABEL[o.how]), refLink(o.from.ref, o.from.text), o.from.detail ? h('small', { class: 'muted' }, ` (${o.from.detail})`) : null))),
              ),
            ),
          ),
        ),
      ),
    );
  }
  return { el, update };
}
