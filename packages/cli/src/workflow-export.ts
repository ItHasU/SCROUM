/**
 * `scroum workflow-export <nom>` : produit un JSON au format API ouvrable tel quel dans ComfyUI
 * (glisser-déposer), avec les placeholders remplacés par des valeurs d'exemple ou celles du projet.
 */
import { writeFile } from 'node:fs/promises';
import { loadImageConfig, loadWorkflow, placeholders, substitute, workflowDirs, type WorkflowJson } from '@scroum/images';
import type { ResolvedProject } from '@scroum/build';
import type { Io } from './index';

/** Valeurs d'exemple quand ni le workflow ni le projet n'en fournissent. */
export const EXAMPLE_PARAMS: Record<string, unknown> = {
  prompt: 'pixel art, cozy seaside lighthouse at dusk, warm light, detailed background',
  negative: 'blurry, lowres, watermark, text',
  seed: 42,
  width: 1280,
  height: 720,
  instruction: 'same framing and pose, turn the character into a realistic person',
  unet: 'qwen_image_fp8_e4m3fn.safetensors',
  clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
  vae: 'qwen_image_vae.safetensors',
  checkpoint: 'model.safetensors',
};

/** Remplace chaque placeholder par la valeur du projet, du workflow ou d'exemple (les références → example.png). */
export function exportGraph(graph: WorkflowJson, defaults: Record<string, unknown>, models: Record<string, string>, name: string): WorkflowJson {
  const params: Record<string, unknown> = { ...EXAMPLE_PARAMS, ...defaults, ...models };
  for (const p of placeholders(graph)) {
    if (!(p in params)) params[p] = /^ref_image_\d+$/.test(p) ? 'example.png' : p;
  }
  return substitute(graph, params, name);
}

export async function workflowExportCommand(project: ResolvedProject | null, args: string[], values: Map<string, string>, io: Io): Promise<number> {
  const name = args[0];
  if (!name) {
    io.err('usage : scroum workflow-export <nom> [--out fichier.json] [chemin]');
    return 2;
  }
  const cfg = project ? await loadImageConfig(project.root, project.config) : null;
  const wf = await loadWorkflow(name, workflowDirs(cfg?.gameWorkflowsDir ?? null));
  const out = exportGraph(wf.graph, (wf.meta.defaults ?? {}) as Record<string, unknown>, cfg?.models ?? {}, name);
  const json = JSON.stringify(out, null, 2) + '\n';
  const file = values.get('out');
  if (file) {
    await writeFile(file, json);
    io.out(`✔ ${wf.file} → ${file} (à glisser dans ComfyUI)`);
  } else {
    io.out(json.trimEnd());
  }
  return 0;
}
