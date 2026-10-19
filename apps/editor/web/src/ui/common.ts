/** Éléments d'interface partagés : badges, liens vers un élément, sélecteur de statut, toasts. */
import type { ContentError, GameData, Status } from '@scroum/schema';
import { api } from '../api';
import { h, type Child } from '../dom';
import { fileOf, refKey, type Ref } from '../model/refs';
import { setStatusInFile, STATUSES } from '../model/status';
import { select, state } from '../store';

export const STATUS_LABEL: Record<Status, string> = { draft: 'brouillon', review: 'à relire', validated: 'validé', rejected: 'rejeté' };

export function badge(status: Status | null): HTMLElement {
  return status ? h('span', { class: `badge st-${status}` }, STATUS_LABEL[status]) : h('span', { class: 'badge st-none' }, '—');
}

export function toast(message: string, kind: 'ok' | 'err' = 'ok'): void {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('div', { class: `toast ${kind}` }, message);
  box.appendChild(t);
  window.setTimeout(() => t.remove(), kind === 'err' ? 7000 : 2500);
}

/** Bouton-lien qui sélectionne un élément (l'inspecteur l'affiche). */
export function refLink(ref: Ref | null, text: string, title?: string): HTMLElement {
  if (!ref) return h('span', { class: 'muted' }, text);
  return h('button', { class: 'link', title: title ?? refKey(ref), onclick: () => select(ref) }, text);
}

/** Sélecteur de statut : réécrit le fichier source via l'API. */
export function statusSelect(ref: Ref, current: Status): HTMLElement {
  const sel = h(
    'select',
    {
      class: `status-select st-${current}`,
      title: 'Changer le statut (écrit le fichier)',
      onchange: () => {
        void changeStatus(ref, sel.value as Status).then((ok) => {
          if (!ok) sel.value = current;
        });
      },
    },
    STATUSES.map((s) => h('option', { value: s, selected: s === current }, STATUS_LABEL[s])),
  );
  return sel;
}

export async function changeStatus(ref: Ref, status: Status): Promise<boolean> {
  const game = state.game;
  const file = game ? fileOf(game, ref) : null;
  if (!file) {
    toast('Fichier source introuvable', 'err');
    return false;
  }
  const text = await api.readFile(file);
  const next = text === null ? null : setStatusInFile(text, ref, status);
  if (next === null) {
    toast(`Impossible de modifier le statut dans ${file}`, 'err');
    return false;
  }
  const r = await api.writeFile(file, next);
  if (!r.ok) {
    toast(`${file} : ${r.errors[0]?.message ?? r.error ?? 'refusé'}`, 'err');
    return false;
  }
  toast(`${ref.id} → ${STATUS_LABEL[status]}`);
  return true;
}

/** Élément correspondant à un fichier (et un chemin interne) pour naviguer depuis un message de validation. */
export function refForIssue(game: GameData | null, issue: ContentError): Ref | null {
  if (!game) return null;
  const f = issue.file;
  for (const s of Object.values(game.scenes)) if (s.source === f) return { kind: 'scene', id: s.id };
  for (const d of Object.values(game.dialogues)) {
    if (d.source !== f) continue;
    const nm = /^nodes\.([^.[]+)/.exec(issue.path);
    return nm?.[1] ? { kind: 'dnode', id: d.id, node: nm[1] } : { kind: 'dialogue', id: d.id };
  }
  for (const c of Object.values(game.characters)) if (c.source === f) return { kind: 'character', id: c.id };
  for (const d of Object.values(game.bible.docs)) if (d.source === f) return { kind: 'doc', id: d.id };
  const first = (path: string): string | null => /^([A-Za-z0-9_]+)/.exec(path)?.[1] ?? null;
  const key = first(issue.path);
  if (key) {
    if (f === 'items.yaml' && game.items[key]) return { kind: 'item', id: key };
    if (game.quests[key]?.source === f) return { kind: 'quest', id: key };
    if (game.worlds[key]?.source === f) return { kind: 'world', id: key };
    if (game.bible.gags[key]?.source === f) return { kind: 'gag', id: key };
  }
  return null;
}

export function openIssue(issue: ContentError): void {
  const ref = refForIssue(state.game, issue);
  select(ref, ref ? null : issue.file);
}

export function section(title: string, ...children: Child[]): HTMLElement {
  return h('section', { class: 'card' }, h('h3', null, title), ...children);
}
