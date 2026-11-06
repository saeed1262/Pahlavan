// Safety gates. These live in the engine (not in the skill's advice) and are
// never gated by Pro (features.ts). Wellness wording throughout: describe what
// was reported, never name a cause or a condition.
//
// - Screening: the outcome from the intake answers (intake.md) and its caps.
// - Red flags: stop and refer.
// - The Ledger: abdominal-strain (IAP) tags and movement constraints, with swaps.
// - Load jumps: one increment per session, about 10 % a week (rules.md).

import { RED_FLAGS, REFERRAL, WARNING_SIGNS, type RedFlag, type RedFlagSeverity } from './data/red-flags.ts';
import { LOWER_BODY, UPPER_BODY } from './data/muscles.ts';
import { addDays, dayText, daysBetween, isIsoDate } from './dates.ts';
import type { ProgressionTarget } from './progression.ts';
import { explain, joinNotes, type Result } from './reason.ts';
import type { Exercise, IsoDate, LedgerConstraint, RiskTag, ScreeningOutcome, SessionTemplate, Unit } from './schema.ts';

type Catalogue = Readonly<Record<string, Exercise>>;

// ---------------------------------------------------------------- screening

export interface ScreeningAnswers {
  /** Planned exercise 3+ days a week, about 30 min, moderate effort or more, over the last 3 months. */
  regularExercise: boolean;
  /** A heart, metabolic or kidney condition: none, cleared for vigorous exercise in the last 12 months, or not cleared. */
  knownCondition: 'none' | 'cleared' | 'not-cleared';
  /** Ids from WARNING_SIGNS; an unknown id counts as a warning sign. */
  warningSigns: readonly string[];
  under18?: boolean;
  pregnantOrPostpartum?: boolean;
  /** A clinician cleared training after pregnancy (then Conservative unless they say otherwise). */
  pregnancyCleared?: boolean;
  /** A new diagnosis, medication, surgery or injury since the last screening. */
  healthChange?: boolean;
}

export interface ScreeningResult {
  outcome: ScreeningOutcome;
  coached: boolean;
  referral: string | null;
  rescreen: boolean;
}

const STRICTNESS: Record<ScreeningOutcome, number> = { go: 0, 'go-ramped': 1, conservative: 2, blocked: 3 };
const stricter = (a: ScreeningOutcome, b: ScreeningOutcome) => (STRICTNESS[a] >= STRICTNESS[b] ? a : b);

/** intake.md's outcome table, from the four screening answers. */
export function screeningOutcome(a: ScreeningAnswers): Result<ScreeningResult> {
  const inputs = { ...a, warningSigns: [...a.warningSigns] };
  const known = new Set(WARNING_SIGNS.map((w) => w.id));
  const unknownSigns = a.warningSigns.filter((s) => !known.has(s));
  const rule = 'safety.screening';

  if (a.under18) {
    return explain<ScreeningResult>({ outcome: 'blocked', coached: false, referral: null, rescreen: false }, rule, inputs, {
      note: 'Under 18: not coached.',
    });
  }
  if (a.warningSigns.length > 0) {
    return explain<ScreeningResult>({ outcome: 'blocked', coached: true, referral: REFERRAL.plan, rescreen: false }, rule, inputs, {
      note: joinNotes(
        'A warning sign: stop exercise and see a clinician before training again. Logging only.',
        unknownSigns.length > 0 && `Unknown warning-sign id(s) treated as warning signs: ${unknownSigns.join(', ')}.`,
      ),
    });
  }

  let outcome: ScreeningOutcome;
  if (a.regularExercise) outcome = a.knownCondition === 'not-cleared' ? 'conservative' : 'go';
  else outcome = a.knownCondition === 'none' ? 'go-ramped' : a.knownCondition === 'cleared' ? 'conservative' : 'blocked';
  const notes: (string | false)[] = [];
  if (a.pregnantOrPostpartum) {
    outcome = stricter(outcome, a.pregnancyCleared ? 'conservative' : 'blocked');
    notes.push(a.pregnancyCleared ? 'Pregnant or postpartum and cleared: Conservative unless the clinician says otherwise.' : 'Pregnant or postpartum: referred to their clinician; no plan until cleared.');
  }
  notes.push(
    outcome === 'go' && 'Go: the normal plan.',
    outcome === 'go-ramped' && 'Go, ramped: light to moderate effort (RIR 3 or more) for the first mesocycle.',
    outcome === 'conservative' && 'Conservative: full body only, RIR 4 or more, no vigorous work, no max tests, no calibration sets to failure.',
    outcome === 'blocked' && 'Blocked until cleared: logging only.',
    a.healthChange === true && 'A health change since the last screening: these answers are the re-run.',
  );
  return explain<ScreeningResult>(
    { outcome, coached: true, referral: outcome === 'blocked' || outcome === 'conservative' ? REFERRAL.plan : null, rescreen: a.healthChange === true },
    rule,
    inputs,
    { threshold: 'intake.md outcome table', note: joinNotes(...notes) },
  );
}

/** Re-screen every 12 months (the date a year on; 29 February maps to 1 March). */
export function screeningDue(screened: IsoDate, today: IsoDate): Result<boolean> {
  const year = Number(screened.slice(0, 4)) + 1;
  let due = `${year}${screened.slice(4)}`;
  if (!isIsoDate(due)) due = addDays(`${year}-02-28`, 1); // 29 February
  const value = today >= due;
  return explain(value, 'safety.screening-due', { screened, today, due }, {
    threshold: { months: 12 },
    note: value ? `Screened ${screened}: re-screen now (due ${due}).` : `Re-screen by ${due}.`,
  });
}

export interface ScreeningCaps {
  /** False: no plan and no progression advice (logging only). */
  prescribe: boolean;
  minRir: number | null;
  fullBodyOnly: boolean;
  vigorous: boolean;
  maxTests: boolean;
  calibrationToFailure: boolean;
}

export function screeningCaps(outcome: ScreeningOutcome, opts: { firstMesocycle?: boolean } = {}): Result<ScreeningCaps> {
  const first = opts.firstMesocycle === true;
  const caps: ScreeningCaps =
    outcome === 'go'
      ? { prescribe: true, minRir: null, fullBodyOnly: false, vigorous: true, maxTests: true, calibrationToFailure: true }
      : outcome === 'go-ramped'
        ? first
          ? { prescribe: true, minRir: 3, fullBodyOnly: false, vigorous: false, maxTests: false, calibrationToFailure: false }
          : { prescribe: true, minRir: null, fullBodyOnly: false, vigorous: true, maxTests: true, calibrationToFailure: true }
        : outcome === 'conservative'
          ? { prescribe: true, minRir: 4, fullBodyOnly: true, vigorous: false, maxTests: false, calibrationToFailure: false }
          : { prescribe: false, minRir: null, fullBodyOnly: false, vigorous: false, maxTests: false, calibrationToFailure: false };
  return explain(caps, 'safety.screening-caps', { outcome, firstMesocycle: first }, {
    note: {
      go: 'No extra limits.',
      'go-ramped': first ? 'First mesocycle: light to moderate effort, RIR 3 or more; no vigorous work, max tests or sets to failure yet.' : 'Past the first mesocycle: no extra limits.',
      conservative: 'Full body only, RIR 4 or more, no vigorous work, no max tests, no calibration sets to failure.',
      blocked: 'Logging only: no plan and no progression advice until a clinician clears it.',
    }[outcome],
  });
}

/** A plan to be checked before it reaches the user. */
export interface Prescription {
  sessions: SessionTemplate[];
  conditioning: { id: string; minutes: number; vigorous: boolean; note?: string }[];
  maxTests: boolean;
  calibrationToFailure: boolean;
}

export interface ScreenedPrescription {
  /** Null when blocked, or when the plan breaks a cap the gate cannot fix (a split session under Conservative). */
  prescription: Prescription | null;
  changes: string[];
  violations: string[];
}

function regions(t: SessionTemplate, exercises: Catalogue): { lower: boolean; upper: boolean } {
  const main = t.slots.flatMap((s) => exercises[s.exercise]?.muscles?.main ?? []);
  return { lower: main.some((m) => LOWER_BODY.includes(m)), upper: main.some((m) => UPPER_BODY.includes(m)) };
}

/** Applies the screening outcome's caps to a prescription. */
export function applyScreening(
  p: Prescription,
  outcome: ScreeningOutcome,
  opts: { exercises: Catalogue; firstMesocycle?: boolean },
): Result<ScreenedPrescription> {
  const caps = screeningCaps(outcome, opts.firstMesocycle === undefined ? {} : { firstMesocycle: opts.firstMesocycle }).value;
  const rule = 'safety.apply-screening';
  const inputs = { outcome, firstMesocycle: opts.firstMesocycle ?? false, sessions: p.sessions.map((s) => s.id) };
  if (!caps.prescribe) {
    return explain<ScreenedPrescription>({ prescription: null, changes: [], violations: [] }, rule, inputs, {
      threshold: caps,
      note: `Blocked: no prescription, logging only. ${REFERRAL.plan}`,
    });
  }

  const changes: string[] = [];
  const violations: string[] = [];
  const sessions = p.sessions.map((t) => ({
    ...t,
    slots: t.slots.map((s) => {
      if (caps.minRir !== null && s.rir < caps.minRir) {
        changes.push(`${t.name}: ${opts.exercises?.[s.exercise]?.name ?? s.exercise}, RIR ${s.rir} -> ${caps.minRir}`);
        return { ...s, rir: caps.minRir };
      }
      return s;
    }),
  }));
  if (caps.fullBodyOnly) {
    for (const t of sessions) {
      if (t.kind !== 'lift' && t.kind !== 'express') continue;
      const r = regions(t, opts.exercises);
      if (!(r.lower && r.upper)) violations.push(`${t.id} is not full body (${r.lower ? 'lower' : r.upper ? 'upper' : 'no tagged'} muscles only)`);
    }
  }
  const conditioning = p.conditioning.map((c) => {
    if (c.vigorous && !caps.vigorous) {
      changes.push(`${c.id}: vigorous -> easy, same minutes`);
      return { ...c, vigorous: false };
    }
    return c;
  });
  let maxTests = p.maxTests;
  let calibrationToFailure = p.calibrationToFailure;
  if (maxTests && !caps.maxTests) {
    maxTests = false;
    changes.push('max tests removed');
  }
  if (calibrationToFailure && !caps.calibrationToFailure) {
    calibrationToFailure = false;
    changes.push('calibration set to failure removed');
  }

  const ok = violations.length === 0;
  return explain<ScreenedPrescription>(
    { prescription: ok ? { sessions, conditioning, maxTests, calibrationToFailure } : null, changes, violations },
    rule,
    inputs,
    {
      threshold: caps,
      note: joinNotes(
        changes.length === 0 && ok && 'Within the caps: unchanged.',
        changes.length > 0 && `${changes.length} change(s) to fit the ${outcome} caps.`,
        !ok && `Not usable under ${outcome}: ${violations.join('; ')}. Re-plan as full-body sessions.`,
      ),
    },
  );
}

/** A progression target under the screening caps: no advice when blocked; RIR raised to the floor. */
export function capTarget(
  target: ProgressionTarget,
  outcome: ScreeningOutcome,
  opts: { firstMesocycle?: boolean } = {},
): Result<ProgressionTarget | null> {
  const caps = screeningCaps(outcome, opts).value;
  const inputs = { outcome, target };
  if (!caps.prescribe) {
    return explain<ProgressionTarget | null>(null, 'safety.cap-target', inputs, { threshold: caps, note: 'Blocked: logging only, no progression advice.' });
  }
  if (caps.minRir !== null && target.rir < caps.minRir) {
    return explain<ProgressionTarget | null>({ ...target, rir: caps.minRir }, 'safety.cap-target', inputs, {
      threshold: caps,
      note: `RIR raised from ${target.rir} to ${caps.minRir} (${outcome}). If ${target.reps} reps no longer leave ${caps.minRir} in reserve, take weight off.`,
    });
  }
  return explain<ProgressionTarget | null>(target, 'safety.cap-target', inputs, { threshold: caps });
}

// ---------------------------------------------------------------- red flags

export interface RedFlagCheck {
  stop: boolean;
  severity: RedFlagSeverity | null;
  flags: RedFlag[];
  /** Ids not in the list: treated as stop and refer. */
  unknown: string[];
  message: string | null;
}

/** Any red flag stops coaching for the session; emergencies lead with the urgent line. */
export function checkRedFlags(ids: readonly string[]): Result<RedFlagCheck> {
  const flags = RED_FLAGS.filter((f) => ids.includes(f.id));
  const unknown = ids.filter((id) => !RED_FLAGS.some((f) => f.id === id));
  const emergency = flags.some((f) => f.severity === 'emergency');
  const stop = flags.length > 0 || unknown.length > 0;
  const severity: RedFlagSeverity | null = emergency ? 'emergency' : stop ? 'stop-and-refer' : null;
  const message = emergency ? `${REFERRAL.emergency} ${REFERRAL.plan}` : stop ? `${REFERRAL.stop} ${REFERRAL.plan}` : null;
  return explain<RedFlagCheck>({ stop, severity, flags, unknown, message }, 'safety.red-flags', { ids: [...ids] }, {
    threshold: 'intake.md red-flag list',
    note: joinNotes(
      stop ? `${REFERRAL.describe} Coaching stops for this session.` : 'No red flags.',
      unknown.length > 0 && `Unknown id(s) treated as stop and refer: ${unknown.join(', ')}.`,
    ),
  });
}

// ---------------------------------------------------------------- the Ledger and IAP tags

export type IapLevel = 'low' | 'moderate' | 'high';
const IAP_ORDER: Record<IapLevel, number> = { low: 0, moderate: 1, high: 2 };

/** The exercise's abdominal-strain tag, or null when it has none. */
export function iapLevel(exercise: { risk?: readonly RiskTag[] } | undefined): IapLevel | null {
  const tag = exercise?.risk?.find((r) => r.startsWith('abdomen-'));
  return tag ? (tag.slice('abdomen-'.length) as IapLevel) : null;
}

export type { LedgerConstraint };

export interface ExerciseScreen {
  exercise: string;
  allowed: boolean;
  iap: IapLevel | null;
  blockedBy: string[];
  /** How to do it when allowed under an active abdominal constraint. */
  conditions: string[];
  /** When blocked: allowed exercises sharing a main muscle with a lower risk tag, best first. */
  swaps: string[];
  /** When blocked: the last day of the block (the latest `until` of its constraints), null when one has no end date. */
  blockedUntil?: IsoDate | null;
}

const active = (c: LedgerConstraint, today: IsoDate) => c.until === undefined || today <= c.until;

function blockers(id: string, ex: Exercise | undefined, constraints: readonly LedgerConstraint[], today: IsoDate): LedgerConstraint[] {
  return constraints.filter(
    (c) => active(c, today) && ((c.noMovements ?? []).includes(id) || (ex?.risk ?? []).some((r) => (c.noTags ?? []).includes(r))),
  );
}

/**
 * Screens one exercise against the Ledger. With an active constraint against
 * high abdominal strain, a moderate exercise stays allowed with conditions
 * (rules.md, IAP table). A blocked exercise gets swaps: allowed exercises that
 * share a main muscle and carry a lower abdominal-strain tag (an equal one
 * when only the movement itself was ruled out), the plan's own swaps first.
 */
export function screenExercise(
  id: string,
  constraints: readonly LedgerConstraint[],
  today: IsoDate,
  exercises: Catalogue,
  opts: { swaps?: readonly string[] } = {},
): Result<ExerciseScreen> {
  const ex = exercises[id];
  const iap = iapLevel(ex);
  const live = constraints.filter((c) => active(c, today));
  const expired = constraints.filter((c) => !active(c, today)).map((c) => c.id);
  const rule = 'safety.ledger';
  const inputs = { exercise: id, iap, today, constraints: live.map((c) => c.id), expired };

  if (!ex) {
    return explain<ExerciseScreen>({ exercise: id, allowed: false, iap: null, blockedBy: [], conditions: [], swaps: [] }, rule, inputs, {
      note: `Unknown exercise ${id}: not screened, so not allowed.`,
    });
  }
  const by = blockers(id, ex, constraints, today);
  const highBlocked = live.some((c) => (c.noTags ?? []).includes('abdomen-high'));
  const conditions = by.length === 0 && highBlocked && iap === 'moderate' ? ['breathe out on the effort; never hold the breath', 'keep 2 or more reps in reserve'] : [];

  let swaps: string[] = [];
  if (by.length > 0) {
    const tagBlocked = by.some((c) => (ex.risk ?? []).some((r) => (c.noTags ?? []).includes(r)));
    const main = new Set(ex.muscles?.main ?? []);
    const helps = new Set(ex.muscles?.helps ?? []);
    const preferred = opts.swaps ?? [];
    const ranked = Object.entries(exercises)
      .filter(([cid, c]) => {
        if (cid === id || (c.kind ?? 'strength') !== 'strength') return false;
        const lvl = iapLevel(c);
        if (lvl === null || iap === null) return false;
        if (tagBlocked ? IAP_ORDER[lvl] >= IAP_ORDER[iap] : IAP_ORDER[lvl] > IAP_ORDER[iap]) return false;
        if (!(c.muscles?.main ?? []).some((m) => main.has(m))) return false;
        return blockers(cid, c, constraints, today).length === 0;
      })
      .map(([cid, c]) => ({
        id: cid,
        pref: preferred.includes(cid) ? 0 : 1,
        shared: (c.muscles?.main ?? []).filter((m) => main.has(m)).length,
        risk: IAP_ORDER[iapLevel(c)!],
        helps: (c.muscles?.helps ?? []).filter((m) => helps.has(m)).length,
      }))
      .sort((a, b) => a.pref - b.pref || b.shared - a.shared || a.risk - b.risk || b.helps - a.helps || (a.id < b.id ? -1 : 1));
    swaps = ranked.map((r) => r.id);
  }

  return explain<ExerciseScreen>(
    { exercise: id, allowed: by.length === 0, iap, blockedBy: by.map((c) => c.id), conditions, swaps, ...(by.length ? { blockedUntil: by.every((c) => c.until) ? by.map((c) => c.until!).sort().at(-1)! : null } : {}) },
    rule,
    inputs,
    {
      threshold: { swaps: 'shares a main muscle; lower abdominal-strain tag' },
      note: joinNotes(
        by.length > 0 && `${ex.name} is ruled out by ${by.map((c) => `${c.id}${c.until ? ` (through ${dayText(c.until)})` : ''}`).join(', ')}.`,
        by.length > 0 && (swaps.length ? `Swaps: ${swaps.map((x) => exercises[x]?.name ?? x).join(', ')}.` : 'No swap in the catalogue shares a main muscle with a lower tag.'),
        conditions.length > 0 && `Allowed with an active abdominal constraint: ${conditions.join('; ')}.`,
        iap === null && 'No abdominal-strain tag: tag-based constraints cannot judge it.',
        expired.length > 0 && `Expired, not applied: ${expired.join(', ')} (a high-strain lift returns at deload loads).`,
      ),
    },
  );
}

// ---------------------------------------------------------------- load jumps

export const LOAD_CAP = {
  /** At most one increment per session. */
  perSession: 1,
  /** Never more than about 10 % over a rolling 7 days. */
  maxWeekFraction: 0.1,
  windowDays: 7,
} as const;

export type LoadCapBinding = 'none' | 'session' | 'week' | 'big-jump-repeat';

export interface LoadCap {
  weight: number;
  capped: boolean;
  /** The highest allowed weight, or null with no history to compare against. */
  limit: number | null;
  /** The increase is one step that is itself more than 10 % (light dumbbells). */
  bigJump: boolean;
  binding: LoadCapBinding;
}

export interface LoadCapInput {
  proposed: number;
  /** The date of the session the weight is for. */
  date: IsoDate;
  /** This exercise's top-set weights in its own unit, oldest first; the last is the latest session. */
  history: readonly { date: IsoDate; weight: number }[];
  exercise: { unit: Unit; increment: number };
}

const EPS = 1e-9;
const isBig = (from: number, to: number) => to - from > LOAD_CAP.maxWeekFraction * from + EPS;

/**
 * The load-jump cap (rules.md, Progression): at most one increment per session
 * and never more than about 10 % across the exercise's sessions in a rolling
 * 7 days (the proposed session and the 6 days before it). When one increment
 * is itself over 10 % (light dumbbells), that one increment is still allowed,
 * flagged as a big jump, but never twice within 7 days. A capped weight is
 * rounded down to the step and never goes below the last weight. Progression
 * applies it to every target that adds weight; other proposers should call it.
 */
export function capLoadJump(input: LoadCapInput): Result<LoadCap> {
  const { proposed, date, history, exercise } = input;
  const inc = exercise.increment;
  const rule = 'safety.load-cap';
  const threshold = { perSession: `one step (${inc} ${exercise.unit})`, perWeek: `${LOAD_CAP.maxWeekFraction * 100} % over ${LOAD_CAP.windowDays} days` };
  const last = history.at(-1);
  if (!last) {
    return explain<LoadCap>({ weight: proposed, capped: false, limit: null, bigJump: false, binding: 'none' }, rule, { proposed, date, sessions: 0 }, {
      threshold,
      note: 'No earlier session to compare with.',
    });
  }
  const inWindow = (d: IsoDate) => {
    const gap = daysBetween(d, date);
    return gap >= 0 && gap < LOAD_CAP.windowDays;
  };
  const recent = history.filter((h) => inWindow(h.date));
  const ref = recent.length ? Math.min(...recent.map((h) => h.weight)) : last.weight;
  const sessionLimit = Number((last.weight + inc).toFixed(6));
  const weekLimit = Number((ref * (1 + LOAD_CAP.maxWeekFraction)).toFixed(6));
  const bigStep = isBig(last.weight, last.weight + inc);
  const earlierBig = history.some((h, i) => i > 0 && inWindow(h.date) && isBig(history[i - 1]!.weight, h.weight));

  let limit: number;
  let binding: LoadCapBinding;
  if (bigStep) {
    limit = earlierBig ? last.weight : sessionLimit;
    binding = earlierBig ? 'big-jump-repeat' : 'session';
  } else {
    limit = Math.min(sessionLimit, weekLimit);
    binding = weekLimit < sessionLimit ? 'week' : 'session';
  }
  const capped = proposed > limit + EPS;
  let weight = proposed;
  if (capped) {
    weight = Number((Math.floor(limit / inc + EPS) * inc).toFixed(6));
    if (weight < last.weight) weight = last.weight;
  }
  const bigJump = weight > last.weight + EPS && isBig(last.weight, weight);
  return explain<LoadCap>(
    { weight, capped, limit, bigJump, binding: capped ? binding : 'none' },
    rule,
    { proposed, date, last, weekReference: ref, sessionsInWindow: recent.length, unit: exercise.unit, increment: inc },
    {
      threshold,
      note: joinNotes(
        capped && binding === 'session' && `${proposed} ${exercise.unit} is more than one step over ${last.weight}: capped at ${weight}.`,
        capped && binding === 'week' && `${proposed} ${exercise.unit} would be more than 10 % over ${ref} within 7 days: capped at ${weight}.`,
        capped && binding === 'big-jump-repeat' && `A big jump already happened within 7 days: hold ${weight} ${exercise.unit}.`,
        bigJump && `One step is more than 10 % of the load (a big jump): start at the bottom of the range.`,
      ),
    },
  );
}
