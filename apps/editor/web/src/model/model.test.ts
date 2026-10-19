import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateContent } from '@scroum/validate';
import { readContentDir } from '@scroum/validate/node';
import type { GameData } from '@scroum/schema';
import { buildGraph } from './graph';
import { itemTable } from './items';
import { bibleSummary } from './bible';
import { setStatusInFile } from './status';
import { fileOf } from './refs';

const demo = resolve(__dirname, '../../../../../examples/demo/content');
const report = validateContent(await readContentDir(demo));
const game = report.game as GameData;

describe('graphe', () => {
  const g = buildGraph(game, { issues: [...report.errors, ...report.warnings] });
  const ids = new Set(g.nodes.map((n) => n.id));

  it('contient scènes, dialogues, objets et quêtes', () => {
    for (const s of Object.keys(game.scenes)) expect(ids.has(`scene:${s}`)).toBe(true);
    for (const d of Object.keys(game.dialogues)) expect(ids.has(`dialogue:${d}`)).toBe(true);
    for (const i of Object.keys(game.items)) expect(ids.has(`item:${i}`)).toBe(true);
    for (const q of Object.keys(game.quests)) expect(ids.has(`quest:${q}`)).toBe(true);
  });

  it('relie la sortie du port au pied du phare et les objets à leur lieu', () => {
    expect(g.edges.some((e) => e.kind === 'exit' && e.source === 'scene:port' && e.target === 'scene:phare_bas')).toBe(true);
    expect(g.edges.some((e) => e.kind === 'give' && e.source === 'scene:port' && e.target === 'item:meche')).toBe(true);
    expect(g.edges.some((e) => e.kind === 'quest' && e.source === 'scene:port' && e.target === 'quest:rallumer_phare')).toBe(true);
  });

  it('toutes les arêtes pointent vers des nœuds existants', () => {
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it('déplie un dialogue en nœuds avec choix et parent', () => {
    const x = buildGraph(game, { expanded: new Set(['gardien']) });
    const n1 = x.nodes.find((n) => n.id === 'dnode:gardien/n1');
    expect(n1?.parent).toBe('dialogue:gardien');
    expect(x.edges.some((e) => e.kind === 'choice' && e.source === 'dnode:gardien/n1' && e.target === 'dnode:gardien/huile')).toBe(true);
    expect(x.edges.some((e) => e.source === 'dnode:gardien/n1' && e.target === 'dnode:gardien/reconnaissance' && e.label.includes('photo_ancienne'))).toBe(true);
  });

  it('met en évidence les orphelins signalés par la validation', () => {
    const issues = [{ severity: 'warning' as const, code: 'orphan_scene', file: game.scenes.lanterne!.source, path: '', message: 'x' }];
    const x = buildGraph(game, { issues });
    expect(x.nodes.find((n) => n.id === 'scene:lanterne')?.orphan).toBe(true);
    expect(x.nodes.find((n) => n.id === 'scene:port')?.orphan).toBe(false);
  });
});

describe('table des objets', () => {
  const rows = itemTable(game);
  const row = (id: string) => rows.find((r) => r.id === id)!;
  it('liste tous les objets', () => expect(rows.map((r) => r.id).sort()).toEqual(Object.keys(game.items).sort()));
  it('trouve où on obtient la mèche', () => {
    expect(row('meche').obtained.some((o) => o.from.scene === 'port')).toBe(true);
  });
  it('trouve où sert la photo (on_give du gardien)', () => {
    expect(row('photo_ancienne').used.some((u) => u.how === 'on_give' && u.from.dialogue === 'gardien')).toBe(true);
  });
  it('la mèche huilée vient d’une combinaison', () => {
    expect(row('meche_huilee').obtained.some((o) => o.how === 'combine')).toBe(true);
  });
});

describe('bible', () => {
  const s = bibleSummary(game);
  it('compte par statut et liste ce qui reste à valider', () => {
    expect(s.total).toBe(s.entries.length);
    expect(Object.values(s.byStatus).reduce((a, b) => a + b, 0)).toBe(s.total);
    expect(s.todo.items.map((e) => e.ref.id)).toContain('coquillage');
    expect(s.todo.items.map((e) => e.ref.id)).not.toContain('meche');
    expect(s.todo.dialogues.map((e) => e.ref.id)).toContain('gardien');
  });
});

describe('changement de statut', () => {
  it('élément à la racine du fichier (scène)', () => {
    const out = setStatusInFile('# c\nstatus: review\ntitle: x\n', { kind: 'scene', id: 'port' }, 'validated');
    expect(out).toContain('status: validated');
    expect(out).toContain('# c');
  });
  it('entrée d’un fichier multi-éléments', () => {
    const out = setStatusInFile('a:\n  status: draft\n  name: A\nb:\n  status: draft\n', { kind: 'item', id: 'b' }, 'validated')!;
    expect(out).toContain('b:\n  status: validated');
    expect(out).toContain('a:\n  status: draft');
  });
  it('gag en forme abrégée', () => {
    const out = setStatusInFile('g: "texte"\n', { kind: 'gag', id: 'g' }, 'review')!;
    expect(out).toMatch(/status: review/);
    expect(out).toMatch(/text: texte|text: "texte"/);
  });
  it('document Markdown avec ou sans front matter', () => {
    expect(setStatusInFile('---\nstatus: draft\n---\n# T\n', { kind: 'doc', id: 'pitch' }, 'validated')).toBe('---\nstatus: validated\n---\n# T\n');
    expect(setStatusInFile('# T\n', { kind: 'doc', id: 'pitch' }, 'review')).toBe('---\nstatus: review\n---\n# T\n');
  });
  it('fileOf', () => expect(fileOf(game, { kind: 'item', id: 'meche' })).toBe('items.yaml'));
});

import { claudeItems } from './claude-stream';
import { parsePlayerMessage, playUrl } from './protocol';
import { fieldsFor, setField } from './yamlEdit';

describe('formulaire YAML', () => {
  const src = 'status: draft # c\nspeaker: x\nstart: a\nnodes:\n  a:\n    lines:\n      - "Bonjour"\n      - { speaker: margot, text: "Salut" }\n    choices:\n      - { label: "Oui", next: b }\n  b:\n    lines: "Fin"\n';
  it('liste les répliques et choix d’un nœud', () => {
    const f = fieldsFor(src, { kind: 'dnode', id: 'x', node: 'a' });
    expect(f.map((x) => x.value)).toEqual(['Bonjour', 'Salut', 'Oui']);
    expect(fieldsFor(src, { kind: 'dnode', id: 'x', node: 'b' })[0]?.value).toBe('Fin');
  });
  it('modifie sans perdre les commentaires', () => {
    const f = fieldsFor(src, { kind: 'dnode', id: 'x', node: 'a' });
    const out = setField(src, f[1]!.path, 'Coucou')!;
    expect(out).toContain('Coucou');
    expect(out).toContain('# c');
    expect(fieldsFor(out, { kind: 'dnode', id: 'x', node: 'a' })[1]?.value).toBe('Coucou');
  });
  it('champs d’un hotspot de la démo', async () => {
    const text = (await readContentDir(demo)).get('scenes/port.yaml') as string;
    const f = fieldsFor(text, { kind: 'hotspot', id: 'rochers', parent: 'port' });
    expect(f[0]?.value).toBe('Rochers');
    expect(f.some((x) => x.label.includes('look'))).toBe(true);
  });
});

describe('protocole playtest', () => {
  it('accepte un message state et normalise', () => {
    const m = parsePlayerMessage({ scroum: 'state', state: { scene: 'port', flags: ['a'], vars: { x: 1 }, counters: {}, inventory: { meche: 1 }, dialogue: { id: 'loic', node: 'menu', pending_scene: null } }, lastEvents: [{ type: 'say' }], intent: { intent: 'saluer', confidence: 0.8 } });
    expect(m?.scroum).toBe('state');
    if (m?.scroum === 'state') {
      expect(m.state.dialogue).toEqual({ id: 'loic', node: 'menu' });
      expect(m.intent?.confidence).toBe(0.8);
    }
  });
  it('rejette le reste', () => {
    expect(parsePlayerMessage({ foo: 1 })).toBeNull();
    expect(parsePlayerMessage('x')).toBeNull();
    expect(parsePlayerMessage({ scroum: 'state' })).toBeNull();
  });
  it('construit l’URL', () => expect(playUrl('port')).toBe('/play/?source=%2Fapi&scene=port'));
});

describe('flux Claude', () => {
  it('extrait texte, outils et résultat', () => {
    expect(claudeItems({ type: 'assistant', message: { content: [{ type: 'text', text: 'Je modifie.' }, { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/a/b.yaml' } }] } })).toEqual([
      { kind: 'text', text: 'Je modifie.' },
      { kind: 'tool', id: 't1', name: 'Edit', summary: '/a/b.yaml' },
    ]);
    expect(claudeItems({ type: 'result', result: 'ok', is_error: false })[0]?.kind).toBe('result');
    expect(claudeItems({ type: 'rate_limit_event' })).toEqual([]);
  });
});
