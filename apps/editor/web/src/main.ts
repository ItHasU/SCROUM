/** Point d'entrée du front de l'éditeur SCROUM. */
import './style.css';
import { api } from './api';
import { $, h } from './dom';
import { connectEvents, on, reload, setView, state, type ViewName } from './store';
import { createBibleView } from './ui/bible';
import { createClaudeView } from './ui/claude';
import { toast } from './ui/common';
import { createFilesView } from './ui/files';
import { createGraphView } from './ui/graph';
import { createInspector } from './ui/inspector';
import { createItemsView } from './ui/items';
import { createPlaytestView } from './ui/playtest';
import { createValidation } from './ui/validation';
import type { View } from './ui/view';

const NAV: [ViewName, string][] = [
  ['bible', 'Bible'],
  ['graph', 'Graphe'],
  ['items', 'Objets'],
  ['files', 'Fichiers'],
  ['playtest', 'Playtest'],
  ['claude', 'Claude'],
];

function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('scroum-theme', theme);
  } catch {
    /* stockage indisponible */
  }
  document.dispatchEvent(new Event('themechange'));
}

function initialTheme(): 'dark' | 'light' {
  try {
    const t = localStorage.getItem('scroum-theme');
    if (t === 'dark' || t === 'light') return t;
  } catch {
    /* ignore */
  }
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function boot(): void {
  document.documentElement.dataset.theme = initialTheme();
  const app = $('#app');
  const title = h('span', { class: 'title' }, 'SCROUM');
  const counter = h('button', { class: 'counter', id: 'validation-counter', title: 'Rapport de validation' }, '…');
  const live = h('span', { class: 'live', title: 'Connexion temps réel (SSE)' }, '●');
  const buildBtn = h('button', {
    onclick: () => {
      buildBtn.disabled = true;
      void api.build().then((r) => {
        buildBtn.disabled = false;
        toast(r.ok ? `Zip écrit : ${r.zip}` : `Build refusé : ${r.errors?.[0]?.message ?? 'erreurs de validation'}`, r.ok ? 'ok' : 'err');
      });
    },
  }, 'Builder');
  const themeBtn = h('button', { title: 'Thème', onclick: () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') }, '◐');
  const header = h('header', { class: 'top' }, title, counter, h('span', { class: 'spacer' }), live, buildBtn, themeBtn);
  const drawer = h('div', { class: 'drawer', id: 'validation-drawer' });
  const nav = h('nav', { class: 'side' });
  const center = h('main', { class: 'center' });
  const inspector = h('aside', { class: 'inspector' });
  const toasts = h('div', { id: 'toasts' });
  app.replaceChildren(header, drawer, h('div', { class: 'body' }, nav, center, inspector), toasts);

  const views: Record<ViewName, View> = {
    bible: createBibleView(),
    graph: createGraphView(),
    items: createItemsView(),
    files: createFilesView(),
    playtest: createPlaytestView(),
    claude: createClaudeView(),
  };
  const navButtons = new Map<ViewName, HTMLElement>();
  for (const [name, label] of NAV) {
    const b = h('button', { class: 'nav-btn', dataset: { view: name }, onclick: () => setView(name) }, label);
    navButtons.set(name, b);
    nav.appendChild(b);
    views[name].el.hidden = true;
    center.appendChild(views[name].el);
  }
  const validation = createValidation(counter, drawer);
  createInspector(inspector);

  const showView = (): void => {
    for (const [name, v] of Object.entries(views) as [ViewName, View][]) {
      const active = name === state.view;
      if (v.el.hidden === active) {
        v.el.hidden = !active;
        if (active) v.onShow?.();
      }
      navButtons.get(name)?.classList.toggle('active', active);
    }
    window.location.hash = state.view;
  };
  on('view', showView);
  on('data', () => {
    title.textContent = state.report?.title ?? state.project?.name ?? 'SCROUM';
    document.title = `${title.textContent} — Éditeur SCROUM`;
    validation.update();
    for (const v of Object.values(views)) v.update();
  });
  on('selection', () => views.claude.update());

  const fromHash = window.location.hash.slice(1) as ViewName;
  if (NAV.some(([n]) => n === fromHash)) state.view = fromHash;
  void (async () => {
    state.project = await api.project();
    await reload();
    showView();
    connectEvents();
  })();
  void live;
}

boot();
