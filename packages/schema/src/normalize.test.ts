import { describe, expect, it } from 'vitest';
import {
  createNormCtx,
  normalizeCondition,
  normalizeHotspotActions,
  normalizeItemReactions,
  normalizeScript,
  normalizeTransition,
  type NormCtx,
} from './normalize';
import type { Condition, Script } from './types';

function cond(raw: unknown): { value: Condition; ctx: NormCtx } {
  const ctx = createNormCtx();
  return { value: normalizeCondition(raw, [], ctx), ctx };
}
function script(raw: unknown): { value: Script; ctx: NormCtx } {
  const ctx = createNormCtx();
  return { value: normalizeScript(raw, [], ctx), ctx };
}
function ok<T>(r: { value: T; ctx: NormCtx }): T {
  expect(r.ctx.issues).toEqual([]);
  return r.value;
}

describe('normalizeCondition', () => {
  it('flag, has_item, ever_had_item', () => {
    expect(ok(cond({ flag: 'porte_ouverte' }))).toEqual({ kind: 'flag', flag: 'porte_ouverte' });
    expect(ok(cond('porte_ouverte'))).toEqual({ kind: 'flag', flag: 'porte_ouverte' });
    expect(ok(cond({ has_item: 'cle' }))).toEqual({ kind: 'has_item', item: 'cle' });
    expect(ok(cond({ ever_had_item: 'cle' }))).toEqual({ kind: 'ever_had_item', item: 'cle' });
  });

  it('var, counter, item_qty avec comparateurs', () => {
    expect(ok(cond({ var: 'confiance', gte: 2 }))).toEqual({ kind: 'var', var: 'confiance', cmp: { gte: 2 } });
    expect(ok(cond({ counter: 'points', lte: 5, gt: 1 }))).toEqual({ kind: 'counter', counter: 'points', cmp: { lte: 5, gt: 1 } });
    expect(ok(cond({ item_qty: 'coquillage', eq: 3 }))).toEqual({ kind: 'item_qty', item: 'coquillage', cmp: { eq: 3 } });
  });

  it('quest avec état par défaut unlocked', () => {
    expect(ok(cond({ quest: 'q1' }))).toEqual({ kind: 'quest', quest: 'q1', state: 'unlocked' });
    expect(ok(cond({ quest: 'q1', state: 'completed' }))).toEqual({ kind: 'quest', quest: 'q1', state: 'completed' });
  });

  it('all, any, not, et liste ≡ all', () => {
    expect(ok(cond({ all: [{ flag: 'a' }, { not: { flag: 'b' } }] }))).toEqual({
      kind: 'all',
      conditions: [
        { kind: 'flag', flag: 'a' },
        { kind: 'not', condition: { kind: 'flag', flag: 'b' } },
      ],
    });
    expect(ok(cond([{ flag: 'a' }, 'b']))).toEqual({
      kind: 'all',
      conditions: [
        { kind: 'flag', flag: 'a' },
        { kind: 'flag', flag: 'b' },
      ],
    });
    expect(ok(cond({ any: [] }))).toEqual({ kind: 'any', conditions: [] });
  });

  it('signale les erreurs avec leur chemin', () => {
    expect(cond({ var: 'x' }).ctx.issues[0]?.message).toMatch(/comparateur/);
    expect(cond({ flag: 'a', has_item: 'b' }).ctx.issues[0]?.message).toMatch(/qu'un type/);
    expect(cond({ flag: 'A B' }).ctx.issues[0]?.path).toEqual(['flag']);
    expect(cond({ all: [{ flag: 'a' }, { fleg: 'b' }] }).ctx.issues[0]?.path).toEqual(['all', 1]);
    expect(cond({ quest: 'q', state: 'oops' }).ctx.issues[0]?.path).toEqual(['state']);
    expect(cond({ counter: 'p', gte: 'x' }).ctx.issues[0]?.path).toEqual(['gte']);
    expect(cond(42).ctx.issues).toHaveLength(1);
  });
});

describe('normalizeScript', () => {
  it('formes vides', () => {
    expect(ok(script(undefined))).toEqual([]);
    expect(ok(script(null))).toEqual([]);
    expect(ok(script([]))).toEqual([]);
  });

  it('{ say, text } et texte seul', () => {
    expect(ok(script({ say: 'narrator', text: 'Bonjour' }))).toEqual([{ kind: 'say', speaker: 'narrator', text: 'Bonjour' }]);
    expect(ok(script('Bonjour'))).toEqual([{ kind: 'say', speaker: 'narrator', text: 'Bonjour' }]);
  });

  it('{ dialogue: id } et start_dialogue avec nœud', () => {
    expect(ok(script({ dialogue: 'pecheur' }))).toEqual([{ kind: 'start_dialogue', dialogue: 'pecheur', node: null }]);
    expect(ok(script({ start_dialogue: 'pecheur', node: 'n2' }))).toEqual([{ kind: 'start_dialogue', dialogue: 'pecheur', node: 'n2' }]);
  });

  it('{ do: [...] } aplati', () => {
    expect(ok(script({ do: [{ set: 'a' }, { do: [{ unset: 'b' }] }] }))).toEqual([
      { kind: 'set_flag', flag: 'a' },
      { kind: 'unset_flag', flag: 'b' },
    ]);
  });

  it('{ if, do, else } et then synonyme de do', () => {
    const expected = [
      {
        kind: 'if',
        condition: { kind: 'not', condition: { kind: 'flag', flag: 'vu' } },
        then: [
          { kind: 'say', speaker: 'narrator', text: 'Première fois.' },
          { kind: 'set_flag', flag: 'vu' },
        ],
        else: [{ kind: 'say', speaker: 'narrator', text: 'Encore toi.' }],
      },
    ];
    expect(
      ok(
        script({
          if: { not: { flag: 'vu' } },
          do: [{ say: 'narrator', text: 'Première fois.' }, { set: 'vu' }],
          else: { say: 'narrator', text: 'Encore toi.' },
        }),
      ),
    ).toEqual(expected);
    expect(
      ok(script([{ if: { not: 'vu' }, then: ['Première fois.', { set: 'vu' }], else: 'Encore toi.' }])),
    ).toEqual(expected);
  });

  it('chaque effet du §4.6 et les extensions', () => {
    expect(
      ok(
        script([
          { set: 'f' },
          { set: ['f1', 'f2'] },
          { set: { confiance: 3 } },
          { unset: 'f' },
          { add: { confiance: -2, humeur: 1 } },
          { counter: 'points', add: 10 },
          { counter: 'points', set: 0 },
          { give_item: 'cle' },
          { give_item: 'coquillage', qty: 3 },
          { take_item: 'cle' },
          { reveal: 'tiroir' },
          { reveal: 'tiroir', scene: 'cuisine' },
          { hide: { target: 'tiroir', scene: 'cuisine' } },
          { goto_scene: 'port' },
          { start_dialogue: 'pecheur' },
          { unlock_quest: 'q1' },
          { complete_quest: 'q1' },
          { say: 'margot', text: 'Hop.' },
          { end_game: 'victoire' },
        ]),
      ),
    ).toEqual([
      { kind: 'set_flag', flag: 'f' },
      { kind: 'set_flag', flag: 'f1' },
      { kind: 'set_flag', flag: 'f2' },
      { kind: 'set_var', var: 'confiance', value: 3 },
      { kind: 'unset_flag', flag: 'f' },
      { kind: 'add_var', var: 'confiance', amount: -2 },
      { kind: 'add_var', var: 'humeur', amount: 1 },
      { kind: 'counter_add', counter: 'points', amount: 10 },
      { kind: 'counter_set', counter: 'points', value: 0 },
      { kind: 'give_item', item: 'cle', qty: 1 },
      { kind: 'give_item', item: 'coquillage', qty: 3 },
      { kind: 'take_item', item: 'cle', qty: 1 },
      { kind: 'reveal', target: 'tiroir', scene: null },
      { kind: 'reveal', target: 'tiroir', scene: 'cuisine' },
      { kind: 'hide', target: 'tiroir', scene: 'cuisine' },
      { kind: 'goto_scene', scene: 'port' },
      { kind: 'start_dialogue', dialogue: 'pecheur', node: null },
      { kind: 'unlock_quest', quest: 'q1' },
      { kind: 'complete_quest', quest: 'q1' },
      { kind: 'say', speaker: 'margot', text: 'Hop.' },
      { kind: 'end_game', ending: 'victoire' },
    ]);
  });

  it('end_game en ligne remonte la fin', () => {
    const r = script({ end_game: { ending: 'chute', type: 'game_over', text: 'Plouf.' } });
    expect(ok(r)).toEqual([{ kind: 'end_game', ending: 'chute' }]);
    expect(r.ctx.inlineEndings.map((e) => e.ending)).toEqual([{ id: 'chute', type: 'game_over', title: null, text: 'Plouf.', image: null }]);
  });

  it('refuse les étapes ambiguës ou inconnues', () => {
    expect(script({ set: 'a', goto_scene: 'b' }).ctx.issues[0]?.message).toMatch(/qu'un effet/);
    expect(script({ teleport: 'b' }).ctx.issues[0]?.message).toMatch(/non reconnue/);
    expect(script({ say: 'narrator' }).ctx.issues[0]?.message).toMatch(/text/);
    expect(script({ counter: 'p' }).ctx.issues[0]?.message).toMatch(/add.*set/);
    expect(script({ give_item: 'a', qty: 0 }).ctx.issues[0]?.path).toEqual(['qty']);
    expect(script([{ set: 'ok' }, { goto_scene: 'x', foo: 1 }]).ctx.issues[0]?.path).toEqual([1, 'foo']);
    expect(script({ end_game: { ending: 'x', type: 'bof' } }).ctx.issues[0]?.path).toEqual(['end_game', 'type']);
  });
});

describe('réactions et transitions', () => {
  it('use indexé par objet avec default', () => {
    const ctx = createNormCtx();
    const r = normalizeItemReactions(
      { telecommande: { do: [{ set: 'tele_allumee' }] }, default: { say: 'margot', text: 'Non.' } },
      [],
      ctx,
      normalizeScript,
    );
    expect(ctx.issues).toEqual([]);
    expect(r).toEqual({
      byItem: { telecommande: [{ kind: 'set_flag', flag: 'tele_allumee' }] },
      default: [{ kind: 'say', speaker: 'margot', text: 'Non.' }],
    });
  });

  it('on_give / on_show : transitions', () => {
    const ctx = createNormCtx();
    const r = normalizeItemReactions(
      { bouquet: { next: 'n_touchee', effects: [{ take_item: 'bouquet' }] }, default: 'n_refus' },
      [],
      ctx,
      normalizeTransition,
    );
    expect(ctx.issues).toEqual([]);
    expect(r).toEqual({
      byItem: { bouquet: { next: 'n_touchee', effects: [{ kind: 'take_item', item: 'bouquet', qty: 1 }] } },
      default: { next: 'n_refus', effects: [] },
    });
  });

  it('transition null = fin', () => {
    const ctx = createNormCtx();
    expect(normalizeTransition(null, [], ctx)).toEqual({ next: null, effects: [] });
    expect(normalizeTransition({ effects: 'Au revoir.' }, [], ctx)).toEqual({
      next: null,
      effects: [{ kind: 'say', speaker: 'narrator', text: 'Au revoir.' }],
    });
  });

  it('actions de hotspot : verbes, label, use', () => {
    const ctx = createNormCtx();
    const r = normalizeHotspotActions(
      {
        look: { say: 'narrator', text: 'Un tiroir.' },
        open: { label: 'Fouiller', do: [{ reveal: 'cle' }] },
        talk: { dialogue: 'barde' },
        use: { cle: { set: 'ouvert' } },
      },
      [],
      ctx,
    );
    expect(ctx.issues).toEqual([]);
    expect(r.actions).toEqual({
      look: { label: null, script: [{ kind: 'say', speaker: 'narrator', text: 'Un tiroir.' }] },
      open: { label: 'Fouiller', script: [{ kind: 'reveal', target: 'cle', scene: null }] },
      talk: { label: null, script: [{ kind: 'start_dialogue', dialogue: 'barde', node: null }] },
    });
    expect(r.use).toEqual({ byItem: { cle: [{ kind: 'set_flag', flag: 'ouvert' }] }, default: null });
  });
});
