import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ComfyUIProvider, ImageError, findWorkflowFile, loadWorkflow, placeholders, substitute, workflowDirs, type Progress } from '../src';
import { startFakeComfy, type FakeComfy } from '../src/fake-comfyui';

const MODELS = { unet: 'qwen_image_q4.gguf', clip: 'qwen_2.5_vl_7b.safetensors', vae: 'qwen_image_vae.safetensors' };
let fake: FakeComfy | null = null;
let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'scroum-img-'));
});
afterEach(async () => {
  await fake?.close();
  fake = null;
  rmSync(tmp, { recursive: true, force: true });
});
const provider = (extra: Partial<ConstructorParameters<typeof ComfyUIProvider>[0]> = {}) => new ComfyUIProvider({ url: fake!.url, models: MODELS, pollMs: 30, ...extra });
const codeOf = async (p: Promise<unknown>): Promise<string> => p.then(() => 'ok', (e: ImageError) => e.code);

describe('placeholders', () => {
  it('garde le type des valeurs entières et convertit les placeholders partiels', () => {
    const g = { a: { inputs: { seed: '{{seed}}', text: 'A {{prompt}} B', w: '{{width}}', ok: '{{flag}}' } } };
    const out = substitute(g, { seed: 42, prompt: 'chat "noir"', width: 512, flag: true }) as typeof g;
    expect(out.a.inputs).toEqual({ seed: 42, text: 'A chat "noir" B', w: 512, ok: true });
    expect(typeof out.a.inputs.seed).toBe('number');
    expect([...placeholders(g)].sort()).toEqual(['flag', 'prompt', 'seed', 'width']);
  });
  it('une valeur manquante est une erreur claire (modèles : indication de config)', () => {
    expect(() => substitute({ n: { inputs: { unet_name: '{{unet}}' } } }, {})).toThrow(/\{\{unet\}\}.*scroum\.local\.yaml/);
  });
  it('un prompt contenant des accolades ou JSON ne casse rien', () => {
    const out = substitute({ t: '{{prompt}}' }, { prompt: '{{seed}} "x" \\ }' });
    expect(out.t).toBe('{{seed}} "x" \\ }');
  });
});

describe('recherche de workflows', () => {
  it("cherche d'abord dans le jeu, puis dans les génériques", async () => {
    const game = join(tmp, 'workflows');
    mkdirSync(game);
    writeFileSync(join(game, 'bg.json'), JSON.stringify({ '1': { class_type: 'X', inputs: {} } }));
    expect(findWorkflowFile('bg', [game, join(tmp, 'none')])).toBe(join(game, 'bg.json'));
    const generic = await loadWorkflow('char_edit', workflowDirs(game));
    expect(generic.file).toMatch(/workflows[\\/]char_edit\.json$/);
    expect(generic.file.startsWith(game)).toBe(false);
    expect(generic.meta.references).toBe(1);
    expect('_scroum' in generic.graph).toBe(false);
  });
  it('workflow introuvable ou nom invalide', async () => {
    expect(await codeOf(loadWorkflow('nope', workflowDirs(tmp)))).toBe('workflow_not_found');
    expect(await codeOf(loadWorkflow('../x', workflowDirs(tmp)))).toBe('workflow_not_found');
  });
  it('les 6 workflows génériques sont du format API valide', async () => {
    for (const n of ['bg', 'char_sheet', 'item_icon', 'char_edit', 'transform', 'remove_bg']) {
      const w = await loadWorkflow(n, workflowDirs(null));
      expect(Object.keys(w.graph).length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('ComfyUIProvider', () => {
  it('génère via WebSocket : prompt, progression, history, view', async () => {
    fake = await startFakeComfy({ models: { unet: [MODELS.unet] } });
    const events: Progress[] = [];
    const out = await provider().generate({ prompt: 'un port', negative: 'flou', width: 640, height: 360, seed: 100, workflow: 'bg' }, { n: 2, onProgress: (p) => events.push(p) });
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.seed)).toEqual([100, 101]);
    expect(out[0]!.data.slice(1, 4)).toEqual(new Uint8Array([80, 78, 71]));
    expect(out[0]!.model).toBe(MODELS.unet);
    expect(fake.wsClients).toBe(2);
    const sent = fake.prompts[0]!.prompt;
    expect(sent['6']!.inputs).toMatchObject({ width: 640, height: 360 });
    expect(sent['8']!.inputs).toMatchObject({ seed: 100, steps: 20, cfg: 2.5 });
    expect(sent['1']!.inputs.unet_name).toBe(MODELS.unet);
    expect(sent['4']!.inputs.text).toBe('un port');
    expect(fake.prompts[0]!.client_id).toMatch(/[0-9a-f-]{36}/);
    expect(events.some((e) => e.phase === 'running' && e.value === 3 && e.max === 3)).toBe(true);
    expect(events.filter((e) => e.phase === 'done').map((e) => e.index)).toEqual([0, 1]);
  });
  it('repli sur le polling /history sans WebSocket', async () => {
    fake = await startFakeComfy({ noWebSocket: true });
    const out = await provider().generate({ prompt: 'x', width: 64, height: 64, seed: 1, workflow: 'item_icon' });
    expect(out).toHaveLength(1);
    expect(fake.wsClients).toBe(0);
  });
  it('édition : upload multipart des références, nom injecté dans {{ref_image_1}}', async () => {
    fake = await startFakeComfy();
    const ref = join(tmp, 'margot.png');
    writeFileSync(ref, Buffer.from('fakepng'));
    const out = await provider().edit({ references: [ref], instruction: 'sourire', workflow: 'char_edit', seed: 5 });
    expect(fake.uploads).toEqual([{ name: 'margot.png', bytes: expect.any(Number) }]);
    expect(fake.prompts[0]!.prompt['4']!.inputs.image).toBe('margot.png');
    expect(out[0]!.references).toEqual(['margot.png']);
    expect(await codeOf(provider().edit({ references: [], instruction: 'x', workflow: 'char_edit' }))).toBe('missing_param');
  });
  it('workflow demandant une référence non fournie', async () => {
    fake = await startFakeComfy();
    expect(await codeOf(provider().generate({ prompt: 'x', width: 8, height: 8, workflow: 'remove_bg' }))).toBe('missing_param');
  });
  it('délai dépassé', async () => {
    fake = await startFakeComfy({ hang: true });
    expect(await codeOf(provider({ timeoutMs: 250 }).generate({ prompt: 'x', width: 8, height: 8, workflow: 'bg' }))).toBe('timeout');
  });
  it('annulation : interrompt ComfyUI', async () => {
    fake = await startFakeComfy({ hang: true });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    expect(await codeOf(provider().generate({ prompt: 'x', width: 8, height: 8, workflow: 'bg' }, { signal: ac.signal }))).toBe('aborted');
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.interrupts).toBe(1);
  });
  it('ComfyUI injoignable', async () => {
    fake = await startFakeComfy();
    const url = fake.url;
    await fake.close();
    fake = null;
    const err = await new ComfyUIProvider({ url, models: MODELS }).generate({ prompt: 'x', width: 8, height: 8, workflow: 'bg' }).catch((e: ImageError) => e);
    expect((err as ImageError).code).toBe('unreachable');
    expect((err as Error).message).toContain('scroum.local.yaml');
  });
  it('noeud inconnu et modèle inconnu', async () => {
    fake = await startFakeComfy({ knownNodes: ['LoadImage', 'SaveImage'] });
    const e1 = await provider().generate({ prompt: 'x', width: 8, height: 8, workflow: 'bg' }).catch((e: ImageError) => e);
    expect((e1 as ImageError).code).toBe('unknown_node');
    await fake.close();
    fake = await startFakeComfy({ models: { unet: ['autre.gguf'] } });
    const e2 = await provider().generate({ prompt: 'x', width: 8, height: 8, workflow: 'bg' }).catch((e: ImageError) => e);
    expect((e2 as ImageError).code).toBe('unknown_model');
    expect((e2 as Error).message).toMatch(/unet_name.*qwen_image_q4\.gguf.*autre\.gguf/);
  });
  it("échec d'exécution", async () => {
    fake = await startFakeComfy({ failExecution: 'CUDA out of memory' });
    const e = await provider().generate({ prompt: 'x', width: 8, height: 8, workflow: 'bg' }).catch((x: ImageError) => x);
    expect((e as ImageError).code).toBe('execution');
    expect((e as Error).message).toContain('CUDA out of memory');
  });
  it('modèle non configuré : message de configuration', async () => {
    fake = await startFakeComfy();
    const e = await new ComfyUIProvider({ url: fake.url }).generate({ prompt: 'x', width: 8, height: 8, workflow: 'bg' }).catch((x: ImageError) => x);
    expect((e as ImageError).code).toBe('missing_param');
    expect((e as Error).message).toContain('{{unet}}');
  });
});
