/**
 * Configuration d'un dépôt de jeu : `scroum.project.yaml` (versionné) et
 * `scroum.local.yaml` (gitignoré, propre à la machine).
 */
import { z } from 'zod';

export const ProjectConfigSchema = z.strictObject({
  formatVersion: z.number().int().min(1),
  /** Nom de sortie du zip : `dist/<name>-<version>.scroum.zip`. */
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, { error: 'nom invalide : minuscules, chiffres, - et _' }),
  /** Dossier du contenu, relatif à la racine du dépôt. */
  content: z.string().default('content'),
  /** Dossier de sortie des zips. */
  output: z.string().default('dist'),
  /** Dossier des workflows ComfyUI propres au jeu. */
  workflows: z.string().default('workflows'),
  editor: z
    .strictObject({
      port: z.number().int().min(1).max(65535).default(5317),
    })
    .default({ port: 5317 }),
  images: z
    .strictObject({
      /** Format de sortie des images au build. */
      format: z.enum(['webp', 'png', 'jpg']).default('webp'),
      /** Largeur maximale des décors au build. */
      max_width: z.number().int().positive().default(1280),
    })
    .default({ format: 'webp', max_width: 1280 }),
  notes: z.string().optional(),
});
export type ProjectConfig = z.output<typeof ProjectConfigSchema>;

export const LocalConfigSchema = z.looseObject({
  comfyui: z
    .looseObject({
      url: z.string().default('http://127.0.0.1:8188'),
    })
    .optional(),
});
export type LocalConfig = z.output<typeof LocalConfigSchema>;

export const PROJECT_FILE = 'scroum.project.yaml';
export const LOCAL_FILE = 'scroum.local.yaml';
