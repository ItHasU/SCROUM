/**
 * Validation de jouabilité par quête (segments).
 *
 * Chaque quête qui déclare un `checkpoint` (`bible/quests.yaml`) est explorée
 * isolément : BFS de l'état moteur forgé par `startFromCheckpoint`, jusqu'à son
 * `goal` (défaut : quête `completed`). Les états-buts sont terminaux ; les
 * soft-locks sont les états depuis lesquels le but est inatteignable (game over
 * exclus). Chaque segment a ses bornes (celles des options, surchargeables par
 * `checkpoint.limits`).
 *
 * Chaînage : tout objet / drapeau / variable / compteur / quête donné par un
 * checkpoint doit être produit à l'atteinte du but d'un segment **antérieur**
 * (ordre de déclaration dans `quests.yaml`) ou figurer dans `game.yaml → initial`.
 * Sinon : avertissement `given_never_obtained`.
 */
import { createInitialState, evalCondition, startFromCheckpoint, type GameState } from '@scroum/engine';
import type { Checkpoint, GameData, Id, Quest } from '@scroum/schema';
import { analyzePlayability, type GoalSummary, type PlayabilityOptions, type ReachedEnding, type SoftlockGroup, type StopReason } from './playability';
import type { AnalyzerContext } from './types';

export interface SegmentReport {
  quest: Id;
  title: string;
  /** Description lisible du but. */
  goal: string;
  startScene: Id;
  goalReached: boolean;
  /** Chemin le plus court depuis le checkpoint jusqu'au but. */
  goalPath: ReachedEnding | null;
  complete: boolean;
  stopReason: StopReason | null;
  limits: { maxStates: number; maxDepth: number; timeLimitMs: number };
  stats: { states: number; transitions: number; depth: number; durationMs: number };
  softlocks: SoftlockGroup[];
  softlockStates: { certain: number; suspected: number };
  /** Ce qui est présent à l'atteinte du but (union des états-buts explorés). */
  produced: GoalSummary;
  /** Fins atteintes pendant le segment (hors but). */
  endings: { id: Id; type: 'win' | 'game_over' }[];
  /** État de départ forgé (rejouable avec `runScenario(…, { initialState })`). */
  initial: GameState;
  /** Erreur de forge du checkpoint, le cas échéant. */
  error: string | null;
}

export interface GivenIssue {
  quest: Id;
  kind: 'item' | 'flag' | 'var' | 'counter' | 'quest';
  id: Id;
}

export interface SegmentsReport {
  segments: SegmentReport[];
  /** Éléments donnés par un checkpoint mais jamais obtenus avant. */
  neverObtained: GivenIssue[];
  /** Le but de la dernière quête, ou une fin `win`, est atteint. */
  finalReached: boolean;
}

export const hasCheckpoints = (game: GameData): boolean => Object.values(game.quests).some((q) => q.checkpoint);

/** Description du but d'une quête. */
export function describeGoal(q: Quest): string {
  if (q.goal?.ending) return `fin « ${q.goal.ending} »`;
  if (q.goal?.condition) return 'condition `goal.if`';
  return `quête « ${q.id} » terminée`;
}

/** Prédicat de but d'une quête. */
export function goalPredicate(q: Quest): (s: GameState) => boolean {
  const { ending, condition } = q.goal ?? { ending: null, condition: null };
  if (ending) return (s) => s.ending?.id === ending;
  if (condition) return (s) => evalCondition(condition, s);
  return (s) => s.quests.completed.includes(q.id);
}

function segmentOptions(base: PlayabilityOptions, cp: Checkpoint): PlayabilityOptions {
  const l = cp.limits;
  const o: PlayabilityOptions = { ...base };
  delete o.segment;
  if (l?.max_states) o.maxStates = l.max_states;
  if (l?.max_depth) o.maxDepth = l.max_depth;
  if (l?.time_limit) o.timeLimitMs = Math.round(l.time_limit * 1000);
  return o;
}

export function analyzeSegments(game: GameData, options: PlayabilityOptions = {}): SegmentsReport {
  const segments: SegmentReport[] = [];
  const quests = Object.values(game.quests).filter((q) => q.checkpoint);
  const initial = createInitialState(game);
  const eng = options.engine ?? {};
  for (const q of quests) {
    const cp = q.checkpoint!;
    const start = startFromCheckpoint(game, cp, eng);
    const err = start.events.find((e) => e.type === 'error');
    const base = {
      quest: q.id,
      title: q.title,
      goal: describeGoal(q),
      startScene: start.state.scene,
      initial: start.state,
    };
    const empty: GoalSummary = { states: 0, items: [], flags: [], vars: [], counters: [], unlocked: [], completed: [] };
    if (err && err.type === 'error') {
      segments.push({
        ...base,
        goalReached: false,
        goalPath: null,
        complete: true,
        stopReason: null,
        limits: { maxStates: 0, maxDepth: 0, timeLimitMs: 0 },
        stats: { states: 0, transitions: 0, depth: 0, durationMs: 0 },
        softlocks: [],
        softlockStates: { certain: 0, suspected: 0 },
        produced: empty,
        endings: [],
        error: err.message,
      });
      continue;
    }
    const r = analyzePlayability(game, { ...segmentOptions(options, cp), segment: { initial: start.state, initialEvents: start.events, goal: goalPredicate(q) } });
    segments.push({
      ...base,
      goalReached: r.winReachable,
      goalPath: r.winPath,
      complete: r.complete,
      stopReason: r.stopReason,
      limits: r.limits,
      stats: { states: r.stats.states, transitions: r.stats.transitions, depth: r.stats.depth, durationMs: r.stats.durationMs },
      softlocks: r.softlocks,
      softlockStates: r.softlockStates,
      produced: r.goalSummary!,
      endings: r.endings.reached.filter((e) => e.id !== 'goal').map((e) => ({ id: e.id, type: game.endings[e.id]?.type ?? 'game_over' })),
      error: null,
    });
  }

  // --- chaînage : ce qui est donné doit avoir été obtenu avant
  const neverObtained: GivenIssue[] = [];
  const have = {
    item: new Set<Id>(Object.keys(initial.inventory)),
    flag: new Set<Id>(initial.flags),
    var: new Set<Id>(Object.keys(initial.vars)),
    counter: new Set<Id>(),
    quest: new Set<Id>(initial.quests.unlocked),
  };
  const completedBefore = new Set<Id>();
  segments.forEach((seg) => {
    const cp = game.quests[seg.quest]!.checkpoint!;
    const given: GivenIssue[] = [
      ...Object.keys(cp.inventory).filter((id) => !initial.inventory[id]).map((id) => ({ quest: seg.quest, kind: 'item' as const, id })),
      ...cp.flags.map((id) => ({ quest: seg.quest, kind: 'flag' as const, id })),
      ...Object.entries(cp.vars).filter(([, v]) => v !== 0).map(([id]) => ({ quest: seg.quest, kind: 'var' as const, id })),
      ...Object.entries(cp.counters).filter(([id, v]) => v !== (initial.counters[id] ?? 0)).map(([id]) => ({ quest: seg.quest, kind: 'counter' as const, id })),
      ...cp.quests.map((id) => ({ quest: seg.quest, kind: 'quest' as const, id })),
      ...cp.completed.map((id) => ({ quest: seg.quest, kind: 'quest' as const, id })),
    ];
    for (const g of given) {
      const ok =
        g.kind === 'quest' && cp.completed.includes(g.id)
          ? completedBefore.has(g.id)
          : g.kind === 'quest'
            ? have.quest.has(g.id) || completedBefore.has(g.id)
            : have[g.kind].has(g.id);
      if (!ok && !neverObtained.some((x) => x.quest === g.quest && x.kind === g.kind && x.id === g.id)) neverObtained.push(g);
    }
    for (const id of seg.produced.items) have.item.add(id);
    for (const id of seg.produced.flags) have.flag.add(id);
    for (const id of seg.produced.vars) have.var.add(id);
    for (const id of seg.produced.counters) have.counter.add(id);
    for (const id of seg.produced.unlocked) have.quest.add(id);
    for (const id of seg.produced.completed) completedBefore.add(id);
  });

  const last = segments[segments.length - 1];
  const winEnding = segments.some((s) => s.endings.some((e) => e.type === 'win'));
  const finalReached = segments.length === 0 || !!(last?.goalReached || winEnding);
  return { segments, neverObtained, finalReached };
}

const KIND_LABEL = { item: 'objet', flag: 'drapeau', var: 'variable', counter: 'compteur', quest: 'quête' } as const;

/** Traduit le rapport des segments en problèmes de validation. */
export function reportSegments(game: GameData, r: SegmentsReport, ctx: AnalyzerContext): void {
  for (const s of r.segments) {
    const q = game.quests[s.quest]!;
    const where = `${s.quest}.checkpoint`;
    const tag = `[quête « ${s.quest} »]`;
    if (s.error) {
      ctx.report('error', 'checkpoint_invalid', q.source, where, `${tag} point de reprise inutilisable : ${s.error}`);
      continue;
    }
    if (!s.complete) {
      const why = { max_states: `limite de ${s.limits.maxStates} états`, max_depth: `profondeur ${s.limits.maxDepth}`, time_limit: `limite de ${s.limits.timeLimitMs} ms` }[s.stopReason!];
      ctx.report('warning', 'segment_incomplete', q.source, where, `${tag} exploration incomplète (${why} atteinte : ${s.stats.states} états) — verdict non concluant ; resserrer le checkpoint ou relever les bornes (checkpoint.limits)`);
    }
    if (!s.goalReached) {
      ctx.report(
        s.complete ? 'error' : 'warning',
        s.complete ? 'quest_goal_unreachable' : 'quest_goal_not_found',
        q.source,
        s.complete ? `${s.quest}.goal` : where,
        s.complete ? `${tag} le but (${s.goal}) n'est atteignable depuis le point de reprise (${s.stats.states} états explorés)` : `${tag} but (${s.goal}) non trouvé dans les bornes de l'exploration`,
      );
    }
    for (const g of s.softlocks) {
      const others = g.count > 1 ? ` (+${g.count - 1} autre${g.count > 2 ? 's' : ''} état${g.count > 2 ? 's' : ''} bloqué${g.count > 2 ? 's' : ''} de même cause)` : '';
      const steps = g.path.steps.length <= 10 ? g.path.steps.join(' → ') : `… → ${g.path.steps.slice(-10).join(' → ')}`;
      ctx.report(
        g.suspected ? 'warning' : 'error',
        g.suspected ? 'softlock_suspected' : 'softlock',
        g.file,
        g.location,
        `${tag} ${g.suspected ? 'soft-lock suspecté' : s.goalReached ? 'soft-lock' : 'blocage'} — ${g.diagnosis.message}${others}. Chemin depuis le checkpoint (${g.path.steps.length} actions) : ${steps}`,
      );
    }
  }
  for (const g of r.neverObtained) {
    const q = game.quests[g.quest]!;
    const partial = r.segments.some((s) => !s.complete && s.quest !== g.quest) ? ' (des segments antérieurs sont incomplets : peut-être un faux positif)' : '';
    ctx.report(
      'warning',
      'given_never_obtained',
      q.source,
      `${g.quest}.checkpoint`,
      `${KIND_LABEL[g.kind]} « ${g.id} » donné automatiquement par le checkpoint de « ${g.quest} » mais jamais obtenu avant (ni dans initial, ni au but d'un segment antérieur)${partial}`,
    );
  }
  if (!r.finalReached) {
    ctx.report('error', 'final_unreachable', 'bible/quests.yaml', '', 'ni le but de la dernière quête ni une fin « win » ne sont atteints par les segments');
  }
}
