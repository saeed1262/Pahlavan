// Double progression: the next target for one exercise from its last sessions,
// its rep range [lo, hi] and the target RIR. The arithmetic follows the
// dashboard's nextTarget (the original log script's next target) and rules.md
// ("Progression"); the two-miss rule follows the numbers.md flag.

import { addDays, dayText, mondayOf } from './dates.ts';
import type { ExerciseSession } from './history.ts';
import { topSet } from './history.ts';
import { cited, explain, joinNotes, type Result, type RuleFrom } from './reason.ts';
import type { LiftProgression, RuleSource } from './rules.ts';
import { capLoadJump } from './safety.ts';
import type { IsoDate, LoggedSet, RepRange, SlotProgression, Unit } from './schema.ts';
import { roundToStep, setInUnit, weightInUnit } from './units.ts';

export const PROGRESSION = {
  /** Two sessions in a row under lo: this much of the last weight, rounded to the step. */
  lighterFactor: 0.9,
  /** Deload week: this much of the last loading weight, at lo reps (the dashboard's deload). */
  deloadFactor: 0.9,
  /** Deload week: target RIR plus this (rules.md, deloads). */
  deloadRirAdd: 3,
  /** A logged RIR of 5 or more is unreliable: the set was too light to judge. */
  unreliableRir: 5,
  /** The dashboard rounds base + increment to 0.5. */
  incrementRounding: 0.5,
  /** The lighter step should land inside 5-10 %. */
  lighterBand: [0.05, 0.1],
} as const;

/** `calibrate` comes from the calibration week (calibration.ts), `ease-back` from the missed-time protocol (missed.ts). */
export type ProgressionAction =
  | 'start'
  | 'no-data'
  | 'deload'
  | 'lighter'
  | 'hold'
  | 'increase'
  | 'add-reps'
  | 'calibrate'
  | 'ease-back'
  | 'next-variation'
  | 'target';

export interface ProgressionTarget {
  action: ProgressionAction;
  /** In the exercise unit; null when there is no logged load to start from. */
  weight: number | null;
  unit: Unit;
  reps: number;
  rir: number;
  /** Standard or Light tracking: the logged top set stands in for every set. */
  assumedAllSets: boolean;
  /** A coach-set target (rule `target`): the last session met it; the target holds until the coach sets the next. */
  targetMet?: boolean;
}

export interface ProgressionInput {
  /** This exercise's sessions, oldest first (history.ts exerciseHistory). */
  history: readonly ExerciseSession[];
  exercise: { unit: Unit; increment: number };
  repRange: RepRange;
  targetRir: number;
  /** The coming session is in a deload week. */
  deload?: boolean;
  /** The light week's load (a fraction of the last loading weight) and RIR added, and the rule they come from (default: 0.9 and +3). */
  lightWeek?: { load: number; rirAdd: number; from?: RuleFrom };
  /** The slot's progression rule (default double; linear uses its own step). */
  rule?: SlotProgression;
  /**
   * The lift's standing rule (rules.ts): the plan's own, or the old default
   * the plan leaves standing, with where it came from. The plan's own rule
   * sets the step: an increase over the load-jump guide is reported, not
   * capped. Without it, the old default (double progression, capped).
   */
  standing?: { rule: LiftProgression; source: RuleSource; from?: RuleFrom };
  /** The coming session's date, for the load-jump cap's 7 days (default: the day after the last session). */
  date?: IsoDate;
  /** Mondays of deload weeks the check-ins say were trained at full load: their sessions count as loading. */
  fullLoadWeeks?: readonly IsoDate[];
  /** The RIR the user reported at a check-in for the last session's top sets, used when no set carries RIR. */
  reportedRir?: { rir: number; checkin: IsoDate };
  /** The RIR calibration bias for this exercise (actual - predicted), added to logged or reported RIR. */
  rirBias?: { bias: number; date: IsoDate };
  /** Display names for exercise ids, for the notes (ids stay in the inputs). */
  exerciseName?: (id: string) => string;
}

/** The sets the rule judges: every set at Full tracking, otherwise the top set for all. */
function judged(h: ExerciseSession): { sets: LoggedSet[]; assumed: boolean } {
  if (h.trackingLevel === 'full') return { sets: h.sets, assumed: false };
  const t = topSet(h.sets);
  return { sets: t ? [t] : [], assumed: true };
}

/** The session as progression read it: every set in the exercise's unit, the logged weight beside it. */
const summary = (h: ExerciseSession, exercise: { unit: Unit; increment: number }) => ({
  date: h.date,
  trackingLevel: h.trackingLevel,
  sets: h.sets.map((s) => setInUnit(s, exercise)),
});

/** A session's top-set weight in the exercise unit, as progression reads it. */
function weightOf(h: ExerciseSession, exercise: { unit: Unit; increment: number }): number {
  const t = topSet(h.sets)!;
  return weightInUnit(t.weight, t.unit, exercise);
}

/**
 * The next target. A ladder slot that earns an increase moves to its next
 * variation instead of adding load. Every target that adds weight passes
 * through the load-jump cap (safety.ts) before it is returned.
 */
export function nextTarget(raw: ProgressionInput): Result<ProgressionTarget> {
  // Deload weeks the user trained at full load count as loading weeks.
  const full = new Set(raw.fullLoadWeeks ?? []);
  const restored = raw.history.filter((h) => h.deload && full.has(mondayOf(h.date)));
  const input: ProgressionInput = restored.length ? { ...raw, history: raw.history.map((h) => (restored.includes(h) ? { ...h, deload: false } : h)) } : raw;
  const r0 = withStanding(cappedTarget(input), input);
  const r = restored.length
    ? {
        value: r0.value,
        reason: {
          ...r0.reason,
          inputs: { ...r0.reason.inputs, fullLoadSessions: restored.map((h) => h.date) },
          note: joinNotes(r0.reason.note, `Session(s) ${restored.map((h) => dayText(h.date)).join(', ')} fell in a deload week the check-in says was trained at full load: counted as loading.`) ?? '',
        },
      }
    : r0;
  // Name the deload-week sessions after the last loading one: they are not used.
  const lastLoading = input.history.filter((h) => !h.deload && h.sets.length > 0).at(-1);
  const passed = lastLoading ? input.history.filter((h) => h.deload && h.sets.length > 0 && h.date > lastLoading.date) : [];
  if (passed.length === 0) return r;
  const listed = passed.map((h) => {
    const t = topSet(h.sets)!;
    return `${h.date} (${t.weight} ${t.unit} x ${t.reps})`;
  });
  return {
    value: r.value,
    reason: {
      ...r.reason,
      inputs: { ...r.reason.inputs, deloadSessionsNotUsed: passed.map((h) => h.date) },
      note: joinNotes(r.reason.note, `Deload-week session(s) after it are not used: ${listed.join(', ')}; if that week was trained at full load, confirm it in the check-in.`) ?? '',
    },
  };
}

/** A target cited by the lift's standing rule; a light-week target keeps the light-week rule it already cites. */
function withStanding(r: Result<ProgressionTarget>, input: ProgressionInput): Result<ProgressionTarget> {
  const from = input.standing?.from;
  if (!from || r.reason.from) return r;
  return { value: r.value, reason: cited(r.reason, from) };
}

function cappedTarget(input: ProgressionInput): Result<ProgressionTarget> {
  const r = uncappedTarget(input);
  const base = r.reason.inputs['base'];
  if (typeof base !== 'number' || r.value.weight === null || r.value.weight <= base) return r;
  if (input.rule?.rule === 'ladder') {
    const next = input.rule.next ?? null;
    return {
      value: { ...r.value, action: 'next-variation', weight: base },
      reason: {
        ...r.reason,
        inputs: { ...r.reason.inputs, next },
        title: 'Ladder',
        note: `Every set reached the top of the range: move to ${next ? (input.exerciseName?.(next) ?? next) : 'the next harder variation'} at ${input.repRange[0]} reps.`,
      },
    };
  }
  const logged = input.history.filter((h) => !h.deload && h.sets.length > 0);
  const history = logged.map((h) => ({ date: h.date, weight: weightOf(h, input.exercise) }));
  const date = input.date ?? addDays(logged.at(-1)!.date, 1);
  const cap = capLoadJump({ proposed: r.value.weight, date, history, exercise: input.exercise });
  const loadCap = { proposed: r.value.weight, limit: cap.value.limit, bigJump: cap.value.bigJump, binding: cap.value.binding };
  if (!cap.value.capped && !cap.value.bigJump) return r;
  if (input.standing?.source === 'plan') {
    // The plan's rule sets the step: the guide (one step a session, about 10 % in 7 days) is a heuristic, reported as a fact.
    const unit = input.exercise.unit;
    return {
      value: r.value,
      reason: {
        ...r.reason,
        inputs: { ...r.reason.inputs, loadCap: { ...loadCap, applied: false } },
        note: joinNotes(
          r.reason.note,
          cap.value.capped && `${r.value.weight} ${unit} is over the load-jump guide (${cap.value.limit} ${unit}: one step a session, about 10 % in 7 days; a heuristic). Reported, not applied: the plan's rule sets the step.`,
          cap.value.bigJump && !cap.value.capped && 'One step is more than 10 % of the load (a big jump): reported, the plan\'s rule sets the step.',
        ) ?? '',
      },
    };
  }
  return {
    value: { ...r.value, weight: cap.value.weight },
    reason: {
      ...r.reason,
      title: cap.value.bigJump ? 'Big jump' : 'Load cap',
      inputs: { ...r.reason.inputs, loadCap },
      note: joinNotes(r.reason.note, cap.reason.note) ?? '',
    },
  };
}

function uncappedTarget(input: ProgressionInput): Result<ProgressionTarget> {
  const { history, exercise, repRange, targetRir } = input;
  const [lo, hi] = repRange;
  const unit = exercise.unit;
  const inc = exercise.increment;
  const deload = input.deload === true;
  const lightWeek = { load: input.lightWeek?.load ?? PROGRESSION.deloadFactor, rirAdd: input.lightWeek?.rirAdd ?? PROGRESSION.deloadRirAdd, from: input.lightWeek?.from };
  const stepUp = input.rule?.rule === 'linear' && input.rule.step ? input.rule.step : inc;
  const threshold = { lo, hi, targetRir, increment: inc, ...(stepUp !== inc ? { linearStep: stepUp } : {}) };
  // The plan's own lift rule (double, linear, hold, target) names the result; else the slot's (double by default).
  const own = input.standing?.source === 'plan' ? input.standing.rule : null;
  const rule = own ? `progression.${own.rule}` : `progression.${input.rule?.rule ?? 'double'}`;
  const onMiss = input.standing?.rule.onMiss ?? { after: 2, drop: 1 - PROGRESSION.lighterFactor };
  const target = own?.rule === 'target' ? (own.target ?? null) : null;

  const loading = history.filter((h) => !h.deload);
  const logged = loading.filter((h) => h.sets.length > 0);
  const last = logged.at(-1);

  if (!last && target && !deload) {
    return explain<ProgressionTarget>({ action: 'target', weight: target.weight, unit, reps: target.reps, rir: target.rir, assumedAllSets: false, targetMet: false }, rule, { sessions: history.length, loggedSessions: 0, repRange, target, targetMet: false }, {
      threshold,
      note: `The coach's target: ${target.weight} ${unit} x ${target.reps} at RIR ${target.rir}.`,
    });
  }

  if (!last) {
    const performed = history.length > 0;
    const target: ProgressionTarget = {
      action: performed ? 'no-data' : 'start',
      weight: null,
      unit,
      reps: lo,
      rir: deload ? targetRir + lightWeek.rirAdd : targetRir,
      assumedAllSets: false,
    };
    // Logged only in deload weeks: progression never starts from a deload load.
    const deloadLogged = history.filter((h) => h.deload && h.sets.length > 0);
    const lastDeload = deloadLogged.at(-1);
    const deloadTop = lastDeload ? topSet(lastDeload.sets) : undefined;
    const light = history.every((h) => h.trackingLevel === 'light');
    return explain(target, rule, { sessions: history.length, loggedSessions: 0, deloadSessionsLogged: deloadLogged.length, repRange, targetRir, deload }, {
      threshold,
      note: deloadTop
        ? `Logged only in deload weeks (last ${deloadTop.weight} ${deloadTop.unit} x ${deloadTop.reps} on ${lastDeload!.date}): progression never starts from a deload session, so choose a weight that leaves ${targetRir} reps in reserve at ${lo}-${hi} reps. If that week was trained at full load, confirm it in the check-in.`
        : performed
          ? `Done ${history.length} time(s) with no load logged${light ? ' (Light tracking)' : ''}: choose a weight that leaves ${targetRir} reps in reserve at ${lo}-${hi} reps.`
          : `First time: find a weight for ${lo}-${hi} reps with ${targetRir} in reserve.`,
    });
  }

  const top = topSet(last.sets)!;
  // A top set logged in the other unit is converted and rounded to the step.
  const base = weightInUnit(top.weight, top.unit, exercise);
  const { sets, assumed } = judged(last);
  const reps = sets.map((s) => s.reps);
  let rirs = sets.map((s) => s.rir).filter((r): r is number => r !== undefined);
  const rirNotes: string[] = [];
  const rirInputs: Record<string, unknown> = {};
  const reported = rirs.length === 0 && input.reportedRir !== undefined;
  if (reported) {
    rirs = [input.reportedRir!.rir];
    rirInputs['reportedRir'] = input.reportedRir;
    rirNotes.push(`No RIR logged: the ${input.reportedRir!.checkin} check-in reported RIR ${input.reportedRir!.rir} on the top sets.`);
  } else if (rirs.length) {
    // A logged RIR takes the place of the check-in's reported one: that is only for sessions without one.
    rirInputs['loggedRir'] = rirs;
    rirNotes.push(`RIR as logged on the ${assumed ? 'top set' : 'sets'}: ${rirs.join(', ')}${input.reportedRir ? ` (the ${input.reportedRir.checkin} check-in's reported RIR is for sessions without one)` : ''}.`);
  }
  if (rirs.length && input.rirBias && input.rirBias.bias !== 0) {
    const b = input.rirBias.bias;
    const before = rirs;
    rirs = rirs.map((r) => r + b);
    rirInputs['rirBias'] = input.rirBias;
    rirNotes.push(`RIR corrected by the calibration bias ${b > 0 ? '+' : ''}${b} (calibration of ${input.rirBias.date}): ${before.join(', ')} -> ${rirs.join(', ')}.`);
  }
  const inputs: Record<string, unknown> = {
    last: summary(last, exercise),
    base,
    unit,
    repRange,
    targetRir,
    increment: inc,
    deload,
    judgedReps: reps,
    ...rirInputs,
  };
  const assumption = joinNotes(
    assumed &&
      `${last.trackingLevel === 'light' ? 'Light' : 'Standard'} tracking: only the top set is logged, so every set is assumed to have matched it (the dashboard's assumption); confirm in the check-in.`,
    ...rirNotes,
  );
  const unreliable = rirs.some((r) => r >= PROGRESSION.unreliableRir)
    ? `A ${reported ? 'reported' : 'logged'} RIR of 5 or more is unreliable: the set was too light to judge; push closer to the target.`
    : undefined;
  const make = (action: ProgressionAction, weight: number, r: number, rir = targetRir): ProgressionTarget => ({
    action,
    weight,
    unit,
    reps: r,
    rir,
    assumedAllSets: assumed,
  });

  if (deload) {
    const w = roundToStep(base * lightWeek.load, inc);
    return explain(make('deload', w, lo, targetRir + lightWeek.rirAdd), rule, inputs, {
      threshold: { ...threshold, deloadFactor: lightWeek.load, deloadRirAdd: lightWeek.rirAdd },
      note: joinNotes(
        `Deload week: ${w} ${unit} x ${lo}, ${lightWeek.load >= 1 ? 'the load of' : `about ${Math.round((1 - lightWeek.load) * 100)} % under`} the last loading session (${base} ${unit}), RIR +${lightWeek.rirAdd}.`,
        assumption,
      ),
      ...(lightWeek.from ? { from: lightWeek.from } : {}),
    });
  }

  if (target) {
    // The coach's numbers; met once every judged set reached its reps at its weight or more.
    const met = base >= target.weight - 1e-9 && reps.length > 0 && reps.every((r) => r >= target.reps);
    return explain<ProgressionTarget>({ ...make('target', target.weight, target.reps, target.rir), targetMet: met }, rule, { ...inputs, target, targetMet: met }, {
      threshold,
      note: joinNotes(
        met
          ? `The coach's target is met (${base} ${unit} x ${reps.join(', ')}): ${target.weight} ${unit} x ${target.reps} at RIR ${target.rir} holds until the coach sets the next one.`
          : `The coach's target: ${target.weight} ${unit} x ${target.reps} at RIR ${target.rir}.`,
        assumption,
      ),
    });
  }

  const miss = (h: ExerciseSession) => judged(h).sets.some((s) => s.reps < lo);
  const prev = logged.at(-2);
  const missRun = onMiss === 'hold' ? null : logged.slice(-onMiss.after);
  if (onMiss !== 'hold' && missRun!.length === onMiss.after && missRun!.every(miss)) {
    const factor = own ? 1 - onMiss.drop : PROGRESSION.lighterFactor;
    let w = roundToStep(base * factor, inc);
    if (w >= base) w = Math.max(0, Number((base - inc).toFixed(6))); // the step is too coarse for the drop
    const drop = base > 0 ? 1 - w / base : 0;
    const [bandLo, bandHi] = own ? [Math.max(0, onMiss.drop - 0.05), onMiss.drop] : PROGRESSION.lighterBand;
    const runText = onMiss.after === 1 ? 'A session' : onMiss.after === 2 ? 'Two sessions in a row' : `${onMiss.after} sessions in a row`;
    return explain(make('lighter', w, lo), rule, { ...inputs, ...(prev ? { previous: summary(prev, exercise) } : {}), drop }, {
      threshold: { ...threshold, lighterFactor: factor, lighterBand: own ? [bandLo, bandHi] : PROGRESSION.lighterBand },
      note: joinNotes(
        `${runText} under ${lo} reps: ${w} ${unit} x ${lo}, ${(drop * 100).toFixed(1)} % lighter.`,
        (drop < bandLo - 1e-9 || drop > bandHi + 1e-9) &&
          `The ${inc} ${unit} step makes this outside ${Math.round(bandLo * 100)}-${Math.round(bandHi * 100)} %; a wider rep range lets reps carry the progress.`,
        assumption,
      ),
    });
  }

  if (own?.rule === 'linear') {
    // Linear: the weight goes up every session each set reaches the top; the reps stay there.
    if (reps.some((r) => r < hi)) {
      return explain(make('hold', base, hi), rule, inputs, { threshold, note: joinNotes(`A set under ${hi} reps: hold ${base} ${unit} and aim for ${hi} on every set.`, assumption, unreliable) });
    }
    if (rirs.some((r) => r < targetRir)) {
      return explain(make('hold', base, hi), rule, { ...inputs, judgedRir: rirs }, { threshold, note: joinNotes(`Reached ${hi} reps but with less than ${targetRir} in reserve: repeat ${base} ${unit} x ${hi} at the target RIR before adding weight.`, assumption) });
    }
    const w = roundToStep(base + stepUp, PROGRESSION.incrementRounding);
    return explain(make('increase', w, hi), rule, inputs, { threshold, note: joinNotes(`Every set reached ${hi}: ${w} ${unit} x ${hi}.`, assumption, unreliable) });
  }

  if (reps.some((r) => r < lo)) {
    return explain(make('hold', base, lo), rule, inputs, {
      threshold,
      note: joinNotes(`A set under ${lo} reps: hold ${base} ${unit} and aim for ${lo}.`, assumption, unreliable),
    });
  }

  if (reps.every((r) => r >= hi)) {
    const harder = rirs.some((r) => r < targetRir);
    if (harder) {
      return explain(make('hold', base, hi), rule, { ...inputs, judgedRir: rirs }, {
        threshold,
        note: joinNotes(
          `Reached ${hi} reps but with less than ${targetRir} in reserve: repeat ${base} ${unit} x ${hi} at the target RIR before adding weight.`,
          assumption,
        ),
      });
    }
    if (own?.rule === 'hold') {
      return explain(make('hold', base, hi), rule, inputs, { threshold, note: joinNotes(`Every set reached ${hi}: the weight stays at ${base} ${unit} x ${hi} (the rule adds no weight).`, assumption) });
    }
    const w = roundToStep(base + stepUp, PROGRESSION.incrementRounding);
    return explain(make('increase', w, lo), rule, inputs, {
      threshold,
      note: joinNotes(
        `Every set reached ${hi}: ${w} ${unit} x ${lo}.`,
        assumed && `If any set fell short of ${hi}, stay at ${base} ${unit}.`,
        assumption,
        unreliable,
      ),
    });
  }

  const nextReps = Math.min(hi, Math.max(lo, Math.min(...reps) + 1));
  return explain(make('add-reps', base, nextReps), rule, inputs, {
    threshold,
    note: joinNotes(`Inside the range: ${base} ${unit} x ${nextReps}, one more rep.`, assumption, unreliable),
  });
}
