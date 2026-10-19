/** Vue Bible : documents, mondes, gags, quêtes, personnages et tableau de bord des statuts. */
import type { Status } from '@scroum/schema';
import { h, render } from '../dom';
import { bibleSummary, CATEGORY_LABEL, type BibleCategory } from '../model/bible';
import { select, state } from '../store';
import { badge, refLink, section, statusSelect, STATUS_LABEL } from './common';
import type { View } from './view';

/** Rendu minimal de Markdown (titres, listes, paragraphes) — sans HTML injecté. */
export function renderMarkdown(src: string): HTMLElement {
  const root = h('div', { class: 'md' });
  let list: HTMLElement | null = null;
  let para: string[] = [];
  const flush = (): void => {
    if (para.length) root.appendChild(h('p', null, para.join(' ')));
    para = [];
  };
  for (const line of src.split(/\r?\n/)) {
    const hm = /^(#{1,4})\s+(.*)$/.exec(line);
    const lm = /^\s*[-*]\s+(.*)$/.exec(line);
    if (hm) {
      flush();
      list = null;
      root.appendChild(h(`h${Math.min(6, hm[1]!.length + 2)}` as 'h3', null, hm[2]));
    } else if (lm) {
      flush();
      if (!list) {
        list = h('ul');
        root.appendChild(list);
      }
      list.appendChild(h('li', null, lm[1]));
    } else if (!line.trim()) {
      flush();
      list = null;
    } else para.push(line.trim());
  }
  flush();
  return root;
}

const STATUS_ORDER: Status[] = ['draft', 'review', 'validated', 'rejected'];

export function createBibleView(): View {
  const el = h('div', { class: 'view bible' });

  function update(): void {
    const game = state.game;
    if (!game) return render(el, h('p', { class: 'muted pad' }, 'Aucun jeu chargé (voir le rapport de validation).'));
    const sum = bibleSummary(game);

    const dash = section(
      'Tableau de bord',
      h(
        'div',
        { class: 'stats' },
        STATUS_ORDER.map((s) => h('div', { class: `stat st-${s}` }, h('b', null, sum.byStatus[s]), h('span', null, STATUS_LABEL[s]))),
      ),
      h('div', { class: 'bar' }, STATUS_ORDER.map((s) => h('i', { class: `st-${s}`, style: `flex:${sum.byStatus[s]}`, title: `${STATUS_LABEL[s]} : ${sum.byStatus[s]}` }))),
      h('h4', null, `À valider (${sum.byStatus.draft + sum.byStatus.review})`),
      (Object.keys(CATEGORY_LABEL) as BibleCategory[])
        .filter((c) => sum.todo[c].length > 0)
        .map((c) =>
          h(
            'details',
            { open: true },
            h('summary', null, `${CATEGORY_LABEL[c]} (${sum.todo[c].length})`),
            h(
              'ul',
              { class: 'rows' },
              sum.todo[c].map((e) => h('li', null, refLink(e.ref, e.title), badge(e.status), statusSelect(e.ref, e.status))),
            ),
          ),
        ),
      sum.byStatus.draft + sum.byStatus.review === 0 ? h('p', { class: 'muted' }, 'Tout est validé.') : null,
    );

    const docs = (['pitch', 'tone', 'style'] as const)
      .map((k) => game.bible.docs[k])
      .concat(Object.values(game.bible.docs).filter((d) => !['pitch', 'tone', 'style'].includes(d.id)))
      .filter((d) => !!d)
      .map((d) =>
        section(
          `${d!.id}`,
          h('div', { class: 'row' }, badge(d!.status), statusSelect({ kind: 'doc', id: d!.id }, d!.status), refLink({ kind: 'doc', id: d!.id }, 'éditer')),
          renderMarkdown(d!.body),
        ),
      );

    const worlds = section(
      'Mondes',
      h(
        'div',
        { class: 'grid' },
        Object.values(game.worlds).map((w) =>
          h(
            'div',
            { class: 'tile', onclick: () => select({ kind: 'world', id: w.id }) },
            h('b', null, w.name),
            badge(w.status),
            h('p', null, w.description ?? ''),
            h('small', { class: 'muted' }, `skin ${w.ui_skin} · refus : « ${w.refuse_line} »`),
          ),
        ),
      ),
    );

    const quests = section(
      'Quêtes',
      h(
        'ul',
        { class: 'rows' },
        Object.values(game.quests).map((q) => h('li', null, refLink({ kind: 'quest', id: q.id }, q.title), h('span', { class: 'muted' }, q.description ?? ''), badge(q.status), statusSelect({ kind: 'quest', id: q.id }, q.status))),
      ),
    );

    const gags = section(
      'Gags',
      h(
        'ul',
        { class: 'rows' },
        Object.values(game.bible.gags).map((g) => h('li', null, refLink({ kind: 'gag', id: g.id }, g.text), h('small', { class: 'muted' }, g.tags.join(', ')), badge(g.status), statusSelect({ kind: 'gag', id: g.id }, g.status))),
      ),
    );

    const chars = section(
      'Personnages',
      h(
        'div',
        { class: 'grid' },
        Object.values(game.characters).map((c) =>
          h(
            'div',
            { class: 'tile', onclick: () => select({ kind: 'character', id: c.id }) },
            h('b', null, c.identity.name),
            badge(c.status),
            h('small', { class: 'muted' }, [c.role, c.age ? `${c.age} ans` : null, c.persona ? `persona : ${c.persona.name}` : null].filter(Boolean).join(' · ')),
            h('p', null, c.identity.description ?? c.motivation ?? ''),
            h('div', { onclick: (e: Event) => e.stopPropagation() }, statusSelect({ kind: 'character', id: c.id }, c.status)),
          ),
        ),
      ),
    );

    render(el, h('h2', null, game.meta.title), dash, docs, worlds, quests, gags, chars);
  }
  return { el, update };
}
