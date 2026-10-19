import { describe, expect, it } from 'vitest';
import {
  buildClassifyRequest,
  buildRephraseRequest,
  intentAction,
  KeywordBackend,
  normalizeText,
  start,
  step,
  tokenMatch,
  type Action,
  type ClassifyRequest,
  type GameState,
} from '../src';
import { loadExample } from './helpers';

const demo = loadExample('demo');
const kb = new KeywordBackend();
const run = (s: GameState, ...a: Action[]) => a.reduce((st, x) => step(demo, st, x).state, s);
const loicMenu = (inv: Record<string, number> = {}) => {
  const s = run(start(demo).state, { type: 'verb', hotspot: 'loic', verb: 'talk' }, { type: 'continue' });
  return { ...s, inventory: inv };
};

describe('normalisation', () => {
  it('minuscules, accents, ponctuation, ligatures', () => {
    expect(normalizeText("  L'Œuf de Loïc, ÇA mord ?! ")).toBe('l oeuf de loic ca mord');
  });
  it('tokenMatch tolère les flexions simples', () => {
    expect(tokenMatch('rallume', 'rallumer')).toBe(true);
    expect(tokenMatch('phares', 'phare')).toBe(true);
    expect(tokenMatch('la', 'lampe')).toBe(false);
    expect(tokenMatch('mer', 'merci')).toBe(false);
  });
});

describe('KeywordBackend', () => {
  const req = (text: string, inv: Record<string, number> = {}): ClassifyRequest => buildClassifyRequest(demo, loicMenu(inv), text);

  it('requête : intentions autorisées du nœud, objets possédés d’abord, interlocuteur', () => {
    const r = req('x', { photo_ancienne: 1 });
    expect(r.intents.map((i) => i.id)).toEqual(['saluer', 'question_phare', 'compliment', 'blague', 'show_item']);
    expect(r.items[0]).toEqual({ id: 'photo_ancienne', name: 'Photo ancienne', owned: true });
    expect(r.items.length).toBe(Object.keys(demo.items).length);
    expect(r.speaker).toEqual({ id: 'loic', name: 'Loïc' });
  });

  it.each([
    ['Bonjour Loïc !', 'saluer'],
    ['salut', 'saluer'],
    ['Comment je rallume le phare ?', 'question_phare'],
    ['il faut quoi pour la lampe', 'question_phare'],
    ['Quelle belle barbe !', 'compliment'],
    ["vous avez l'air d'un vrai marin", 'compliment'],
    ['ça mord ?', 'blague'],
    ["j'ai une blague", 'blague'],
  ])('« %s » → %s', async (text, intent) => {
    const r = await kb.classify(req(text));
    expect(r.intent).toBe(intent);
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('texte sans rapport → aucune intention', async () => {
    expect(await kb.classify(req('zzz qwerty'))).toEqual({ intent: null, confidence: 0, item: null });
  });

  it('show_item reconnaît l’objet cité', () => {
    expect(kb.classifySync(req('regarde cette photo', { photo_ancienne: 1 }))).toMatchObject({ intent: 'show_item', item: 'photo_ancienne' });
    // objet cité non possédé : reconnu quand même, le moteur refusera
    expect(kb.classifySync(req('je te montre le briquet'))).toMatchObject({ intent: 'show_item', item: 'briquet' });
    expect(kb.classifySync(req('regarde ça'))).toMatchObject({ intent: 'show_item', item: null });
  });

  it('give_item : « je te donne la bière » → give_item + objet', () => {
    const r: ClassifyRequest = {
      text: 'Je te donne la bière !',
      intents: [demo.intents.give_item!, demo.intents.saluer!],
      items: [
        { id: 'biere', name: 'Bière blonde', owned: true },
        { id: 'cle', name: 'Clé', owned: true },
      ],
      speaker: null,
    };
    expect(kb.classifySync(r)).toMatchObject({ intent: 'give_item', item: 'biere' });
  });

  it('égalité entre deux intentions → confiance pénalisée', () => {
    const a = kb.classifySync(req('bonjour'));
    const b = kb.classifySync(req('bonjour, belle barbe'));
    expect(b.confidence).toBeLessThan(a.confidence);
  });

  it('exemple identique → confiance 1', () => {
    expect(kb.classifySync(req('le phare est éteint'))).toMatchObject({ intent: 'question_phare', confidence: 1 });
  });

  it('rephrase renvoie la réplique telle quelle', async () => {
    const r = buildRephraseRequest(demo, start(demo).state, { speaker: 'loic', text: 'Salut.' });
    expect(r).toMatchObject({ name: 'Loïc', voice: expect.any(String), persona_prompt: expect.any(String) });
    expect(await kb.rephrase(r)).toBe('Salut.');
  });

  it('bout en bout : classification puis step', async () => {
    const s = loicMenu();
    const res = await kb.classify(buildClassifyRequest(demo, s, 'Comment rallumer le phare ?'));
    const r = step(demo, s, intentAction(res));
    expect(r.state.flags).toContain('sait_pour_le_feu');
    const res2 = await kb.classify(buildClassifyRequest(demo, s, 'je te montre la photo'));
    expect(step(demo, s, intentAction(res2)).events).toMatchObject([{ type: 'refuse', reason: 'missing_item', item: 'photo_ancienne' }]);
  });

  it('hors nœud à texte libre : aucune intention autorisée', () => {
    expect(buildClassifyRequest(demo, start(demo).state, 'bonjour').intents).toEqual([]);
  });
});
