/** Mise en forme lisible d'un rapport de validation. */
import type { ValidationReport, Issue } from '@scroum/validate';

export interface Style {
  red(s: string): string;
  yellow(s: string): string;
  green(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
}

export function makeStyle(color: boolean): Style {
  const wrap = (code: number) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { red: wrap(31), yellow: wrap(33), green: wrap(32), dim: wrap(2), bold: wrap(1) };
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export function formatReport(report: ValidationReport, opts: { style: Style; quiet?: boolean }): string {
  const { style: st } = opts;
  const issues: Issue[] = [...report.errors, ...(opts.quiet ? [] : report.warnings)];
  const byFile = new Map<string, Issue[]>();
  for (const i of issues) {
    if (!byFile.has(i.file)) byFile.set(i.file, []);
    byFile.get(i.file)!.push(i);
  }
  const lines: string[] = [];
  for (const file of [...byFile.keys()].sort()) {
    lines.push(st.bold(file));
    const list = byFile.get(file)!.sort((a, b) => (a.severity === b.severity ? (a.line ?? 0) - (b.line ?? 0) : a.severity === 'error' ? -1 : 1));
    for (const i of list) {
      const mark = i.severity === 'error' ? st.red('✖') : st.yellow('⚠');
      const where = [i.path, i.line !== undefined ? `ligne ${i.line}` : ''].filter(Boolean).join(', ');
      lines.push(`  ${mark} ${where ? `${where} : ` : ''}${i.message} ${st.dim(`[${i.code}]`)}`);
    }
  }
  for (const s of report.skipped) lines.push(st.dim(`(non exécuté : ${s.analyzer} — ${s.reason})`));
  const summary = `${plural(report.errors.length, 'erreur')}, ${plural(report.warnings.length, 'avertissement')}`;
  lines.push(report.ok ? st.green(`✔ Contenu valide (${summary})`) : st.red(`✖ Contenu invalide (${summary})`));
  return lines.join('\n');
}
