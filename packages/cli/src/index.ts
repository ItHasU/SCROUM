/**
 * @scroum/cli — binaire `scroum`.
 *
 *   scroum validate [chemin] [--json] [--quiet] [--no-playability] [--global] [--path-out f.json] [--max-states N] [--max-depth N] [--time-limit S]
 *   scroum build [chemin]
 *   scroum edit [chemin] [--port N] [--host H] [--no-open]
 *   scroum gen-image --asset <id> [--n 4] [--prompt "…"]
 *
 * `main` est testable : entrées/sorties injectées, renvoie le code de retour.
 */
import { writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { FORMAT_VERSION } from '@scroum/schema';
import { buildProject } from '@scroum/build';
import { exportPaths, type PlayabilityOptions } from '@scroum/validate';
import { validateDir } from '@scroum/validate/node';
import { genImageCommand } from './gen-image';
import { workflowExportCommand } from './workflow-export';
import { ProjectError, resolveProject, type ResolvedProject } from './project';
import { formatReport, makeStyle } from './report';

export { resolveProject, ProjectError, type ResolvedProject } from './project';
export { formatReport } from './report';


export interface Io {
  out(s: string): void;
  err(s: string): void;
  /** Dossier de base des chemins relatifs. */
  cwd: string;
  color: boolean;
}

const defaultIo = (): Io => ({
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
  // Avec `pnpm scroum`, pnpm change de dossier : INIT_CWD garde celui de l'appelant.
  cwd: process.env.INIT_CWD ?? process.cwd(),
  color: !!process.stdout.isTTY && !process.env.NO_COLOR,
});

const HELP = `scroum — outils du moteur d'aventure SCROUM (format ${FORMAT_VERSION})

Usage :
  scroum validate [chemin] [--json] [--quiet] [--no-playability] [--global] [--path-out <f.json>]
      Valide le contenu d'un jeu. [chemin] : racine d'un dépôt de jeu
      (avec scroum.project.yaml) ou dossier content/ ; défaut : dossier courant.
      --json   rapport structuré { ok, errors, warnings, skipped, playability } sur stdout
      --quiet  n'affiche que les erreurs
      Analyse de jouabilité (exploration des états du moteur), sauf --no-playability :
      --path-out <f.json>  écrit les chemins rejouables (fin win, fins, soft-locks) :
                           actions du moteur, formes courtes et scénarios runScenario
      --max-states N       bornes de l'exploration (défauts : 100000 états,
      --max-depth N        profondeur 1000, 30 s) ; au-delà, le rapport dit
      --time-limit S       « exploration incomplète » au lieu de conclure
      Quêtes avec « checkpoint » (bible/quests.yaml) : validation par quête (bornes
      ci-dessus par segment) ; le BFS global est omis sauf --global (information seule).
  scroum build [chemin]
      Valide (échec = pas de zip), convertit les images (sharp, webp) et produit
      <output>/<nom>-<version>.scroum.zip (défaut : dist/).
  scroum edit [chemin] [--port N] [--host H]
      Lance l'éditeur local (http://127.0.0.1:5317 par défaut ; port : --port,
      puis editor.port de scroum.project.yaml). Le player est servi sous /play/.
  scroum gen-image --asset <id> [--n 4] [--prompt "…"] [--workflow w] [--seed N] [--variant-of N] [--no-server] [chemin]
      Dépose N candidats dans content/assets/_candidates/<id>/ (jamais validés : le statut
      reste à l'humain). Passe par l'éditeur s'il tourne (--url, sinon editor.port), sinon
      génère directement via ComfyUI (comfyui.url de scroum.local.yaml).
  scroum workflow-export <nom> [--out fichier.json] [chemin]
      Exporte un workflow (bg, char_sheet, char_edit, transform, remove_bg, item_icon…) en JSON
      ouvrable directement dans ComfyUI (glisser-déposer), placeholders remplacés par les modèles
      du projet (scroum.local.yaml) ou des valeurs d'exemple.
  scroum --help | --version

Code de retour : 0 si tout va bien, 1 si erreurs de contenu, 2 si usage incorrect.`;


/** Options à valeur (`--port 5000` ou `--port=5000`) ; les autres `--x` sont des drapeaux. */
const VALUE_OPTS = new Set(['port', 'host', 'asset', 'n', 'prompt', 'workflow', 'seed', 'variant-of', 'url', 'path-out', 'max-states', 'max-depth', 'time-limit', 'out']);

function parseArgs(argv: string[]): { positional: string[]; flags: Set<string>; values: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [name, inline] = a.slice(2).split(/=(.*)/s);
      if (VALUE_OPTS.has(name!)) {
        const v = inline ?? argv[++i];
        if (v !== undefined) values.set(name!, v);
        flags.add(name!);
      } else flags.add(name!);
    } else if (a === '-h') flags.add('help');
    else positional.push(a);
  }
  return { positional, flags, values };
}

function projectOrReport(target: string | undefined, io: Io, cmd: string): ResolvedProject | null {
  const path = isAbsolute(target ?? '.') ? target! : resolve(io.cwd, target ?? '.');
  try {
    return resolveProject(path);
  } catch (e) {
    if (e instanceof ProjectError) {
      io.err(`scroum ${cmd} : ${e.message}`);
      return null;
    }
    throw e;
  }
}

async function buildCommand(args: string[], flags: Set<string>, io: Io): Promise<number> {
  const unknown = [...flags].filter((f) => f !== 'quiet');
  if (unknown.length > 0 || args.length > 1) {
    io.err(`option ou argument inattendu : ${[...unknown.map((f) => `--${f}`), ...args.slice(1)].join(' ')}`);
    return 2;
  }
  const project = projectOrReport(args[0], io, 'build');
  if (!project) return 1;
  const st = makeStyle(io.color);
  const r = await buildProject(project);
  if (!r.ok) {
    io.err(st.bold('scroum build : validation en échec, aucun zip produit.'));
    io.out(formatReport(r.report, { style: st, quiet: true }));
    return 1;
  }
  for (const w of r.warnings) io.err(`avertissement : ${w}`);
  io.out(`${st.bold('✔ Build')} ${r.manifest!.title} ${r.manifest!.version} (${r.manifest!.images.length} image(s))`);
  io.out(r.zipPath!);
  return 0;
}

async function editCommand(args: string[], flags: Set<string>, values: Map<string, string>, io: Io): Promise<number> {
  const unknown = [...flags].filter((f) => !['port', 'host', 'no-open'].includes(f));
  if (unknown.length > 0 || args.length > 1) {
    io.err(`option ou argument inattendu : ${[...unknown.map((f) => `--${f}`), ...args.slice(1)].join(' ')}`);
    return 2;
  }
  const project = projectOrReport(args[0], io, 'edit');
  if (!project) return 1;
  const portArg = values.get('port');
  const port = portArg === undefined ? undefined : Number(portArg);
  if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port <= 65535)) {
    io.err(`port invalide : ${portArg}`);
    return 2;
  }
  const { startEditorServer } = await import('@scroum/editor-server');
  const server = await startEditorServer({ project, port, host: values.get('host') });
  io.out(`Éditeur SCROUM : ${server.url}`);
  io.out(`Player (playtest) : ${server.url}/play/?source=/api`);
  io.out('Ctrl+C pour arrêter.');
  await new Promise<void>((done) => {
    const stop = () => void server.close().then(done);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

const VALIDATE_FLAGS = ['json', 'quiet', 'no-playability', 'workflow', 'seed', 'variant-of', 'url', 'path-out', 'max-states', 'max-depth', 'time-limit', 'global'];

/** Options de jouabilité de la ligne de commande ; null si une valeur est invalide (message déjà affiché). */
function playabilityOptions(flags: Set<string>, values: Map<string, string>, io: Io): PlayabilityOptions | false | null {
  if (flags.has('no-playability')) {
    if (flags.has('path-out')) {
      io.err('--path-out est incompatible avec --no-playability');
      return null;
    }
    return false;
  }
  const opts: PlayabilityOptions = {};
  if (flags.has('global')) opts.global = 'on';
  for (const [flag, key, scale] of [
    ['max-states', 'maxStates', 1],
    ['max-depth', 'maxDepth', 1],
    ['time-limit', 'timeLimitMs', 1000],
  ] as const) {
    if (!flags.has(flag)) continue;
    const raw = values.get(flag);
    const v = Number(raw);
    if (raw === undefined || !Number.isFinite(v) || v <= 0) {
      io.err(`valeur invalide pour --${flag} : ${raw ?? '(absente)'}`);
      return null;
    }
    opts[key] = Math.round(v * scale);
  }
  if (flags.has('path-out') && !values.get('path-out')) {
    io.err('--path-out attend un nom de fichier');
    return null;
  }
  return opts;
}

async function validateCommand(args: string[], flags: Set<string>, values: Map<string, string>, io: Io): Promise<number> {
  const unknown = [...flags].filter((f) => !VALIDATE_FLAGS.includes(f));
  if (unknown.length > 0 || args.length > 1) {
    io.err(`option ou argument inattendu : ${[...unknown.map((f) => `--${f}`), ...args.slice(1)].join(' ')}`);
    return 2;
  }
  const playability = playabilityOptions(flags, values, io);
  if (playability === null) return 2;
  const target = args[0] ?? '.';
  const path = isAbsolute(target) ? target : resolve(io.cwd, target);
  let project;
  try {
    project = resolveProject(path);
  } catch (e) {
    if (e instanceof ProjectError) {
      io.err(`scroum validate : ${e.message}`);
      if (flags.has('json')) {
        const error = { severity: 'error', code: 'project', file: '', path: '', message: e.message };
        io.out(JSON.stringify({ ok: false, errors: [error], warnings: [], skipped: [], playability: null }, null, 2));
      }
      return 1;
    }
    throw e;
  }
  const report = await validateDir(project.contentDir, { playability });
  const pathOut = values.get('path-out');
  if (pathOut && report.game) {
    const file = isAbsolute(pathOut) ? pathOut : resolve(io.cwd, pathOut);
    if (report.playability || report.segments) {
      writeFileSync(file, `${JSON.stringify(exportPaths(report.game, report.playability, playability ? playability.engine : undefined, report.segments), null, 2)}\n`);
      io.err(`chemins de jouabilité écrits dans ${file}`);
    } else io.err(`--path-out : analyse de jouabilité non exécutée (erreurs à corriger d'abord), ${file} non écrit`);
  }
  if (flags.has('json')) {
    const { game: _game, ...rest } = report;
    io.out(JSON.stringify(rest, null, 2));
    return report.ok ? 0 : 1;
  }
  const st = makeStyle(io.color);
  const title = report.game ? `« ${report.game.meta.title} » ${report.game.meta.version}` : '';
  io.out(st.bold(`scroum validate ${title}`.trim()) + st.dim(` — ${project.contentDir}`));
  for (const n of project.notes) io.out(st.dim(`note : ${n}`));
  io.out(formatReport(report, { style: st, quiet: flags.has('quiet') }));
  return report.ok ? 0 : 1;
}

export async function main(argv: string[], io: Io = defaultIo()): Promise<number> {
  const { positional, flags, values } = parseArgs(argv);
  const [command, ...args] = positional;
  if (flags.has('version')) {
    io.out(`scroum 0.0.0 (format ${FORMAT_VERSION})`);
    return 0;
  }
  if (!command || flags.has('help') || command === 'help') {
    io.out(HELP);
    return command || flags.has('help') ? 0 : 2;
  }
  switch (command) {
    case 'validate':
      return validateCommand(args, flags, values, io);
    case 'build':
      return buildCommand(args, flags, io);
    case 'edit':
      return editCommand(args, flags, values, io);
    case 'gen-image':
    {
      if (args.length > 1) {
        io.err(`argument inattendu : ${args.slice(1).join(' ')}`);
        return 2;
      }
      const project = projectOrReport(args[0], io, 'gen-image');
      return project ? genImageCommand(project, flags, values, io) : 1;
    }
    case 'workflow-export': {
      // Le dépôt de jeu est facultatif : il fournit les noms de modèles et ses propres workflows.
      let project: ResolvedProject | null = null;
      try {
        project = resolveProject(resolve(io.cwd, args[1] ?? '.'));
      } catch (e) {
        if (!(e instanceof ProjectError)) throw e;
      }
      return workflowExportCommand(project, args, values, io);
    }
    default:
      io.err(`commande inconnue : ${command}\n\n${HELP}`);
      return 2;
  }
}
