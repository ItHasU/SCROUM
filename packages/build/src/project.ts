/** Localisation et lecture d'un dépôt de jeu (`scroum.project.yaml`). */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { FORMAT_VERSION, PROJECT_FILE, ProjectConfigSchema, type ProjectConfig } from '@scroum/schema';

export interface ResolvedProject {
  /** Racine du dépôt de jeu (ou dossier donné). */
  root: string;
  /** Dossier `content/` absolu. */
  contentDir: string;
  /** Configuration lue, ou null si aucun scroum.project.yaml. */
  config: ProjectConfig | null;
  /** Remarques non bloquantes (ex. pas de scroum.project.yaml). */
  notes: string[];
}

export class ProjectError extends Error {}

/**
 * Résout un chemin donné en ligne de commande :
 * - dossier avec `scroum.project.yaml` → dépôt de jeu, contenu dans `config.content` ;
 * - dossier contenant directement `game.yaml` → dossier de contenu ;
 * - dossier avec `content/game.yaml` → dépôt de jeu sans fichier projet (remarque).
 */
export function resolveProject(path: string): ResolvedProject {
  const root = resolve(path);
  if (!existsSync(root)) throw new ProjectError(`dossier introuvable : ${root}`);
  const projectFile = join(root, PROJECT_FILE);
  if (existsSync(projectFile)) {
    let raw: unknown;
    try {
      raw = parse(readFileSync(projectFile, 'utf8'));
    } catch (e) {
      throw new ProjectError(`${PROJECT_FILE} : YAML invalide (${(e as Error).message.split('\n')[0]})`);
    }
    const r = ProjectConfigSchema.safeParse(raw ?? {}, { error: z.locales.fr().localeError });
    if (!r.success) {
      const msg = r.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`).join(' ; ');
      throw new ProjectError(`${PROJECT_FILE} invalide : ${msg}`);
    }
    if (r.data.formatVersion > FORMAT_VERSION) {
      throw new ProjectError(`${PROJECT_FILE} : formatVersion ${r.data.formatVersion}, ce SCROUM gère le format ${FORMAT_VERSION} au plus`);
    }
    return { root, contentDir: resolve(root, r.data.content), config: r.data, notes: [] };
  }
  if (existsSync(join(root, 'game.yaml'))) return { root, contentDir: root, config: null, notes: [] };
  if (existsSync(join(root, 'content', 'game.yaml'))) {
    return { root, contentDir: join(root, 'content'), config: null, notes: [`pas de ${PROJECT_FILE} dans ${root} : contenu lu dans content/`] };
  }
  throw new ProjectError(`ni ${PROJECT_FILE}, ni game.yaml, ni content/game.yaml dans ${root}`);
}
