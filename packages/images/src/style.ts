/**
 * `bible/style.md` : préfixe, suffixe, négatif et post-traitement par monde.
 *
 * Convention (voir docs/FORMAT.md §4 « style.md ») :
 * - front-matter YAML optionnel : `postprocess: { <monde>|default: { pixelate: 4, colors: 32 } }` ;
 * - une section « Négatif commun » dont le premier bloc de code (ou `code` en ligne) est le négatif de tous les mondes ;
 * - une section par monde, dont le titre contient l'id du monde entre parenthèses et backticks, p. ex. `## Azerine (`royaumes_azerine`)`,
 *   avec des puces `- **Préfixe** : `…``, `- **Suffixe** : `…``, `- **Négatif spécifique** : `…``, `- **Palette** : … #rrggbb …`.
 */
import { parse } from 'yaml';
import { PostprocessSchema, type Postprocess } from '@scroum/schema';

export interface WorldStyle {
  prefix: string;
  suffix: string;
  negative: string;
  palette: string[];
}
export interface StyleGuide {
  negative: string;
  worlds: Record<string, WorldStyle>;
  postprocess: Record<string, Postprocess>;
}

const empty = (): WorldStyle => ({ prefix: '', suffix: '', negative: '', palette: [] });

function frontMatter(md: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { data: {}, body: md };
  try {
    const d = parse(m[1]!);
    return { data: d && typeof d === 'object' ? (d as Record<string, unknown>) : {}, body: md.slice(m[0].length) };
  } catch {
    return { data: {}, body: md.slice(m[0].length) };
  }
}

/** Contenu d'un `code` en ligne s'il y en a (sans trim : le préfixe peut finir par « , »), sinon texte brut. */
function inlineValue(raw: string): string {
  const m = /`([^`]*)`/.exec(raw);
  return (m ? m[1]! : raw).trim();
}

export function parseStyle(md: string): StyleGuide {
  const { data, body } = frontMatter(md);
  const guide: StyleGuide = { negative: '', worlds: {}, postprocess: {} };
  const pp = data.postprocess;
  if (pp && typeof pp === 'object') {
    for (const [k, v] of Object.entries(pp)) {
      const r = PostprocessSchema.safeParse(v);
      if (r.success) guide.postprocess[k] = r.data;
    }
  }
  let section: { kind: 'common' } | { kind: 'world'; id: string } | { kind: 'other' } = { kind: 'other' };
  let inFence = false;
  let fenceBuf: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      if (inFence) {
        if (section.kind === 'common' && !guide.negative) guide.negative = fenceBuf.join(' ').trim();
        fenceBuf = [];
      }
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      fenceBuf.push(line.trim());
      continue;
    }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      const title = h[1]!;
      const world = /\(\s*`([A-Za-z0-9_]+)`\s*\)/.exec(title);
      if (world) {
        section = { kind: 'world', id: world[1]! };
        guide.worlds[world[1]!] ??= empty();
      } else if (/n[ée]gatif\s+commun/i.test(title)) section = { kind: 'common' };
      else section = { kind: 'other' };
      continue;
    }
    const bullet = /^\s*[-*]\s+\*\*([^*]+)\*\*\s*:?\s*(.*)$/.exec(line);
    if (bullet && section.kind === 'world') {
      const label = bullet[1]!.replace(/\s*:\s*$/, '').toLowerCase();
      const w = guide.worlds[section.id]!;
      if (/^pr[ée]fixe/.test(label)) w.prefix = inlineValue(bullet[2]!);
      else if (/^suffixe/.test(label)) w.suffix = inlineValue(bullet[2]!);
      else if (/^n[ée]gatif/.test(label)) w.negative = inlineValue(bullet[2]!);
      else if (/^palette/.test(label)) w.palette = [...bullet[2]!.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((x) => x[0].toUpperCase());
    } else if (section.kind === 'common' && !guide.negative) {
      const inline = /`([^`]+)`/.exec(line);
      if (inline) guide.negative = inline[1]!.trim();
    }
  }
  return guide;
}

const clean = (s: string): string => s.trim().replace(/^[,\s]+|[,\s]+$/g, '');
const joinCsv = (...parts: (string | undefined)[]): string => parts.map((p) => clean(p ?? '')).filter(Boolean).join(', ');

/** Partie de style à ajouter, sauf si le prompt de l'asset la contient déjà (prompts écrits avec le préfixe inclus). */
const unlessIncluded = (part: string | undefined, prompt: string): string | undefined => {
  const c = clean(part ?? '');
  return c && prompt.toLowerCase().includes(c.toLowerCase()) ? undefined : part;
};

/** Prompt complet = préfixe du monde + prompt de l'asset + suffixe ; négatif = commun + monde + négatif de l'asset. */
export function buildPrompt(guide: StyleGuide | null, world: string | null, prompt: string, negative?: string | null): { prompt: string; negative: string } {
  const w = (world && guide?.worlds[world]) || null;
  return {
    prompt: joinCsv(unlessIncluded(w?.prefix, prompt), prompt, unlessIncluded(w?.suffix, prompt)),
    negative: joinCsv(guide?.negative, w?.negative, negative ?? ''),
  };
}

/** Réglage de post-traitement d'un monde : `default` du front-matter, puis monde (le projet prime, voir build). */
export function postprocessFor(guide: StyleGuide | null, world: string | null): Postprocess | null {
  if (!guide) return null;
  return (world && guide.postprocess[world]) || guide.postprocess.default || null;
}
