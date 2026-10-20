import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPrompt, generateForAsset, listAssets, listCandidates, loadImageConfig, parseStyle, selectCandidate, validateAsset, ComfyUIProvider, ImageError } from '../src';
import { startFakeComfy, type FakeComfy } from '../src/fake-comfyui';

const STYLE = `---
status: draft
postprocess:
  royaumes:
    pixelate: 4
    colors: 16
  default:
    colors: 64
---
# Direction artistique

## Négatif commun (tous mondes)

\`\`\`
text, watermark,
nsfw
\`\`\`

## Royaumes (\`royaumes\`)

- **Préfixe** : \`16-bit pixel art, \`
- **Suffixe** : \`, no text\`
- **Palette** : émeraude \`#2e8b57\`, or \`#E0B040\`
- **Négatif spécifique** : \`photorealistic\`

## IRL (\`irl\`)

- **Préfixe** : \`snapshot, \`
`;

describe('style.md', () => {
  it('lit le négatif commun, les mondes et le post-traitement', () => {
    const g = parseStyle(STYLE);
    expect(g.negative).toBe('text, watermark, nsfw');
    expect(g.worlds.royaumes).toEqual({ prefix: '16-bit pixel art,', suffix: ', no text'.trim(), negative: 'photorealistic', palette: ['#2E8B57', '#E0B040'] });
    expect(g.worlds.irl!.prefix).toBe('snapshot,');
    expect(g.postprocess).toEqual({ royaumes: { pixelate: 4, colors: 16 }, default: { colors: 64 } });
  });
  it('construit prompt et négatif', () => {
    const g = parseStyle(STYLE);
    expect(buildPrompt(g, 'royaumes', 'une taverne', 'flou')).toEqual({ prompt: '16-bit pixel art, une taverne, no text', negative: 'text, watermark, nsfw, photorealistic, flou' });
    expect(buildPrompt(g, null, 'x').prompt).toBe('x');
    // préfixe déjà présent dans le prompt de l'asset : pas de doublon
    expect(buildPrompt(g, 'royaumes', '16-bit pixel art, une taverne').prompt).toBe('16-bit pixel art, une taverne, no text');
    expect(buildPrompt(null, 'royaumes', 'x')).toEqual({ prompt: 'x', negative: '' });
  });
  it('lit le vrai style.md de Boris si présent', () => {
    const f = resolve(__dirname, '../../../../SCROUM_Boris/content/bible/style.md');
    if (!existsSync(f)) return;
    const g = parseStyle(readFileSync(f, 'utf8'));
    expect(g.negative).toContain('watermark');
    expect(Object.keys(g.worlds)).toContain('royaumes_azerine');
    expect(g.worlds.royaumes_azerine!.prefix).toMatch(/^16-bit pixel art/);
    expect(g.worlds.royaumes_azerine!.palette.length).toBeGreaterThan(2);
  });
});

let fake: FakeComfy;
let repo: string;
const MODELS = { unet: 'u.gguf', clip: 'c.safetensors', vae: 'v.safetensors' };
const ctx = () => ({ root: repo, contentDir: join(repo, 'content'), config: null, provider: new ComfyUIProvider({ url: fake.url, models: MODELS, pollMs: 30 }) });

beforeEach(async () => {
  fake = await startFakeComfy();
  repo = mkdtempSync(join(tmpdir(), 'scroum-gen-'));
  cpSync(resolve(__dirname, '../../../examples/demo'), repo, { recursive: true });
  mkdirSync(join(repo, 'content/bible'), { recursive: true });
  writeFileSync(join(repo, 'content/bible/style.md'), STYLE);
});
afterEach(async () => {
  await fake.close();
  rmSync(repo, { recursive: true, force: true });
});

function addAsset(id: string, yaml: string): void {
  const f = join(repo, 'content/assets/assets.yaml');
  const cur = existsSync(f) ? readFileSync(f, 'utf8') : '';
  mkdirSync(join(repo, 'content/assets'), { recursive: true });
  writeFileSync(f, `${cur}\n# commentaire conservé\n${id}:\n${yaml}\n`);
}

describe('candidats et sélection', () => {
  it('génère, numérote sans écraser, applique le style du monde', async () => {
    addAsset('img_test', '  status: draft\n  kind: background\n  prompt: une taverne\n  world: royaumes');
    const first = await generateForAsset(ctx(), { assetId: 'img_test', n: 2, seed: 10 });
    expect(first.map((m) => [m.n, m.seed, m.file])).toEqual([[1, 10, '1.png'], [2, 11, '2.png']]);
    expect(first[0]!.prompt).toBe('16-bit pixel art, une taverne, no text');
    expect(first[0]!.userPrompt).toBe('une taverne');
    expect(first[0]!.negative).toBe('text, watermark, nsfw, photorealistic');
    expect(fake.prompts[0]!.prompt['6']!.inputs).toMatchObject({ width: 1280, height: 720 });
    const more = await generateForAsset(ctx(), { assetId: 'img_test', n: 1, prompt: 'autre', seed: 50 });
    expect(more[0]!.n).toBe(3);
    expect((await listCandidates(join(repo, 'content'), 'img_test')).map((c) => c.n)).toEqual([1, 2, 3]);
    expect(existsSync(join(repo, 'content/assets/_candidates/img_test/3.png'))).toBe(true);
  });

  it("select copie l'image, met assets.yaml à jour, statut review, jamais validated", async () => {
    addAsset('img_test', '  status: validated   # ancien\n  kind: background\n  prompt: ancien\n  references: [img_ref]');
    await generateForAsset(ctx(), { assetId: 'img_test', n: 2, prompt: 'nouveau', seed: 7, workflow: 'bg', references: [] });
    const r = await selectCandidate(join(repo, 'content'), 'img_test', 2);
    expect(r.file).toBe('assets/images/img_test.png');
    expect(existsSync(join(repo, 'content/assets/images/img_test.png'))).toBe(true);
    const y = readFileSync(join(repo, 'content/assets/assets.yaml'), 'utf8');
    expect(y).toContain('# commentaire conservé');
    expect(y).toMatch(/img_test:[\s\S]*status: review/);
    expect(y).toContain('prompt: nouveau');
    expect(y).toContain('seed: 8');
    expect(y).toContain('workflow: bg');
    expect(y).toContain('model: u.gguf');
    expect((await listAssets(join(repo, 'content'))).find((a) => a.id === 'img_test')).toMatchObject({ status: 'review', hasImage: true, candidates: 2 });
    await validateAsset(join(repo, 'content'), 'img_test');
    expect(readFileSync(join(repo, 'content/assets/assets.yaml'), 'utf8')).toMatch(/img_test:[\s\S]*status: validated/);
  });

  it('variante : le candidat devient référence (édition, pas de style)', async () => {
    addAsset('img_c', '  status: draft\n  kind: character\n  prompt: une héroïne\n  world: royaumes');
    await generateForAsset(ctx(), { assetId: 'img_c', n: 1, seed: 1 });
    const v = await generateForAsset(ctx(), { assetId: 'img_c', n: 1, prompt: 'elle sourit', variantOf: 1, seed: 2 });
    expect(v[0]).toMatchObject({ n: 2, workflow: 'char_edit', variantOf: 1, prompt: 'elle sourit', references: ['candidate:1'] });
    expect(fake.uploads.at(-1)!.name).toBe('1.png');
    const lastPrompt = fake.prompts.at(-1)!.prompt;
    expect(Object.values(lastPrompt).some((n) => n.class_type === 'TextEncodeQwenImageEdit')).toBe(true);
  });

  it('références par id : exige une image retenue ; erreurs claires', async () => {
    addAsset('img_a', '  status: draft\n  kind: character\n  prompt: x');
    addAsset('img_b', '  status: draft\n  kind: character\n  prompt: y');
    await expect(generateForAsset(ctx(), { assetId: 'img_a', references: ['img_b'] })).rejects.toThrow(/aucune image retenue/);
    await expect(generateForAsset(ctx(), { assetId: 'inconnu' })).rejects.toThrow(/absent de assets\/assets\.yaml/);
    await expect(generateForAsset(ctx(), { assetId: '../x' })).rejects.toBeInstanceOf(ImageError);
    await generateForAsset(ctx(), { assetId: 'img_b', seed: 1 });
    await selectCandidate(join(repo, 'content'), 'img_b', 1);
    const out = await generateForAsset(ctx(), { assetId: 'img_a', references: ['img_b'], seed: 3 });
    expect(out[0]!.workflow).toBe('char_edit');
    expect(fake.uploads.at(-1)!.name).toBe('img_b.png');
    await selectCandidate(join(repo, 'content'), 'img_a', 1);
    expect(readFileSync(join(repo, 'content/assets/assets.yaml'), 'utf8')).toMatch(/img_a:[\s\S]*references:\s*\n?\s*- img_b/);
  });
});

describe('configuration', () => {
  it('scroum.local.yaml surcharge le projet ; défauts ComfyUI', async () => {
    expect((await loadImageConfig(repo, null)).url).toBe('http://127.0.0.1:8188');
    writeFileSync(join(repo, 'scroum.local.yaml'), 'comfyui:\n  url: http://10.0.0.5:8188\n  models:\n    unet: local.gguf\n  timeout_s: 30\n');
    const c = await loadImageConfig(repo, { comfyui: { models: { unet: 'proj.gguf', vae: 'v.sft' } } } as never);
    expect(c).toMatchObject({ url: 'http://10.0.0.5:8188', models: { unet: 'local.gguf', vae: 'v.sft' }, timeoutMs: 30000 });
  });
});
