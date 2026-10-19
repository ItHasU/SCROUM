import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { startFakeComfy } from '@scroum/images/testing';
import { startEditorServer } from '@scroum/editor-server';
import { resolveProject } from '@scroum/build';
import { main, type Io } from './index';

/** Ignore un éventuel `dist/` local (build git-ignoré) lors de la copie de l'exemple. */
const noDist = (src: string): boolean => !/[\\/]dist$/.test(src);

vi.setConfig({ testTimeout: 60_000 });

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
    cpSync(join(examples, 'demo'), dir, { recursive: true, filter: noDist });
    const scene = join(dir, 'content/scenes/port.yaml');
    writeFileSync(scene, readFileSync(scene, 'utf8').replace('to: phare_bas', 'to: nulle_part'));
    const t = io();
    expect(await main(['validate', dir, '--quiet'], t)).toBe(1);
    const out = t.stdout.join('\n');
    expect(out).toMatch(/scenes\/port\.yaml/);
    expect(out).toMatch(/✖ exits\[0\]\.to : scène « nulle_part » inconnue/);
    expect(out).toMatch(/Contenu invalide \(1 erreur/);
  });

  it('--json produit un rapport structuré, avec la jouabilité', async () => {
    const t = io();
    expect(await main(['validate', 'demo', '--json'], t)).toBe(0);
    const report = JSON.parse(t.stdout.join('\n'));
    expect(report).toMatchObject({ ok: true, errors: [], skipped: [] });
    expect(report.playability).toMatchObject({ complete: true, winReachable: true, softlocks: [] });
    expect(report.game).toBeUndefined();
  });

  it('démo : résumé de jouabilité, fin win atteignable, aucun soft-lock', async () => {
    const t = io();
    expect(await main(['validate', 'demo'], t)).toBe(0);
    const out = t.stdout.join('\n');
    expect(out).toMatch(/Jouabilité : \d+ états? explorés.*exploration complète/);
    expect(out).toMatch(/fin win atteignable : phare_rallume/);
    expect(out).toMatch(/aucun soft-lock/);
  });

  it('demo-softlock : soft-lock avec son chemin lisible, code 1 (critère M1b)', async () => {
    const t = io();
    expect(await main(['validate', 'demo-softlock'], t)).toBe(1);
    const out = t.stdout.join('\n');
    expect(out).toMatch(/\[softlock\]/);
    expect(out).toMatch(/take cle → use cle on porte1/);
    expect(out).toMatch(/1 soft-lock/);
  });

  it('--path-out écrit les chemins rejouables ; --no-playability les désactive', async () => {
    const f = join(tmp, 'paths.json');
    expect(await main(['validate', 'demo-softlock', '--path-out', f], io())).toBe(1);
    const paths = JSON.parse(readFileSync(f, 'utf8'));
    expect(paths.softlocks.length).toBeGreaterThan(0);
    const t = io();
    expect(await main(['validate', 'demo-softlock', '--no-playability', '--json'], t)).toBe(0);
    expect(JSON.parse(t.stdout.join('\n')).playability).toBeNull();
    expect(await main(['validate', 'demo', '--no-playability', '--path-out', f], io())).toBe(2);
  });

  it('bornes dépassées : exploration incomplète signalée', async () => {
    const t = io();
    await main(['validate', 'demo', '--max-states', '5'], t);
    expect(t.stdout.join('\n')).toMatch(/exploration INCOMPLÈTE/);
    expect(await main(['validate', 'demo', '--max-states', 'abc'], io())).toBe(2);
  });

  it('projet introuvable ou invalide', async () => {
    const t = io(tmp);
    expect(await main(['validate'], t)).toBe(1);
    expect(t.stderr[0]).toMatch(/ni scroum\.project\.yaml/);
    const bad = join(tmp, 'mauvais');
    cpSync(join(examples, 'demo-softlock'), bad, { recursive: true, filter: noDist });
    writeFileSync(join(bad, 'scroum.project.yaml'), 'formatVersion: 1\nname: "Pas Bon"\n');
    const t2 = io();
    expect(await main(['validate', bad], t2)).toBe(1);
    expect(t2.stderr[0]).toMatch(/scroum\.project\.yaml invalide : name/);
  });
});

describe('autres commandes', () => {
  it('aide, version, commande inconnue', async () => {
    expect(await main(['--help'], io())).toBe(0);
    expect(await main(['--version'], io())).toBe(0);
    expect(await main([], io())).toBe(2);
    expect(await main(['danse'], io())).toBe(2);
    expect(await main(['validate', '--strict'], io())).toBe(2);
  });
});

describe('scroum build', () => {
  it('construit la démo et affiche le chemin du zip', async () => {
    const dir = join(tmp, 'build-demo');
    cpSync(join(examples, 'demo'), dir, { recursive: true, filter: noDist });
    const t = io();
    expect(await main(['build', dir], t)).toBe(0);
    expect(t.stdout.join('\n')).toMatch(/demo-.+\.scroum\.zip/);
  });
  it('code 1 et pas de zip si la validation échoue', async () => {
    const dir = join(tmp, 'build-bad');
    cpSync(join(examples, 'demo'), dir, { recursive: true, filter: noDist });
    writeFileSync(join(dir, 'content/scenes/port.yaml'), 'id: [casse');
    const t = io();
    expect(await main(['build', dir], t)).toBe(1);
    expect(existsSync(join(dir, 'dist'))).toBe(false);
  });
});

describe('scroum gen-image', () => {
  async function gameRepo(name: string, comfyUrl: string): Promise<string> {
    const dir = join(tmp, name);
    cpSync(join(examples, 'demo'), dir, { recursive: true, filter: noDist });
    writeFileSync(join(dir, 'scroum.local.yaml'), `comfyui:\n  url: ${comfyUrl}\n  models: { unet: u, clip: c, vae: v }\n`);
    return dir;
  }

  it('usage et options invalides', async () => {
    const t = io();
    expect(await main(['gen-image', 'demo'], t)).toBe(2);
    expect(t.stderr.join()).toMatch(/--asset/);
    expect(await main(['gen-image', 'demo', '--asset', 'x', '--n', 'abc'], io())).toBe(2);
    expect(await main(['gen-image', 'demo', '--asset', 'x', '--bidon'], io())).toBe(2);
  });

  it('génération directe (sans éditeur) : candidats déposés, statut inchangé', async () => {
    const comfy = await startFakeComfy();
    try {
      const dir = await gameRepo('gen-direct', comfy.url);
      const t = io();
      expect(await main(['gen-image', dir, '--asset', 'img_port_bg', '--n', '2', '--seed', '5', '--no-server'], t)).toBe(0);
      expect(t.stdout.join('\n')).toMatch(/génération directe/);
      expect(existsSync(join(dir, 'content/assets/_candidates/img_port_bg/2.png'))).toBe(true);
      expect(readFileSync(join(dir, 'content/assets/assets.yaml'), 'utf8')).not.toMatch(/img_port_bg:.*status: (review|validated)/);
      expect(existsSync(join(dir, 'content/assets/images/img_port_bg.png'))).toBe(false);
    } finally {
      await comfy.close();
    }
  });

  it("passe par l'éditeur s'il tourne", async () => {
    const comfy = await startFakeComfy();
    const dir = await gameRepo('gen-server', comfy.url);
    const srv = await startEditorServer({ project: resolveProject(dir), port: 0, playerDir: join(tmp, 'none') });
    try {
      const t = io();
      expect(await main(['gen-image', dir, '--asset', 'img_loic', '--n', '1', '--url', srv.url], t)).toBe(0);
      expect(t.stdout.join('\n')).toMatch(/Via l'éditeur/);
      expect(existsSync(join(dir, 'content/assets/_candidates/img_loic/1.png'))).toBe(true);
    } finally {
      await srv.close();
      await comfy.close();
    }
  });

  it('erreur claire si ComfyUI est injoignable', async () => {
    const dir = await gameRepo('gen-down', 'http://127.0.0.1:9');
    const t = io();
    expect(await main(['gen-image', dir, '--asset', 'img_port_bg', '--no-server'], t)).toBe(1);
    expect(t.stderr.join()).toMatch(/injoignable/);
  });
});
