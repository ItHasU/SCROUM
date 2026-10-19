/** Vue Graphe : Cytoscape + ELK. */
import cytoscape from 'cytoscape';
import elk from 'cytoscape-elk';
import type { Id } from '@scroum/schema';
import { h } from '../dom';
import { buildGraph, type GraphEdgeKind, type GraphModel, type GraphNode, type GraphNodeKind } from '../model/graph';
import type { Ref } from '../model/refs';
import { on, select, state } from '../store';
import type { View } from './view';

cytoscape.use(elk);

const WORLD_HUES = [210, 28, 140, 330, 50, 270, 180, 0];
const css = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function nodeIdForRef(ref: Ref | null): string | null {
  if (!ref) return null;
  switch (ref.kind) {
    case 'scene':
      return `scene:${ref.id}`;
    case 'hotspot':
      return ref.parent ? `scene:${ref.parent}` : null;
    case 'dialogue':
      return `dialogue:${ref.id}`;
    case 'dnode':
      return ref.node ? `dnode:${ref.id}/${ref.node}` : `dialogue:${ref.id}`;
    case 'item':
      return `item:${ref.id}`;
    case 'quest':
      return `quest:${ref.id}`;
    default:
      return null;
  }
}

const EDGE_STYLE: Record<GraphEdgeKind, { color: string; style: 'solid' | 'dashed' | 'dotted'; width: number }> = {
  exit: { color: '--edge', style: 'solid', width: 2 },
  goto: { color: '--edge', style: 'dashed', width: 2 },
  start_dialogue: { color: '--c-dialogue', style: 'dotted', width: 2 },
  choice: { color: '--c-dialogue', style: 'solid', width: 1 },
  intent: { color: '--c-intent', style: 'dashed', width: 1 },
  next: { color: '--c-dialogue', style: 'solid', width: 1 },
  give: { color: '--c-give', style: 'solid', width: 2 },
  require: { color: '--c-require', style: 'dashed', width: 2 },
  combine: { color: '--c-give', style: 'dotted', width: 1 },
  quest: { color: '--c-quest', style: 'dotted', width: 1 },
};

export function createGraphView(): View & { relayout(): void; model(): GraphModel | null } {
  const expanded = new Set<Id>();
  const hidden = new Set<GraphNodeKind>();
  let cy: cytoscape.Core | null = null;
  let model: GraphModel | null = null;
  let dirty = true;
  let firstFit = true;
  let guard = false;
  let lastTap = { id: '', t: 0 };

  const canvas = h('div', { class: 'cy' });
  const legend = h('div', { class: 'legend' });
  const empty = h('p', { class: 'muted pad' }, '');

  const toggle = (kind: GraphNodeKind, label: string): HTMLElement =>
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: true, onchange: (e: Event) => {
      if ((e.target as HTMLInputElement).checked) hidden.delete(kind);
      else hidden.add(kind);
      rebuild(true);
    } }), label);

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    toggle('dialogue', 'Dialogues'),
    toggle('item', 'Objets'),
    toggle('quest', 'Quêtes'),
    h('button', { onclick: () => { for (const d of Object.keys(state.game?.dialogues ?? {})) expanded.add(d); rebuild(true); } }, 'Déplier les dialogues'),
    h('button', { onclick: () => { expanded.clear(); rebuild(true); } }, 'Replier'),
    h('button', { onclick: () => cy?.fit(undefined, 30) }, 'Ajuster'),
    h('span', { class: 'muted hint' }, 'Double-clic sur un dialogue : déplier/replier'),
    legend,
  );
  const el = h('div', { class: 'view graph' }, toolbar, h('div', { class: 'cy-wrap' }, canvas, empty));

  function colorsForWorlds(): Map<string, string> {
    const dark = document.documentElement.dataset.theme === 'dark';
    const m = new Map<string, string>();
    Object.keys(state.game?.worlds ?? {}).forEach((w, i) => m.set(w, `hsl(${WORLD_HUES[i % WORLD_HUES.length]}, ${dark ? 45 : 60}%, ${dark ? 30 : 82}%)`));
    return m;
  }

  function styleSheet(): cytoscape.StylesheetJson {
    const text = css('--text');
    const base: cytoscape.StylesheetJson = [
      { selector: 'node', style: { label: 'data(label)', color: text, 'font-size': 11, 'text-wrap': 'wrap', 'text-max-width': '150px', 'text-valign': 'center', 'text-halign': 'center', shape: 'round-rectangle', width: 'label', height: 'label', padding: '9px', 'background-color': 'data(color)', 'border-width': 2, 'border-color': css('--st-none') } },
      { selector: 'node[kind="scene"]', style: { 'font-weight': 'bold', padding: '12px' } },
      { selector: 'node[kind="dialogue"]', style: { shape: 'round-tag', 'background-color': css('--bg-dialogue') } },
      { selector: 'node[kind="dialogue"][?expanded]', style: { 'text-valign': 'top', 'background-opacity': 0.25, padding: '14px' } },
      { selector: 'node[kind="dnode"]', style: { shape: 'rectangle', 'font-size': 10, 'background-color': css('--bg-dialogue') } },
      { selector: 'node[kind="item"]', style: { shape: 'diamond', 'background-color': css('--bg-item'), padding: '14px' } },
      { selector: 'node[kind="quest"]', style: { shape: 'hexagon', 'background-color': css('--bg-quest'), padding: '12px' } },
      { selector: 'node[status="validated"]', style: { 'border-color': css('--st-validated') } },
      { selector: 'node[status="review"]', style: { 'border-color': css('--st-review') } },
      { selector: 'node[status="draft"]', style: { 'border-color': css('--st-draft'), 'border-style': 'dashed' } },
      { selector: 'node[status="rejected"]', style: { 'border-color': css('--st-rejected'), 'border-style': 'double', 'border-width': 4 } },
      { selector: 'node.orphan', style: { 'underlay-color': css('--danger'), 'underlay-opacity': 0.45, 'underlay-padding': 7, 'underlay-shape': 'round-rectangle', 'border-width': 3 } },
      { selector: 'node:selected', style: { 'border-color': css('--accent'), 'border-width': 4, 'border-style': 'solid' } },
      { selector: 'edge', style: { 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.9, label: 'data(label)', 'font-size': 9, color: css('--muted'), 'text-background-color': css('--bg'), 'text-background-opacity': 0.85, 'text-background-padding': '2px', 'text-wrap': 'ellipsis', 'text-max-width': '110px', 'text-rotation': 'autorotate' } },
      { selector: 'edge:selected', style: { width: 4 } },
    ];
    for (const [kind, s] of Object.entries(EDGE_STYLE)) {
      base.push({ selector: `edge[kind="${kind}"]`, style: { 'line-color': css(s.color), 'target-arrow-color': css(s.color), 'line-style': s.style, width: s.width } });
    }
    return base;
  }

  function toElements(m: GraphModel): cytoscape.ElementDefinition[] {
    const worldColor = colorsForWorlds();
    const els: cytoscape.ElementDefinition[] = [];
    for (const n of m.nodes) {
      els.push({
        group: 'nodes',
        data: { id: n.id, label: n.label, kind: n.kind, status: n.status ?? '', expanded: n.expanded ?? false, color: (n.world && worldColor.get(n.world)) || css('--bg-card'), ...(n.parent ? { parent: n.parent } : {}) },
        classes: n.orphan ? 'orphan' : '',
      });
    }
    for (const e of m.edges) els.push({ group: 'edges', data: { id: e.id, source: e.source, target: e.target, kind: e.kind, label: e.label } });
    return els;
  }

  function renderLegend(): void {
    const colors = colorsForWorlds();
    legend.replaceChildren(
      ...[...colors].map(([w, c]) => h('span', { class: 'lg' }, h('i', { style: `background:${c}` }), state.game?.worlds[w]?.name ?? w)),
      h('span', { class: 'lg' }, h('i', { class: 'orph' }), 'orphelin'),
    );
  }

  function rebuild(force = false): void {
    if (!state.game) {
      empty.textContent = 'Aucun jeu chargé.';
      return;
    }
    empty.textContent = '';
    if (!force && el.hidden) {
      dirty = true;
      return;
    }
    const issues = [...(state.report?.errors ?? []), ...(state.report?.warnings ?? [])];
    model = buildGraph(state.game, { expanded, issues, hide: hidden });
    renderLegend();
    const pan = cy?.pan();
    const zoom = cy?.zoom();
    cy?.destroy();
    cy = cytoscape({ container: canvas, headless: /jsdom/i.test(navigator.userAgent) /* tests sans canvas */, elements: toElements(model), style: styleSheet(), minZoom: 0.1, maxZoom: 2.5 });
    cy.on('tap', 'node', (ev) => {
      const id = ev.target.id() as string;
      const now = Date.now();
      const n = model?.nodes.find((x) => x.id === id);
      if (n?.kind === 'dialogue' && lastTap.id === id && now - lastTap.t < 400) {
        const d = n.ref.id;
        if (expanded.has(d)) expanded.delete(d);
        else expanded.add(d);
        lastTap = { id: '', t: 0 };
        rebuild(true);
        return;
      }
      lastTap = { id, t: now };
      if (n && !guard) select(n.ref);
    });
    cy.on('tap', (ev) => {
      if (ev.target === cy && !guard) select(null);
    });
    dirty = false;
    const keepView = !firstFit && pan && zoom !== undefined;
    const layout = cy.layout({
      name: 'elk',
      fit: !keepView,
      padding: 30,
      animate: false,
      nodeDimensionsIncludeLabels: true,
      elk: { algorithm: 'layered', 'elk.direction': 'RIGHT', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.spacing.nodeNode': 36, 'elk.layered.spacing.nodeNodeBetweenLayers': 70, 'elk.edgeRouting': 'SPLINES' },
    } as cytoscape.LayoutOptions);
    layout.one('layoutstop', () => {
      if (keepView && cy) {
        cy.zoom(zoom!);
        cy.pan(pan!);
      }
      firstFit = false;
      el.dataset.ready = String(model?.nodes.length ?? 0);
      syncSelection();
    });
    layout.run();
  }

  function syncSelection(): void {
    if (!cy) return;
    guard = true;
    cy.elements().unselect();
    const id = nodeIdForRef(state.selection);
    if (id) cy.getElementById(id).select();
    guard = false;
  }

  on('selection', syncSelection);
  document.addEventListener('themechange', () => {
    if (cy) {
      cy.style(styleSheet());
      cy.nodes().forEach((n) => {
        const node = model?.nodes.find((x: GraphNode) => x.id === n.id());
        if (node) n.data('color', (node.world && colorsForWorlds().get(node.world)) || css('--bg-card'));
      });
      renderLegend();
    }
  });

  return {
    el,
    update: () => rebuild(false),
    onShow: () => {
      if (dirty || !cy) rebuild(true);
      else {
        cy.resize();
        syncSelection();
      }
    },
    relayout: () => rebuild(true),
    model: () => model,
  };
}

