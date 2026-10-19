/**
 * Mini LLM (§5.5 de la spec) : interface `LlmBackend` et `KeywordBackend`,
 * classifieur par mots-clés pur et sans téléchargement (repli par défaut).
 *
 * Règle absolue : un backend ne modifie jamais l'état. Il renvoie une
 * intention ; c'est le moteur (action `intent`) qui décide de la transition.
 */
import type { GameData, Id } from '@scroum/schema';
import { allowedIntents, ownedItems, resolveSpeaker } from './queries';
import type { GameState } from './state';
import type { Action } from './types';

export interface IntentCandidate {
  id: Id;
  desc: string;
  examples: string[];
  keywords: string[];
}

export interface ItemCandidate {
  id: Id;
  name: string;
  /** Le joueur possède l'objet (le moteur refuse un don d'objet non possédé). */
  owned: boolean;
}

export interface ClassifyRequest {
  /** Texte saisi par le joueur. */
  text: string;
  /** Intentions autorisées dans le nœud (y compris `give_item`/`show_item`). */
  intents: IntentCandidate[];
  /** Objets du jeu (possédés d'abord), pour reconnaître l'objet de `give_item`/`show_item`. */
  items: ItemCandidate[];
  /** Interlocuteur (contexte pour un LLM). */
  speaker: { id: Id; name: string | null } | null;
}

export interface ClassifyResult {
  /** Intention reconnue, null si rien. */
  intent: Id | null;
  /** Confiance entre 0 et 1. */
  confidence: number;
  /** Objet visé pour `give_item`/`show_item`. */
  item?: Id | null;
}

export interface RephraseRequest {
  /** Réplique scriptée. */
  text: string;
  speaker: Id;
  name: string | null;
  voice: string | null;
  persona_prompt: string | null;
  /** Longueur maximale souhaitée (caractères). */
  max_length: number;
}

/** Backend de langage : classification du texte libre et reformulation des répliques. */
export interface LlmBackend {
  readonly id: string;
  classify(req: ClassifyRequest): Promise<ClassifyResult>;
  /** Réécrit la réplique dans la voix du personnage ; doit renvoyer `req.text` en cas d'échec. */
  rephrase(req: RephraseRequest): Promise<string>;
}

/** Requête de classification pour le nœud courant (intentions autorisées, objets). */
export function buildClassifyRequest(game: GameData, state: GameState, text: string): ClassifyRequest {
  const intents = allowedIntents(game, state).map((id) => {
    const it = game.intents[id];
    return { id, desc: it?.desc ?? id, examples: it?.examples ?? [], keywords: it?.keywords ?? [] };
  });
  const owned = ownedItems(game, state);
  const items: ItemCandidate[] = [
    ...owned.map((id) => ({ id, name: game.items[id]?.name ?? id, owned: true })),
    ...Object.values(game.items)
      .filter((i) => !owned.includes(i.id))
      .map((i) => ({ id: i.id, name: i.name, owned: false })),
  ];
  const d = state.dialogue ? game.dialogues[state.dialogue.id] : undefined;
  const speaker = d ? { id: d.speaker, name: resolveSpeaker(game, state, d.speaker).name } : null;
  return { text, intents, items, speaker };
}

/** Requête de reformulation d'une réplique. */
export function buildRephraseRequest(game: GameData, state: GameState, line: { speaker: Id; text: string }, maxLength = 240): RephraseRequest {
  const ch = game.characters[line.speaker];
  return {
    text: line.text,
    speaker: line.speaker,
    name: resolveSpeaker(game, state, line.speaker).name,
    voice: ch?.voice ?? null,
    persona_prompt: ch?.llm_persona_prompt ?? null,
    max_length: maxLength,
  };
}

/** Action `intent` à passer à `step` à partir d'un résultat de classification. */
export function intentAction(result: ClassifyResult): Action {
  return { type: 'intent', intent: result.intent, confidence: result.confidence, item: result.item ?? null };
}

// ---------------------------------------------------------------------------
// KeywordBackend
// ---------------------------------------------------------------------------

/** Minuscules, accents retirés, ponctuation → espaces, espaces compactés. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(s: string): string[] {
  const n = normalizeText(s);
  return n ? n.split(' ') : [];
}

const STOPWORDS = new Set(
  (
    'a ai as au aux avec c ca ce cet cette ces d de des du elle en es est et il ils j je l la le les leur lui m ma me mes moi mon ' +
    'n ne nous on ou par pas pour qu que qui s sa se ses son sont suis sur t ta te tes toi ton tu un une vos votre vous y'
  ).split(' '),
);

/** Mots porteurs de sens (hors mots-outils). */
export function contentTokens(s: string): string[] {
  return tokenize(s).filter((t) => !STOPWORDS.has(t));
}

/** Égalité tolérante : identiques, ou préfixe l'un de l'autre (≥ 4 lettres, ≤ 3 lettres d'écart : rallume/rallumer). */
export function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 3) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function containsPhrase(text: string[], phrase: string[]): boolean {
  if (!phrase.length) return false;
  for (let i = 0; i + phrase.length <= text.length; i++) if (phrase.every((p, j) => tokenMatch(text[i + j]!, p))) return true;
  return false;
}

function tokenDice(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const common = a.filter((t) => b.some((u) => tokenMatch(t, u))).length;
  const common2 = b.filter((t) => a.some((u) => tokenMatch(t, u))).length;
  return (common + common2) / (a.length + b.length);
}

function trigrams(s: string): string[] {
  const p = `  ${s} `;
  const out: string[] = [];
  for (let i = 0; i + 3 <= p.length; i++) out.push(p.slice(i, i + 3));
  return out;
}

function trigramDice(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  const pool = new Map<string, number>();
  for (const t of tb) pool.set(t, (pool.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of ta) {
    const n = pool.get(t) ?? 0;
    if (n > 0) {
      common++;
      pool.set(t, n - 1);
    }
  }
  return (2 * common) / (ta.length + tb.length);
}

export interface KeywordBackendOptions {
  /** Confiance d'un seul mot-clé reconnu (défaut 0.75 ; +0.1 par mot-clé supplémentaire, max 0.95). */
  keywordConfidence?: number;
  /** Pénalité quand deux intentions sont à égalité (défaut 0.1). */
  tiePenalty?: number;
  /** Score minimal de reconnaissance d'un objet (défaut 0.5 : la moitié des mots de son nom). */
  itemThreshold?: number;
}

/** Détail du score d'une intention (débogage, éditeur). */
export interface IntentScore {
  intent: Id;
  score: number;
  keywords: string[];
  example: number;
}

/**
 * Classifieur sans LLM : mots-clés (`keywords`, tolérance aux flexions simples)
 * et similarité avec les exemples (recouvrement de mots porteurs et trigrammes
 * de caractères). Pour `give_item`/`show_item`, reconnaît le nom d'un objet du jeu.
 * Pur et déterministe ; `classifySync` est la version synchrone.
 */
export class KeywordBackend implements LlmBackend {
  readonly id = 'keyword';
  private readonly kw: number;
  private readonly tie: number;
  private readonly itemThreshold: number;

  constructor(options: KeywordBackendOptions = {}) {
    this.kw = options.keywordConfidence ?? 0.75;
    this.tie = options.tiePenalty ?? 0.1;
    this.itemThreshold = options.itemThreshold ?? 0.5;
  }

  async classify(req: ClassifyRequest): Promise<ClassifyResult> {
    return this.classifySync(req);
  }

  async rephrase(req: RephraseRequest): Promise<string> {
    return req.text;
  }

  /** Scores de chaque intention candidate, dans l'ordre de la requête. */
  score(req: ClassifyRequest): IntentScore[] {
    const tokens = tokenize(req.text);
    const content = contentTokens(req.text);
    const norm = normalizeText(req.text);
    return req.intents.map((it) => {
      const keywords = it.keywords.filter((k) => containsPhrase(tokens, tokenize(k)));
      const kwScore = keywords.length ? Math.min(0.95, this.kw + 0.1 * (keywords.length - 1)) : 0;
      let example = 0;
      for (const ex of it.examples) {
        const n = normalizeText(ex);
        const sim = n === norm ? 1 : Math.max(tokenDice(content, contentTokens(ex)), 0.8 * trigramDice(norm, n));
        example = Math.max(example, sim);
      }
      return { intent: it.id, score: Math.max(kwScore, example), keywords, example };
    });
  }

  /** Objet du jeu cité dans le texte (possédé de préférence), ou null. */
  detectItem(req: ClassifyRequest): Id | null {
    const tokens = contentTokens(req.text);
    let best: { id: Id; score: number; owned: boolean } | null = null;
    for (const item of req.items) {
      const words = [...new Set([...contentTokens(item.name), ...item.id.split('_').filter((w) => w.length > 2)])];
      if (!words.length) continue;
      const nameWords = contentTokens(item.name);
      const base = nameWords.length ? nameWords : words;
      const hit = base.filter((w) => tokens.some((t) => tokenMatch(t, w))).length;
      const idHit = words.filter((w) => tokens.some((t) => tokenMatch(t, w))).length;
      const score = Math.max(hit / base.length, idHit / words.length);
      if (score < this.itemThreshold) continue;
      if (!best || score > best.score || (score === best.score && item.owned && !best.owned)) best = { id: item.id, score, owned: item.owned };
    }
    return best?.id ?? null;
  }

  classifySync(req: ClassifyRequest): ClassifyResult {
    const scores = this.score(req);
    let best: IntentScore | null = null;
    for (const s of scores) if (s.score > 0 && (!best || s.score > best.score)) best = s;
    if (!best) return { intent: null, confidence: 0, item: null };
    const tied = scores.some((s) => s !== best && s.score === best!.score);
    const confidence = Math.max(0, Math.min(1, best.score - (tied ? this.tie : 0)));
    const reserved = best.intent === 'give_item' || best.intent === 'show_item';
    return { intent: best.intent, confidence: Number(confidence.toFixed(4)), item: reserved ? this.detectItem(req) : null };
  }
}
