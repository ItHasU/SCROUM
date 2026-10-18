/** Utilitaires Node (accès disque) : `@scroum/validate/node`. */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { classifyPath } from '@scroum/schema';
import { validateContent } from './validate';
import type { ValidateOptions, ValidationReport } from './types';

/**
 * Lit récursivement un dossier `content/`. Les fichiers texte (YAML, Markdown,
 * CSS) sont lus ; les images et fichiers ignorés ne sont que listés (contenu vide).
 */
export async function readContentDir(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(d: string): Promise<void> {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        await walk(full);
        continue;
      }
      const rel = relative(dir, full).split(sep).join('/');
      const kind = classifyPath(rel);
      const isText = kind !== 'image' && kind !== 'ignored' ? /\.(ya?ml|md)$/i.test(rel) : /\.css$/i.test(rel);
      out.set(rel, isText ? await readFile(full, 'utf8') : '');
    }
  }
  await walk(dir);
  return out;
}

/** Lit et valide un dossier `content/`. */
export async function validateDir(contentDir: string, options: ValidateOptions = {}): Promise<ValidationReport> {
  return validateContent(await readContentDir(contentDir), options);
}
