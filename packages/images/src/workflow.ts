/** Workflows ComfyUI au format API, à placeholders `{{nom}}`. */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImageError, type Params } from './types';

export type WorkflowJson = Record<string, unknown>;

/** Métadonnées optionnelles de la clé `_scroum` (retirée avant l'envoi à ComfyUI). */
export interface WorkflowMeta {
  description?: string;
  /** Paramètres obligatoires hors prompt/seed (ex. `unet`, `clip`, `vae`). */
  requires?: string[];
  /** Valeurs par défaut des placeholders (steps, cfg, width…). */
  defaults?: Params;
  /** Nombre d'images de référence attendues. */
  references?: number;
  /** Noeuds personnalisés nécessaires. */
  custom_nodes?: string[];
}

export interface LoadedWorkflow {
  name: string;
  /** Fichier d'où il provient. */
  file: string;
  graph: WorkflowJson;
  meta: WorkflowMeta;
}

/** Workflows génériques livrés avec SCROUM (`<dépôt>/workflows`). */
export const BUILTIN_WORKFLOWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'workflows');

const NAME_RE = /^[A-Za-z0-9_-]+$/;

/** Ordre de recherche : workflows du jeu, puis génériques SCROUM. */
export function workflowDirs(gameWorkflowsDir: string | null): string[] {
  return [...(gameWorkflowsDir ? [gameWorkflowsDir] : []), BUILTIN_WORKFLOWS_DIR];
}

export function findWorkflowFile(name: string, dirs: string[]): string {
  if (!NAME_RE.test(name)) throw new ImageError('workflow_not_found', `nom de workflow invalide : « ${name} »`);
  for (const d of dirs) {
    const f = join(d, `${name}.json`);
    if (existsSync(f)) return f;
  }
  throw new ImageError('workflow_not_found', `workflow « ${name} » introuvable (cherché dans : ${dirs.join(', ')})`);
}

export async function loadWorkflow(name: string, dirs: string[]): Promise<LoadedWorkflow> {
  const file = findWorkflowFile(name, dirs);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    throw new ImageError('workflow_invalid', `${file} : JSON invalide (${(e as Error).message})`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ImageError('workflow_invalid', `${file} : objet JSON attendu (format « Save (API) »)`);
  const { _scroum, ...graph } = raw as WorkflowJson;
  if (Object.keys(graph).length === 0) throw new ImageError('workflow_invalid', `${file} : workflow vide`);
  if (!Object.values(graph).every((n) => typeof n === 'object' && n !== null && 'class_type' in n)) {
    throw new ImageError('workflow_invalid', `${file} : format API attendu (chaque noeud avec « class_type »), pas l'export graphique`);
  }
  return { name, file, graph, meta: (_scroum ?? {}) as WorkflowMeta };
}

const WHOLE = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/;
const PART = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Noms de placeholders présents dans un graphe. */
export function placeholders(graph: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') for (const m of v.matchAll(PART)) out.add(m[1]!);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(graph);
  return out;
}

/**
 * Substitue les placeholders sans toucher à la structure JSON (aucun risque d'injection par un prompt contenant des
 * guillemets). Une chaîne qui est *exactement* `{{x}}` prend le type de la valeur (nombre, booléen, chaîne) ;
 * un placeholder au milieu d'un texte est converti en chaîne. Un placeholder sans valeur est une erreur.
 */
export function substitute(graph: WorkflowJson, params: Record<string, unknown>, name = 'workflow'): WorkflowJson {
  const missing = new Set<string>();
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const whole = WHOLE.exec(v);
      if (whole) {
        const val = params[whole[1]!];
        if (val === undefined || val === null) {
          missing.add(whole[1]!);
          return v;
        }
        return val;
      }
      return v.replace(PART, (_m, k: string) => {
        const val = params[k];
        if (val === undefined || val === null) {
          missing.add(k);
          return '';
        }
        return String(val);
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(graph) as WorkflowJson;
  if (missing.size > 0) {
    const list = [...missing].sort();
    const hint = list.some((k) => /^(unet|clip|vae|checkpoint|[a-z_]*model[a-z_]*)$/.test(k))
      ? ' — les noms de modèles se règlent dans scroum.local.yaml (comfyui.models) ou scroum.project.yaml'
      : '';
    throw new ImageError('missing_param', `${name} : valeur manquante pour ${list.map((k) => `{{${k}}}`).join(', ')}${hint}`);
  }
  return out;
}
