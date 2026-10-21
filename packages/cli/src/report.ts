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
  const sg = report.segments;
  if (sg) {
    lines.push(st.bold(`Jouabilité par quête (${plural(sg.segments.length, 'segment')}) :`));
    for (const x of sg.segments) {
      const t = `${(x.stats.durationMs / 1000).toFixed(1)} s`;
      const verdict = x.error ? st.red('checkpoint inutilisable') : x.goalReached ? st.green(`but atteint en ${plural(x.goalPath?.path.steps.length ?? 0, 'action')}`) : x.complete ? st.red('but INATTEIGNABLE') : st.yellow('but non trouvé');
      const expl = x.complete ? 'complet' : st.yellow(`INCOMPLET (${x.stopReason})`);
      const sl = x.softlocks.length ? st.red(`${plural(x.softlocks.length, 'soft-lock')}`) : 'aucun soft-lock';
      lines.push(`  ${x.quest} : ${verdict} — ${plural(x.stats.states, 'état')} en ${t}, exploration ${expl}, ${sl}`);
    }
    lines.push(sg.finalReached ? st.green('  fin du jeu atteinte par les segments') : st.red('  fin du jeu non atteinte par les segments'));
  }
  const pl = report.playability;
  if (pl) {
    const t = `${(pl.stats.durationMs / 1000).toFixed(1)} s`;
    const head = `Jouabilité : ${plural(pl.stats.states, 'état')} explorés en ${t}, profondeur ${pl.stats.depth}`;
    if (!pl.complete && sg) lines.push(st.dim(`${head} — BFS global incomplet (${pl.stopReason ?? 'borne atteinte'}) : information seule, le verdict vient des segments`));
    else if (!pl.complete) lines.push(st.yellow(`${head} — exploration INCOMPLÈTE (${pl.stopReason ?? 'borne atteinte'}) : absence de fin, de soft-lock ou d'élément atteint non concluante`));
    else lines.push(st.dim(`${head} — exploration complète`));
    lines.push(pl.winReachable ? st.green(`  fin win atteignable : ${pl.winPath?.id ?? '?'}${pl.winPath ? ` (${pl.winPath.path.steps.length} actions)` : ''}`) : st.dim('  fin win non atteinte'));
    const n = pl.softlocks.length;
    lines.push(n ? st.red(`  ${plural(n, 'soft-lock')} (voir ci-dessus)`) : st.dim('  aucun soft-lock'));
  }
  const summary = `${plural(report.errors.length, 'erreur')}, ${plural(report.warnings.length, 'avertissement')}`;
  lines.push(report.ok ? st.green(`✔ Contenu valide (${summary})`) : st.red(`✖ Contenu invalide (${summary})`));
  return lines.join('\n');
}
