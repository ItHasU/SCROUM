/** Serveur HTTP local de l'éditeur SCROUM (http natif, 127.0.0.1 par défaut). */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import { buildProject, type ResolvedProject } from '@scroum/build';
import { IMAGE_EXTENSIONS, classifyPath, imageMime, loadContent, normalizePath } from '@scroum/schema';
import { validateContent } from '@scroum/validate';
import { readContentDir } from '@scroum/validate/node';
import { buildSystemPrompt, resolveClaudeConfig, spawnClaude, validatedElements, type Selection } from './claude';
import { changedFiles, diffFile, isGitRepo, revertFiles, snapshot } from './git';
import { HttpError, relPosix, safeJoin } from './paths';

export interface EditorServerOptions {
  project: ResolvedProject;
  /** Défaut : `editor.port` de scroum.project.yaml, sinon 5317. 0 = port libre. */
  port?: number;
  /** Défaut : 127.0.0.1. */
  host?: string;
  /** Commande `claude` (sinon $SCROUM_CLAUDE_BIN, scroum.local.yaml, `claude`). */
  claudeCommand?: string;
  /** Dossier du front de l'éditeur. */
  webDir?: string;
  /** Dossier de l'app player (Vite en middlewareMode si index.html existe). */
  playerDir?: string;
  /** Délai de regroupement des événements SSE (ms). */
  debounceMs?: number;
}

export interface EditorServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

const MAX_BODY = 20 * 1024 * 1024;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

const here = dirname(fileURLToPath(import.meta.url));

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'corps de requête trop volumineux');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const buf = await readBody(req);
  if (buf.length === 0) return {};
  try {
    const v = JSON.parse(buf.toString('utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'corps JSON invalide');
  }
}

const IMAGE_RE = new RegExp(`\\.(${IMAGE_EXTENSIONS.join('|')})$`, 'i');

async function listFiles(dir: string): Promise<{ path: string; size: number; kind: string }[]> {
  const out: { path: string; size: number; kind: string }[] = [];
  async function walk(d: string): Promise<void> {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== '.git') await walk(full);
      } else if (e.isFile()) {
        const rel = relPosix(dir, full);
        out.push({ path: rel, size: (await stat(full)).size, kind: classifyPath(rel) });
      }
    }
  }
  await walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function startEditorServer(options: EditorServerOptions): Promise<EditorServer> {
  const { project } = options;
  const contentDir = project.contentDir;
  const root = project.root;
  const host = options.host ?? '127.0.0.1';
  const webDir = options.webDir ?? join(here, '../../web/public');
  const playerDir = options.playerDir ?? join(here, '../../../player');
  const claudeCfg = await resolveClaudeConfig(root, options.claudeCommand);
  await mkdir(contentDir, { recursive: true });

  // ---- SSE ---------------------------------------------------------------
  const clients = new Set<ServerResponse>();
  const broadcast = (payload: unknown): void => {
    const msg = `data: ${JSON.stringify(payload)}\n\n`;
    for (const c of clients) c.write(msg);
  };
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  const watcher = chokidar.watch(contentDir, { ignoreInitial: true, ignored: (p) => /(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(p) });
  const onFile = (p: string): void => {
    pending.add(relPosix(contentDir, p));
    clearTimeout(timer);
    timer = setTimeout(() => {
      const files = [...pending].sort();
      pending = new Set();
      broadcast({ type: 'change', files });
    }, options.debounceMs ?? 120);
  };
  watcher.on('add', onFile).on('change', onFile).on('unlink', onFile);
  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n');
  }, 25_000);
  heartbeat.unref();

  // ---- Vite (player) -----------------------------------------------------
  let vite: import('vite').ViteDevServer | null = null;
  const playerAvailable = existsSync(join(playerDir, 'index.html'));

  // ---- Claude : une exécution à la fois ----------------------------------
  let claudeBusy = false;

  const compile = async () => {
    const files = await readContentDir(contentDir);
    return { files, ...loadContent(files) };
  };

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? 'GET';
    const path = url.pathname;

    if (path === '/api/project' && method === 'GET') {
      return sendJson(res, 200, {
        name: project.config?.name ?? null,
        root,
        contentDir,
        config: project.config,
        notes: project.notes,
        git: await isGitRepo(root),
        playerAvailable,
      });
    }

    if (path === '/api/files' && method === 'GET') {
      return sendJson(res, 200, { files: await listFiles(contentDir) });
    }

    if (path.startsWith('/api/files/')) {
      const rel = normalizePath(decodeURIComponent(path.slice('/api/files/'.length)));
      if (!rel) throw new HttpError(400, 'chemin manquant');
      const full = safeJoin(contentDir, rel);
      if (method === 'GET') {
        const st = await stat(full).catch(() => null);
        if (!st?.isFile()) throw new HttpError(404, `fichier introuvable : ${rel}`);
        if (IMAGE_RE.test(rel)) {
          res.writeHead(200, { 'content-type': imageMime(rel), 'cache-control': 'no-cache' });
          return void res.end(await readFile(full));
        }
        return sendJson(res, 200, { path: rel, content: await readFile(full, 'utf8') });
      }
      if (method === 'PUT') {
        if ((req.headers['content-type'] ?? '').startsWith('application/json')) {
          const body = await readJson(req);
          if (typeof body.content !== 'string') throw new HttpError(400, 'champ « content » (chaîne) requis');
          const content = body.content;
          const files = await readContentDir(contentDir);
          files.set(rel, content);
          const { errors } = loadContent(files);
          const own = errors.filter((e) => e.file === rel);
          const blocking = own.filter((e) => e.severity === 'error');
          if (blocking.length > 0) return sendJson(res, 422, { ok: false, path: rel, errors: blocking, warnings: own.filter((e) => e.severity === 'warning') });
          await mkdir(dirname(full), { recursive: true });
          await writeFile(full, content, 'utf8');
          return sendJson(res, 200, { ok: true, path: rel, errors: [], warnings: own });
        }
        if (!IMAGE_RE.test(rel)) throw new HttpError(415, 'écriture binaire réservée aux images (assets/images/…)');
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, await readBody(req));
        return sendJson(res, 200, { ok: true, path: rel, errors: [], warnings: [] });
      }
      if (method === 'DELETE') {
        const st = await stat(full).catch(() => null);
        if (!st?.isFile()) throw new HttpError(404, `fichier introuvable : ${rel}`);
        await rm(full);
        return sendJson(res, 200, { ok: true, path: rel });
      }
      throw new HttpError(405, 'méthode non permise');
    }

    if (path === '/api/game.json' && method === 'GET') {
      const { game, errors } = await compile();
      const blocking = errors.filter((e) => e.severity === 'error');
      if (!game || blocking.length > 0) return sendJson(res, 422, { ok: false, errors: blocking });
      return sendJson(res, 200, game);
    }

    if (path === '/api/validate' && method === 'GET') {
      const report = validateContent(await readContentDir(contentDir));
      const { game, ...rest } = report;
      return sendJson(res, 200, { ...rest, title: game?.meta.title ?? null });
    }

    if (path.startsWith('/api/images/') && method === 'GET') {
      const id = decodeURIComponent(path.slice('/api/images/'.length));
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new HttpError(400, 'identifiant invalide');
      for (const ext of IMAGE_EXTENSIONS) {
        const f = join(contentDir, 'assets', 'images', `${id}.${ext}`);
        if (existsSync(f)) {
          res.writeHead(200, { 'content-type': imageMime(ext), 'cache-control': 'no-cache' });
          return void res.end(await readFile(f));
        }
      }
      throw new HttpError(404, `image introuvable : ${id}`);
    }

    if (path === '/api/build' && method === 'POST') {
      const r = await buildProject(project);
      if (!r.ok) return sendJson(res, 422, { ok: false, errors: r.report.errors, warnings: r.report.warnings });
      return sendJson(res, 200, { ok: true, zip: r.zipPath, manifest: r.manifest, warnings: r.warnings });
    }

    if (path === '/api/gen-image' && method === 'POST') {
      return sendJson(res, 501, { ok: false, error: "génération d'images non implémentée (M5)" });
    }

    if (path === '/api/claude' && method === 'POST') return handleClaude(req, res);

    if (path === '/api/claude/revert' && method === 'POST') {
      const body = await readJson(req);
      const files = body.files;
      if (!Array.isArray(files) || files.some((f) => typeof f !== 'string')) throw new HttpError(400, 'champ « files » (liste de chemins) requis');
      if (!(await isGitRepo(root))) throw new HttpError(409, "le dépôt de jeu n'est pas un dépôt git");
      return sendJson(res, 200, { ok: true, ...(await revertFiles(root, files as string[])) });
    }

    if (path === '/api/diff' && method === 'GET') {
      const file = url.searchParams.get('file');
      if (!file) throw new HttpError(400, 'paramètre « file » requis');
      if (!(await isGitRepo(root))) throw new HttpError(409, "le dépôt de jeu n'est pas un dépôt git");
      return sendJson(res, 200, { file, diff: await diffFile(root, normalizePath(file)) });
    }

    throw new HttpError(404, 'route inconnue');
  }

  async function handleClaude(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req);
    const prompt = body.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) throw new HttpError(400, 'champ « prompt » requis');
    if (claudeBusy) throw new HttpError(409, 'une demande à Claude est déjà en cours');
    const repo = await isGitRepo(root);
    const { game, files } = await compile();
    const tone = files.get('bible/tone.md') ?? null;
    const system = buildSystemPrompt({
      tone,
      validated: validatedElements(game),
      selected: (body.selected ?? undefined) as Selection | undefined,
      contentDir,
    });
    claudeBusy = true;
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    const send = (payload: unknown): void => void res.write(`data: ${JSON.stringify(payload)}\n\n`);
    try {
      const before = repo ? await snapshot(root) : null;
      const child = spawnClaude(claudeCfg, root, prompt, system);
      let buf = '';
      let stderr = '';
      child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          try {
            send({ type: 'claude', event: JSON.parse(line) });
          } catch {
            send({ type: 'claude', text: line });
          }
        }
      });
      child.stderr!.setEncoding('utf8').on('data', (c: string) => (stderr += c));
      res.on('close', () => {
        if (child.exitCode === null) child.kill('SIGTERM');
      });
      const code: number | string = await new Promise((resolve) => {
        child.once('error', (e) => resolve(`impossible de lancer « ${claudeCfg.command} » : ${e.message}`));
        child.once('close', (c) => resolve(c ?? -1));
      });
      if (buf.trim()) send({ type: 'claude', text: buf.trim() });
      const modified = before ? changedFiles(before, await snapshot(root)) : null;
      send({
        type: 'done',
        code: typeof code === 'number' ? code : -1,
        ...(typeof code === 'string' ? { error: code } : {}),
        ...(stderr.trim() ? { stderr: stderr.trim().slice(-4000) } : {}),
        files: modified,
        git: repo,
      });
    } catch (e) {
      send({ type: 'done', code: -1, error: (e as Error).message, files: null, git: repo });
    } finally {
      claudeBusy = false;
      res.end();
    }
  }

  async function serveStatic(res: ServerResponse, dir: string, rel: string): Promise<boolean> {
    let target: string;
    try {
      target = safeJoin(dir, rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel);
    } catch {
      return false;
    }
    const st = await stat(target).catch(() => null);
    if (!st?.isFile()) return false;
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(target));
    return true;
  }

  const allowedHosts = new Set<string>();
  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        // Protection contre le DNS rebinding et les requêtes cross-origin sur l'API locale.
        const hostHeader = (req.headers.host ?? '').toLowerCase();
        if (allowedHosts.size > 0 && !allowedHosts.has(hostHeader)) throw new HttpError(403, 'hôte non autorisé');
        const origin = req.headers.origin;
        if (origin && new URL(origin).host.toLowerCase() !== hostHeader) throw new HttpError(403, 'origine non autorisée');

        if (url.pathname === '/events' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
          res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
          clients.add(res);
          res.on('close', () => clients.delete(res));
          return;
        }
        if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

        if (url.pathname === '/play') {
          res.writeHead(302, { location: `/play/${url.search}` });
          return void res.end();
        }
        if (url.pathname.startsWith('/play/')) {
          if (!playerAvailable) {
            res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
            return void res.end('<!doctype html><meta charset="utf-8"><title>Player</title><body style="font:16px sans-serif;padding:2rem"><h1>Player non disponible</h1><p>apps/player/index.html n’existe pas encore.</p>');
          }
          if (!vite) {
            const { createServer: createVite } = await import('vite');
            vite = await createVite({
              root: playerDir,
              base: '/play/',
              appType: 'spa',
              server: { middlewareMode: true, hmr: { server } },
            });
          }
          return void vite.middlewares(req, res, () => {
            res.writeHead(404).end();
          });
        }
        const rel = decodeURIComponent(url.pathname.slice(1));
        if (await serveStatic(res, webDir, rel)) return;
        if (url.pathname === '/') return sendJson(res, 200, { name: 'SCROUM editor', web: 'front non disponible', api: '/api/project' });
        throw new HttpError(404, 'introuvable');
      } catch (e) {
        if (res.headersSent) return void res.end();
        if (e instanceof HttpError) return sendJson(res, e.status, { ok: false, error: e.message, ...e.extra });
        console.error(e);
        sendJson(res, 500, { ok: false, error: (e as Error).message });
      }
    })();
  });

  const port = options.port ?? project.config?.editor.port ?? 5317;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const actual = (server.address() as AddressInfo).port;
  const shownHost = host.includes(':') ? `[${host}]` : host;
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    for (const h of ['127.0.0.1', 'localhost', '[::1]']) allowedHosts.add(`${h}:${actual}`);
  }

  return {
    url: `http://${shownHost}:${actual}`,
    port: actual,
    async close() {
      clearInterval(heartbeat);
      clearTimeout(timer);
      for (const c of clients) c.end();
      await watcher.close();
      await vite?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
