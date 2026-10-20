/**
 * Configuration d'un dépôt de jeu : `scroum.project.yaml` (versionné) et
 * `scroum.local.yaml` (gitignoré, propre à la machine).
 */
import { z } from 'zod';

/** Post-traitement d'image au build (par monde). */
export const PostprocessSchema = z.strictObject({
  /** Pixelisation : taille d'un « gros pixel » en pixels de sortie (>= 2). */
  pixelate: z.number().int().min(2).max(64).optional(),
  /** Quantification de palette : nombre de couleurs (2 à 256). */
  colors: z.number().int().min(2).max(256).optional(),
});
export type Postprocess = z.output<typeof PostprocessSchema>;

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
      /** Post-traitement par monde (id de monde → réglages) ; `default` s'applique aux autres. Prioritaire sur bible/style.md. */
      postprocess: z.record(z.string(), PostprocessSchema).optional(),
      /** Largeur maximale des décors au build. */
      max_width: z.number().int().positive().default(1280),
    })
    .default({ format: 'webp', max_width: 1280 }),
  /** Génération d'images : valeurs par défaut des paramètres de workflow (modèles) ; l'URL est dans scroum.local.yaml. */
  comfyui: z
    .strictObject({
      /** Valeurs de `{{unet}}`, `{{clip}}`, `{{vae}}`, `{{clip_type}}`, `{{steps}}`, `{{cfg}}`… (surchargées par scroum.local.yaml). */
      models: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
      timeout_s: z.number().positive().optional(),
    })
    .optional(),
  notes: z.string().optional(),
});
export type ProjectConfig = z.output<typeof ProjectConfigSchema>;

export const LocalConfigSchema = z.looseObject({
  comfyui: z
    .looseObject({
      url: z.string().default('http://127.0.0.1:8188'),
      models: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      timeout_s: z.number().positive().optional(),
    })
    .optional(),
});
export type LocalConfig = z.output<typeof LocalConfigSchema>;

export const PROJECT_FILE = 'scroum.project.yaml';
export const LOCAL_FILE = 'scroum.local.yaml';
