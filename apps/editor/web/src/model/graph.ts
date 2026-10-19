/** Construction du graphe (nœuds / arêtes Cytoscape) à partir d'un GameData. */
import type { ContentError, GameData, Id, Status } from '@scroum/schema';
import { collectFacts, type Place } from './facts';
import type { Ref } from './refs';

export type GraphNodeKind = 'scene' | 'dialogue' | 'dnode' | 'item' | 'quest';
export type GraphEdgeKind = 'exit' | 'goto' | 'start_dialogue' | 'choice' | 'intent' | 'next' | 'give' | 'require' | 'combine' | 'quest';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  world: Id | null;
  status: Status | null;
  orphan: boolean;
  /** Dialogue ouvert : nœud composé (parent des `dnode`). */
  expanded?: boolean;
  parent?: string;
  ref: Ref;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  label: string;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphOptions {
  /** Dialogues dépliés en nœuds. */
  expanded?: ReadonlySet<Id>;
  /** Avertissements/erreurs de validation (orphelins). */
  issues?: readonly ContentError[];
  /** Types d'objets à masquer. */
  hide?: ReadonlySet<GraphNodeKind>;
}

export const sceneNodeId = (id: Id): string => `scene:${id}`;
export const dialogueNodeId = (id: Id): string => `dialogue:${id}`;
export const dnodeId = (d: Id, n: Id): string => `dnode:${d}/${n}`;
export const itemNodeId = (id: Id): string => `item:${id}`;
export const questNodeId = (id: Id): string => `quest:${id}`;

const short = (s: string, n = 40): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function buildGraph(game: GameData, opts: GraphOptions = {}): GraphModel {
  const expanded = opts.expanded ?? new Set<Id>();
  const issues = opts.issues ?? [];
  const nodes: GraphNode[] = [];
  const edges = new Map<string, GraphEdge>();

  // --- orphelins signalés par la validation
  const orphanScenes = new Set<Id>();
  const orphanDialogues = new Set<Id>();
  const orphanNodes = new Set<string>();
  for (const i of issues) {
    if (i.code === 'orphan_scene') for (const s of Object.values(game.scenes)) if (s.source === i.file) orphanScenes.add(s.id);
    if (i.code === 'orphan_dialogue') for (const d of Object.values(game.dialogues)) if (d.source === i.file) orphanDialogues.add(d.id);
    if (i.code === 'orphan_node') {
      const nm = /^nodes\.(.+)$/.exec(i.path);
      for (const d of Object.values(game.dialogues)) if (d.source === i.file && nm?.[1]) orphanNodes.add(dnodeId(d.id, nm[1]));
    }
  }

  const sceneWorld = (id: Id): Id | null => game.scenes[id]?.world ?? null;
  const dialogueWorld = (id: Id): Id | null => {
    // le monde d'un dialogue = celui de la première scène qui le lance
    for (const j of facts.jumps) if (j.type === 'start_dialogue' && j.target === id && j.from.scene) return sceneWorld(j.from.scene);
    return null;
  };
  const facts = collectFacts(game);

  /** Nœud du graphe représentant « dialogue d, nœud n » (dialogue entier si replié). */
  const dEndpoint = (d: Id, n: Id | null): string => {
    const dlg = game.dialogues[d];
    if (!dlg) return dialogueNodeId(d);
    return expanded.has(d) ? dnodeId(d, n ?? dlg.start) : dialogueNodeId(d);
  };
  const endpointOf = (p: Place): string | null => {
    if (p.scene) return sceneNodeId(p.scene);
    if (p.dialogue) return dEndpoint(p.dialogue, p.node ?? null);
    if (p.item) return itemNodeId(p.item);
    return null;
  };

  const addEdge = (source: string, target: string, kind: GraphEdgeKind, label = ''): void => {
    if (source === target) return;
    const id = `${kind}|${source}|${target}`;
    const old = edges.get(id);
    if (old) {
      if (label && !old.label.split(' / ').includes(label)) old.label = old.label ? `${old.label} / ${label}` : label;
      return;
    }
    edges.set(id, { id, source, target, kind, label });
  };

  // --- nœuds
  for (const s of Object.values(game.scenes)) {
    nodes.push({ id: sceneNodeId(s.id), kind: 'scene', label: s.title ?? s.id, world: s.world, status: s.status, orphan: orphanScenes.has(s.id), ref: { kind: 'scene', id: s.id } });
  }
  for (const d of Object.values(game.dialogues)) {
    const world = dialogueWorld(d.id);
    const who = game.characters[d.speaker]?.identity.name ?? d.speaker;
    const isOpen = expanded.has(d.id);
    nodes.push({
      id: dialogueNodeId(d.id),
      kind: 'dialogue',
      label: `Dialogue : ${who}`,
      world,
      status: d.status,
      orphan: orphanDialogues.has(d.id),
      expanded: isOpen,
      ref: { kind: 'dialogue', id: d.id },
    });
    if (isOpen) {
      for (const n of Object.values(d.nodes)) {
        const first = n.lines[0];
        nodes.push({
          id: dnodeId(d.id, n.id),
          kind: 'dnode',
          label: `${n.id}${first ? ` — ${short(first.text, 36)}` : ''}`,
          world,
          status: d.status,
          orphan: orphanNodes.has(dnodeId(d.id, n.id)),
          parent: dialogueNodeId(d.id),
          ref: { kind: 'dnode', id: d.id, node: n.id },
        });
      }
    }
  }
  for (const it of Object.values(game.items)) {
    nodes.push({ id: itemNodeId(it.id), kind: 'item', label: it.name, world: null, status: it.status, orphan: false, ref: { kind: 'item', id: it.id } });
  }
  for (const q of Object.values(game.quests)) {
    nodes.push({ id: questNodeId(q.id), kind: 'quest', label: q.title, world: null, status: q.status, orphan: false, ref: { kind: 'quest', id: q.id } });
  }

  // --- arêtes : sorties
  for (const s of Object.values(game.scenes)) {
    for (const e of s.exits) if (game.scenes[e.to]) addEdge(sceneNodeId(s.id), sceneNodeId(e.to), 'exit', e.label);
  }
  // --- arêtes : scripts
  for (const j of facts.jumps) {
    const src = endpointOf(j.from);
    if (!src) continue;
    if (j.type === 'goto_scene' && game.scenes[j.target]) addEdge(src, sceneNodeId(j.target), 'goto', 'goto');
    else if (j.type === 'start_dialogue' && game.dialogues[j.target]) addEdge(src, dEndpoint(j.target, j.node), 'start_dialogue', 'dialogue');
    else if ((j.type === 'unlock_quest' || j.type === 'complete_quest') && game.quests[j.target]) {
      addEdge(src, questNodeId(j.target), 'quest', j.type === 'unlock_quest' ? 'débloque' : 'termine');
    }
  }
  // --- arêtes : objets
  for (const g of facts.gives) {
    if (!game.items[g.item]) continue;
    if (g.how === 'combine' && g.from.item) addEdge(itemNodeId(g.from.item), itemNodeId(g.item), 'combine', 'combinaison');
    else {
      const src = endpointOf(g.from);
      if (src) addEdge(src, itemNodeId(g.item), 'give', 'obtenu ici');
    }
  }
  for (const n of facts.needs) {
    if (!game.items[n.item] || n.how === 'combine') continue;
    const dst = endpointOf(n.from);
    if (dst) addEdge(itemNodeId(n.item), dst, 'require', 'requis là');
  }
  // --- arêtes : dialogues dépliés
  for (const d of Object.values(game.dialogues)) {
    if (!expanded.has(d.id)) continue;
    for (const n of Object.values(d.nodes)) {
      const from = dnodeId(d.id, n.id);
      const to = (id: Id | null): string | null => (id && d.nodes[id] ? dnodeId(d.id, id) : null);
      const t0 = to(n.next);
      if (t0) addEdge(from, t0, 'next', '');
      for (const c of n.choices) {
        const t = to(c.next);
        if (t) addEdge(from, t, 'choice', short(c.label, 28));
      }
      if (n.free_text) {
        for (const [intent, tr] of Object.entries(n.free_text.intents)) {
          const t = to(tr.next);
          if (t) addEdge(from, t, 'intent', `~${intent}`);
        }
        const tf = to(n.free_text.fallback.next);
        if (tf) addEdge(from, tf, 'intent', '~fallback');
      }
      for (const key of ['on_give', 'on_show'] as const) {
        const r = n[key];
        if (!r) continue;
        for (const [item, tr] of Object.entries(r.byItem)) {
          const t = to(tr.next);
          if (t) addEdge(from, t, 'next', `${key === 'on_give' ? 'donner' : 'montrer'} ${item}`);
        }
        const td = to(r.default?.next ?? null);
        if (td) addEdge(from, td, 'next', `${key === 'on_give' ? 'donner' : 'montrer'} autre`);
      }
    }
  }

  // --- orphelins d'objets / quêtes : aucune arête incidente
  const touched = new Set<string>();
  for (const e of edges.values()) {
    touched.add(e.source);
    touched.add(e.target);
  }
  for (const n of nodes) if ((n.kind === 'item' || n.kind === 'quest') && !touched.has(n.id)) n.orphan = true;

  const hide = opts.hide ?? new Set<GraphNodeKind>();
  const kept = nodes.filter((n) => !hide.has(n.kind) && !(n.parent && hide.has('dialogue')));
  const ids = new Set(kept.map((n) => n.id));
  return { nodes: kept, edges: [...edges.values()].filter((e) => ids.has(e.source) && ids.has(e.target)) };
}
