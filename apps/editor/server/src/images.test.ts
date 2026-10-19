import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveProject } from '@scroum/build';
import { startFakeComfy, type FakeComfy } from '@scroum/images/testing';
import { startEditorServer, type EditorServer } from './index';

const demo = fileURLToPath(new URL('../../../../examples/demo/', import.meta.url));
let tmp: string;
let repo: string;
let srv: EditorServer;
let comfy: FakeComfy;
const api = (p: string, init?: RequestInit) => fetch(srv.url + p, init);
const post = (p: string, body: object, headers: Record<string, string> = {}) =>
  api(p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const yaml = () => readFileSync(join(repo, 'content/assets/assets.yaml'), 'utf8');

beforeAll(async () => {
  comfy = await startFakeComfy();
  tmp = mkdtempSync(join(tmpdir(), 'scroum-srvimg-'));
  repo = join(tmp, 'demo');
  cpSync(demo, repo, { recursive: true, filter: (s) => !/[\\/]dist$/.test(s) });
  writeFileSync(join(repo, 'scroum.local.yaml'), `comfyui:\n  url: ${comfy.url}\n  models:\n    unet: u.gguf\n    clip: c.sft\n    vae: v.sft\n`);
  srv = await startEditorServer({ project: resolveProject(repo), port: 0, debounceMs: 30, playerDir: join(tmp, 'none') });
});
afterAll(async () => {
  await srv.close();
  await comfy.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('API images', () => {
  it('ping ComfyUI via scroum.local.yaml', async () => {
    const r = await (await api('/api/comfyui')).json();
    expect(r).toMatchObject({ ok: true, url: comfy.url, version: 'fake-1.0', models: { unet: 'u.gguf' } });
  });

  it('génère en JSON puis liste et sert les candidats', async () => {
    const r = await post('/api/gen-image', { assetId: 'img_port_bg', n: 2, seed: 9 });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { candidates: { n: number; seed: number }[] };
    expect(body.candidates.map((c) => [c.n, c.seed])).toEqual([[1, 9], [2, 10]]);
    const list = (await (await api('/api/candidates/img_port_bg')).json()) as { candidates: unknown[] };
    expect(list.candidates).toHaveLength(2);
    const img = await api('/api/candidates/img_port_bg/1.png');
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await img.arrayBuffer())[1]).toBe(80);
    expect((await api('/api/candidates/img_port_bg/..%2Fx.png')).status).toBe(400);
    const assets = ((await (await api('/api/assets')).json()) as { assets: { id: string; candidates: number; hasImage: boolean }[] }).assets;
    expect(assets.find((a) => a.id === 'img_port_bg')).toMatchObject({ candidates: 2, hasImage: false });
  });

  it('flux SSE de progression', async () => {
    const r = await post('/api/gen-image', { assetId: 'img_loic', n: 1, seed: 1 }, { accept: 'text/event-stream' });
    expect(r.headers.get('content-type')).toContain('text/event-stream');
    const events = (await r.text()).split('\n\n').filter(Boolean).map((l) => JSON.parse(l.slice(6)) as { type: string; phase?: string; ok?: boolean });
    expect(events[0]!.type).toBe('start');
    expect(events.some((e) => e.type === 'progress' && e.phase === 'running')).toBe(true);
    expect(events.some((e) => e.type === 'candidate')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done', ok: true });
  });

  it('sélection : copie, assets.yaml à jour, statut review ; validation seulement avec confirm', async () => {
    const r = await post('/api/assets/img_port_bg/select', { candidate: 2 });
    expect(await r.json()).toMatchObject({ ok: true, file: 'assets/images/img_port_bg.png', status: 'review' });
    expect(existsSync(join(repo, 'content/assets/images/img_port_bg.png'))).toBe(true);
    const line = yaml().split('\n').find((l) => l.startsWith('img_port_bg:'))!;
    expect(line).toMatch(/status: review/);
    expect(line).toMatch(/seed: 10/);
    expect(line).toMatch(/model: u\.gguf/);
    expect((await post('/api/assets/img_port_bg/validate', {})).status).toBe(400);
    expect(yaml()).not.toMatch(/img_port_bg:.*status: validated/);
    expect((await post('/api/assets/img_port_bg/validate', { confirm: true })).status).toBe(200);
    expect(yaml()).toMatch(/img_port_bg:.*status: validated/);
    expect((await post('/api/assets/img_loic/validate', { confirm: true })).status).toBe(400); // pas d'image retenue
    expect((await post('/api/assets/img_port_bg/select', { candidate: 99 })).status).toBe(400);
  });

  it('variante à partir d’un candidat', async () => {
    const r = await post('/api/gen-image', { assetId: 'img_loic', n: 1, variantOf: 1, prompt: 'il rit', seed: 4 });
    const c = ((await r.json()) as { candidates: { workflow: string; variantOf: number; references: string[] }[] }).candidates[0]!;
    expect(c).toMatchObject({ workflow: 'char_edit', variantOf: 1, references: ['candidate:1'] });
  });

  it('erreurs claires : asset inconnu, ComfyUI injoignable', async () => {
    const r = await post('/api/gen-image', { assetId: 'img_nope' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/absent de assets/);
    const url = comfy.url;
    await comfy.close();
    const r2 = await post('/api/gen-image', { assetId: 'img_port_bg', n: 1 });
    expect(r2.status).toBe(502);
    expect(await r2.json()).toMatchObject({ code: 'unreachable' });
    comfy = await startFakeComfy();
    void url;
  });
});
