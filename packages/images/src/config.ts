/** Configuration de génération : scroum.local.yaml (URL, modèles) fusionnée à scroum.project.yaml. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { LOCAL_FILE, type ProjectConfig } from '@scroum/schema';
import { ComfyUIProvider } from './comfyui';
import type { ImageProvider } from './types';

export interface ImageConfig {
  url: string;
  models: Record<string, string>;
  timeoutMs: number | undefined;
  gameWorkflowsDir: string;
}

export const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188';

export async function loadImageConfig(root: string, project: ProjectConfig | null): Promise<ImageConfig> {
  type Local = { comfyui?: { url?: unknown; models?: unknown; timeout_s?: unknown } } | null;
  let local = null as Local;
  try {
    local = parse(await readFile(join(root, LOCAL_FILE), 'utf8')) as Local;
  } catch {
    /* pas de scroum.local.yaml */
  }
  const models: Record<string, string> = { ...(project?.comfyui?.models ?? {}) };
  const lm = local?.comfyui?.models;
  if (lm && typeof lm === 'object') for (const [k, v] of Object.entries(lm)) if (typeof v === 'string') models[k] = v;
  const t = typeof local?.comfyui?.timeout_s === 'number' ? local.comfyui.timeout_s : project?.comfyui?.timeout_s;
  return {
    url: typeof local?.comfyui?.url === 'string' && local.comfyui.url ? local.comfyui.url : DEFAULT_COMFY_URL,
    models,
    timeoutMs: t ? t * 1000 : undefined,
    gameWorkflowsDir: join(root, project?.workflows ?? 'workflows'),
  };
}

export async function createProvider(root: string, project: ProjectConfig | null): Promise<ImageProvider> {
  const c = await loadImageConfig(root, project);
  return new ComfyUIProvider({ url: c.url, models: c.models, gameWorkflowsDir: c.gameWorkflowsDir, timeoutMs: c.timeoutMs });
}
