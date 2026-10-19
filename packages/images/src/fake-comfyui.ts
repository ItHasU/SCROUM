/** Faux serveur ComfyUI (HTTP + WebSocket en processus) pour les tests : aucun GPU, aucune dépendance. */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { crc32, deflateSync } from 'node:zlib';

export interface FakeComfyOptions {
  /** Noeuds connus ; un `class_type` absent → erreur « noeud inconnu ». Défaut : tous. */
  knownNodes?: string[];
  /** Modèles installés (UNETLoader/CLIPLoader/VAELoader) ; une autre valeur → `value_not_in_list`. Défaut : tous. */
  models?: { unet?: string[]; clip?: string[]; vae?: string[] };
  /** Pas d'échantillonnage simulés. */
  steps?: number;
  /** Durée simulée (ms) avant la fin. */
  delayMs?: number;
  /** Ne termine jamais (test du délai). */
  hang?: boolean;
  /** Refuse les connexions WebSocket (test du repli par polling). */
  noWebSocket?: boolean;
  /** Termine en erreur d'exécution. */
  failExecution?: string;
}

export interface FakeComfy {
  url: string;
  uploads: { name: string; bytes: number }[];
  prompts: { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>; client_id: string }[];
  wsClients: number;
  interrupts: number;
  options: FakeComfyOptions;
  close(): Promise<void>;
}

function png(r: number, g: number, b: number, size = 16): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function frame(text: string): Buffer {
  const payload = Buffer.from(text);
  const head = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  return Buffer.concat([head, payload]);
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

export async function startFakeComfy(options: FakeComfyOptions = {}): Promise<FakeComfy> {
  const sockets = new Map<string, Duplex>();
  const history = new Map<string, unknown>();
  const timers = new Set<NodeJS.Timeout>();
  let counter = 0;
  const state: FakeComfy = { url: '', uploads: [], prompts: [], wsClients: 0, interrupts: 0, options, close: async () => undefined };
  const send = (clientId: string, type: string, data: unknown): void => void sockets.get(clientId)?.write(frame(JSON.stringify({ type, data })));

  const json = (res: import('node:http').ServerResponse, status: number, v: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(v));
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (req.method === 'GET' && url.pathname === '/system_stats') return json(res, 200, { system: { comfyui_version: 'fake-1.0' } });
      if (req.method === 'POST' && url.pathname === '/upload/image') {
        const raw = await body(req);
        const name = /filename="([^"]+)"/.exec(raw.toString('latin1'))?.[1] ?? 'unknown.png';
        state.uploads.push({ name, bytes: raw.length });
        return json(res, 200, { name, subfolder: '', type: 'input' });
      }
      if (req.method === 'POST' && url.pathname === '/interrupt') {
        state.interrupts++;
        return json(res, 200, {});
      }
      if (req.method === 'POST' && url.pathname === '/prompt') {
        const p = JSON.parse((await body(req)).toString('utf8')) as (typeof state.prompts)[number];
        state.prompts.push(p);
        for (const [id, node] of Object.entries(p.prompt)) {
          if (options.knownNodes && !options.knownNodes.includes(node.class_type)) {
            return json(res, 400, { error: { type: 'invalid_prompt', message: `Cannot execute because node ${node.class_type} does not exist.`, details: `Node ID '#${id}'` }, node_errors: {} });
          }
          for (const [cls, field, key] of [['UNETLoader', 'unet_name', 'unet'], ['CLIPLoader', 'clip_name', 'clip'], ['VAELoader', 'vae_name', 'vae']] as const) {
            const list = options.models?.[key];
            if (node.class_type === cls && list && !list.includes(String(node.inputs[field]))) {
              return json(res, 400, {
                error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation' },
                node_errors: { [id]: { class_type: cls, errors: [{ type: 'value_not_in_list', message: 'Value not in list', extra_info: { input_name: field, received_value: node.inputs[field], input_config: [list] } }] } },
              });
            }
          }
        }
        const promptId = `p${++counter}`;
        const seed = Number(Object.values(p.prompt).find((n) => n.inputs.seed !== undefined)?.inputs.seed ?? 0);
        const steps = options.steps ?? 3;
        if (!options.hang) {
          const t = setTimeout(() => {
            for (let i = 1; i <= steps; i++) send(p.client_id, 'progress', { value: i, max: steps, prompt_id: promptId });
            if (options.failExecution) {
              history.set(promptId, { status: { status_str: 'error', completed: false, messages: [['execution_error', { exception_message: options.failExecution, node_type: 'KSampler' }]] }, outputs: {} });
            } else {
              history.set(promptId, {
                status: { status_str: 'success', completed: true, messages: [] },
                outputs: { '10': { images: [{ filename: `scroum_${promptId}_${seed}.png`, subfolder: 'scroum', type: 'output' }] } },
              });
            }
            send(p.client_id, 'executing', { node: null, prompt_id: promptId });
          }, options.delayMs ?? 20);
          timers.add(t);
        }
        return json(res, 200, { prompt_id: promptId, number: counter, node_errors: {} });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/history/')) {
        const id = decodeURIComponent(url.pathname.slice('/history/'.length));
        return json(res, 200, history.has(id) ? { [id]: history.get(id) } : {});
      }
      if (req.method === 'GET' && url.pathname === '/view') {
        const f = url.searchParams.get('filename') ?? '';
        const seed = Number(/_(\d+)\.png$/.exec(f)?.[1] ?? 0);
        res.writeHead(200, { 'content-type': 'image/png' });
        return void res.end(png((seed * 53) % 256, (seed * 97) % 256, (seed * 29) % 256));
      }
      json(res, 404, { error: 'not found' });
    })().catch((e: Error) => json(res, 500, { error: e.message }));
  });

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (options.noWebSocket || url.pathname !== '/ws') return void socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
    const key = String(req.headers['sec-websocket-key']);
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const id = url.searchParams.get('clientId') ?? '';
    sockets.set(id, socket);
    state.wsClients++;
    socket.on('data', () => undefined);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(id));
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = async () => {
    for (const t of timers) clearTimeout(t);
    for (const s of sockets.values()) s.destroy();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return state;
}
