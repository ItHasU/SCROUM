import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { zipSync, strToU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FORMAT_VERSION, FormatVersionError, GameZipError, readGameZip } from '@scroum/schema';
import { buildProject, postprocessResolver, processImages } from './build';

/** Ignore un éventuel `dist/` local (build git-ignoré) lors de la copie de l'exemple. */
const noDist = (src: string): boolean => !/[\\/]dist$/.test(src);

const demo = fileURLToPath(new URL('../../../examples/demo/', import.meta.url));
let tmp: string;
let repo: string;
beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'scroum-build-'));
  repo = join(tmp, 'demo');
  cpSync(demo, repo, { recursive: true, filter: noDist });
  const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#336699' } }).png().toBuffer();
  writeFileSync(join(repo, 'content/assets/images/img_port_bg.png'), png);
  mkdirSync(join(repo, 'content/assets/_candidates/img_port_bg'), { recursive: true });
  writeFileSync(join(repo, 'content/assets/_candidates/img_port_bg/1.png'), png);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('buildProject', () => {
  it('produit un zip relisible avec readGameZip (images en webp, redimensionnées)', async () => {
    const r = await buildProject(repo, { buildDate: '2026-01-01T00:00:00.000Z' });
    expect(r.ok).toBe(true);
    expect(r.zipPath).toMatch(/dist[\\/]demo-.+\.scroum\.zip$/);
    const zip = readGameZip(new Uint8Array(readFileSync(r.zipPath!)));
    expect(zip.manifest.formatVersion).toBe(FORMAT_VERSION);
    expect(zip.manifest.title).toBe(zip.game.meta.title);
    expect(zip.manifest.buildDate).toBe('2026-01-01T00:00:00.000Z');
    expect(zip.manifest.images).toEqual([{ id: 'img_port_bg', file: 'images/img_port_bg.webp' }]);
    expect([...zip.images.keys()]).toEqual(['img_port_bg']);
    const meta = await sharp(zip.images.get('img_port_bg')!).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1280);
    expect(zip.game.assets.img_port_bg!.file).toBe('images/img_port_bg.webp');
    expect(Object.keys(zip.game.scenes).length).toBeGreaterThan(0);
  });

  it('copie brute avec avertissement si sharp est indisponible', async () => {
    const r = await buildProject(repo, { noSharp: true });
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/sharp/);
    const zip = readGameZip(new Uint8Array(readFileSync(r.zipPath!)));
    expect(zip.manifest.images[0]!.file).toBe('images/img_port_bg.png');
  });

  it('exclut _candidates/', async () => {
    const r = await buildProject(repo);
    const zip = readGameZip(new Uint8Array(readFileSync(r.zipPath!)));
    expect(zip.images.size).toBe(1);
  });

  it('refuse (aucun zip) si la validation échoue', async () => {
    const bad = join(tmp, 'bad');
    cpSync(demo, bad, { recursive: true, filter: noDist });
    writeFileSync(join(bad, 'content/scenes/port.yaml'), 'id: [pas, valide');
    const r = await buildProject(bad);
    expect(r.ok).toBe(false);
    expect(r.report.errors.length).toBeGreaterThan(0);
    expect(existsSync(join(bad, 'dist'))).toBe(false);
  });
});

describe('readGameZip', () => {
  const zipOf = (manifest: object, game: object = {}) =>
    zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'game.json': strToU8(JSON.stringify(game)) });

  it('refuse proprement un formatVersion plus récent', () => {
    const bytes = zipOf({ formatVersion: FORMAT_VERSION + 1, title: 'x', version: '1', buildDate: '', images: [] });
    expect(() => readGameZip(bytes)).toThrow(FormatVersionError);
    expect(() => readGameZip(bytes)).toThrow(/mettre à jour/);
  });
  it('un zip au format 1 est migré ; le zip produit porte le format courant (un lecteur v1 le refusera)', () => {
    const old = readGameZip(zipOf({ formatVersion: 1, title: 'x', version: '1', buildDate: '', images: [] }, { formatVersion: 1, meta: { formatVersion: 1 } }));
    expect(old.manifest.formatVersion).toBe(FORMAT_VERSION);
    expect(FORMAT_VERSION).toBeGreaterThanOrEqual(2);
  });
  it('refuse un manifest sans formatVersion, un zip illisible et un zip incomplet', () => {
    expect(() => readGameZip(zipOf({ title: 'x' }))).toThrow(FormatVersionError);
    expect(() => readGameZip(new Uint8Array([1, 2, 3]))).toThrow(GameZipError);
    expect(() => readGameZip(zipSync({ 'a.txt': strToU8('a') }))).toThrow(/manifest\.json absent/);
  });
});

describe('post-traitement des images', () => {
  const noise = async (): Promise<Buffer> => {
    const w = 64;
    const raw = Buffer.alloc(w * w * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 37 + ((i / 3) | 0) * 11) % 256;
    return sharp(raw, { raw: { width: w, height: w, channels: 3 } }).png().toBuffer();
  };
  const pixels = async (b: Uint8Array) => {
    const { data, info } = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, w: info.width, colors: new Set(Array.from({ length: data.length / 3 }, (_, i) => data.subarray(i * 3, i * 3 + 3).join(','))).size };
  };

  it('pixelise et quantifie selon le réglage donné', async () => {
    const dir = join(tmp, 'pp');
    mkdirSync(join(dir, 'assets/images'), { recursive: true });
    writeFileSync(join(dir, 'assets/images/a.png'), await noise());
    writeFileSync(join(dir, 'assets/images/b.png'), await noise());
    const out = await processImages(dir, { format: 'png', max_width: 1280 }, { postprocess: (id) => (id === 'a' ? { pixelate: 8, colors: 4 } : null) }, []);
    const a = await pixels(out.get('a')!.bytes);
    expect(a.colors).toBeLessThanOrEqual(4);
    // blocs de 8x8 uniformes
    for (const [x, y] of [[0, 0], [8, 16], [56, 56]] as const) {
      const at = (dx: number, dy: number) => a.data.subarray(((y + dy) * a.w + x + dx) * 3, ((y + dy) * a.w + x + dx) * 3 + 3).join(',');
      expect(at(7, 7)).toBe(at(0, 0));
    }
    expect((await pixels(out.get('b')!.bytes)).colors).toBeGreaterThan(100);
  });

  it('lit le réglage de style.md (front-matter) et le laisse surcharger par le projet', async () => {
    const r = join(tmp, 'pp2');
    cpSync(repo, r, { recursive: true, filter: noDist });
    const game = (await buildProject(r)).report.game!;
    mkdirSync(join(r, 'content/bible'), { recursive: true });
    writeFileSync(join(r, 'content/bible/style.md'), '---\npostprocess:\n  default:\n    colors: 8\n---\n# Style\n');
    expect((await postprocessResolver(join(r, 'content'), null, game))('img_port_bg')).toEqual({ colors: 8 });
    const cfg = { images: { format: 'webp', max_width: 1280, postprocess: { default: { pixelate: 4 } } } } as never;
    expect((await postprocessResolver(join(r, 'content'), cfg, game))('img_port_bg')).toEqual({ pixelate: 4 });
    const built = await buildProject(r);
    expect(built.ok).toBe(true);
  });
});
