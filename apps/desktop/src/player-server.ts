/** Mini-serveur local (127.0.0.1) : player statique + un `.scroum.zip` exposé sous /game.zip. */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
};

export interface PlayerServer {
  url: string;
  close(): Promise<void>;
}

export async function startPlayerServer(playerDir: string, zipPath: string): Promise<PlayerServer> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
        const file = path === '/game.zip' ? zipPath : join(playerDir, normalize(path === '/' ? '/index.html' : path));
        if (file !== zipPath && !file.startsWith(playerDir + sep)) throw new Error('hors racine');
        if (!(await stat(file)).isFile()) throw new Error('absent');
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(await readFile(file));
      } catch {
        res.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((ok, ko) => {
    server.once('error', ko);
    server.listen(0, '127.0.0.1', () => ok());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/?game=/game.zip`,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}
