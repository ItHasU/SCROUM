/**
 * @scroum/cli — binaire `scroum`.
 *
 *   scroum validate [chemin] [--json] [--quiet]
 *   scroum build | edit | gen-image   (pas encore implémentées)
 *
 * `main` est testable : entrées/sorties injectées, renvoie le code de retour.
 */
import { isAbsolute, resolve } from 'node:path';
import { FORMAT_VERSION } from '@scroum/schema';
import { validateDir } from '@scroum/validate/node';
import { ProjectError, resolveProject } from './project';
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
  scroum validate [chemin] [--json] [--quiet]
      Valide le contenu d'un jeu. [chemin] : racine d'un dépôt de jeu
      (avec scroum.project.yaml) ou dossier content/ ; défaut : dossier courant.
      --json   rapport structuré { ok, errors, warnings, skipped } sur stdout
      --quiet  n'affiche que les erreurs
  scroum build [chemin]        Produit dist/<nom>-<version>.scroum.zip   (jalon M2, non implémenté)
  scroum edit [chemin]         Lance l'éditeur local                      (jalon M2, non implémenté)
  scroum gen-image --asset <id> [--n 4] [--prompt "…"]                    (jalon M5, non implémenté)
  scroum --help | --version

Code de retour : 0 si tout va bien, 1 si erreurs de contenu, 2 si usage incorrect.`;

const MILESTONES: Record<string, string> = { build: 'M2', edit: 'M2', 'gen-image': 'M5' };

function parseArgs(argv: string[]): { positional: string[]; flags: Set<string> } {
  const positional: string[] = [];
  const flags = new Set<string>();
  for (const a of argv) {
    if (a.startsWith('--')) flags.add(a.slice(2));
    else if (a === '-h') flags.add('help');
    else positional.push(a);
  }
  return { positional, flags };
}

async function validateCommand(args: string[], flags: Set<string>, io: Io): Promise<number> {
  const unknown = [...flags].filter((f) => f !== 'json' && f !== 'quiet');
  if (unknown.length > 0 || args.length > 1) {
    io.err(`option ou argument inattendu : ${[...unknown.map((f) => `--${f}`), ...args.slice(1)].join(' ')}`);
    return 2;
  }
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
        io.out(JSON.stringify({ ok: false, errors: [error], warnings: [], skipped: [] }, null, 2));
      }
      return 1;
    }
    throw e;
  }
  const report = await validateDir(project.contentDir);
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
  const { positional, flags } = parseArgs(argv);
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
      return validateCommand(args, flags, io);
    case 'build':
    case 'edit':
    case 'gen-image':
      io.err(`scroum ${command} : pas encore implémentée (jalon ${MILESTONES[command]}).`);
      return 1;
    default:
      io.err(`commande inconnue : ${command}\n\n${HELP}`);
      return 2;
  }
}
