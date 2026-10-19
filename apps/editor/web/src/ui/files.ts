/** Vue Fichiers : liste de content/ ; un clic ouvre le fichier brut dans l'inspecteur. */
import { h, render } from '../dom';
import { select, state } from '../store';
import type { View } from './view';

export function createFilesView(): View {
  const el = h('div', { class: 'view files' });
  function update(): void {
    const errs = new Map<string, number>();
    const warns = new Map<string, number>();
    for (const e of state.report?.errors ?? []) errs.set(e.file, (errs.get(e.file) ?? 0) + 1);
    for (const e of state.report?.warnings ?? []) warns.set(e.file, (warns.get(e.file) ?? 0) + 1);
    render(
      el,
      h('h2', null, 'Fichiers de content/'),
      h(
        'table',
        { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Fichier'), h('th', null, 'Type'), h('th', null, 'Taille'), h('th', null, 'Validation'))),
        h(
          'tbody',
          null,
          state.files.map((f) => {
            const isImage = f.kind === 'image';
            return h(
              'tr',
              { class: state.file === f.path ? 'sel' : '' },
              h('td', null, isImage ? f.path : h('button', { class: 'link', onclick: () => select(null, f.path) }, f.path)),
              h('td', null, f.kind),
              h('td', null, `${f.size} o`),
              h('td', null, errs.get(f.path) ? h('span', { class: 'err-text' }, `${errs.get(f.path)} erreur(s) `) : null, warns.get(f.path) ? h('span', { class: 'warn-text' }, `${warns.get(f.path)} avert.`) : null),
            );
          }),
        ),
      ),
    );
  }
  return { el, update };
}
