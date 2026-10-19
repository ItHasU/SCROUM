/** Champs texte éditables d'un élément (répliques, labels) et écriture dans le YAML en préservant les commentaires. */
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { Ref } from './refs';

export type FieldPath = (string | number)[];

export interface Field {
  label: string;
  path: FieldPath;
  value: string;
  multiline: boolean;
}

/** Champs éditables par formulaire pour l'élément sélectionné (nœud de dialogue ou hotspot). */
export function fieldsFor(text: string, ref: Ref): Field[] {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return [];
  const out: Field[] = [];
  const scalar = (label: string, path: FieldPath, multiline: boolean): void => {
    const n = doc.getIn(path, true);
    if (isScalar(n) && (typeof n.value === 'string' || typeof n.value === 'number')) out.push({ label, path, value: String(n.value), multiline });
  };
  if (ref.kind === 'dnode' && ref.node) {
    const base: FieldPath = ['nodes', ref.node];
    const lines = doc.getIn([...base, 'lines'], true);
    if (isScalar(lines)) scalar('Réplique', [...base, 'lines'], true);
    else if (isMap(lines)) scalar(`Réplique (${String(lines.get('speaker') ?? '')})`, [...base, 'lines', 'text'], true);
    else if (isSeq(lines)) {
      lines.items.forEach((it, i) => {
        if (isScalar(it)) scalar(`Réplique ${i + 1}`, [...base, 'lines', i], true);
        else if (isMap(it)) scalar(`Réplique ${i + 1} (${String(it.get('speaker') ?? '')})`, [...base, 'lines', i, 'text'], true);
      });
    }
    const choices = doc.getIn([...base, 'choices'], true);
    if (isSeq(choices)) choices.items.forEach((it, i) => isMap(it) && scalar(`Choix ${i + 1}`, [...base, 'choices', i, 'label'], false));
  } else if (ref.kind === 'hotspot') {
    const hs = doc.get('hotspots', true);
    if (!isSeq(hs)) return [];
    const idx = hs.items.findIndex((h) => isMap(h) && h.get('id') === ref.id);
    if (idx < 0) return [];
    const base: FieldPath = ['hotspots', idx];
    scalar('Libellé', [...base, 'label'], false);
    const actions = doc.getIn([...base, 'actions'], true);
    if (isMap(actions)) {
      for (const pair of actions.items) {
        const verb = String(isScalar(pair.key) ? pair.key.value : pair.key);
        if (isScalar(pair.value)) scalar(`Action « ${verb} »`, [...base, 'actions', verb], true);
        else if (isMap(pair.value) && pair.value.has('text')) scalar(`Action « ${verb} »`, [...base, 'actions', verb, 'text'], true);
      }
    }
  }
  return out;
}

/** Modifie la valeur d'un champ texte ; renvoie le nouveau texte du fichier (null si le YAML est invalide). */
export function setField(text: string, path: FieldPath, value: string): string | null {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return null;
  doc.setIn(path, value);
  return doc.toString();
}
