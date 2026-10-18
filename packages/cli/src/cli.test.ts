import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { main, type Io } from './index';

const examples = fileURLToPath(new URL('../../../examples/', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'scroum-cli-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function io(cwd = examples): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (s) => stdout.push(s), err: (s) => stderr.push(s), cwd, color: false };
}

describe('scroum validate', () => {
  it('valide la démo (chemin relatif au dossier courant)', async () => {
    const t = io();
    expect(await main(['validate', 'demo'], t)).toBe(0);
    expect(t.stdout.join('\n')).toMatch(/Le Phare de Kerbrume/);
    expect(t.stdout.join('\n')).toMatch(/✔ Contenu valide \(0 erreur/);
  });

  it('dossier courant par défaut, et dossier content/ direct', async () => {
    expect(await main(['validate'], io(join(examples, 'demo')))).toBe(0);
    expect(await main(['validate', join(examples, 'demo', 'content')], io())).toBe(0);
  });

  it('code de retour 1 et sortie lisible en cas d’erreur', async () => {
    const dir = join(tmp, 'casse');
    cpSync(join(examples, 'demo'), dir, { recursive: true });
    const scene = join(dir, 'content/scenes/port.yaml');
    writeFileSync(scene, readFileSync(scene, 'utf8').replace('to: phare_bas', 'to: nulle_part'));
    const t = io();
    expect(await main(['validate', dir, '--quiet'], t)).toBe(1);
    const out = t.stdout.join('\n');
    expect(out).toMatch(/scenes\/port\.yaml/);
    expect(out).toMatch(/✖ exits\[0\]\.to : scène « nulle_part » inconnue/);
    expect(out).toMatch(/Contenu invalide \(1 erreur/);
  });

  it('--json produit un rapport structuré', async () => {
    const t = io();
    expect(await main(['validate', 'demo-softlock', '--json'], t)).toBe(0);
    const report = JSON.parse(t.stdout.join('\n'));
    expect(report).toMatchObject({ ok: true, errors: [], warnings: [], skipped: [] });
    expect(report.game).toBeUndefined();
  });

  it('projet introuvable ou invalide', async () => {
    const t = io(tmp);
    expect(await main(['validate'], t)).toBe(1);
    expect(t.stderr[0]).toMatch(/ni scroum\.project\.yaml/);
    const bad = join(tmp, 'mauvais');
    cpSync(join(examples, 'demo-softlock'), bad, { recursive: true });
    writeFileSync(join(bad, 'scroum.project.yaml'), 'formatVersion: 1\nname: "Pas Bon"\n');
    const t2 = io();
    expect(await main(['validate', bad], t2)).toBe(1);
    expect(t2.stderr[0]).toMatch(/scroum\.project\.yaml invalide : name/);
  });
});

describe('autres commandes', () => {
  it('build, edit, gen-image : non implémentées', async () => {
    for (const c of ['build', 'edit', 'gen-image']) {
      const t = io();
      expect(await main([c], t)).toBe(1);
      expect(t.stderr[0]).toMatch(/pas encore implémentée/);
    }
  });
  it('aide, version, commande inconnue', async () => {
    expect(await main(['--help'], io())).toBe(0);
    expect(await main(['--version'], io())).toBe(0);
    expect(await main([], io())).toBe(2);
    expect(await main(['danse'], io())).toBe(2);
    expect(await main(['validate', '--strict'], io())).toBe(2);
  });
});
