import { request } from 'node:http';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveProject } from '@scroum/build';
import { readGameZip } from '@scroum/schema';
import { startEditorServer, type EditorServer } from './index';

/** Ignore un éventuel `dist/` local (build git-ignoré) lors de la copie de l'exemple. */
const noDist = (src: string): boolean => !/[\\/]dist$/.test(src);

const demo = fileURLToPath(new URL('../../../../examples/demo/', import.meta.url));
let tmp: string;
let repo: string;
let srv: EditorServer;
let fake: string;
const api = (p: string, init?: RequestInit) => fetch(srv.url + p, init);
const put = (p: string, content: string) =>
  api(`/api/files/${p}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) });
const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'scroum-srv-'));
  repo = join(tmp, 'demo');
  cpSync(demo, repo, { recursive: true, filter: noDist });
  writeFileSync(join(repo, 'content/assets/images/img_port_bg.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  fake = join(tmp, 'fake-claude.mjs');
  writeFileSync(
    fake,
    `#!/usr/bin/env node
import { writeFileSync, appendFileSync } from 'node:fs';

writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: 'system', subtype: 'init' }));
appendFileSync('content/bible/pitch.md', '\\nAjout par Claude\\n');
writeFileSync('content/bible/nouveau.md', '# nouveau\\n');
console.log(JSON.stringify({ type: 'result', result: 'fait' }));
`,
  );
  chmodSync(fake, 0o755);
  process.env.FAKE_ARGS_FILE = join(tmp, 'args.json');
  srv = await startEditorServer({ project: resolveProject(repo), port: 0, claudeCommand: fake, debounceMs: 30, playerDir: join(tmp, 'pas-de-player') });
});
afterAll(async () => {
  await srv.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('API fichiers', () => {
  it('écoute sur 127.0.0.1', () => expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/));

  it('liste, lit, écrit, supprime', async () => {
    const list = await (await api('/api/files')).json();
    expect(list.files.map((f: { path: string }) => f.path)).toContain('game.yaml');
    const one = await (await api('/api/files/bible/tone.md')).json();
    expect(one.content).toMatch(/\S/);
    expect((await put('bible/extra.md', '# Extra\n')).status).toBe(200);
    expect(readFileSync(join(repo, 'content/bible/extra.md'), 'utf8')).toBe('# Extra\n');
    expect((await api('/api/files/bible/extra.md', { method: 'DELETE' })).status).toBe(200);
    expect(existsSync(join(repo, 'content/bible/extra.md'))).toBe(false);
    expect((await api('/api/files/bible/extra.md')).status).toBe(404);
  });

  it('refuse (422) un fichier invalide sans l’écrire', async () => {
    const before = readFileSync(join(repo, 'content/scenes/port.yaml'), 'utf8');
    const r = await put('scenes/port.yaml', 'id: [casse');
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body.ok).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0].file).toBe('scenes/port.yaml');
    expect(readFileSync(join(repo, 'content/scenes/port.yaml'), 'utf8')).toBe(before);
    const r2 = await put('items.yaml', 'foo: { inconnu: 1 }');
    expect(r2.status).toBe(422);
  });

  it('bloque la traversée de chemins', async () => {
    expect((await api('/api/files/..%2F..%2Fscroum.project.yaml')).status).toBe(403);
    expect((await put('%2E%2E%2Fevil.md', 'x')).status).toBe(403);
    expect((await api('/api/files/%2Fetc%2Fpasswd')).status).toBe(404); // relatif à content/
    expect((await api('/api/files/a%00b')).status).toBe(400);
    expect(existsSync(join(repo, 'evil.md'))).toBe(false);
  });

  it('refuse une requête cross-origin', async () => {
    expect((await api('/api/files', { headers: { origin: 'http://evil.example' } })).status).toBe(403);
    const status = await new Promise<number>((resolve) => {
      const req = request({ host: '127.0.0.1', port: srv.port, path: '/api/files', headers: { host: 'evil.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.end();
    });
    expect(status).toBe(403);
  });
});

describe('compilation et rapports', () => {
  it('game.json, validate, images, gen-image', async () => {
    const game = await (await api('/api/game.json')).json();
    expect(game.meta.title).toBe('Le Phare de Kerbrume');
    const rep = await (await api('/api/validate')).json();
    expect(rep.ok).toBe(true);
    expect((await api('/api/images/img_port_bg')).headers.get('content-type')).toBe('image/png');
    expect((await api('/api/images/inconnue')).status).toBe(404);
    expect((await api('/api/images/..%2Fgame')).status).toBe(400);
    const gi = await api('/api/gen-image', { method: 'POST' });
    expect(gi.status).toBe(501);
    expect((await gi.json()).error).toMatch(/M5/);
  });

  it('build : produit un zip relisible', async () => {
    const r = await (await api('/api/build', { method: 'POST' })).json();
    expect(r.ok).toBe(true);
    const zip = readGameZip(new Uint8Array(readFileSync(r.zip)));
    expect(zip.images.has('img_port_bg')).toBe(true);
  });

  it('le front minimal et la page « player non disponible »', async () => {
    expect(await (await api('/')).text()).toMatch(/Éditeur SCROUM/);
    const p = await api('/play/?source=/api');
    expect(p.status).toBe(503);
    expect(await p.text()).toMatch(/Player non disponible/);
  });
});

describe('SSE', () => {
  it('pousse un changement après écriture disque', async () => {
    const res = await api('/events');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let acc = '';
    const readUntil = async (re: RegExp) => {
      const deadline = Date.now() + 5000;
      while (!re.test(acc) && Date.now() < deadline) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), 5000)),
        ]);
        if (done) break;
        acc += dec.decode(value);
      }
    };
    await readUntil(/hello/);
    writeFileSync(join(repo, 'content/bible/sse.md'), '# sse\n');
    await readUntil(/bible\/sse\.md/);
    await reader.cancel();
    rmSync(join(repo, 'content/bible/sse.md'));
    expect(acc).toMatch(/"type":"change","files":\["bible\/sse\.md"\]/);
  });
});

describe('Claude Code (faux binaire)', () => {
  async function ask(body: object) {
    const res = await api('/api/claude', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.status).toBe(200);
    const text = await res.text();
    return text
      .split('\n\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)));
  }

  it('relaie le flux, liste les fichiers modifiés, diff puis revert', async () => {
    const events = await ask({ prompt: 'améliore le pitch', selected: { kind: 'scene', id: 'port', file: 'scenes/port.yaml' } });
    expect(events.some((e) => e.type === 'claude' && e.event?.type === 'result')).toBe(true);
    const done = events.at(-1);
    expect(done.type).toBe('done');
    expect(done.code).toBe(0);
    expect(done.files).toEqual(['content/bible/nouveau.md', 'content/bible/pitch.md']);

    const args = JSON.parse(readFileSync(process.env.FAKE_ARGS_FILE!, 'utf8')) as string[];
    expect(args.slice(0, 2)).toEqual(['-p', 'améliore le pitch']);
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
    const sys = args[args.indexOf('--append-system-prompt') + 1]!;
    expect(sys).toMatch(/docs[\\/]FORMAT\.md/);
    expect(sys).toMatch(/scenes\/port\.yaml/);
    expect(sys).toContain(readFileSync(join(repo, 'content/bible/tone.md'), 'utf8').trim().split('\n')[0]!);

    const diff = await (await api('/api/diff?file=content/bible/pitch.md')).json();
    expect(diff.diff).toMatch(/\+Ajout par Claude/);
    const diffNew = await (await api('/api/diff?file=content/bible/nouveau.md')).json();
    expect(diffNew.diff).toMatch(/\+# nouveau/);
    expect((await api('/api/diff?file=..%2F..%2Fetc%2Fpasswd')).status).toBe(403);

    const rv = await api('/api/claude/revert', { method: 'POST', body: JSON.stringify({ files: done.files }) });
    expect(rv.status).toBe(200);
    expect(git('status', '--porcelain').trim()).toBe('');
    expect(existsSync(join(repo, 'content/bible/nouveau.md'))).toBe(false);
    expect(readFileSync(join(repo, 'content/bible/pitch.md'), 'utf8')).not.toMatch(/Ajout par Claude/);
  });

  it('refuse un prompt vide et un revert hors dépôt', async () => {
    expect((await api('/api/claude', { method: 'POST', body: '{}' })).status).toBe(400);
    const r = await api('/api/claude/revert', { method: 'POST', body: JSON.stringify({ files: ['../x'] }) });
    expect(r.status).toBe(403);
  });

  it('signale une commande introuvable', async () => {
    const other = await startEditorServer({ project: resolveProject(repo), port: 0, claudeCommand: '/nonexistent/claude' });
    try {
      const res = await fetch(other.url + '/api/claude', { method: 'POST', body: JSON.stringify({ prompt: 'x' }) });
      const last = (await res.text()).trim().split('\n\n').at(-1)!;
      const done = JSON.parse(last.slice(6));
      expect(done.type).toBe('done');
      expect(done.error).toMatch(/impossible de lancer/);
    } finally {
      await other.close();
    }
  });
});

describe('player via Vite (middlewareMode)', () => {
  it('sert apps/player sous /play/ quand index.html existe', async () => {
    const playerDir = join(tmp, 'player');
    mkdirSync(playerDir);
    writeFileSync(join(playerDir, 'index.html'), '<!doctype html><title>P</title><script type="module" src="/main.js"></script>');
    writeFileSync(join(playerDir, 'main.js'), 'console.log("player")');
    const s = await startEditorServer({ project: resolveProject(repo), port: 0, playerDir });
    try {
      const html = await (await fetch(s.url + '/play/?source=/api')).text();
      expect(html).toMatch(/@vite\/client/);
      const js = await fetch(s.url + '/play/main.js');
      expect(js.status).toBe(200);
      expect((await fetch(s.url + '/api/game.json')).status).toBe(200);
    } finally {
      await s.close();
    }
  });
});

describe('mode production (staticDirs)', () => {
  it('sert les fronts pré-construits sans Vite', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'scroum-static-'));
    mkdirSync(join(dist, 'web'));
    mkdirSync(join(dist, 'player/assets'), { recursive: true });
    writeFileSync(join(dist, 'web/index.html'), '<title>web-prod</title>');
    writeFileSync(join(dist, 'player/index.html'), '<title>player-prod</title>');
    writeFileSync(join(dist, 'player/assets/a.js'), 'export {}');
    const prod = await startEditorServer({
      project: resolveProject(repo),
      port: 0,
      debounceMs: 30,
      staticDirs: { web: join(dist, 'web'), player: join(dist, 'player') },
    });
    try {
      expect(await (await fetch(prod.url + '/')).text()).toContain('web-prod');
      expect(await (await fetch(prod.url + '/play/')).text()).toContain('player-prod');
      const js = await fetch(prod.url + '/play/assets/a.js');
      expect(js.headers.get('content-type')).toMatch(/javascript/);
      expect((await fetch(prod.url + '/play/nope.js')).status).toBe(404);
      expect((await fetch(prod.url + '/api/project')).status).toBe(200);
      expect((await (await fetch(prod.url + '/api/project')).json()).playerAvailable).toBe(true);
    } finally {
      await prod.close();
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
