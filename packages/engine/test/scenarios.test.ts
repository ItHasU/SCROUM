import { describe, expect, it } from 'vitest';
import { formatScenarioResult, parseAction, describeAction, runScenario, listActions, start, step, stateKey, type Scenario } from '../src';
import { loadExample, makeGame } from './helpers';
import { freeText, gameOver, softlock, walkthrough } from './scenarios/demo';

const demo = loadExample('demo');
const lock = loadExample('demo-softlock');

describe('scénarios de la démo', () => {
  it.each([walkthrough, gameOver, freeText])('$name', async (sc) => {
    const r = await runScenario(demo, sc);
    expect(formatScenarioResult(r)).toBe(`✔ ${sc.name}`);
  });

  it(softlock.name, async () => {
    const r = await runScenario(lock, softlock);
    expect(formatScenarioResult(r)).toBe(`✔ ${softlock.name}`);
  });

  it('demo-softlock : depuis l’impasse, aucune fin n’est atteignable (exploration complète)', async () => {
    const r = await runScenario(lock, { name: 'impasse', steps: softlock.steps.slice(0, 4) });
    const seen = new Set<string>([stateKey(r.state)]);
    const queue = [r.state];
    let ended = false;
    while (queue.length) {
      const s = queue.shift()!;
      for (const a of listActions(lock, s)) {
        const n = step(lock, s, a).state;
        if (n.ending) ended = true;
        const k = stateKey(n);
        if (!seen.has(k)) {
          seen.add(k);
          queue.push(n);
        }
      }
    }
    expect(ended).toBe(false);
    expect(seen.size).toBeLessThan(10);
  });
});

describe('harnais', () => {
  it('rapporte les échecs sans lever d’exception', async () => {
    const sc: Scenario = {
      name: 'faux',
      steps: [{ do: 'take caisse', expect: { inventory: { meche: 2 }, flags: ['nope'], events: [{ type: 'game_ended' }] } }, 'take caisse'],
    };
    const r = await runScenario(demo, sc);
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => f.message)).toEqual([
      'drapeau « nope » non levé',
      'objet meche : attendu 2, obtenu 1',
      expect.stringContaining('événement absent'),
    ]);
    expect(r.trace).toHaveLength(2); // start + 1 étape (arrêt au premier échec)
    const all = await runScenario(demo, sc, { stopOnFailure: false });
    expect(all.trace).toHaveLength(3);
    expect(formatScenarioResult(r)).toContain('étape 0');
  });

  it('une erreur moteur non attendue est un échec ; forme courte invalide aussi', async () => {
    expect((await runScenario(demo, { name: 'e', steps: ['look nulle_part'] })).failures[0]!.message).toContain('unknown_hotspot');
    expect((await runScenario(demo, { name: 'e', steps: ['use x'] })).failures[0]!.message).toContain('use <objet> on <hotspot>');
    expect((await runScenario(demo, { name: 'e', steps: ['talk loic', 'continue', 'choose "inexistant"'] })).failures[0]!.message).toContain('aucun choix visible');
    expect((await runScenario(demo, { name: 'e', steps: [{ do: 'look nulle_part', expect: { error: 'unknown_hotspot' } }] })).ok).toBe(true);
  });

  it('vérification sans action et état initial fourni', async () => {
    const s = step(demo, start(demo).state, { type: 'verb', hotspot: 'caisse', verb: 'take' }).state;
    const r = await runScenario(demo, { name: 'v', start: { inventory: { meche: 1 } }, steps: [{ expect: { scene: 'port' } }] }, { initialState: s });
    expect(r.ok).toBe(true);
  });

  it('parseAction ↔ describeAction', () => {
    const g = makeGame({ 'scenes/a.yaml': 'world: w\n' });
    const s = start(g).state;
    for (const txt of ['look coffre', 'use cle on porte', 'exit exit_b', 'choose 3', 'continue', 'leave', 'give x', 'show x', 'combine a b', 'inspect a', 'intent salut 1', 'intent give_item pomme 0.8', 'intent - 0'])
      expect(describeAction(parseAction(g, s, txt))).toBe(txt);
    expect(parseAction(g, s, 'intent -')).toEqual({ type: 'intent', intent: null, confidence: 0, item: null });
    expect(parseAction(g, s, 'intent salut')).toEqual({ type: 'intent', intent: 'salut', confidence: 1, item: null });
  });
});
