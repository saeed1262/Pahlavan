// Double progression: the next target for one exercise from its last sessions,
// its rep range [lo, hi] and the target RIR. The arithmetic follows the
// dashboard's nextTarget (fitness_log.py next_target) and rules.md
// ("Progression"); the two-miss rule follows the numbers.md flag.

import { addDays, dayText, mondayOf } from './dates.ts';
import type { ExerciseSession } from './history.ts';
import { topSet } from './history.ts';
import { explain, joinNotes, type Result } from './reason.ts';
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

/** `calibrate` and `ease-back` come from the missed-time protocol (missed.ts). */
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
  | 'next-variation';

export interface ProgressionTarget {
  action: ProgressionAction;
  /** In the exercise unit; null when there is no logged load to start from. */
  weight: number | null;
  unit: Unit;
  reps: number;
  rir: number;
  /** Standard or Light tracking: the logged top set stands in for every set. */
  assumedAllSets: boolean;
}

export interface ProgressionInput {
  /** This exercise's sessions, oldest first (history.ts exerciseHistory). */
  history: readonly ExerciseSession[];
  exercise: { unit: Unit; increment: number };
  repRange: RepRange;
  targetRir: number;
  /** The coming session is in a deload week. */
  deload?: boolean;
  /** The slot's progression rule (default double; linear uses its own step). */
  rule?: SlotProgression;
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
  const r0 = cappedTarget(input);
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
  const stepUp = input.rule?.rule === 'linear' && input.rule.step ? input.rule.step : inc;
  const threshold = { lo, hi, targetRir, increment: inc, ...(stepUp !== inc ? { linearStep: stepUp } : {}) };
  const rule = `progression.${input.rule?.rule ?? 'double'}`;

  const loading = history.filter((h) => !h.deload);
  const logged = loading.filter((h) => h.sets.length > 0);
  const last = logged.at(-1);

  if (!last) {
    const performed = history.length > 0;
    const target: ProgressionTarget = {
      action: performed ? 'no-data' : 'start',
      weight: null,
      unit,
      reps: lo,
      rir: deload ? targetRir + PROGRESSION.deloadRirAdd : targetRir,
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
    const w = roundToStep(base * PROGRESSION.deloadFactor, inc);
    return explain(make('deload', w, lo, targetRir + PROGRESSION.deloadRirAdd), rule, inputs, {
      threshold: { ...threshold, deloadFactor: PROGRESSION.deloadFactor, deloadRirAdd: PROGRESSION.deloadRirAdd },
      note: joinNotes(
        `Deload week: ${w} ${unit} x ${lo}, about 10 % under the last loading session (${base} ${unit}), RIR +${PROGRESSION.deloadRirAdd}.`,
        assumption,
      ),
    });
  }

  const miss = (h: ExerciseSession) => judged(h).sets.some((s) => s.reps < lo);
  const prev = logged.at(-2);
  if (prev && miss(last) && miss(prev)) {
    let w = roundToStep(base * PROGRESSION.lighterFactor, inc);
    if (w >= base) w = Math.max(0, Number((base - inc).toFixed(6))); // the step is too coarse for 10 %
    const drop = base > 0 ? 1 - w / base : 0;
    const [bandLo, bandHi] = PROGRESSION.lighterBand;
    return explain(make('lighter', w, lo), rule, { ...inputs, previous: summary(prev, exercise), drop }, {
      threshold: { ...threshold, lighterFactor: PROGRESSION.lighterFactor, lighterBand: PROGRESSION.lighterBand },
      note: joinNotes(
        `Two sessions in a row under ${lo} reps: ${w} ${unit} x ${lo}, ${(drop * 100).toFixed(1)} % lighter.`,
        (drop < bandLo - 1e-9 || drop > bandHi + 1e-9) &&
          `The ${inc} ${unit} step makes this outside 5-10 %; a wider rep range lets reps carry the progress.`,
        assumption,
      ),
    });
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

  const target = Math.min(hi, Math.max(lo, Math.min(...reps) + 1));
  return explain(make('add-reps', base, target), rule, inputs, {
    threshold,
    note: joinNotes(`Inside the range: ${base} ${unit} x ${target}, one more rep.`, assumption, unreliable),
  });
}
