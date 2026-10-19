/** Changement de statut d'un élément directement dans le texte du fichier source (YAML ou Markdown). */
import { isMap, parseDocument } from 'yaml';
import type { Status } from '@scroum/schema';
import type { Ref } from './refs';

export const STATUSES: Status[] = ['draft', 'review', 'validated', 'rejected'];

/**
 * Renvoie le contenu du fichier avec le nouveau statut, ou null si l'élément
 * n'est pas gérable ainsi. Les commentaires YAML sont préservés.
 */
export function setStatusInFile(text: string, ref: Ref, status: Status): string | null {
  if (ref.kind === 'doc') return setDocStatus(text, status);
  const keyed = ref.kind === 'world' || ref.kind === 'quest' || ref.kind === 'item' || ref.kind === 'gag';
  const topLevel = ref.kind === 'scene' || ref.kind === 'dialogue' || ref.kind === 'character';
  if (!keyed && !topLevel) return null;
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return null;
  if (topLevel) {
    doc.set('status', status);
  } else {
    const entry = doc.get(ref.id, true);
    if (entry === undefined) return null;
    if (isMap(entry)) {
      doc.setIn([ref.id, 'status'], status);
    } else {
      // forme abrégée (gag : simple chaîne) → forme développée
      doc.set(ref.id, doc.createNode({ status, text: String(doc.get(ref.id)) }));
    }
  }
  return doc.toString();
}

function setDocStatus(text: string, status: Status): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return `---\nstatus: ${status}\n---\n${text}`;
  const front = m[1] ?? '';
  const next = /^status:.*$/m.test(front) ? front.replace(/^status:.*$/m, `status: ${status}`) : `status: ${status}\n${front}`;
  return `---\n${next}\n---\n${text.slice(m[0].length)}`;
}
