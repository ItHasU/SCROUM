/**
 * Chargement d'un jeu : zip distant (`?game=<url>`), fichier local, ou source
 * directe de l'éditeur (`?source=/api` : `/api/game.json`, `/api/images/<id>`, SSE `/events`).
 */
import { FormatVersionError, GameZipError, imageMime, readGameZip, readFormatVersion, FORMAT_VERSION, migrate, type GameData } from '@scroum/schema';
import type { AssetResolver } from '@scroum/ui';
import { strFromU8, unzipSync } from 'fflate';

export interface LoadedGame {
  game: GameData;
  assets: AssetResolver;
  kind: 'zip' | 'source';
  /** Libère les URL blob (zip). */
  dispose(): void;
}

/** Erreur de chargement avec un message destiné au joueur. */
export class LoadError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'LoadError';
  }
}

/** Traduit une erreur quelconque en message lisible. */
export function describeLoadError(e: unknown, url?: string): LoadError {
  if (e instanceof LoadError) return e;
  if (e instanceof FormatVersionError) return new LoadError('Version de jeu incompatible', e.message);
  if (e instanceof GameZipError) return new LoadError('Fichier de jeu illisible', e.message);
  if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) {
    return new LoadError(
      'Téléchargement impossible',
      `Le jeu${url ? ` (${url})` : ''} n'a pas pu être téléchargé : réseau indisponible, adresse erronée, ou serveur qui n'autorise pas le partage entre origines (CORS). ` +
        "Le serveur du jeu doit répondre avec l'en-tête Access-Control-Allow-Origin (GitHub Pages le fait).",
    );
  }
  return new LoadError('Chargement impossible', e instanceof Error ? e.message : String(e));
}

/** Lit un `.scroum.zip` en mémoire : images en URL blob, skins `skins/<nom>.css` si présents. */
export function loadZipBytes(bytes: Uint8Array): LoadedGame {
  const zip = readGameZip(bytes);
  const urls = new Map<string, string>();
  for (const [id, data] of zip.images) {
    const file = zip.manifest.images.find((i) => i.id === id)?.file ?? `${id}.webp`;
    urls.set(id, URL.createObjectURL(new Blob([data as BlobPart], { type: imageMime(file) })));
  }
  // Le format v1 ne transporte pas encore les skins : on lit `skins/*.css` s'ils existent (voir docs/ARCHITECTURE.md).
  let skins: Record<string, Uint8Array> = {};
  try {
    skins = unzipSync(bytes, { filter: (f) => /^(content\/)?skins\/[^/]+\.css$/.test(f.name) });
  } catch {
    skins = {};
  }
  return {
    game: zip.game,
    kind: 'zip',
    assets: {
      url: (id) => (id ? (urls.get(id) ?? null) : null),
      skinCss: async (name) => {
        const entry = Object.entries(skins).find(([k]) => k.endsWith(`skins/${name}.css`));
        return entry ? strFromU8(entry[1]) : null;
      },
    },
    dispose: () => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
    },
  };
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new LoadError('Téléchargement impossible', `${url} : HTTP ${res.status} ${res.statusText}`);
  return res;
}

/** `?game=<url>` : télécharge et ouvre un zip. */
export async function loadZipUrl(url: string): Promise<LoadedGame> {
  try {
    const res = await fetchOk(url);
    return loadZipBytes(new Uint8Array(await res.arrayBuffer()));
  } catch (e) {
    throw describeLoadError(e, url);
  }
}

/** Fichier local `.scroum.zip`. */
export async function loadZipFile(file: Blob): Promise<LoadedGame> {
  try {
    return loadZipBytes(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    throw describeLoadError(e);
  }
}

/** Résout la base de la source directe (`/api`) en URL absolue sans `/` final. */
export function sourceBase(source: string, href = location.href): string {
  return new URL(source, href).href.replace(/\/+$/, '');
}

/** Lit `game.json` de la source directe (422 = contenu invalide côté éditeur). */
export async function fetchSourceGame(base: string): Promise<GameData> {
  const res = await fetch(`${base}/game.json`, { cache: 'no-store' });
  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as { errors?: { file?: string; message?: string }[] };
    const first = body.errors?.slice(0, 3).map((e) => `${e.file ?? ''} : ${e.message ?? ''}`).join('\n');
    throw new LoadError('Le contenu du jeu contient des erreurs', first || 'voir le rapport de validation de l’éditeur');
  }
  if (!res.ok) throw new LoadError('Source indisponible', `${base}/game.json : HTTP ${res.status}`);
  const data: unknown = await res.json();
  const v = readFormatVersion(data);
  if (v !== undefined && v > FORMAT_VERSION) throw new FormatVersionError(`ce jeu est au format ${v}, ce player ne connaît que le format ${FORMAT_VERSION}`, v);
  return migrate<GameData>(data);
}

/** Source directe de l'éditeur. */
export async function loadSource(source: string): Promise<LoadedGame & { base: string }> {
  const base = sourceBase(source);
  let game: GameData;
  try {
    game = await fetchSourceGame(base);
  } catch (e) {
    throw describeLoadError(e, `${base}/game.json`);
  }
  const holder = { game };
  const loaded = {
    base,
    kind: 'source' as const,
    get game() {
      return holder.game;
    },
    set game(g: GameData) {
      holder.game = g;
    },
    assets: {
      url: (id: string | null | undefined) => (id && holder.game.assets[id]?.file ? `${base}/images/${encodeURIComponent(id)}` : null),
      skinCss: async (name: string) => {
        const res = await fetch(`${base}/files/skins/${encodeURIComponent(name)}.css`, { cache: 'no-store' });
        if (!res.ok) return null;
        const body = (await res.json()) as { content?: string };
        return typeof body.content === 'string' ? body.content : null;
      },
    } satisfies AssetResolver,
    dispose: () => undefined,
  };
  return loaded;
}

/** Abonnement SSE aux changements de contenu (`/events` à la racine du serveur de la source). */
export function watchSource(base: string, onChange: (files: string[]) => void): () => void {
  if (typeof EventSource === 'undefined') return () => undefined;
  const es = new EventSource(new URL('/events', base).href);
  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as { type?: string; files?: string[] };
      if (msg.type === 'change') onChange(msg.files ?? []);
    } catch {
      /* message ignoré */
    }
  };
  return () => es.close();
}
