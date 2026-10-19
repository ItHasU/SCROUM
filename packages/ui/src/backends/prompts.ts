/**
 * Prompts, grammaire GBNF et analyse des réponses des LLM (purs, testables).
 *
 * Règle absolue (§5.5) : le LLM ne fait que classer une intention ou reformuler
 * une réplique ; la réponse est filtrée ici (intention et objet restreints aux
 * candidats de la requête) avant d'être passée au moteur.
 */
import type { ClassifyRequest, ClassifyResult, RephraseRequest } from '@scroum/engine';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Messages de classification d'intention (réponse JSON attendue). */
export function classifyMessages(req: ClassifyRequest): ChatMessage[] {
  const intents = req.intents
    .map((i) => `- ${i.id} : ${i.desc}${i.examples.length ? ` (ex. ${i.examples.slice(0, 3).map((e) => `« ${e} »`).join(', ')})` : ''}`)
    .join('\n');
  const owned = req.items.filter((i) => i.owned);
  const items = owned.length ? owned.map((i) => `- ${i.id} : ${i.name}`).join('\n') : '(aucun)';
  const needsItem = req.intents.some((i) => i.id === 'give_item' || i.id === 'show_item');
  const system =
    "Tu es le classifieur d'intentions d'un jeu d'aventure. Tu ne parles pas au joueur : tu réponds uniquement par un objet JSON " +
    '{"intent": <id ou null>, "confidence": <nombre entre 0 et 1>' +
    (needsItem ? ', "item": <id d\'objet ou null>' : '') +
    '}. Choisis une intention parmi la liste, ou null si aucune ne correspond. Sois prudent : confiance basse en cas de doute.';
  const user =
    `Interlocuteur : ${req.speaker?.name ?? req.speaker?.id ?? 'inconnu'}\n` +
    `Intentions possibles :\n${intents || '(aucune)'}\n` +
    (needsItem ? `Objets du joueur :\n${items}\n` : '') +
    `Phrase du joueur : « ${req.text} »`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Littéral GBNF d'une chaîne JSON (les ids sont en `[a-z0-9_]`, rien à échapper ; le reste est filtré). */
const gbnfString = (s: string): string => `"\\"${s.replace(/[^A-Za-z0-9_-]/g, '')}\\""`;

/** Grammaire GBNF qui contraint la réponse au JSON `{intent, confidence, item?}` avec les seuls ids autorisés. */
export function classifyGrammar(req: ClassifyRequest): string {
  const intents = ['"null"', ...req.intents.map((i) => gbnfString(i.id))].join(' | ');
  const needsItem = req.intents.some((i) => i.id === 'give_item' || i.id === 'show_item');
  const items = ['"null"', ...req.items.map((i) => gbnfString(i.id))].join(' | ');
  return [
    `root ::= "{" ws "\\"intent\\"" ws ":" ws intent ws "," ws "\\"confidence\\"" ws ":" ws conf ws ${needsItem ? '"," ws "\\"item\\"" ws ":" ws item ws ' : ''}"}"`,
    `intent ::= ${intents}`,
    ...(needsItem ? [`item ::= ${items}`] : []),
    'conf ::= "0" ( "." [0-9] [0-9]? )? | "1" ( ".0" )?',
    'ws ::= [ \\t\\n]*',
  ].join('\n');
}

/** Analyse la réponse JSON d'un LLM ; null si inexploitable. Intention / objet hors candidats → null. */
export function parseClassifyResponse(req: ClassifyRequest, raw: string): ClassifyResult | null {
  const m = /\{[\s\S]*\}/.exec(raw ?? '');
  if (!m) return null;
  let data: unknown;
  try {
    data = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const intent = typeof d.intent === 'string' && req.intents.some((i) => i.id === d.intent) ? d.intent : null;
  const conf = typeof d.confidence === 'number' ? d.confidence : typeof d.confidence === 'string' ? Number(d.confidence) : NaN;
  if (!Number.isFinite(conf)) return null;
  const item = typeof d.item === 'string' && req.items.some((i) => i.id === d.item) ? d.item : null;
  return { intent, confidence: intent === null ? 0 : Math.max(0, Math.min(1, conf)), item };
}

/** Messages de reformulation d'une réplique dans la voix du personnage. */
export function rephraseMessages(req: RephraseRequest): ChatMessage[] {
  const who = req.name ?? req.speaker;
  const system =
    `Tu réécris une réplique de jeu vidéo dans la voix du personnage ${who}. ` +
    (req.voice ? `Voix : ${req.voice}. ` : '') +
    (req.persona_prompt ? `${req.persona_prompt.trim()} ` : '') +
    `Règles : garde exactement le même sens, n'ajoute AUCUNE information, aucun nom, aucun objet ; ` +
    `réponds uniquement par la réplique, en français, en ${req.max_length} caractères au plus, sans guillemets.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: req.text },
  ];
}
