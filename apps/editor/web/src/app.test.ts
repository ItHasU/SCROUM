// @vitest-environment jsdom
/**
 * Test d'intégration du front dans jsdom, contre un vrai serveur d'éditeur
 * lancé sur une copie temporaire de examples/demo (pas de navigateur requis).
 */
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import { startFakeComfy, type FakeComfy } from '@scroum/images/testing';

let comfy: FakeComfy;

let tmp: string;
let child: ChildProcess;
let baseUrl = '';

/** Lance `scroum edit` dans un processus séparé (l'environnement jsdom ne convient pas au serveur). */
async function startServer(dir: string): Promise<void> {
  const port = await new Promise<number>((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
  child = spawn(process.execPath, [resolve(__dirname, '../../../../packages/cli/bin/scroum.js'), 'edit', dir, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((res, rej) => {
    child.stdout!.on('data', (d: Buffer) => d.toString().includes('http://') && res());
    child.once('exit', (c) => rej(new Error('serveur arrêté : ' + c)));
  });
  baseUrl = `http://127.0.0.1:${port}`;
}

const until = async (fn: () => boolean, ms = 8000): Promise<void> => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('délai dépassé : ' + fn.toString());
    await new Promise((r) => setTimeout(r, 25));
  }
};

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'scroum-web-'));
  cpSync(resolve(__dirname, '../../../../examples/demo'), tmp, { recursive: true });
  comfy = await startFakeComfy({ delayMs: 10 });
  writeFileSync(join(tmp, 'scroum.local.yaml'), `comfyui:\n  url: ${comfy.url}\n  models: { unet: u, clip: c, vae: v }\n`);
  await startServer(tmp);
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => realFetch(typeof input === 'string' && input.startsWith('/') ? baseUrl + input : input, init));
  vi.stubGlobal('EventSource', class { onmessage = null; onopen = null; onerror = null; close(): void {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  document.body.innerHTML = '<div id="app"></div>';
  await import('./main');
  await until(() => document.querySelector<HTMLElement>('#validation-counter')?.dataset.errors !== undefined);
});

afterAll(async () => {
  child?.kill();
  await comfy?.close();
  rmSync(tmp, { recursive: true, force: true });
});

const nav = (v: string): void => document.querySelector<HTMLElement>(`.nav-btn[data-view="${v}"]`)!.click();
const view = (v: string): HTMLElement => document.querySelector<HTMLElement>(`.view.${v}`)!;

describe('front de l’éditeur (jsdom)', () => {
  it('affiche la mise en page et le compteur de validation', () => {
    expect(document.querySelectorAll('.nav-btn')).toHaveLength(7);
    const c = document.querySelector<HTMLElement>('#validation-counter')!;
    expect(c.dataset.errors).toBe('0');
    expect(document.title).toContain('Éditeur SCROUM');
  });

  it('Bible : tableau de bord et statuts', async () => {
    nav('bible');
    await until(() => !!view('bible').querySelector('.stats'));
    expect(view('bible').textContent).toContain('À valider');
    expect(view('bible').querySelectorAll('.badge').length).toBeGreaterThan(5);
  });

  it('Objets : une ligne par objet', async () => {
    nav('items');
    await until(() => view('items').querySelectorAll('tbody tr').length > 0);
    expect(view('items').querySelectorAll('tbody tr').length).toBe(7);
    expect(view('items').textContent).toContain('Mèche de coton');
  });

  it('Fichiers → inspecteur avec le YAML brut', async () => {
    nav('files');
    await until(() => view('files').querySelectorAll('button.link').length > 0);
    [...view('files').querySelectorAll<HTMLElement>('button.link')].find((b) => b.textContent === 'scenes/port.yaml')!.click();
    await until(() => !!document.querySelector<HTMLTextAreaElement>('textarea.yaml')?.value.includes('Le port'));
  });

  it('Inspecteur : formulaire d’un hotspot et enregistrement (200 puis 422)', async () => {
    const link = [...document.querySelectorAll<HTMLElement>('button.link')];
    expect(link.length).toBeGreaterThan(0);
    const { select } = await import('./store');
    select({ kind: 'hotspot', id: 'rochers', parent: 'port' });
    await until(() => document.querySelectorAll('.form .field').length > 0);
    const input = document.querySelector<HTMLInputElement>('.form .field input')!;
    input.value = 'Gros rochers';
    input.dispatchEvent(new Event('input'));
    const ta = document.querySelector<HTMLTextAreaElement>('textarea.yaml')!;
    expect(ta.value).toContain('Gros rochers');
    const save = document.querySelector<HTMLButtonElement>('button.save')!;
    expect(save.disabled).toBe(false);
    save.click();
    await until(() => save.disabled);
    ta.value = 'title: [pas fermé';
    ta.dispatchEvent(new Event('input'));
    save.click();
    await until(() => !!document.querySelector('.issues .issue.err'));
  });

  it('Graphe : Cytoscape affiche les nœuds', async () => {
    nav('graph');
    await until(() => Number(view('graph').dataset.ready ?? 0) > 5, 15000);
    expect(Number(view('graph').dataset.ready)).toBeGreaterThanOrEqual(15);
  });

  it('Atelier d’images : génération, sélection, comparaison, validation humaine', async () => {
    nav('images');
    await until(() => view('images').querySelectorAll('.img-row').length > 5, 30000);
    // l'état de ComfyUI arrive par une requête séparée, parfois après la liste des assets
    await until(() => (view('images').textContent ?? '').includes('connecté'), 30000);
    view('images').querySelector<HTMLElement>('.img-row[data-asset="img_port_bg"]')!.click();
    await until(() => (view('images').querySelector<HTMLTextAreaElement>('#img-prompt')?.value ?? '').includes('port breton'), 30000);
    const n = view('images').querySelector<HTMLInputElement>('#img-n')!;
    n.value = '2';
    view('images').querySelector<HTMLElement>('#img-generate')!.click();
    await until(() => view('images').querySelectorAll('.cand').length === 2, 30000);
    expect(view('images').querySelector('#img-status')!.textContent).toMatch(/Terminé|Candidat/);
    // Retenir le candidat 1 → statut « à relire », vignette dans la liste
    await until(() => !view('images').querySelector<HTMLButtonElement>('.cand .select')!.disabled, 30000);
    view('images').querySelector<HTMLElement>('.cand .select')!.click();
    await until(() => !!view('images').querySelector('.img-row[data-asset="img_port_bg"] .st-review'), 30000);
    expect(view('images').querySelector('.img-row[data-asset="img_port_bg"] img.thumb')).toBeTruthy();
    // Comparaison avec un autre asset
    const cmp = view('images').querySelector<HTMLSelectElement>('#img-compare')!;
    cmp.value = 'img_loic';
    cmp.dispatchEvent(new Event('change'));
    await until(() => view('images').querySelectorAll('.cmp > div').length === 2, 30000);
    // Validation (action humaine)
    await until(() => !view('images').querySelector<HTMLButtonElement>('#img-validate')!.disabled, 30000);
    view('images').querySelector<HTMLElement>('#img-validate')!.click();
    await until(() => !!view('images').querySelector('.img-row[data-asset="img_port_bg"] .st-validated'), 30000);
  }, 90_000);
});
