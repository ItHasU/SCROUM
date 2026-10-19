/** Inspecteur : élément sélectionné, formulaire simple et édition du YAML brut. */
import type { ContentError } from '@scroum/schema';
import { api } from '../api';
import { h, render } from '../dom';
import { collectFacts } from '../model/facts';
import { fileOf, KIND_LABEL, refKey, statusOf, titleOf, type Ref } from '../model/refs';
import { fieldsFor, setField } from '../model/yamlEdit';
import { on, requestPlay, state } from '../store';
import { badge, refLink, statusSelect, toast } from './common';

function sceneOfRef(ref: Ref | null): string | null {
  if (!ref) return null;
  if (ref.kind === 'scene') return ref.id;
  if (ref.kind === 'hotspot') return ref.parent ?? null;
  return null;
}

/** Résumé en lecture seule des relations de l'élément. */
function relations(ref: Ref): HTMLElement | null {
  const game = state.game;
  if (!game) return null;
  const facts = collectFacts(game);
  if (ref.kind === 'item') {
    const gives = facts.gives.filter((g) => g.item === ref.id);
    const needs = facts.needs.filter((n) => n.item === ref.id);
    return h(
      'div',
      { class: 'rel' },
      h('h4', null, 'Obtenu'),
      gives.length ? h('ul', { class: 'plain' }, gives.map((g) => h('li', null, refLink(g.from.ref, g.from.text)))) : h('p', { class: 'err-text' }, 'jamais'),
      h('h4', null, 'Sert'),
      needs.length ? h('ul', { class: 'plain' }, needs.map((g) => h('li', null, refLink(g.from.ref, g.from.text)))) : h('p', { class: 'muted' }, 'nulle part'),
    );
  }
  if (ref.kind === 'scene' || ref.kind === 'hotspot') {
    const sc = game.scenes[ref.kind === 'scene' ? ref.id : (ref.parent ?? '')];
    if (!sc) return null;
    return h(
      'div',
      { class: 'rel' },
      h('h4', null, 'Sorties'),
      h('ul', { class: 'plain' }, sc.exits.map((e) => h('li', null, '→ ', refLink({ kind: 'scene', id: e.to }, game.scenes[e.to]?.title ?? e.to), h('small', { class: 'muted' }, ` « ${e.label} »`)))),
      h('h4', null, 'Hotspots'),
      h('ul', { class: 'plain' }, sc.hotspots.map((hs) => h('li', null, refLink({ kind: 'hotspot', id: hs.id, parent: sc.id }, hs.label)))),
    );
  }
  if (ref.kind === 'dialogue') {
    const d = game.dialogues[ref.id];
    if (!d) return null;
    return h('div', { class: 'rel' }, h('h4', null, `Nœuds (${Object.keys(d.nodes).length})`), h('ul', { class: 'plain' }, Object.keys(d.nodes).map((n) => h('li', null, refLink({ kind: 'dnode', id: d.id, node: n }, n + (n === d.start ? ' (départ)' : ''))))));
  }
  return null;
}

export function createInspector(root: HTMLElement): void {
  let currentFile: string | null = null;
  let original = '';
  let textarea: HTMLTextAreaElement | null = null;
  let errorBox: HTMLElement | null = null;
  let notice: HTMLElement | null = null;
  let formBox: HTMLElement | null = null;
  let loadedKey = '';

  const dirty = (): boolean => !!textarea && textarea.value !== original;

  function showErrors(errors: ContentError[], warnings: ContentError[] = [], message?: string): void {
    if (!errorBox) return;
    render(
      errorBox,
      message ? h('div', { class: 'err-text' }, message) : null,
      errors.map((e) => h('div', { class: 'issue err' }, h('b', null, e.line ? `ligne ${e.line} ` : ''), e.path ? h('code', null, e.path) : null, ` ${e.message}`)),
      warnings.map((e) => h('div', { class: 'issue warn' }, e.path ? h('code', null, e.path) : null, ` ${e.message}`)),
    );
  }

  function fillForm(ref: Ref | null): void {
    if (!formBox || !textarea) return;
    const fields = ref ? fieldsFor(textarea.value, ref) : [];
    render(
      formBox,
      fields.length ? h('h4', null, 'Formulaire') : null,
      fields.map((f) => {
        const input = f.multiline ? h('textarea', { rows: Math.max(2, Math.ceil(f.value.length / 38)), value: f.value }) : h('input', { type: 'text', value: f.value });
        input.addEventListener('input', () => {
          const next = textarea ? setField(textarea.value, f.path, input.value) : null;
          if (next !== null && textarea) {
            textarea.value = next;
            updateDirty();
          }
        });
        return h('label', { class: 'field' }, h('span', null, f.label), input);
      }),
    );
  }

  const updateDirty = (): void => {
    const s = root.querySelector<HTMLButtonElement>('.save');
    if (s) s.disabled = !dirty();
    root.classList.toggle('dirty', dirty());
  };

  async function save(): Promise<void> {
    if (!currentFile || !textarea) return;
    const content = textarea.value;
    const r = await api.writeFile(currentFile, content);
    if (r.ok) {
      original = content;
      updateDirty();
      showErrors([], r.warnings);
      toast(`${currentFile} enregistré`);
    } else {
      showErrors(r.errors, r.warnings, r.errors.length === 0 ? (r.error ?? `Échec (${r.status})`) : `Refusé (${r.status}) : le fichier n'a pas été écrit.`);
    }
  }

  async function load(force: boolean): Promise<void> {
    const ref = state.selection;
    const game = state.game;
    const file = state.file ?? (ref && game ? fileOf(game, ref) : null);
    const key = `${ref ? refKey(ref) : ''}|${file ?? ''}`;
    if (!force && key === loadedKey && currentFile === file) return;
    loadedKey = key;
    currentFile = file;

    const title = ref && game ? titleOf(game, ref) : (file ?? '');
    const status = ref && game ? statusOf(game, ref) : null;
    const play = sceneOfRef(ref);
    textarea = null;
    if (!ref && !file) {
      render(root, h('div', { class: 'inspector-empty muted' }, h('h3', null, 'Inspecteur'), h('p', null, 'Sélectionnez un élément dans le graphe, la bible ou un tableau.')));
      return;
    }
    const text = file ? await api.readFile(file) : null;
    original = text ?? '';
    textarea = h('textarea', { class: 'yaml', spellcheck: false, value: original, oninput: updateDirty }) as HTMLTextAreaElement;
    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void save();
      }
    });
    errorBox = h('div', { class: 'issues' });
    notice = h('div', { class: 'notice', hidden: true }, 'Le fichier a changé sur le disque. ', h('button', { onclick: () => void load(true) }, 'Recharger (perd vos modifications)'));
    formBox = h('div', { class: 'form' });
    const header = h(
      'div',
      { class: 'ins-head' },
      h('div', { class: 'kind' }, ref ? KIND_LABEL[ref.kind] : 'Fichier'),
      h('h3', null, title),
      ref && game && status ? h('div', { class: 'row' }, badge(status), statusSelect(ref, status)) : null,
      play ? h('button', { class: 'primary', onclick: () => requestPlay(play) }, '▶ Jouer depuis ici') : null,
      file ? h('div', { class: 'muted file' }, file) : null,
    );
    render(
      root,
      header,
      ref ? relations(ref) : null,
      formBox,
      file
        ? h(
            'div',
            { class: 'yaml-box' },
            h('h4', null, 'Source'),
            notice,
            textarea,
            h('div', { class: 'row' }, h('button', { class: 'save primary', disabled: true, onclick: () => void save() }, 'Enregistrer'), h('button', { onclick: () => { if (textarea) { textarea.value = original; fillForm(ref); updateDirty(); showErrors([]); } } }, 'Annuler'), h('span', { class: 'muted' }, 'Ctrl+S')),
            errorBox,
          )
        : h('p', { class: 'muted' }, 'Cet élément n’a pas de fichier source.'),
    );
    fillForm(ref);
    // positionne le curseur sur l'élément dans les fichiers multi-éléments
    if (ref && ['item', 'quest', 'world', 'gag'].includes(ref.kind)) {
      const m = new RegExp(`^${ref.id}:`, 'm').exec(original);
      if (m) {
        const line = original.slice(0, m.index).split('\n').length - 1;
        textarea.scrollTop = Math.max(0, line * 18 - 20);
      }
    }
  }

  on('selection', () => void load(false));
  on('data', () => {
    if (state.file === null && state.selection === null) return;
    const changedHere = currentFile !== null && state.lastChanged.includes(currentFile);
    if (!changedHere) {
      // un renommage peut avoir changé le titre : on met à jour sans toucher au texte en cours d'édition
      if (!dirty()) void load(true);
      return;
    }
    if (dirty()) {
      if (notice) notice.hidden = false;
    } else void load(true);
  });
  void load(true);
}
