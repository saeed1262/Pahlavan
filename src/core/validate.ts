// A small hand-written validator for the schema v1 shapes. Each validate*
// function returns a list of errors (empty when the value is valid). Unknown
// keys are errors, except keys starting with "_" (comments, like the vault's
// "_about"). Every object shape is named and its keys are listed in
// SHAPE_KEYS, which a test compares with schema/pahlavan.v1.schema.json.

import { PATTERNS } from './data/exercises.ts';
import { isIsoDate, mondayOf } from './dates.ts';
import { MORNING_KEYS, MORNING_LIMITS, type MorningKey } from './morning.ts';
import { explain, type Result } from './reason.ts';
import { LB_PER_KG } from './units.ts';
import {
  INBOX_KINDS,
  INBOX_VERSION,
  TRAINED_ANSWERS,
  type InboxKind,
  type InboxMorningFields,
  ABDOMEN_RISK,
  CONFIDENCE,
  DAY_MARKS,
  EMPHASIS_KINDS,
  EXERCISE_KINDS,
  EXPERIENCE,
  GOAL_KINDS,
  SCHEMA_VERSION,
  SCREENING_OUTCOMES,
  BAD_WEEK_KINDS,
  SPLIT_KINDS,
  SESSION_KINDS,
  TRACKING_LEVELS,
  UNITS,
  WEEKDAYS,
  WEEK_KINDS,
  PROGRESSION_RULES,
  BUSY_KINDS,
  SORENESS_LEVELS,
  ITEM_KINDS,
  ITEM_SLOTS,
  SCHEDULE_KINDS,
  SUGGESTION_STATES,
  NUDGE_ANSWERS,
  EATING_LEVELS,
  COUNTING,
  HAND_KINDS,
  PATTERN_PERIODS,
  ADJUST_STEPS,
  REASON_SOURCES,
  SKIP_REASONS,
  type CheckinLog,
  type EatingPlan,
  type ItemDay,
  type NudgeState,
  type SittingLog,
  type TrackedItem,
  type Tracking,
  type Program,
  type Session,
  type WeeklyCheckin,
} from './schema.ts';

export interface ValidationError {
  path: string;
  message: string;
}

type Check = (value: unknown, path: string, errors: ValidationError[]) => void;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const at = (path: string, key: string | number) =>
  typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key;

function fail(errors: ValidationError[], path: string, message: string): void {
  errors.push({ path: path || '(root)', message });
}

// ---------------------------------------------------------------- checks

function str(opts: { pattern?: RegExp; nonEmpty?: boolean } = {}): Check {
  return (v, p, e) => {
    if (typeof v !== 'string') return fail(e, p, 'expected a string');
    if (opts.nonEmpty && v.trim() === '') return fail(e, p, 'must not be empty');
    if (opts.pattern && !opts.pattern.test(v)) fail(e, p, `does not match ${opts.pattern}`);
  };
}

function num(opts: { min?: number; max?: number; above?: number; int?: boolean } = {}): Check {
  return (v, p, e) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fail(e, p, 'expected a finite number');
    if (opts.int && !Number.isInteger(v)) fail(e, p, 'expected a whole number');
    if (opts.min !== undefined && v < opts.min) fail(e, p, `must be at least ${opts.min}`);
    if (opts.above !== undefined && v <= opts.above) fail(e, p, `must be above ${opts.above}`);
    if (opts.max !== undefined && v > opts.max) fail(e, p, `must be at most ${opts.max}`);
  };
}

const bool: Check = (v, p, e) => {
  if (typeof v !== 'boolean') fail(e, p, 'expected true or false');
};

const date: Check = (v, p, e) => {
  if (!isIsoDate(v)) fail(e, p, 'expected a date as YYYY-MM-DD');
};

function oneOf(values: readonly string[]): Check {
  return (v, p, e) => {
    if (typeof v !== 'string' || !values.includes(v)) fail(e, p, `expected one of: ${values.join(', ')}`);
  };
}

function arr(item: Check, opts: { min?: number } = {}): Check {
  return (v, p, e) => {
    if (!Array.isArray(v)) return fail(e, p, 'expected a list');
    if (opts.min !== undefined && v.length < opts.min) fail(e, p, `needs at least ${opts.min} item(s)`);
    v.forEach((x, i) => item(x, at(p, i), e));
  };
}

const shapeKeys: Record<string, { required: readonly string[]; optional: readonly string[] }> = {};

/** The required and optional keys of every named object shape. */
export const SHAPE_KEYS: Readonly<Record<string, { required: readonly string[]; optional: readonly string[] }>> = shapeKeys;

/** A named object shape; the name is its `$defs` entry in the JSON Schema. */
function shape(name: string, required: Record<string, Check>, optional: Record<string, Check> = {}): Check {
  shapeKeys[name] = { required: Object.keys(required), optional: Object.keys(optional) };
  return (v, p, e) => {
    if (!isObject(v)) return fail(e, p, 'expected an object');
    for (const [k, check] of Object.entries(required)) {
      if (v[k] === undefined) fail(e, at(p, k), 'is required');
      else check(v[k], at(p, k), e);
    }
    for (const [k, x] of Object.entries(v)) {
      if (k in required || k.startsWith('_')) continue;
      const check = optional[k];
      if (!check) fail(e, at(p, k), 'unknown key');
      else if (x !== undefined) check(x, at(p, k), e);
    }
  };
}

function record(value: Check, keyPattern?: RegExp): Check {
  return (v, p, e) => {
    if (!isObject(v)) return fail(e, p, 'expected an object');
    for (const [k, x] of Object.entries(v)) {
      if (keyPattern && !keyPattern.test(k)) fail(e, at(p, k), `key does not match ${keyPattern}`);
      value(x, at(p, k), e);
    }
  };
}

/** Runs `check`, then `extra` only if `check` found nothing. */
function then(check: Check, extra: (v: unknown, p: string, e: ValidationError[]) => void): Check {
  return (v, p, e) => {
    const before = e.length;
    check(v, p, e);
    if (e.length === before) extra(v, p, e);
  };
}

const version: Check = (v, p, e) => {
  if (v !== SCHEMA_VERSION) fail(e, p, `expected schema version ${SCHEMA_VERSION}, found ${JSON.stringify(v)}`);
};

// ---------------------------------------------------------------- shapes

const ID = /^[a-z0-9][a-z0-9-]*$/;
const id = str({ pattern: ID });
const text = str({ nonEmpty: true });
const unit = oneOf(UNITS);
const scale5 = num({ min: 1, max: 5 });
const rir = num({ min: 0 });

const repRange: Check = then(arr(num({ min: 1, int: true })), (v, p, e) => {
  const r = v as number[];
  if (r.length !== 2) fail(e, p, 'expected [lo, hi]');
  else if (r[0]! > r[1]!) fail(e, p, 'the low end is above the high end');
});

const dropRange: Check = then(arr(num({ min: 0 })), (v, p, e) => {
  const r = v as number[];
  if (r.length !== 2) fail(e, p, 'expected [lo, hi]');
  else if (r[0]! > r[1]!) fail(e, p, 'the low end is above the high end');
});

const riskTag: Check = (v, p, e) => {
  const ok = typeof v === 'string' && ((ABDOMEN_RISK as readonly string[]).includes(v) || /^joint:[a-z][a-z-]*$/.test(v));
  if (!ok) fail(e, p, `expected ${ABDOMEN_RISK.join(', ')} or joint:<name>`);
};

const rateBand = then(shape('rateBand', { unit: oneOf(['pct', 'kg']), lo: num(), hi: num() }), (v, p, e) => {
  const b = v as { lo: number; hi: number };
  if (b.lo > b.hi) fail(e, p, 'lo is above hi');
});

const goal = shape(
  'goal',
  { id, kind: oneOf(GOAL_KINDS), label: text, importance: num({ min: 0, max: 10 }), confidence: num({ min: 0, max: 10 }) },
  { measure: str(), rateBand },
);

const profileShape = shape(
  'profile',
  {
    schemaVersion: version,
    units: shape('units', { load: unit, body: unit }),
    goals: arr(goal),
    availability: then(shape(
      'availability',
      { daysPerWeek: num({ min: 0, max: 7, int: true }), minutesPerSession: num({ min: 0 }) },
      {
        shortSessions: shape('shortSessions', { days: num({ min: 1, max: 7, int: true }), minutes: num({ above: 0 }) }),
        fixedDays: arr(oneOf(WEEKDAYS)),
        busy: arr(shape('busyPeriod', { from: date, to: date }, { note: str() })),
        note: str(),
      },
    ), (v, p, e) => {
      const a = v as { daysPerWeek: number; minutesPerSession: number; shortSessions?: { days: number; minutes: number } };
      if (a.shortSessions && a.shortSessions.days >= a.daysPerWeek) fail(e, at(p, 'shortSessions.days'), 'must be fewer than daysPerWeek (when every day is short, set minutesPerSession instead)');
      if (a.shortSessions && a.shortSessions.minutes >= a.minutesPerSession) fail(e, at(p, 'shortSessions.minutes'), 'must be under minutesPerSession');
    }),
    equipment: arr(str()),
    trackingLevel: oneOf(TRACKING_LEVELS),
    screening: shape('screening', { outcome: oneOf(SCREENING_OUTCOMES), date }, { limits: arr(str()) }),
    emphasis: arr(
      shape(
        'emphasis',
        { area: text, seen: text, confidence: oneOf(CONFIDENCE), emphasis: text },
        { kind: oneOf(EMPHASIS_KINDS), side: oneOf(['left', 'right']), muscles: arr(str()) },
      ),
    ),
  },
  {
    basics: shape(
      'basics',
      {},
      { birthYear: num({ min: 1900, int: true }), heightCm: num({ above: 0 }), sex: oneOf(['male', 'female']) },
    ),
    priorityMuscles: arr(str()),
    travelEquipment: arr(str()),
    experience: oneOf(EXPERIENCE),
    preferences: shape('preferences', {}, {
      likes: arr(id),
      dislikes: arr(id),
      cardio: arr(id),
      splits: shape('splitPreferences', {}, { likes: arr(oneOf(SPLIT_KINDS)), dislikes: arr(oneOf(SPLIT_KINDS)) }),
    }),
    selfCheck: shape('selfCheck', { date }, {
      sitToStand: shape('sitToStand', { easy: bool, heelsDown: bool }),
      pushUps: num({ min: 0, int: true }),
      deadHangS: num({ min: 0 }),
      pullUps: num({ min: 0, int: true }),
      coreHold: shape('coreHold', { kind: oneOf(['plank', 'hollow']), seconds: num({ min: 0 }) }),
      hingeFlatBack: bool,
      overheadReach: then(shape('overheadReach', { clean: bool }, { ribFlare: bool, lowBackArch: bool }), (v, p, e) => {
        const r = v as { clean: boolean; ribFlare?: boolean; lowBackArch?: boolean };
        if (r.clean && (r.ribFlare || r.lowBackArch)) fail(e, p, 'a clean reach has no rib flare or low-back arch');
      }),
      wallGapCm: num({ min: 0 }),
      balanceS: shape('balance', { left: num({ min: 0 }), right: num({ min: 0 }) }),
    }),
    badWeek: shape('badWeek', { usually: arr(oneOf(BAD_WEEK_KINDS)) }, { note: str() }),
    useHistory: bool,
    rirCalibration: arr(shape('rirCalibration', { exercise: id, date, predicted: rir, actual: rir })),
    work: shape('deskWork', { desk: bool }, { sittingHours: num({ min: 0, max: 24 }) }),
    targets: shape('targets', {}, {
      by: date,
      waistDropCm: dropRange,
      weightDropKg: dropRange,
      rhrDropBpm: dropRange,
      stepsPerDay: num({ above: 0 }),
      sleepHours: num({ above: 0, max: 24 }),
      tests: record(num({ min: 0 })),
    }),
  },
);

const temporaryChange = shape(
  'temporaryChange',
  { until: date, reason: text },
  { exercise: id, sets: num({ min: 0, int: true }), repRange, rir, note: str() },
);

const slot = shape(
  'slot',
  { exercise: id, sets: num({ min: 1, int: true }), repRange, rir },
  {
    swaps: arr(id),
    risk: arr(riskTag),
    until: temporaryChange,
    main: bool,
    progression: shape('slotProgression', { rule: oneOf(PROGRESSION_RULES) }, { step: num({ above: 0 }), next: id, ladder: id, level: num({ min: 1, int: true }) }),
    note: str(),
    pair: bool,
  },
);

const template = shape('sessionTemplate', { id, name: text, kind: oneOf(SESSION_KINDS), slots: arr(slot) });

const week = shape(
  'week',
  { index: num({ min: 1, int: true }), kind: oneOf(WEEK_KINDS), start: date, sessions: arr(template) },
  { calibration: bool, tests: bool },
);

const exercise = then(
  shape(
    'exercise',
    { name: text },
    {
      pattern: oneOf(PATTERNS),
      unit,
      increment: num({ above: 0 }),
      muscles: shape('muscleTags', { main: arr(str()), helps: arr(str()) }),
      kind: oneOf(EXERCISE_KINDS),
      risk: arr(riskTag),
      equipment: str(),
    },
  ),
  (v, p, e) => {
    const x = v as { kind?: string; unit?: string; increment?: number };
    if ((x.kind ?? 'strength') === 'strength' && (x.unit === undefined || x.increment === undefined)) {
      fail(e, p, 'a strength exercise needs a unit and an increment');
    }
  },
);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const clock = str({ pattern: HHMM });
const deskStep = shape('deskStep', { name: text, dose: str() }, { how: str() });
const deskBreaksShape = shape(
  'deskBreaks',
  { steps: arr(deskStep, { min: 1 }), every: num({ min: 1, int: true }), from: clock, to: clock, minutes: num({ above: 0 }), days: arr(oneOf(WEEKDAYS), { min: 1 }) },
  { why: arr(shape('deskWhy', { what: text, from: text })) },
);

const programShape = shape(
  'program',
  {
    schemaVersion: version,
    id,
    name: text,
    exercises: record(exercise, ID),
    macrocycle: shape('macrocycle', {
      id,
      name: text,
      start: date,
      phases: arr(
        shape(
          'phase',
          { id, name: text, mesocycles: arr(shape('mesocycle', { id, name: text, weeks: arr(week, { min: 1 }) }), { min: 1 }) },
          { goal: str() },
        ),
        { min: 1 },
      ),
    }),
  },
  { priorityMuscles: arr(str()), deskBreaks: deskBreaksShape },
);

const loggedSet = shape('loggedSet', { weight: num({ min: 0 }), unit, reps: num({ min: 0, int: true }) }, { rir, pain: bool });

const planSnapshot = shape(
  'planSnapshot',
  { weekKind: oneOf(WEEK_KINDS), template: id, slots: arr(slot) },
  { program: id, phase: id, mesocycle: id, week: num({ min: 1, int: true }), kind: oneOf(SESSION_KINDS) },
);

const sessionPain = shape('sessionPain', { area: text, severity: num({ min: 0, max: 10 }) }, { exercise: str() });

const sessionShape = shape(
  'session',
  {
    id: text,
    date,
    trackingLevel: oneOf(TRACKING_LEVELS),
    exercises: arr(shape('exerciseLog', { exercise: id, sets: arr(loggedSet) }, { note: str() })),
  },
  {
    template: id,
    minutes: num({ min: 0 }),
    rpe: num({ min: 0, max: 10 }),
    skipped: arr(id),
    plan: planSnapshot,
    note: str(),
    pain: arr(sessionPain),
    hotel: bool,
    skipWhy: record(oneOf(SKIP_REASONS), ID),
  },
);

const logShape = shape('log', { schemaVersion: version, month: str({ pattern: /^\d{4}-(0[1-9]|1[0-2])$/ }), sessions: arr(sessionShape) });

const daily = shape(
  'dailyCheckin',
  { date },
  {
    sleepH: num({ min: 0, max: 24 }),
    sleepQ: scale5,
    energy: scale5,
    soreness: scale5,
    rhr: num({ min: 20, max: 250 }),
    illness: bool,
    steps: num({ min: 0, int: true }),
    floors: num({ min: 0, int: true }),
    trained: bool,
    mark: oneOf(DAY_MARKS),
    protein: bool,
    soreMuscles: record(oneOf(SORENESS_LEVELS), ID),
    note: str(),
  },
);

/** Either check passes (the first one's errors are reported when neither does). */
function either(a: Check, b: Check, accepts: (v: unknown) => 'a' | 'b'): Check {
  return (v, p, e) => (accepts(v) === 'a' ? a(v, p, e) : b(v, p, e));
}

const jointAche = shape('jointAche', { area: text, severity: num({ min: 0, max: 10 }) }, { exercise: str(), lingered: bool });
const busyPeriod = then(
  shape('knownBusy', { from: date, to: date, kind: oneOf(BUSY_KINDS) }, { sessions: num({ min: 0, int: true }), note: str() }),
  (v, p, e) => {
    const b = v as { from: string; to: string };
    if (b.from > b.to) fail(e, p, 'from is after to');
  },
);
const triageRecord = shape('triageRecord', { lift: text, step: num({ min: 1, max: 4, int: true }), date });
const unloggedSession = shape('unloggedSession', { date }, { type: str() });
const checkinDeload = shape('checkinDeload', {}, { cancelled: bool, reason: str(), trainedAtFullLoad: arr(date) });

const weekly = shape(
  'weeklyCheckin',
  {},
  {
    date,
    weekStart: date,
    weekOf: date,
    recovery: scale5,
    effort: num({ min: 1, max: 10 }),
    stress: scale5,
    enjoyment: scale5,
    energy: scale5,
    sleepQuality: scale5,
    jointAches: either(bool, arr(jointAche), (v) => (typeof v === 'boolean' ? 'a' : 'b')),
    rir: record(rir, ID),
    reportedRir: either(rir, record(rir), (v) => (typeof v === 'number' ? 'a' : 'b')),
    proteinDays: num({ min: 0, max: 7 }),
    proteinExtra: num({ min: 0, max: 7, int: true }),
    pattern: record(bool, ID),
    unloggedSessions: num({ min: 0, int: true }),
    confirmedUnlogged: arr(unloggedSession),
    restDays: arr(date),
    missedDays: arr(date),
    deload: checkinDeload,
    triage: arr(triageRecord),
    knownBusy: arr(busyPeriod),
    focusFollowed: bool,
    answers: record(str()),
    note: str(),
    notes: str(),
    letter: str(),
  },
);

/** The week's Monday of a weekly record: weekStart, or the first v1 weekOf. */
const weekMonday = (w: { weekStart?: string; weekOf?: string }) => w.weekStart ?? w.weekOf;

function weeklyExtras(w: WeeklyCheckin, path: string, errors: ValidationError[], record: boolean): void {
  const monday = weekMonday(w);
  if (!monday) fail(errors, path, record ? 'weekStart is required' : 'needs weekStart (or weekOf)');
  else if (mondayOf(monday) !== monday) fail(errors, at(path, w.weekStart ? 'weekStart' : 'weekOf'), 'must be a Monday');
  if (w.weekStart && w.weekOf && w.weekStart !== w.weekOf) fail(errors, at(path, 'weekOf'), 'differs from weekStart');
  if (record && !w.date) fail(errors, at(path, 'date'), 'is required');
  if (w.date && monday && w.date < monday) fail(errors, at(path, 'date'), 'is before the week it reviews');
  if (w.date) {
    const late = (d: string) => d > w.date!;
    (w.restDays ?? []).forEach((d, i) => late(d) && fail(errors, `${at(path, 'restDays')}[${i}]`, 'is after the check-in date'));
    (w.missedDays ?? []).forEach((d, i) => late(d) && fail(errors, `${at(path, 'missedDays')}[${i}]`, 'is after the check-in date'));
    (w.confirmedUnlogged ?? []).forEach((c, i) => late(c.date) && fail(errors, `${at(path, 'confirmedUnlogged')}[${i}].date`, 'is after the check-in date'));
    (w.deload?.trainedAtFullLoad ?? []).forEach((d, i) => {
      if (mondayOf(d) !== d) fail(errors, `${at(path, 'deload.trainedAtFullLoad')}[${i}]`, 'must be a Monday');
      else if (late(d)) fail(errors, `${at(path, 'deload.trainedAtFullLoad')}[${i}]`, 'is after the check-in date');
    });
  }
}

const checkinsShape = shape('checkins', { schemaVersion: version, daily: arr(daily), weekly: arr(weekly) });

const checkinLogShape = shape('checkinLog', { schemaVersion: version, checkins: arr(weekly) });

const bodyShape = shape('body', {
  schemaVersion: version,
  weights: arr(shape('weighIn', { date, weight: num({ above: 0 }), unit })),
  tape: arr(
    shape(
      'tapeEntry',
      { date, unit: oneOf(['cm', 'in']) },
      { waist: num({ above: 0 }), hips: num({ above: 0 }), chest: num({ above: 0 }), arm: num({ above: 0 }) },
    ),
  ),
  tests: arr(shape('testEntry', { date, results: record(num()) })),
  photos: arr(shape('photoSet', { date, poses: arr(text, { min: 1 }) }, { folder: str() })),
});

const ledgerShape = shape('ledger', {
  schemaVersion: version,
  constraints: arr(
    shape(
      'ledgerConstraint',
      { id },
      { area: str(), noTags: arr(riskTag), noMovements: arr(id), until: date, note: str() },
    ),
  ),
});

// ---------------------------------------------------------------- tracking, nudges, sitting

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const timestamp = str({ pattern: TIMESTAMP });
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const minutes = num({ min: 1, int: true });

const itemSchedule = shape('itemSchedule', { kind: oneOf(SCHEDULE_KINDS) }, { days: arr(oneOf(WEEKDAYS), { min: 1 }), n: num({ min: 1, int: true }), from: date });
const itemReminder = shape('itemReminder', {}, { at: clock, afterLog: bool, every: minutes, from: clock, to: clock, atMinutes: minutes, stretch: bool });
const itemSource = shape('itemSource', { by: oneOf(['coach', 'user']) }, { why: text, from: text, on: date });
const itemPause = shape('itemPause', { from: date }, { to: date });
const amountConfig = shape('amountConfig', { target: num({ above: 0 }), unit: text }, { quick: arr(num({ above: 0 })) });
const span2: Check = then(arr(clock), (v, p, e) => {
  const w = v as string[];
  if (w.length !== 2) fail(e, p, 'expected [from, to]');
  else if (w[0]! >= w[1]!) fail(e, p, 'from is not before to');
});
const standupConfig = shape(
  'standupConfig',
  {
    sitMinutes: minutes,
    standMinutes: minutes,
    snoozeMinutes: minutes,
    targetMinutes: minutes,
    pauseCalls: bool,
    activeOnly: bool,
    activeSeconds: num({ min: 1, int: true }),
    awayMinutes: minutes,
    standAwayMinutes: minutes,
  },
  { hours: span2, helper: text },
);
const sittingConfig = shape('sittingConfig', { limitMinutes: minutes, stretchMaxMinutes: minutes, awayMinutes: minutes });
const deskConfig = shape('deskConfig', { followPlan: bool, every: minutes, from: clock, to: clock, minutes: num({ above: 0 }) }, { steps: arr(deskStep, { min: 1 }) });
const itemVersion = shape('itemVersion', { until: date }, { schedule: itemSchedule, amount: amountConfig, standup: standupConfig, sitting: sittingConfig, desk: deskConfig });
const trackedItem = shape(
  'trackedItem',
  { id, kind: oneOf(ITEM_KINDS), name: text, schedule: itemSchedule, start: date, source: itemSource },
  {
    when: oneOf(ITEM_SLOTS),
    whenDetail: oneOf(['before', 'after']),
    reminder: itemReminder,
    pauses: arr(itemPause),
    habit: text,
    note: str(),
    dose: str(),
    means: str(),
    goal: shape('itemGoal', { amount: num({ above: 0 }), unit: text }),
    amount: amountConfig,
    standup: standupConfig,
    sitting: sittingConfig,
    desk: deskConfig,
    earlier: arr(itemVersion),
  },
);
const itemDay = shape('itemDay', {}, { done: bool, amount: num({ min: 0 }), minutes: num({ min: 0 }), count: num({ min: 0, int: true }), deskMinutes: num({ min: 0 }), at: timestamp });
const suggestion = shape('itemSuggestion', { id, item: trackedItem, on: date, state: oneOf(SUGGESTION_STATES) }, { decided: date });
const trackingShape = shape(
  'tracking',
  { schemaVersion: version, items: arr(trackedItem), days: record(record(itemDay, ID), DATE_KEY) },
  {
    suggestions: arr(suggestion),
    morning: shape('morningReminder', { on: bool, at: clock }),
    bodyRecord: shape(
      'bodyRecordSchedule',
      { schedule: oneOf(['plan', 'fixed']) },
      { tapeFrom: date, tapeEvery: num({ min: 1, int: true }), testsFrom: date, testsEvery: num({ min: 1, int: true }) },
    ),
    bringOver: shape('bringOver', { on: date, items: arr(id) }),
  },
);

/** The reminder keys of Coach/nudges.json. */
export const NUDGE_KEY = /^(morning|tape|photos|tests|train|coach|slot:(([01]\d|2[0-3]):[0-5]\d|after-log)|(amount|desk|standup):[a-z0-9][a-z0-9-]*|sitting:[a-z0-9][a-z0-9-]*(:stretch)?)$/;
/** The body-record occurrences a skip names: the part and the occurrence's date, or the baseline tests. */
export const SKIP_KEY = /^(tape|photos|tests):(\d{4}-\d{2}-\d{2}|baseline)$/;
const nudgeEntry = shape('nudgeEntry', {}, { how: oneOf(NUDGE_ANSWERS), at: timestamp, snoozedUntil: timestamp, lastAt: timestamp, for: text, by: text });
const nudgesShape = shape('nudges', { schemaVersion: version, days: record(record(nudgeEntry, NUDGE_KEY), DATE_KEY) }, { skipped: record(timestamp, SKIP_KEY) });

/** A Mac's name in Coach/sitting.json. */
export const MAC_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const sittingStretch = shape('sittingStretch', { start: timestamp, end: timestamp });
const sittingShape = shape('sittingLog', { schemaVersion: version, days: record(record(arr(sittingStretch), MAC_NAME), DATE_KEY) });

// ---------------------------------------------------------------- the eating plan

/** A [low, high] pair of numbers, low not above high. */
function pair(opts: { min?: number; above?: number; int?: boolean } = {}): Check {
  return then(arr(num(opts)), (v, p, e) => {
    const r = v as number[];
    if (r.length !== 2) fail(e, p, 'expected [low, high]');
    else if (r[0]! > r[1]!) fail(e, p, 'the low end is above the high end');
  });
}
const anyObject: Check = (v, p, e) => {
  if (!isObject(v)) fail(e, p, 'expected an object');
};
const anyValue: Check = () => {};
const words = then(arr(text), (v, p, e) => {
  if ((v as unknown[]).length !== 2) fail(e, p, 'expected [one, many]');
});

const storedReason = shape('storedReason', { rule: text }, { title: text, inputs: anyObject, threshold: anyValue, note: str() });
const eatingBasis = shape('eatingBasis', { trendKg: num({ above: 0 }), date, weighIns: num({ min: 0, int: true }) });
const eatingProtein = shape(
  'eatingProtein',
  { floorG: num({ above: 0 }), rangeG: pair({ above: 0 }), gPerKg: pair({ above: 0 }), perMealG: pair({ above: 0 }) },
  { item: id, tickAt: clock, reason: storedReason },
);
const eatingFiber = shape('eatingFiber', { g: num({ above: 0 }) }, { per1000kcal: num({ above: 0 }), how: arr(text) });
const eatingEnergy = shape('eatingEnergy', { maintenanceKcal: num({ above: 0 }) }, { targetKcal: pair({ above: 0 }) });
const eatingHabits = shape('eatingHabits', { meals: num({ min: 1, max: 10, int: true }) }, { snacks: bool, cooking: text, avoid: arr(text) });
const mealIdea = shape('mealIdea', { text }, { counts: arr(id) });
const trainingNote = shape('trainingNote', {}, { lift: text, short: text });
const eatingMeal = shape(
  'eatingMeal',
  { id, name: text, text, proteinG: pair({ min: 0 }) },
  { tag: text, portions: id, tip: text, at: clock, foods: record(text, ID), ideas: arr(mealIdea), trainingNote },
);
const handRange = pair({ min: 0, int: true });
const foodGroup = shape('foodGroup', { id, name: text, hand: oneOf(HAND_KINDS), hands: words }, { what: text });
const fallbackTile = shape('fallbackTile', { name: text, text });
const eatingFallbacks = shape('eatingFallbacks', { meal: id, quick: arr(fallbackTile) }, { first: fallbackTile, minutes: num({ above: 0 }) });
const patternLine = shape('patternLine', { id, name: text, target: text, per: oneOf(PATTERN_PERIODS) }, { min: num({ min: 0, int: true }), max: num({ min: 0, int: true }) });
const adjustStep = shape('adjustStep', { id: oneOf(ADJUST_STEPS), when: text, then: text }, { pctPerWeek: num({ min: -1, max: 1 }) });
const adjustApplied = shape('adjustApplied', { date, step: oneOf(ADJUST_STEPS) }, { note: str() });
const adjustRule = shape(
  'adjustRule',
  { windowWeeks: num({ min: 1, max: 26, int: true }), flatCm: num({ min: 0 }), steps: arr(adjustStep, { min: 1 }), waitWeeks: pair({ min: 0 }) },
  { creatineKg: pair({ min: 0 }), creatineFrom: date, creatineWeeks: num({ min: 1, int: true }), looseDay: text, applied: arr(adjustApplied) },
);
const eatingHistory = shape('eatingHistory', { date, note: text });
// The Food tab's words (all optional): the reasons with their sources, the day's times, the light checks, the tips.
const reasonSourceShape = shape('reasonSource', { kind: oneOf(REASON_SOURCES), text }, { field: id, aside: text });
const planReason = shape('planReason', { id, title: text, text }, { icon: id, source: reasonSourceShape });
const trainingTime = shape('trainingTime', { at: clock }, { minutes: num({ above: 0, max: 600 }) });
const dayTraining = shape('dayTraining', {}, { lift: trainingTime, short: trainingTime });
const clockPair = then(arr(clock), (v, p, e) => {
  const r = v as string[];
  if (r.length !== 2) fail(e, p, 'expected [from, to]');
  else if (r[0]! > r[1]!) fail(e, p, 'the start is after the end');
});
const dayDrinks = shape('dayDrinks', {}, { waterL: num({ above: 0, max: 10 }), milkGlasses: num({ min: 0, max: 10, int: true }), coffees: pair({ min: 0, int: true }), lastCoffee: clock });
const eatingDay = shape('eatingDay', {}, { wake: clock, work: clockPair, bed: clock, training: dayTraining, drinks: dayDrinks });
const optionalCheck = shape('optionalCheck', { id, label: text, slots: arr(text, { min: 1 }) });
const eatingToday = shape('eatingToday', {}, { optional: arr(optionalCheck) });
const coachTip = shape('coachTip', { id, title: text, text }, { icon: id, for: text });

const eatingPlanShape = shape(
  'eatingPlan',
  { schemaVersion: version, updated: date, level: oneOf(EATING_LEVELS), goal: oneOf(GOAL_KINDS), review: date, basis: eatingBasis, protein: eatingProtein, meals: arr(eatingMeal, { min: 1 }) },
  {
    source: text,
    screened: date,
    counting: oneOf(COUNTING),
    fiber: eatingFiber,
    energy: eatingEnergy,
    habits: eatingHabits,
    portions: record(record(handRange, ID), ID),
    groups: arr(foodGroup),
    fallbacks: eatingFallbacks,
    pattern: arr(patternLine),
    patternAlso: text,
    adjust: adjustRule,
    history: arr(eatingHistory),
    note: str(),
    goalLabel: text,
    summary: text,
    why: arr(planReason),
    day: eatingDay,
    today: eatingToday,
    tips: arr(coachTip),
  },
);

// ---------------------------------------------------------------- the phone's inbox (Coach/Inbox/*.json)

/** When the phone sent an entry: ISO 8601 with the phone's offset (as Shortcuts formats it) or in UTC. */
export const INBOX_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const inboxAt = then(str({ pattern: INBOX_AT }), (v, p, e) => {
  // Date.parse rolls 31 February over to March, so the day itself is checked too.
  if (!isIsoDate((v as string).slice(0, 10)) || !Number.isFinite(Date.parse(v as string))) fail(e, p, 'is not a real moment');
});
const inboxVersion: Check = (v, p, e) => {
  if (v !== INBOX_VERSION) fail(e, p, `expected entry version ${INBOX_VERSION}, found ${JSON.stringify(v ?? null)}`);
};
const inboxKind = (kind: InboxKind): Check => (v, p, e) => {
  if (v !== kind) fail(e, p, `expected ${kind}`);
};
const inboxBase = (kind: InboxKind) => ({ v: inboxVersion, kind: inboxKind(kind), at: inboxAt, date });
const inboxLift = shape('inboxLift', { weight: num({ min: 0 }), reps: num({ min: 0, int: true }) }, { unit });
const inboxSessionFields = shape(
  'inboxSessionFields',
  { type: text },
  { lift1: inboxLift, lift2: inboxLift, durationMin: num({ min: 1, max: 600, int: true }), express: bool, rating: num({ min: 1, max: 10, int: true }), notes: str() },
);
// The morning fields with the card's limits; the weight's (in kg) is checked once its unit is known.
const morningField = (k: MorningKey): Check => (k === 'weight' ? num({ above: 0 }) : num({ min: MORNING_LIMITS[k].min, max: MORNING_LIMITS[k].max, int: MORNING_LIMITS[k].int }));
const inboxMorningFields = then(
  shape('inboxMorningFields', {}, { ...Object.fromEntries(MORNING_KEYS.map((k) => [k, morningField(k)])), weightUnit: unit }),
  (v, p, e) => {
    const m = v as InboxMorningFields;
    if (!MORNING_KEYS.some((k) => m[k] !== undefined)) fail(e, p, `holds no field: give any of ${MORNING_KEYS.join(', ')}`);
    if (m.weight !== undefined) {
      const kg = m.weightUnit === 'lb' ? m.weight / LB_PER_KG : m.weight;
      const { min, max } = MORNING_LIMITS.weight;
      if (kg < min || kg > max) fail(e, at(p, 'weight'), `is between ${min} and ${max} kg (${Math.round(min * LB_PER_KG)} and ${Math.round(max * LB_PER_KG)} lb)`);
    }
    if (m.weightUnit !== undefined && m.weight === undefined) fail(e, at(p, 'weightUnit'), 'goes with a weight');
  },
);
const nonZero = then(num(), (v, p, e) => {
  if (v === 0) fail(e, p, 'is 0: an amount to add is more than 0 (or less, to take some off)');
});
const INBOX_SHAPES: Record<InboxKind, Check> = {
  session: shape('inboxSession', { ...inboxBase('session'), session: inboxSessionFields }),
  tick: shape('inboxTick', { ...inboxBase('tick'), ids: arr(id, { min: 1 }) }, { done: bool }),
  amount: shape('inboxAmount', { ...inboxBase('amount'), id, add: nonZero }),
  morning: shape('inboxMorning', { ...inboxBase('morning'), morning: inboxMorningFields }),
  trained: shape('inboxTrained', { ...inboxBase('trained'), answer: oneOf(TRAINED_ANSWERS) }),
};

// ---------------------------------------------------------------- cross checks

function run(check: Check, value: unknown, extra?: (errors: ValidationError[]) => void): ValidationError[] {
  const errors: ValidationError[] = [];
  check(value, '', errors);
  if (errors.length === 0 && extra) extra(errors);
  return errors;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

function sessionExtras(s: Session, path: string, errors: ValidationError[]): void {
  if (s.trackingLevel === 'light' && s.exercises.some((x) => x.sets.length > 0)) {
    fail(errors, at(path, 'exercises'), 'a Light-level session logs no sets');
  }
  if (s.plan && s.template && s.plan.template !== s.template) {
    fail(errors, at(path, 'plan.template'), `differs from the session's template ${s.template}`);
  }
  for (const k of Object.keys(s.skipWhy ?? {})) if (!(s.skipped ?? []).includes(k)) fail(errors, at(at(path, 'skipWhy'), k), 'is not in skipped: a reason goes with a skipped item');
}

// ---------------------------------------------------------------- public

export function validateProfile(value: unknown): ValidationError[] {
  return run(profileShape, value);
}

export function validateProgram(value: unknown): ValidationError[] {
  return run(programShape, value, (errors) => {
    const p = value as Program;
    const known = (x: string) => x in p.exercises;
    p.macrocycle.phases.forEach((ph, i) =>
      ph.mesocycles.forEach((m, j) =>
        m.weeks.forEach((w, k) =>
          w.sessions.forEach((t, l) =>
            t.slots.forEach((s, n) => {
              const path = `macrocycle.phases[${i}].mesocycles[${j}].weeks[${k}].sessions[${l}].slots[${n}]`;
              for (const x of [s.exercise, ...(s.swaps ?? []), ...(s.until?.exercise ? [s.until.exercise] : [])]) {
                if (!known(x)) fail(errors, path, `unknown exercise id: ${x}`);
              }
            }),
          ),
        ),
      ),
    );
  });
}

export function validateSession(value: unknown): ValidationError[] {
  return run(sessionShape, value, (errors) => sessionExtras(value as Session, '', errors));
}

export function validateLog(value: unknown): ValidationError[] {
  return run(logShape, value, (errors) => {
    const log = value as { month: string; sessions: Session[] };
    log.sessions.forEach((s, i) => {
      const path = `sessions[${i}]`;
      if (!s.date.startsWith(log.month)) fail(errors, at(path, 'date'), `is outside the file's month ${log.month}`);
      sessionExtras(s, path, errors);
    });
    for (const d of duplicates(log.sessions.map((s) => s.id))) fail(errors, 'sessions', `duplicate session id: ${d}`);
  });
}

export function validateCheckins(value: unknown): ValidationError[] {
  return run(checkinsShape, value, (errors) => {
    const c = value as { daily: { date: string }[]; weekly: WeeklyCheckin[] };
    for (const d of duplicates(c.daily.map((x) => x.date))) fail(errors, 'daily', `duplicate date: ${d}`);
    c.weekly.forEach((w, i) => weeklyExtras(w, `weekly[${i}]`, errors, false));
  });
}

/** Coach/checkins.json: every record has its date and weekStart; one record per date. */
export function validateCheckinLog(value: unknown): ValidationError[] {
  return run(checkinLogShape, value, (errors) => {
    const c = value as CheckinLog;
    c.checkins.forEach((w, i) => weeklyExtras(w, `checkins[${i}]`, errors, true));
    for (const d of duplicates(c.checkins.map((x) => x.date ?? ''))) if (d) fail(errors, 'checkins', `duplicate check-in date: ${d}`);
  });
}

export function validateBody(value: unknown): ValidationError[] {
  return run(bodyShape, value, (errors) => {
    const b = value as { weights: { date: string }[] };
    for (const d of duplicates(b.weights.map((x) => x.date))) fail(errors, 'weights', `duplicate date: ${d}`);
  });
}

/** Coach/tracking.json: unique item ids, each item's kind settings, and a log of known items only. */
export function validateTracking(value: unknown): ValidationError[] {
  return run(trackingShape, value, (errors) => {
    const t = value as Tracking;
    for (const d of duplicates(t.items.map((x) => x.id))) fail(errors, 'items', `duplicate item id: ${d}`);
    t.items.forEach((item, i) => itemExtras(item, `items[${i}]`, errors));
    const kinds = new Map(t.items.map((x) => [x.id, x.kind]));
    dateKeys(t.days, 'days', errors);
    for (const [d, rec] of Object.entries(t.days)) {
      for (const [itemId, day] of Object.entries(rec)) {
        const kind = kinds.get(itemId);
        const path = `days.${d}.${itemId}`;
        if (!kind) {
          fail(errors, path, `no item with the id ${itemId}`);
          continue;
        }
        for (const f of Object.keys(day) as (keyof ItemDay)[]) if (!f.startsWith('_') && !DAY_FIELDS[kind]!.includes(f)) fail(errors, at(path, f), `does not apply to a ${kind} item`);
      }
    }
    for (const d of duplicates((t.suggestions ?? []).map((x) => x.id))) fail(errors, 'suggestions', `duplicate suggestion id: ${d}`);
    (t.suggestions ?? []).forEach((sg, i) => {
      itemExtras(sg.item, `suggestions[${i}].item`, errors);
      if (sg.state !== 'open' && !sg.decided) fail(errors, `suggestions[${i}].decided`, 'is required once accepted or dismissed');
    });
    const br = t.bodyRecord;
    if (br?.schedule === 'fixed') for (const key of ['tapeFrom', 'tapeEvery', 'testsFrom', 'testsEvery'] as const) if (br[key] === undefined) fail(errors, `bodyRecord.${key}`, 'is required for a fixed schedule');
  });
}

/** Coach/nudges.json: real dates and known reminder keys. */
export function validateNudges(value: unknown): ValidationError[] {
  return run(nudgesShape, value, (errors) => dateKeys((value as NudgeState).days, 'days', errors));
}

/** Coach/sitting.json: real dates, and each Mac's stretches in order, none ending before it starts or overlapping the one before. */
export function validateSitting(value: unknown): ValidationError[] {
  return run(sittingShape, value, (errors) => {
    const s = value as SittingLog;
    dateKeys(s.days, 'days', errors);
    for (const [d, macs] of Object.entries(s.days)) {
      for (const [mac, list] of Object.entries(macs)) {
        list.forEach((x, i) => {
          const path = `days.${d}.${mac}[${i}]`;
          if (Date.parse(x.end) < Date.parse(x.start)) fail(errors, path, 'ends before it starts');
          const prev = list[i - 1];
          if (prev && Date.parse(x.start) < Date.parse(prev.end)) fail(errors, path, 'starts before the stretch before it ends');
        });
      }
    }
  });
}

export function validateLedger(value: unknown): ValidationError[] {
  return run(ledgerShape, value, (errors) => {
    const l = value as { constraints: { id: string }[] };
    for (const d of duplicates(l.constraints.map((c) => c.id))) fail(errors, 'constraints', `duplicate constraint id: ${d}`);
  });
}

/**
 * Coach/eating-plan.json: the review not before the plan's date, the basis
 * and the screen not after it, the floor inside the range, unique ids, and
 * every reference (a meal's portions and foods, the portions' food groups,
 * the fallbacks' meal, an idea's or a light check's pattern line) to
 * something the plan holds.
 */
export function validateEatingPlan(value: unknown): ValidationError[] {
  return run(eatingPlanShape, value, (errors) => {
    const p = value as EatingPlan;
    if (p.review < p.updated) fail(errors, 'review', 'is before the plan\'s date (updated)');
    if (p.basis.date > p.updated) fail(errors, 'basis.date', 'is after the plan\'s date (updated)');
    if (p.screened && p.screened > p.updated) fail(errors, 'screened', 'is after the plan\'s date (updated)');
    const [lo, hi] = p.protein.rangeG;
    if (p.protein.floorG < lo || p.protein.floorG > hi) fail(errors, 'protein.floorG', `is outside the range ${lo} to ${hi} g`);
    for (const d of duplicates(p.meals.map((m) => m.id))) fail(errors, 'meals', `duplicate meal id: ${d}`);
    for (const d of duplicates((p.groups ?? []).map((g) => g.id))) fail(errors, 'groups', `duplicate food group id: ${d}`);
    for (const d of duplicates((p.pattern ?? []).map((x) => x.id))) fail(errors, 'pattern', `duplicate pattern id: ${d}`);
    const portions = p.portions ?? {};
    p.meals.forEach((m, i) => {
      if (m.portions && !(m.portions in portions)) fail(errors, `meals[${i}].portions`, `no portions named ${m.portions}`);
    });
    const groups = new Set((p.groups ?? []).map((g) => g.id));
    for (const [meal, byGroup] of Object.entries(portions)) {
      for (const g of Object.keys(byGroup)) if (!groups.has(g)) fail(errors, `portions.${meal}.${g}`, `no food group with the id ${g}`);
    }
    if (p.fallbacks && !p.meals.some((m) => m.id === p.fallbacks!.meal)) fail(errors, 'fallbacks.meal', `no meal with the id ${p.fallbacks.meal}`);
    (p.pattern ?? []).forEach((x, i) => {
      if (x.min === undefined && x.max === undefined) fail(errors, `pattern[${i}]`, 'needs min or max');
      if (x.min !== undefined && x.max !== undefined && x.min > x.max) fail(errors, `pattern[${i}].min`, 'is above max');
    });
    // The Food tab's words: the foods by the plan's groups, the ideas' and the checks' pattern lines, unique ids.
    const lines = new Set((p.pattern ?? []).map((x) => x.id));
    p.meals.forEach((m, i) => {
      for (const g of Object.keys(m.foods ?? {})) if (!groups.has(g)) fail(errors, `meals[${i}].foods.${g}`, `no food group with the id ${g}`);
      (m.ideas ?? []).forEach((x, j) => {
        for (const c of x.counts ?? []) if (!lines.has(c)) fail(errors, `meals[${i}].ideas[${j}].counts`, `no pattern line with the id ${c}`);
      });
    });
    const checks = p.today?.optional ?? [];
    for (const d of duplicates(checks.map((x) => x.id))) fail(errors, 'today.optional', `duplicate check id: ${d}`);
    checks.forEach((x, i) => {
      if (!lines.has(x.id)) fail(errors, `today.optional[${i}].id`, `no pattern line with the id ${x.id} (a check pre-fills its line)`);
    });
    for (const d of duplicates((p.why ?? []).map((x) => x.id))) fail(errors, 'why', `duplicate reason id: ${d}`);
    for (const d of duplicates((p.tips ?? []).map((x) => x.id))) fail(errors, 'tips', `duplicate tip id: ${d}`);
    const a = p.adjust;
    if (a) {
      for (const d of duplicates(a.steps.map((x) => x.id))) fail(errors, 'adjust.steps', `duplicate step: ${d}`);
      (a.applied ?? []).forEach((x, i, all) => {
        if (i > 0 && x.date < all[i - 1]!.date) fail(errors, `adjust.applied[${i}].date`, 'is before the step before it');
      });
    }
  });
}

/**
 * One phone entry (a file in Coach/Inbox/): `v` 1, a known `kind` with its
 * fields, `at` (when it was sent) and `date` (the day it counts for). The
 * morning fields carry the card's limits; a tick's ids are unique. Whether
 * the ids are tracked, the session is in the plan and the day is open is
 * the import's to say (src/report/inbox.ts), against the vault as it is.
 */
export function validateInboxEntry(value: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!isObject(value)) {
    fail(errors, '', `expected an entry object: {"v": ${INBOX_VERSION}, "kind", "at", "date", ...}`);
    return errors;
  }
  const kind = value['kind'];
  if (!(INBOX_KINDS as readonly unknown[]).includes(kind)) {
    inboxVersion(value['v'], 'v', errors);
    fail(errors, 'kind', kind === undefined ? `is required: one of ${INBOX_KINDS.join(', ')}` : `expected one of: ${INBOX_KINDS.join(', ')}`);
    return errors;
  }
  return run(INBOX_SHAPES[kind as InboxKind], value, (e) => {
    if (kind === 'tick') for (const d of duplicates((value as { ids: string[] }).ids)) fail(e, 'ids', `lists ${d} twice`);
  });
}

function dateKeys(days: Record<string, unknown>, path: string, errors: ValidationError[]): void {
  for (const d of Object.keys(days)) if (!isIsoDate(d)) fail(errors, at(path, d), 'is not a real date');
}

const CONFIG_KINDS = { amount: 'amount', standup: 'standup', sitting: 'sitting', desk: 'desk' } as const;

/** One tracked item's cross-field checks: its kind's settings, reminder, schedule and pauses. */
function itemExtras(item: TrackedItem, path: string, errors: ValidationError[]): void {
  const k = item.kind;
  for (const [key, kind] of Object.entries(CONFIG_KINDS)) {
    const has = (item as unknown as Record<string, unknown>)[key] !== undefined;
    if (k === kind && !has) fail(errors, at(path, key), `is required for a ${k} item`);
    if (k !== kind && has) fail(errors, at(path, key), `belongs to ${kind} items only`);
  }
  if (item.dose !== undefined && k !== 'supplement') fail(errors, at(path, 'dose'), 'belongs to supplements only');
  for (const key of ['means', 'goal'] as const) if (item[key] !== undefined && k !== 'tick') fail(errors, at(path, key), 'belongs to ticks only');
  if (item.whenDetail && item.when !== 'training') fail(errors, at(path, 'whenDetail'), 'needs when: training');
  if (item.when && !['supplement', 'tick', 'amount'].includes(k)) fail(errors, at(path, 'when'), `a ${k} item has its own times`);
  if (item.source.by === 'coach' && !item.source.why) fail(errors, at(path, 'source.why'), 'a coach suggestion needs its reason');
  const sc = item.schedule;
  if (sc.kind === 'weekdays' && !sc.days) fail(errors, at(path, 'schedule.days'), 'is required for weekdays');
  if (sc.kind !== 'weekdays' && sc.days) fail(errors, at(path, 'schedule.days'), 'belongs to weekdays only');
  if (sc.kind === 'every' && sc.n === undefined) fail(errors, at(path, 'schedule.n'), 'is required for every N days');
  if (sc.kind !== 'every' && (sc.n !== undefined || sc.from !== undefined)) fail(errors, at(path, 'schedule'), 'n and from belong to every N days only');
  if (sc.days && new Set(sc.days).size !== sc.days.length) fail(errors, at(path, 'schedule.days'), 'lists a day twice');
  if (['standup', 'sitting', 'desk'].includes(k) && ['training', 'rest', 'every'].includes(sc.kind)) fail(errors, at(path, 'schedule.kind'), `a ${k} item runs every day or on chosen weekdays`);
  const r = item.reminder;
  if (r) {
    const set = (Object.keys(r) as (keyof typeof r)[]).filter((x) => r[x] !== undefined);
    const only = (allowed: string[]) => set.filter((x) => !allowed.includes(x)).forEach((x) => fail(errors, at(path, `reminder.${x}`), `does not apply to a ${k} item`));
    if (k === 'standup' || k === 'desk') fail(errors, at(path, 'reminder'), `a ${k} item has its own cards`);
    else if (k === 'sitting') {
      only(['atMinutes', 'stretch']);
      if (!set.length) fail(errors, at(path, 'reminder'), 'needs atMinutes or stretch');
    } else {
      only(k === 'amount' ? ['at', 'every', 'from', 'to'] : ['at', 'afterLog']);
      const every = r.every !== undefined || r.from !== undefined || r.to !== undefined;
      const ways = [r.at !== undefined, r.afterLog === true, every].filter(Boolean).length;
      if (ways !== 1) fail(errors, at(path, 'reminder'), k === 'amount' ? 'needs either at, or every with from and to' : 'needs either at or afterLog');
      if (every && (r.every === undefined || r.from === undefined || r.to === undefined)) fail(errors, at(path, 'reminder'), 'every needs from and to');
      if (r.from && r.to && r.from >= r.to) fail(errors, at(path, 'reminder.to'), 'is not after from');
      if (r.afterLog && item.when !== 'training') fail(errors, at(path, 'reminder.afterLog'), 'needs when: training');
    }
  }
  if (item.desk && item.desk.from >= item.desk.to) fail(errors, at(path, 'desk.to'), 'is not after from');
  const pauses = item.pauses ?? [];
  pauses.forEach((pz, i) => {
    if (pz.to && pz.to < pz.from) fail(errors, `${at(path, 'pauses')}[${i}]`, 'ends before it starts');
    if (!pz.to && i < pauses.length - 1) fail(errors, `${at(path, 'pauses')}[${i}]`, 'only the last pause can be open');
    const prev = pauses[i - 1];
    if (prev && (!prev.to || prev.to >= pz.from)) fail(errors, `${at(path, 'pauses')}[${i}]`, 'overlaps or precedes the pause before it');
  });
  (item.earlier ?? []).forEach((v, i, all) => {
    if (i > 0 && v.until <= all[i - 1]!.until) fail(errors, `${at(path, 'earlier')}[${i}].until`, 'is not after the one before');
    for (const key of Object.keys(CONFIG_KINDS)) if ((v as unknown as Record<string, unknown>)[key] !== undefined && key !== k) fail(errors, `${at(path, 'earlier')}[${i}].${key}`, `belongs to ${key} items only`);
  });
}

/** Which fields of a day's record fit an item's kind. */
const DAY_FIELDS: Record<string, readonly (keyof ItemDay)[]> = {
  supplement: ['done', 'at'],
  tick: ['done', 'at'],
  amount: ['amount', 'at'],
  standup: ['minutes', 'count', 'deskMinutes', 'at'],
  desk: ['count', 'at'],
  sitting: [],
};

/** Writers call this first: a file with another schema version is never overwritten. */
export function canWrite(doc: unknown): Result<boolean> {
  const found = isObject(doc) ? doc['schemaVersion'] : undefined;
  const ok = found === SCHEMA_VERSION;
  return explain(ok, 'schema.write-guard', { found: found ?? null }, {
    threshold: { schemaVersion: SCHEMA_VERSION },
    note: ok ? undefined : `refusing to write: the file is schema ${JSON.stringify(found ?? null)}, the engine writes ${SCHEMA_VERSION}`,
  });
}

// ---------------------------------------------------------------- the coach's letters

/** A letter's `type` in its frontmatter: the week's letter, the mesocycle review, the phase review. */
export const LETTER_TYPES = ['coach-letter', 'mesocycle-review', 'phase-review'] as const;

/** The frontmatter lines Pahlavan reads from a letter, as the Check-in screen parses them (a trailing # comment is dropped, but not from focus). */
export function letterFields(text: string): { frontmatter: boolean; type: string | null; date: string | null; focus: string | null } {
  const fm = /^---\r?\n([^]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  const front = fm?.[1] ?? '';
  const field = (k: string) => new RegExp(`^${k}:\\s*(.+?)\\s*(?:#.*)?$`, 'm').exec(front)?.[1]?.trim() ?? null;
  const focus = /^focus:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? null;
  return { frontmatter: Boolean(fm), type: field('type'), date: field('date'), focus: focus || null };
}

/**
 * A coach letter (Coach/Letters/YYYY-MM-DD.md): the frontmatter Pahlavan
 * reads. `type` one of LETTER_TYPES (Check-in's Last letter names a review
 * by it), `date` a real date (a letter dated on or after a Sunday makes that
 * Sunday's coach step done) and `focus`, one line (Check-in and At a glance
 * show it, and the next check-in asks whether it was followed).
 */
export function validateLetter(text: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const f = letterFields(text);
  if (!f.frontmatter) {
    fail(errors, 'frontmatter', 'missing: a letter starts with a --- block holding its type, date and focus');
    return errors;
  }
  if (f.type === null) fail(errors, 'type', `is required: one of ${LETTER_TYPES.join(', ')}`);
  else if (!(LETTER_TYPES as readonly string[]).includes(f.type)) fail(errors, 'type', `expected one of: ${LETTER_TYPES.join(', ')}`);
  if (f.date === null) fail(errors, 'date', 'is required: the Sunday the letter follows, YYYY-MM-DD');
  else if (!isIsoDate(f.date)) fail(errors, 'date', 'expected a real date, YYYY-MM-DD');
  if (f.focus === null) fail(errors, 'focus', 'is required: the week\'s one focus, on one line');
  return errors;
}
