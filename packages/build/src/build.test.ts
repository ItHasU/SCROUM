import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { zipSync, strToU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FORMAT_VERSION, FormatVersionError, GameZipError, readGameZip } from '@scroum/schema';
import { buildProject } from './build';

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
  it('refuse un manifest sans formatVersion, un zip illisible et un zip incomplet', () => {
    expect(() => readGameZip(zipOf({ title: 'x' }))).toThrow(FormatVersionError);
    expect(() => readGameZip(new Uint8Array([1, 2, 3]))).toThrow(GameZipError);
    expect(() => readGameZip(zipSync({ 'a.txt': strToU8('a') }))).toThrow(/manifest\.json absent/);
  });
});
