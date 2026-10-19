/** Utilitaires de test : chargement des jeux d'exemple et de mini-jeux en mémoire. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent, type GameData } from '@scroum/schema';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function readDir(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(dir, full).split(sep).join('/'), /\.(ya?ml|md|css)$/i.test(name) ? readFileSync(full, 'utf8') : '');
    }
  };
  walk(dir);
  return out;
}

function load(files: Map<string, string>): GameData {
  const { game, errors } = loadContent(files);
  const errs = errors.filter((e) => e.severity === 'error');
  if (!game || errs.length) throw new Error('contenu invalide :\n' + errs.map((e) => `${e.file} ${e.path} ${e.message}`).join('\n'));
  return game;
}

/** Charge `examples/<name>/content` depuis le disque. */
export function loadExample(name: string): GameData {
  return load(readDir(join(ROOT, 'examples', name, 'content')));
}

const BASE_GAME = `title: T
version: 0.1.0
formatVersion: 1
start_scene: a
`;

/**
 * Mini-jeu en mémoire. `game` est ajouté après l'en-tête minimal de game.yaml ;
 * monde `w` déclaré par défaut.
 */
export function makeGame(files: Record<string, string>, game = ''): GameData {
  const m = new Map<string, string>();
  m.set('game.yaml', BASE_GAME + game);
  if (!files['bible/worlds.yaml']) m.set('bible/worlds.yaml', 'w: { name: W, refuse_line: "Non." }\nv: { name: V, refuse_line: "Niet." }\n');
  for (const [k, v] of Object.entries(files)) m.set(k, v);
  return load(m);
}
