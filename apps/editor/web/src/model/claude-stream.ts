/** Mise en forme lisible des événements stream-json de `claude -p` relayés par `POST /api/claude`. */

export type ClaudeItem =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; summary: string }
  | { kind: 'tool_result'; id: string; text: string; error: boolean }
  | { kind: 'system'; text: string }
  | { kind: 'result'; text: string; error: boolean; cost?: number };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Résumé d'un appel d'outil (fichier, commande, motif…). */
export function toolSummary(name: string, input: unknown): string {
  if (!isObj(input)) return '';
  const pick = (...keys: string[]): string => {
    for (const k of keys) if (typeof input[k] === 'string') return input[k] as string;
    return '';
  };
  const v = pick('file_path', 'path', 'command', 'pattern', 'url', 'description', 'prompt');
  return v.length > 140 ? v.slice(0, 139) + '…' : v;
}

/** Transforme un événement stream-json en éléments d'affichage (liste éventuellement vide). */
export function claudeItems(event: unknown): ClaudeItem[] {
  if (!isObj(event)) return [];
  const out: ClaudeItem[] = [];
  const message = isObj(event.message) ? event.message : null;
  const content = message && Array.isArray(message.content) ? message.content : typeof message?.content === 'string' ? [{ type: 'text', text: message.content }] : [];
  switch (event.type) {
    case 'system':
      if (event.subtype === 'init') out.push({ kind: 'system', text: `Session démarrée${typeof event.model === 'string' ? ` (${event.model})` : ''}` });
      break;
    case 'assistant':
      for (const c of content) {
        if (!isObj(c)) continue;
        if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) out.push({ kind: 'text', text: c.text });
        else if (c.type === 'tool_use') out.push({ kind: 'tool', id: String(c.id ?? ''), name: String(c.name ?? '?'), summary: toolSummary(String(c.name ?? ''), c.input) });
      }
      break;
    case 'user':
      for (const c of content) {
        if (!isObj(c) || c.type !== 'tool_result') continue;
        const t = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map((x) => (isObj(x) && typeof x.text === 'string' ? x.text : '')).join('') : '';
        out.push({ kind: 'tool_result', id: String(c.tool_use_id ?? ''), text: t.length > 400 ? t.slice(0, 399) + '…' : t, error: c.is_error === true });
      }
      break;
    case 'result':
      out.push({
        kind: 'result',
        text: typeof event.result === 'string' ? event.result : '',
        error: event.is_error === true,
        ...(typeof event.total_cost_usd === 'number' ? { cost: event.total_cost_usd } : {}),
      });
      break;
  }
  return out;
}
