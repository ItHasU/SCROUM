/** Libellés par défaut de l'interface (français). */

/** Libellés par défaut des verbes usuels (docs/FORMAT.md §6). */
export const DEFAULT_VERB_LABELS: Readonly<Record<string, string>> = {
  look: 'Regarder',
  talk: 'Parler',
  take: 'Prendre',
  open: 'Ouvrir',
  close: 'Fermer',
  push: 'Pousser',
  pull: 'Tirer',
  use: 'Utiliser',
};

/** Libellé affiché d'un verbe : `label` du contenu, sinon défaut, sinon l'id mis en forme. */
export function verbLabel(verb: string, label: string | null | undefined): string {
  if (label) return label;
  const d = DEFAULT_VERB_LABELS[verb];
  if (d) return d;
  const s = verb.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Initiales d'un libellé (placeholders d'icônes / avatars). */
export function initials(label: string): string {
  const words = label
    .replace(/^(l'|la |le |les |un |une |des )/i, '')
    .split(/[\s'’-]+/)
    .filter(Boolean);
  const s = words.length >= 2 ? words[0]!.charAt(0) + words[1]!.charAt(0) : (words[0] ?? '?').slice(0, 2);
  return s.toUpperCase();
}

/** Teinte stable (0..359) dérivée d'un identifiant (placeholders colorés par monde). */
export function hueOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}
