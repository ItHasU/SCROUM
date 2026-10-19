/** Rapport de validation permanent : compteur dans l'en-tête et tiroir de liste cliquable. */
import type { ContentError } from '@scroum/schema';
import { h, render } from '../dom';
import { state } from '../store';
import { openIssue } from './common';

export function createValidation(counter: HTMLElement, drawer: HTMLElement): { update(): void } {
  let open = false;
  counter.addEventListener('click', () => {
    open = !open;
    drawer.hidden = !open;
  });
  drawer.hidden = true;

  const row = (e: ContentError): HTMLElement =>
    h(
      'li',
      { class: `issue ${e.severity === 'error' ? 'err' : 'warn'}`, onclick: () => openIssue(e) },
      h('span', { class: 'sev' }, e.severity === 'error' ? 'erreur' : 'avert.'),
      h('code', null, e.line ? `${e.file}:${e.line}` : e.file, e.path ? ` › ${e.path}` : ''),
      h('span', null, e.message),
      h('small', { class: 'muted' }, e.code),
    );

  function update(): void {
    const r = state.report;
    const errors = r ? r.errors : state.gameErrors;
    const warnings = r?.warnings ?? [];
    render(counter, h('span', { class: `pill ${errors.length ? 'bad' : 'good'}` }, `${errors.length} erreur${errors.length > 1 ? 's' : ''}`), h('span', { class: `pill ${warnings.length ? 'warn' : 'good'}` }, `${warnings.length} avert.`));
    counter.dataset.errors = String(errors.length);
    counter.dataset.warnings = String(warnings.length);
    render(
      drawer,
      h('ul', { class: 'issue-list' }, errors.map(row), warnings.map(row)),
      errors.length + warnings.length === 0 ? h('p', { class: 'muted pad' }, 'Aucun problème.') : null,
      (r?.skipped ?? []).map((s) => h('p', { class: 'muted pad' }, `Analyse ignorée « ${s.analyzer} » : ${s.reason}`)),
    );
  }
  return { update };
}
