/** Lancement de Claude Code depuis l'éditeur. */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { LOCAL_FILE, type GameData } from '@scroum/schema';

/** Chemin absolu de docs/FORMAT.md du dépôt scroum. */
export const FORMAT_DOC = process.env.SCROUM_FORMAT_DOC ?? fileURLToPath(new URL('../../../../docs/FORMAT.md', import.meta.url));

/** La commande `claude` est-elle lançable (chemin existant, ou présente dans le PATH) ? */
export function claudeAvailable(command: string): boolean {
  if (isAbsolute(command) || /[\\/]/.test(command)) return existsSync(command);
  const exts = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD').split(';')] : [''];
  return (process.env.PATH ?? '').split(delimiter).some((d) => d && exts.some((e) => existsSync(join(d, command + e))));
}

export interface ClaudeConfig {
  command: string;
  permissionMode: string | null;
}

/** Priorité : option > $SCROUM_CLAUDE_BIN > scroum.local.yaml (`claude.command`) > `claude`. */
export async function resolveClaudeConfig(root: string, override?: string): Promise<ClaudeConfig> {
  let command = override ?? process.env.SCROUM_CLAUDE_BIN;
  let permissionMode: string | null = 'acceptEdits';
  try {
    const local = parse(await readFile(join(root, LOCAL_FILE), 'utf8')) as { claude?: { command?: unknown; permission_mode?: unknown } } | null;
    if (!command && typeof local?.claude?.command === 'string') command = local.claude.command;
    if (typeof local?.claude?.permission_mode === 'string') permissionMode = local.claude.permission_mode || null;
  } catch {
    /* pas de scroum.local.yaml */
  }
  return { command: command || 'claude', permissionMode };
}

export interface Selection {
  kind?: string;
  id?: string;
  file?: string;
}

/** Éléments `status: validated` du jeu, sous forme de lignes `kind/id`. */
export function validatedElements(game: GameData | null): string[] {
  if (!game) return [];
  const out: string[] = [];
  const scan = (kind: string, rec: Record<string, { status?: string }> | undefined) => {
    for (const [id, v] of Object.entries(rec ?? {})) if (v.status === 'validated') out.push(`${kind}/${id}`);
  };
  scan('bible', game.bible.docs);
  scan('gag', game.bible.gags as never);
  scan('world', game.worlds as never);
  scan('quest', game.quests as never);
  scan('character', game.characters as never);
  scan('scene', game.scenes as never);
  scan('dialogue', game.dialogues as never);
  scan('item', game.items as never);
  scan('asset', game.assets as never);
  return out;
}

export function buildSystemPrompt(opts: { tone: string | null; validated: string[]; selected?: Selection; contentDir: string }): string {
  const sel = opts.selected && (opts.selected.id || opts.selected.file)
    ? `Élément sélectionné dans l'éditeur : ${[opts.selected.kind, opts.selected.id].filter(Boolean).join('/')}${opts.selected.file ? ` (fichier ${opts.selected.file})` : ''}.`
    : "Aucun élément n'est sélectionné dans l'éditeur.";
  return [
    "Tu édites le contenu d'un jeu SCROUM (moteur d'aventure point-and-click) depuis l'éditeur SCROUM.",
    `Le format des fichiers est décrit dans ${FORMAT_DOC} : lis-le avant toute modification.`,
    `Le contenu du jeu est dans ${opts.contentDir} ; modifie uniquement des fichiers du dépôt courant. Lance « pnpm scroum validate » après tes modifications.`,
    "Ne passe jamais un élément à « status: validated » toi-même : seul l'humain valide. Ne modifie pas les éléments validés sans demande explicite.",
    `Éléments validés (intouchables par défaut) : ${opts.validated.length ? opts.validated.join(', ') : 'aucun'}.`,
    sel,
    'Ton et ligne éditoriale (content/bible/tone.md) :',
    opts.tone?.trim() || '(tone.md absent)',
  ].join('\n');
}

export function spawnClaude(cfg: ClaudeConfig, cwd: string, prompt: string, systemPrompt: string): ChildProcess {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--append-system-prompt', systemPrompt];
  if (cfg.permissionMode) args.push('--permission-mode', cfg.permissionMode);
  return spawn(cfg.command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
}
