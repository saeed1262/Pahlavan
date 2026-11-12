// Data schema v1: the shapes of the files in the data folder. Every file
// carries `schemaVersion`; writers refuse to write on a mismatch (validate.ts).
//
//   profile.json        Profile
//   program.json        Program
//   log/<YYYY-MM>.json  Log (sessions)
//   checkins.json       Checkins (daily and weekly)
//   body.json           Body (weight, tape, tests, photo index)
//   ledger.json         Ledger (constraints on exercise choice, from the coach's Ledger)
//   checkins.json       CheckinLog (the weekly check-in answers, one record per check-in date)
//   tracking.json       Tracking (tracked items, their log, the coach's suggestions, check-in reminders)
//   nudges.json         NudgeState (reminder state shared by every Mac: answers, snoozes, skips)
//   sitting.json        SittingLog (sitting stretches per day and per Mac)
//   eating-plan.json    EatingPlan (the eating plan's numbers, meals, portions, pattern and adjustment rule;
//                       optionally the Food tab's words, the day's times, meal ideas, light checks and tips)

import type { Pattern } from './data/exercises.ts';
import type { IsoDate } from './dates.ts';

export type { IsoDate };

export const SCHEMA_VERSION = 1;
export type SchemaVersion = typeof SCHEMA_VERSION;

export const UNITS = ['kg', 'lb'] as const;
export type Unit = (typeof UNITS)[number];

/** Light: session done, minutes, RPE. Standard: the top set of each main lift. Full: every set, with RIR. */
export const TRACKING_LEVELS = ['light', 'standard', 'full'] as const;
export type TrackingLevel = (typeof TRACKING_LEVELS)[number];

export const SCREENING_OUTCOMES = ['go', 'go-ramped', 'conservative', 'blocked'] as const;
export type ScreeningOutcome = (typeof SCREENING_OUTCOMES)[number];

export const GOAL_KINDS = [
  'fat-loss',
  'recomposition',
  'gain',
  'maintenance',
  'strength',
  'skill',
  'posture',
  'conditioning',
  'health',
] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const CONFIDENCE = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

// ---------------------------------------------------------------- profile

/** A signed weekly change: `pct` as a fraction of body weight (-0.005 is -0.5 %), or `kg`. */
export interface RateBand {
  unit: 'pct' | 'kg';
  lo: number;
  hi: number;
}

export interface Goal {
  id: string;
  kind: GoalKind;
  label: string;
  /** 0-10 rulers from the intake. */
  importance: number;
  confidence: number;
  measure?: string;
  /** Overrides the default band for the goal kind (weight.ts). */
  rateBand?: RateBand;
}

export interface Availability {
  daysPerWeek: number;
  /** The longest session; short days, when some are shorter, are in `shortSessions`. */
  minutesPerSession: number;
  /** Some of the `daysPerWeek` are shorter: how many, and their minutes (conditioning goes there first). */
  shortSessions?: { days: number; minutes: number };
  fixedDays?: Weekday[];
  busy?: { from: IsoDate; to: IsoDate; note?: string }[];
  note?: string;
}

export interface Screening {
  outcome: ScreeningOutcome;
  date: IsoDate;
  limits?: string[];
}

/** intake.md's body-assessment rows, as machine-readable kinds. */
export const EMPHASIS_KINDS = [
  'forward-head-rounded-shoulders',
  'overhead-limited',
  'squat-heels-lift',
  'knees-in',
  'low-back-arch',
  'asymmetry',
  'lagging-area',
  'waist-fat',
] as const;
export type EmphasisKind = (typeof EMPHASIS_KINDS)[number];

export const EXPERIENCE = ['novice', 'intermediate', 'advanced'] as const;
export type Experience = (typeof EXPERIENCE)[number];

/** One row of the body assessment: what was seen and the plan emphasis it sets. */
export interface Emphasis {
  area: string;
  seen: string;
  confidence: Confidence;
  /**
   * The user's answer to the question this row raises (intake.md: a finding
   * is a question, never a diagnosis): true, it holds and the plan acts on
   * it; false, it does not and the plan leaves the row out. Left out: not
   * asked yet (findings.ts says what the plan does then).
   */
  confirmed?: boolean;
  emphasis: string;
  /** Which intake.md row this is, so the engine can act on it (the findings, the plan check's options, the priorities). */
  kind?: EmphasisKind;
  /** The weaker side, for an asymmetry. */
  side?: 'left' | 'right';
  muscles?: string[];
  /** Muscle regions this row names (data/regions.ts ids), declared weak by the person: `check` holds each to the declared-region rule (volume.ts, `declaredRegions`). */
  regions?: string[];
}

/**
 * The intake's movement self-check (intake.md, "The movement self-check"):
 * each result as typed back, with the date. Every test is optional (a test
 * that hurt was stopped and is left out). The coach sets the ladders'
 * starting levels from it; the engine reads its findings (the sit-to-stand,
 * the hinge, the overhead reach and balance), which rule movements out once
 * the user confirms them, and its holds.
 */
export interface SelfCheck {
  date: IsoDate;
  /** Five slow reps to a knee-height box, arms crossed: easy or a struggle, heels down or lifting. */
  sitToStand?: { easy: boolean; heelsDown: boolean };
  /** Max clean push-ups, chest to a fist's height (0 when none). */
  pushUps?: number;
  /** Dead hang, seconds. */
  deadHangS?: number;
  /** Strict pull-ups (0 when none). */
  pullUps?: number;
  /** A front plank or a hollow hold, seconds, lower back down. */
  coreHold?: { kind: 'plank' | 'hollow'; seconds: number };
  /** Hands slide to the knees with the lower back flat. */
  hingeFlatBack?: boolean;
  /** Back and head on a wall, arms straight up: clean, or reached with the ribs flaring or the lower back arching. */
  overheadReach?: { clean: boolean; ribFlare?: boolean; lowBackArch?: boolean };
  /** Heels, hips and shoulders on a wall: the gap behind the head, cm. */
  wallGapCm?: number;
  /** Single-leg stand, eyes open, seconds a side (the test stops at 30). */
  balanceS?: { left: number; right: number };
  /**
   * The user's answer, per test, when its result is a finding the plan would
   * act on (a struggled sit-to-stand or lifting heels, a rounded hinge, an
   * overhead reach that is not clean, balance under 30 s): true, it holds and
   * the plan acts on it; false, it does not and only its warm-up lines stay.
   * A test left out: not asked yet (findings.ts says what the plan does then).
   */
  confirmed?: SelfCheckConfirmed;
}

/** The self-check results the user confirmed (true) or declined (false), by test. */
export interface SelfCheckConfirmed {
  sitToStand?: boolean;
  hingeFlatBack?: boolean;
  overheadReach?: boolean;
  balanceS?: boolean;
}

/** Round 5's "when a week goes badly, what usually happens", as kinds the plan can act on. */
export const BAD_WEEK_KINDS = ['skips-sessions', 'shortens-sessions', 'stops-for-a-while', 'travel', 'eats-off-plan', 'sleeps-badly'] as const;
export type BadWeekKind = (typeof BAD_WEEK_KINDS)[number];

export interface BadWeek {
  usually: BadWeekKind[];
  /** The answer in the user's words. */
  note?: string;
}

/** Splits a user has liked or disliked: full body, upper/lower, push/pull/legs, heavier and lighter days. */
/**
 * Splits liked or disliked (profile.preferences.splits): rules.md's split
 * families. The first four since 0.6.0; the rest added in 0.9.0.
 */
export const SPLIT_KINDS = ['full-body', 'upper-lower', 'push-pull-legs', 'heavy-and-light-days', 'body-part', 'torso-limbs', 'upper-lower-full', 'specialization', 'hift', 'circuit', 'calisthenics'] as const;
export type SplitKind = (typeof SPLIT_KINDS)[number];
/**
 * Each split family in words, as rules.md's "Split families" table names it
 * (the Why this plan card, the version facts). The table's Concurrent row is
 * how cardio fits into any plan, not a split, so it has no kind.
 */
export const SPLIT_LABELS: Readonly<Record<SplitKind, string>> = {
  'full-body': 'Full body',
  'upper-lower': 'Upper/lower',
  'push-pull-legs': 'Push/pull/legs',
  'heavy-and-light-days': 'Heavy/light full body',
  'body-part': 'Body-part split',
  'torso-limbs': 'Torso/limbs',
  'upper-lower-full': 'Upper/lower/full',
  specialization: 'Specialization block',
  hift: 'CrossFit-style (HIFT)',
  circuit: 'Circuit or minimalist',
  calisthenics: 'Calisthenics skill blocks',
};

export interface Profile {
  schemaVersion: SchemaVersion;
  units: { load: Unit; body: Unit };
  basics?: { birthYear?: number; heightCm?: number; sex?: 'male' | 'female' };
  goals: Goal[];
  availability: Availability;
  equipment: string[];
  /**
   * What travel usually offers, in the same words as `equipment` ("dumbbells",
   * "bands", "pull-up bar"); bodyweight is always there. The Hotel version of
   * a session uses only these; without it, bodyweight, light dumbbells and
   * bands. An empty list is bodyweight only.
   */
  travelEquipment?: string[];
  trackingLevel: TrackingLevel;
  screening: Screening;
  emphasis: Emphasis[];
  priorityMuscles?: string[];
  /** Regions the person declares weak (data/regions.ts ids): never diagnosed from photos. `review` reports them and `check` holds each to the declared-region rule. */
  priorityRegions?: string[];
  /** Training age by how fast they progress: session to session, week to week, or by blocks. */
  experience?: Experience;
  /** Exercise ids the user likes or dislikes, preferred cardio, and splits liked or disliked before. */
  preferences?: { likes?: string[]; dislikes?: string[]; cardio?: string[]; splits?: { likes?: SplitKind[]; dislikes?: SplitKind[] } };
  /** The movement self-check, read by engine 0.6.0 and later. */
  selfCheck?: SelfCheck;
  /** What usually happens when a week goes badly: shapes the split's skip risk, the minimum week and the pre-mortem. */
  badWeek?: BadWeek;
  /** The user chose to let their logged history size the plan and set starting weights. */
  useHistory?: boolean;
  /** The RIR calibration sets (review.md): bias = actual - predicted, per exercise. */
  rirCalibration?: RirCalibration[];
  /** The numbers to aim for by the end of the plan (week 24); Progress measures against them. */
  targets?: BodyTargets;
  /** The intake's desk-work answer: the plan proposes desk breaks for desk work. */
  work?: DeskWork;
  /** The user's own standing rules for any plan the coach writes; `engine check` reports a plan that breaks one. */
  planRules?: ProfilePlanRules;
  /** The weights the gym actually has, by kind of kit: every weight target lands on one of them (loads.ts). */
  loads?: GymLoads;
}

/**
 * Dumbbells or kettlebells: every weight there is (`weights`), or a range
 * from the lightest to the heaviest in even steps (`from`, `to`, `step`).
 */
export interface WeightSet {
  weights?: number[];
  from?: number;
  to?: number;
  step?: number;
}

/** A stack or a plate-loaded machine: loads go up by `step`, from `from` (default one step) to `to` (default no top). */
export interface WeightStack {
  step: number;
  from?: number;
  to?: number;
}

/**
 * The gym's real weights (profile.loads), in `unit`. Each key is a catalogue
 * equipment id; every kind is optional, and a lift whose kind has none keeps
 * its plan step. A barbell is the bar plus a pair of plates for each plate
 * on a side; a trap bar uses the barbell's plates unless it lists its own.
 */
export interface GymLoads {
  unit: Unit;
  dumbbell?: WeightSet;
  kettlebell?: WeightSet;
  barbell?: { bar: number; plates: number[] };
  'trap-bar'?: { bar: number; plates?: number[] };
  machine?: WeightStack;
  cable?: WeightStack;
}

/**
 * The user's own rules for the plan's shape, as they stated them at intake
 * ("3 sets each; a leg, chest, back and shoulder exercise every session;
 * core on short days"). The coach designs within them; `engine check` warns
 * (`plan-rule`) where a plan breaks one.
 */
export interface ProfilePlanRules {
  /** Every strength exercise with sets on a lifting day has this many working sets. */
  setsPerExercise?: number;
  /**
   * What every lifting session holds: each entry is a catalogue movement
   * pattern ("squat", "horizontal-push") or a muscle id ("chest"), with
   * alternatives joined by "|" ("squat|lunge|hinge" for "a leg exercise").
   */
  liftSession?: { patterns: string[] };
  /** Every short day holds a core exercise. */
  shortDayCore?: boolean;
}

/**
 * Numeric targets: a drop from the cycle's first value (lo to hi, the stretch
 * at hi), or a level to hold as a 7-day average, and goals per fitness test.
 */
export interface BodyTargets {
  /** The date they are for (the plan's last day when left out). */
  by?: IsoDate;
  waistDropCm?: [number, number];
  weightDropKg?: [number, number];
  rhrDropBpm?: [number, number];
  stepsPerDay?: number;
  sleepHours?: number;
  /** Fitness-test goals by test id: pushups, pullups, hollowS, handstandS, sidePlankS. */
  tests?: Record<string, number>;
}

/**
 * One RIR calibration set: the RIR the user predicted at a point in the set,
 * and the reps they then did past it (the actual RIR). A positive bias
 * (actual above predicted) means they stop early: their reported RIR is low.
 */
export interface RirCalibration {
  /** Exercise id: the engine catalogue's or the plan's own (lowercase, dashes). */
  exercise: string;
  date: IsoDate;
  predicted: number;
  actual: number;
}

// ---------------------------------------------------------------- program

export const EXERCISE_KINDS = ['strength', 'circuit', 'timed', 'cardio', 'mobility'] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

export const SESSION_KINDS = ['lift', 'short', 'express', 'cardio', 'mobility'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const WEEK_KINDS = ['loading', 'deload'] as const;
export type WeekKind = (typeof WEEK_KINDS)[number];

/** How much an exercise strains the abdomen (neutral wording), plus joint tags like `joint:shoulder`. */
export const ABDOMEN_RISK = ['abdomen-high', 'abdomen-moderate', 'abdomen-low'] as const;
export type RiskTag = (typeof ABDOMEN_RISK)[number] | `joint:${string}`;

/** Muscles an exercise trains: `main` counts a full set, `helps` half (volume.ts). */
export interface MuscleTags {
  main: string[];
  helps: string[];
  /** The muscle regions it biases (data/regions.ts ids); each region's parent muscle belongs in main or helps. */
  regions?: string[];
}

export interface Exercise {
  name: string;
  /** The movement pattern (data/exercises.ts PATTERNS). */
  pattern?: Pattern;
  /** The unit the exercise is loaded and progressed in. Required for strength work. */
  unit?: Unit;
  /** The smallest load step, in `unit` (5 for 5 lb dumbbells, 2.5 for a kg barbell). Required for strength work. */
  increment?: number;
  muscles?: MuscleTags;
  /** Circuits, timed and cardio items carry no muscle tags and are not counted. */
  kind?: ExerciseKind;
  risk?: RiskTag[];
  equipment?: string;
  /** The real weights this exercise can be loaded with, in `unit`, lightest first (from the profile's loads); without them, targets round to `increment`. */
  weights?: number[];
}

/** [lo, hi] reps. */
export type RepRange = [number, number];

/** A temporary change to a slot, in force through `until` (inclusive). */
export interface TemporaryChange {
  until: IsoDate;
  reason: string;
  exercise?: string;
  sets?: number;
  repRange?: RepRange;
  rir?: number;
  note?: string;
}

/**
 * How a slot progresses: linear (novices: add `step` every session the reps
 * are made), double (the rep range, then the step), wave (double progression
 * with the RIR set week by week), ladder (bodyweight: the top of the range on
 * every set, then the `next` harder variation).
 */
export const PROGRESSION_RULES = ['linear', 'double', 'wave', 'ladder'] as const;
export type ProgressionRuleId = (typeof PROGRESSION_RULES)[number];

export interface SlotProgression {
  rule: ProgressionRuleId;
  /** Linear: the load added per successful session, in the exercise unit. */
  step?: number;
  /** Ladder: the harder variation's exercise id. */
  next?: string;
  /** Ladder: which calisthenics ladder (pullup, pushup, hollow, legs) and the 1-based level the slot starts at (plan-data.json holds it as the ladder's `startLevel`). */
  ladder?: string;
  level?: number;
}

/**
 * A timed item's structure, in minutes (plan-data's `timed`): steady work
 * of `minutes`, or intervals of `rounds` × `workMin` hard with `restMin`
 * easy between, with an optional warm-up and cool-down. With intervals and
 * no warm-up or cool-down given, `minutes` is the whole item (the easy time
 * around the intervals included); src/core/timed.ts counts it.
 */
export interface TimedWork {
  minutes?: number;
  rounds?: number;
  workMin?: number;
  restMin?: number;
  warmupMin?: number;
  cooldownMin?: number;
}

export interface ExerciseSlot {
  exercise: string;
  sets: number;
  repRange: RepRange;
  /** Target reps in reserve. */
  rir: number;
  swaps?: string[];
  risk?: RiskTag[];
  until?: TemporaryChange;
  /** A main lift: logged, kept for the whole phase, counted for stalls and deload triggers. */
  main?: boolean;
  progression?: SlotProgression;
  note?: string;
  /** Done as a superset with the slot before it (plan-data's `pair`, engine 0.9.0): a set of each, then rest. */
  pair?: boolean;
  /** A timed item (cardio, intervals, timed skill work): its minutes and structure. `sets` is then its rounds, or 1. */
  timed?: TimedWork;
}

export interface SessionTemplate {
  id: string;
  name: string;
  kind: SessionKind;
  slots: ExerciseSlot[];
}

export interface Week {
  /** 1-based within the mesocycle. */
  index: number;
  kind: WeekKind;
  /** The week's Monday. */
  start: IsoDate;
  /** Week 1 of a plan: find working weights; no progression or stall checks. */
  calibration?: boolean;
  /** Tests and photos this week. */
  tests?: boolean;
  sessions: SessionTemplate[];
}

export interface Mesocycle {
  id: string;
  name: string;
  weeks: Week[];
}

export interface Phase {
  id: string;
  name: string;
  goal?: string;
  mesocycles: Mesocycle[];
}

export interface Macrocycle {
  id: string;
  name: string;
  start: IsoDate;
  phases: Phase[];
}

export interface Program {
  schemaVersion: SchemaVersion;
  id: string;
  name: string;
  /** Keyed by exercise id (lowercase, dashes). */
  exercises: Record<string, Exercise>;
  macrocycle: Macrocycle;
  priorityMuscles?: string[];
  /** The plan's desk breaks; left out, the plan has none. */
  deskBreaks?: DeskBreaks;
}

// ---------------------------------------------------------------- session log

export interface LoggedSet {
  weight: number;
  unit: Unit;
  reps: number;
  rir?: number;
  pain?: boolean;
}

export interface ExerciseLog {
  exercise: string;
  sets: LoggedSet[];
  note?: string;
}

/** The plan as it stood when the session was done, frozen with the session. */
export interface PlanSnapshot {
  program?: string;
  phase?: string;
  mesocycle?: string;
  week?: number;
  weekKind: WeekKind;
  template: string;
  /** The template's kind, frozen with it (adherence counts by kind). */
  kind?: SessionKind;
  slots: ExerciseSlot[];
}

export interface Session {
  id: string;
  date: IsoDate;
  trackingLevel: TrackingLevel;
  template?: string;
  minutes?: number;
  /** Session RPE, 0-10; training load is rpe x minutes. */
  rpe?: number;
  /** Logged exercises; empty at the Light level. */
  exercises: ExerciseLog[];
  /** Exercise ids from the plan that were skipped. */
  skipped?: string[];
  plan?: PlanSnapshot;
  note?: string;
  /** Pain or a niggle during the session, as the Log panel saves it: where, how bad (0-10, when given), and the exercise. */
  pain?: SessionPain[];
  /**
   * Done as the Hotel version (bodyweight, light dumbbells, bands): it counts
   * for adherence and the week's sets, by its own exercises, but never for a
   * lift's e1RM trend, stall check or next target.
   */
  hotel?: boolean;
  /** Why a skipped item was skipped, by exercise id (a key of `skipped`): the Log panel's Time, Pain, Equipment or Energy. */
  skipWhy?: Record<string, SkipReason>;
}

/** Why a planned item was skipped, as the Log panel asks it. */
export const SKIP_REASONS = ['time', 'pain', 'equipment', 'energy'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Why a planned item was done as another, as the Log panel saves it: your own swap, the Ledger's, soreness's or the Hotel version's. */
export const SWAP_REASONS = ['mine', 'ledger', 'soreness', 'hotel'] as const;
export type SwapReason = (typeof SWAP_REASONS)[number];

/** A pain logged with a session: the area, its severity 0-10 (left out when not given), and the exercise it came with. */
export interface SessionPain {
  area: string;
  severity?: number;
  exercise?: string;
}

export interface Log {
  schemaVersion: SchemaVersion;
  /** YYYY-MM; the file is log/<month>.json. */
  month: string;
  sessions: Session[];
}

// ---------------------------------------------------------------- check-ins

/** The morning check-in. Scales are 1-5; soreness 1 is none, 5 very sore. */
export interface DailyCheckin {
  date: IsoDate;
  /** Hours slept the night ending that morning. */
  sleepH?: number;
  sleepQ?: number;
  energy?: number;
  soreness?: number;
  /** Resting heart rate, bpm. */
  rhr?: number;
  /** Heart rate variability that morning, ms (Apple Health's is SDNN). */
  hrv?: number;
  /** The user said they were ill that day (the morning check-in's "I'm ill today"). */
  illness?: boolean;
  steps?: number;
  /** Floors climbed that day. */
  floors?: number;
  /** The user ticked that they trained (a day ticked with no session logged is an unlogged session). */
  trained?: boolean;
  /** A day the user marked as planned rest or as a missed session; other gaps count as unlogged. */
  mark?: 'rest' | 'missed';
  /** The user ticked that they reached their protein target that day. */
  protein?: boolean;
  /** Sore muscles on the morning body map, by muscle id: mild or sore. */
  soreMuscles?: Record<string, SorenessLevel>;
  note?: string;
}

export const SORENESS_LEVELS = ['mild', 'sore'] as const;
export type SorenessLevel = (typeof SORENESS_LEVELS)[number];

export const DAY_MARKS = ['rest', 'missed'] as const;

/** A pain or niggle reported at the check-in: where, how bad (0-10), and the movement. */
export interface JointAche {
  area: string;
  severity: number;
  exercise?: string;
  /** It lingered past the next day. */
  lingered?: boolean;
}

export const BUSY_KINDS = ['travel', 'crunch', 'other'] as const;
export type BusyKind = (typeof BUSY_KINDS)[number];

/** A known busy period ahead: a busy week next to a scheduled deload becomes the deload. */
export interface BusyPeriod {
  from: IsoDate;
  to: IsoDate;
  kind: BusyKind;
  /** Sessions the user expects to manage that week. */
  sessions?: number;
  note?: string;
}

/** The step of the stall triage ladder a letter applied to a lift. */
export interface TriageRecord {
  /** The lift's exercise id, or its name as the plan writes it. */
  lift: string;
  step: 1 | 2 | 3 | 4;
  date: IsoDate;
}

/**
 * The weekly check-in's answers (checkin.md), one record per check-in date.
 * Records in Coach/checkins.json carry `date` and `weekStart`; `weekOf`,
 * `rir`, `unloggedSessions`, `answers` and `note` are the first v1 fields,
 * still read. Scales follow checkin.md's options (formats.md has the mapping).
 */
export interface WeeklyCheckin {
  /** The check-in date (the Sunday of the week reviewed, or the day it happened). */
  date?: IsoDate;
  /** The reviewed week's Monday. */
  weekStart?: IsoDate;
  /** First v1 field: the week's Monday (same as weekStart). */
  weekOf?: IsoDate;
  /** "Recovered by the next session?" 1-5: sore all week 1, often still sore 2, mostly 4, always 5. */
  recovery?: number;
  /** "How hard did the week's training feel overall?" 1-10: easy 5, solid 7, hard 9, too much 10. */
  effort?: number;
  /** "How was the week outside training?" 1-5: calm 1, normal 2, busy 4, crunch, travel or illness 5. */
  stress?: number;
  /** "How much did you look forward to sessions?" 1-5: dreaded 1, meh 2, fine 4, a lot 5. */
  enjoyment?: number;
  /** The week's energy and sleep quality on the morning check-in's 1-5 scales (not asked in checkin.md). */
  energy?: number;
  sleepQuality?: number;
  /** "Any pain or niggle?": the list (empty for none); true or false in first-v1 records. */
  jointAches?: boolean | JointAche[];
  /** First v1 field: reported RIR per exercise id. */
  rir?: Record<string, number>;
  /** "How many more clean reps were left?" on the logged top sets: one number, or per main lift. */
  reportedRir?: number | Record<string, number>;
  /** Before 0.14.0: days the protein target was reached, 0-7 (the ticks at the check-in plus the answer). Still read when `proteinExtra` is absent. */
  proteinDays?: number;
  /**
   * The unticked days the Sunday check-in says reached the protein target,
   * 0-7. The week's protein days are its ticks, counted when read, plus
   * these (at most the week's days), so a tick that comes after the answer
   * is never counted twice.
   */
  proteinExtra?: number;
  /** The eating plan's weekly pattern, a tap per line: met this week (true) or not (false), by the line's id. */
  pattern?: Record<string, boolean>;
  /** First v1 field: sessions done but not logged, as a count. */
  unloggedSessions?: number;
  /** Sessions done but not logged, after asking, with their dates and session type. */
  confirmedUnlogged?: { date: IsoDate; type?: string }[];
  /** Days the user says were planned rest, or missed sessions. */
  restDays?: IsoDate[];
  missedDays?: IsoDate[];
  deload?: {
    /** The user cancels the deload in the week after the check-in. */
    cancelled?: boolean;
    reason?: string;
    /** Mondays of dashboard deload weeks that were trained at full load. */
    trainedAtFullLoad?: IsoDate[];
  };
  /** Where the letter left off on the stall triage ladder, per lift. */
  triage?: TriageRecord[];
  /** Known travel or crunch periods ahead. */
  knownBusy?: BusyPeriod[];
  /** The last letter's focus was followed. */
  focusFollowed?: boolean;
  answers?: Record<string, string>;
  note?: string;
  notes?: string;
  /** The letter's path in the vault. */
  letter?: string;
}

export interface Checkins {
  schemaVersion: SchemaVersion;
  daily: DailyCheckin[];
  weekly: WeeklyCheckin[];
}

// ---------------------------------------------------------------- body

export interface WeighIn {
  date: IsoDate;
  weight: number;
  unit: Unit;
}

export interface TapeEntry {
  date: IsoDate;
  unit: 'cm' | 'in';
  waist?: number;
  hips?: number;
  chest?: number;
  arm?: number;
}

export interface TestEntry {
  date: IsoDate;
  /** Test id to result, e.g. { pushups: 30, wallGapCm: 4 }. */
  results: Record<string, number>;
}

export interface PhotoSet {
  date: IsoDate;
  poses: string[];
  folder?: string;
}

export interface Body {
  schemaVersion: SchemaVersion;
  weights: WeighIn[];
  tape: TapeEntry[];
  tests: TestEntry[];
  photos: PhotoSet[];
}

// ---------------------------------------------------------------- ledger

/** A Ledger entry's constraint on exercise choice, in force through `until` (inclusive). */
export interface LedgerConstraint {
  id: string;
  area?: string;
  noTags?: readonly RiskTag[];
  noMovements?: readonly string[];
  until?: IsoDate;
  note?: string;
}

/** The machine-readable twin of the coach's Ledger: the constraints the plan must respect. */
export interface Ledger {
  schemaVersion: SchemaVersion;
  constraints: LedgerConstraint[];
}

// ---------------------------------------------------------------- the check-in log

/** Coach/checkins.json: the weekly check-in records, one per check-in date. */
export interface CheckinLog {
  schemaVersion: SchemaVersion;
  checkins: WeeklyCheckin[];
}

// ---------------------------------------------------------------- the eating plan

/** How much the user counts (diet.md's levels): light is hand portions and meal templates, nothing counted. */
export const EATING_LEVELS = ['light', 'standard', 'full'] as const;
export type EatingLevel = (typeof EATING_LEVELS)[number];

/** The eating-history screen's outcome: counting allowed, or none (any answer but No). */
export const COUNTING = ['allowed', 'none'] as const;
export type Counting = (typeof COUNTING)[number];

/** The Light level's hand measures: a palm of protein, a fist of vegetables, a cupped hand of carbs, a thumb of fats. */
export const HAND_KINDS = ['palm', 'fist', 'cupped', 'thumb'] as const;
export type HandKind = (typeof HAND_KINDS)[number];

/** How often a pattern line counts: a weekly target, or a daily one answered for the week. */
export const PATTERN_PERIODS = ['week', 'day'] as const;
export type PatternPeriod = (typeof PATTERN_PERIODS)[number];

/** The adjustment rule's two steps: one cupped hand of carbs less a day, or one back. */
export const ADJUST_STEPS = ['less', 'back'] as const;
export type AdjustStepId = (typeof ADJUST_STEPS)[number];

/** A reason as the coach kept it when the plan was made (the engine's protein rule at the time). */
export interface StoredReason {
  rule: string;
  title?: string;
  inputs?: Record<string, unknown>;
  threshold?: unknown;
  note?: string;
}

/** One meal of the plan, with its rough protein in grams [low, high] (a guide at the Light level, never a count). */
export interface EatingMeal {
  id: string;
  name: string;
  /** A short label under the name ("As now", "The hardest meal"). */
  tag?: string;
  text: string;
  proteinG: [number, number];
  /** The key of its hand portions in `portions`. */
  portions?: string;
  /** A one-line tip under the meal. */
  tip?: string;
  /** When it is eaten ("12:30"): its place on the Food tab's day. */
  at?: string;
  /** The foods for each hand of its portions, by food group id ("fish, chicken or lamb"). */
  foods?: Record<string, string>;
  /** Concrete meals that fit it; the Food tab shows one a day and steps through the rest. */
  ideas?: MealIdea[];
  /** A line for the kind of day it changes: before training on a lifting day. */
  trainingNote?: { lift?: string; short?: string };
}

/** One meal idea, and the weekly pattern lines it helps (pattern ids: fish, legumes). */
export interface MealIdea {
  text: string;
  counts?: string[];
}

/** Where a reason of the plan comes from: an intake answer, or the user's own words. */
export const REASON_SOURCES = ['intake', 'said'] as const;
export type ReasonSource = (typeof REASON_SOURCES)[number];

/** One reason for the plan, tied to the intake ("From your intake: ...", "You said: ..."). */
export interface PlanReason {
  id: string;
  /** The Food tab's icon for it (target, palm, heart, fish...); another draws a plain one. */
  icon?: string;
  title: string;
  text: string;
  source?: { kind: ReasonSource; text: string; field?: string; aside?: string };
}

/** A session's time on the Food tab's day: when it starts and roughly how long. */
export interface TrainingTime {
  at: string;
  minutes?: number;
}

/** The user's day as the Food tab draws it: up, work, bed, when training falls and the drinks. */
export interface EatingDay {
  wake?: string;
  /** Work from and to ("09:00", "17:00"). */
  work?: [string, string];
  bed?: string;
  /** By the kind of day the plan's rotation gives: a lifting day, a short-session day. */
  training?: { lift?: TrainingTime; short?: TrainingTime };
  drinks?: { waterL?: number; milkGlasses?: number; coffees?: [number, number]; lastCoffee?: string };
}

/** A light check on the Food tab's Today: a tap per slot, never a score; it pre-fills the pattern line of the same id at the Sunday check-in. */
export interface OptionalCheck {
  id: string;
  label: string;
  /** The taps ("Lunch", "Dinner"); a day meets the line when they reach its min. */
  slots: string[];
}

/** One of the coach's tips on the Food tab, with what it helps (a meal id, "pattern.fish", "looseDay"). */
export interface CoachTip {
  id: string;
  icon?: string;
  title: string;
  text: string;
  for?: string;
}

/** A food group of the plate guide and the hand that measures it, with its words ["palm", "palms"]. */
export interface FoodGroup {
  id: string;
  name: string;
  hand: HandKind;
  hands: [string, string];
  what?: string;
}

/** One line of the weekly pattern: answered once a week at the Sunday check-in, met or not. */
export interface PatternLine {
  id: string;
  name: string;
  /** In words: "twice a week or more". */
  target: string;
  min?: number;
  max?: number;
  per: PatternPeriod;
}

/** One step of the adjustment rule, as the plan words it; `pctPerWeek` is the rate that sets off "back" (-0.01: losing faster than 1 % a week). */
export interface AdjustStep {
  id: AdjustStepId;
  when: string;
  then: string;
  pctPerWeek?: number;
}

/** A step the coach took, so the rule waits before the next one. */
export interface AdjustApplied {
  date: IsoDate;
  step: AdjustStepId;
  note?: string;
}

/** The plan's adjustment rule: what the tape and the weight trend change, one step at a time. */
export interface AdjustRule {
  /** Weeks of tape the waist must be flat over. */
  windowWeeks: number;
  /** Flat: the waist within this many cm of where its weeks of tape started (the tape's half-centimetre step). */
  flatCm: number;
  steps: AdjustStep[];
  /** Wait at least the low end, in weeks, after a step before the next check. */
  waitWeeks: [number, number];
  /** Creatine's water in its first weeks, in kg: no step for it. */
  creatineKg?: [number, number];
  /** When creatine started (else the tracked creatine item's start). */
  creatineFrom?: IsoDate;
  /** How long its water counts as "the first weeks" (default 4). */
  creatineWeeks?: number;
  /** What to do after a loose day. */
  looseDay?: string;
  /** The steps taken, oldest first. */
  applied?: AdjustApplied[];
}

/**
 * Coach/eating-plan.json: the machine-readable twin of Coach/Eating plan.md,
 * written by the diet job through `engine eating` and drawn by Pahlavan's
 * Food tab.
 */
export interface EatingPlan {
  schemaVersion: SchemaVersion;
  /** The plan's date (Eating plan.md's `updated`). */
  updated: IsoDate;
  /** The Markdown it mirrors. */
  source?: string;
  level: EatingLevel;
  /** When the eating-history and medical-diet questions were asked. */
  screened?: IsoDate;
  counting?: Counting;
  /** The goal the plan serves (the profile's weight goal). */
  goal: GoalKind;
  /** The next review: the adjustment rule's first check. */
  review: IsoDate;
  /** The trend weight the grams were set from, its date and how many weigh-ins it rested on. */
  basis: { trendKg: number; date: IsoDate; weighIns: number };
  protein: {
    /** The day's floor: the protein item is ticked at it. */
    floorG: number;
    rangeG: [number, number];
    gPerKg: [number, number];
    perMealG: [number, number];
    /** The tracked item it ticks (Coach/tracking.json), linked to the linked habit. */
    item?: string;
    /** The evening card's time. */
    tickAt?: string;
    reason?: StoredReason;
  };
  fiber?: { g: number; per1000kcal?: number; how?: string[] };
  /** The coach's reference: shown only at the Standard and Full levels. */
  energy?: { maintenanceKcal: number; targetKcal?: [number, number] };
  habits?: { meals: number; snacks?: boolean; cooking?: string; avoid?: string[] };
  meals: EatingMeal[];
  /** Hand portions per meal: group id to [low, high] hands. */
  portions?: Record<string, Record<string, [number, number]>>;
  groups?: FoodGroup[];
  /** For the meal the plan calls hardest: the first answer and quick ones. */
  fallbacks?: { meal: string; first?: { name: string; text: string }; quick: { name: string; text: string }[]; minutes?: number };
  pattern?: PatternLine[];
  /** The rest of the pattern, in words. */
  patternAlso?: string;
  adjust?: AdjustRule;
  /** Eating plan.md's History lines. */
  history?: { date: IsoDate; note: string }[];
  note?: string;
  // The Food tab's words, each optional: the coach writes them, and the tab builds a short line without them.
  /** The goal in plain words ("Build muscle, lose a little fat"). */
  goalLabel?: string;
  /** The approach in a sentence or two. */
  summary?: string;
  /** Why this plan: each reason with its source in the intake. */
  why?: PlanReason[];
  /** The user's day: the times the Food tab's timeline draws, with each meal's `at`. */
  day?: EatingDay;
  /** The light checks on the Food tab's Today. */
  today?: { optional?: OptionalCheck[] };
  /** The coach's tips, three or four. */
  tips?: CoachTip[];
}

// ---------------------------------------------------------------- desk breaks in the program

/** One step of a desk-break routine: the movement, its dose and a one-line how-to. */
export interface DeskStep {
  name: string;
  dose: string;
  how?: string;
}

/** One reason the plan has desk breaks, and what it rests on (intake, the photo assessment, plan). */
export interface DeskWhy {
  what: string;
  from: string;
}

/** The plan's desk breaks: a short routine every `every` minutes between `from` and `to` on `days`. */
export interface DeskBreaks {
  steps: DeskStep[];
  /** Minutes between breaks. */
  every: number;
  /** The working hours, HH:MM local time. */
  from: string;
  to: string;
  /** About how long one break takes, in minutes. */
  minutes: number;
  days: Weekday[];
  why?: DeskWhy[];
}

/** The intake's desk-work answer: whether the user works at a desk, and for how long a day. */
export interface DeskWork {
  desk: boolean;
  /** Hours seated on a working day. */
  sittingHours?: number;
}

// ---------------------------------------------------------------- tracking (Coach/tracking.json)

/**
 * What a tracked item is: something taken with a dose, a daily amount, a
 * tick, stand-ups, a sitting-time limit or a desk-break routine.
 */
export const ITEM_KINDS = ['supplement', 'amount', 'tick', 'standup', 'sitting', 'desk'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** When in the day a supplement, tick or amount belongs (the reminder's slot). */
export const ITEM_SLOTS = ['morning', 'midday', 'evening', 'bedtime', 'training', 'time', 'day'] as const;
export type ItemSlot = (typeof ITEM_SLOTS)[number];

/** Which days an item is due: every day, training days, rest days, chosen weekdays, every N days. */
export const SCHEDULE_KINDS = ['daily', 'training', 'rest', 'weekdays', 'every'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export interface ItemSchedule {
  kind: ScheduleKind;
  /** `weekdays`: the days it is due. */
  days?: Weekday[];
  /** `every`: every n days, counted from `from` (the item's start when left out). */
  n?: number;
  from?: IsoDate;
}

/**
 * The item's reminder card; left out, there is none (Today still lists it).
 * Supplements and ticks: `at` a time (items with the same time share one
 * card) or `afterLog` (when a session is logged). Amounts: `at`, or `every`
 * minutes from `from` to `to` until the target. Sitting: a card at
 * `atMinutes` of sitting, and `stretch` when a stretch reaches its limit.
 * Stand-ups and desk breaks have their own cards and take no reminder.
 */
export interface ItemReminder {
  at?: string;
  afterLog?: boolean;
  every?: number;
  from?: string;
  to?: string;
  atMinutes?: number;
  stretch?: boolean;
}

/** Who added an item: the coach (with the reason, shown as "Suggested by your coach") or the user. */
export interface ItemSource {
  by: 'coach' | 'user';
  why?: string;
  /** Where it came from: intake, eating plan, plan, letter, or Habit Nudges (brought over). */
  from?: string;
  /** The day it was added or accepted. */
  on?: IsoDate;
}

/** A pause: from a day, through `to` (inclusive; open while it lasts). */
export interface ItemPause {
  from: IsoDate;
  to?: IsoDate;
}

export interface AmountConfig {
  target: number;
  unit: string;
  /** The quick-add buttons on its card. */
  quick?: number[];
}

/** Stand-ups: sit `sitMinutes` of active use, then stand `standMinutes` (Habit Nudges' stand settings). */
export interface StandupConfig {
  sitMinutes: number;
  standMinutes: number;
  /** One snooze per round, this long. */
  snoozeMinutes: number;
  /** The daily target, in minutes standing. */
  targetMinutes: number;
  /** The hours it runs, HH:MM to HH:MM; all day when left out. */
  hours?: [string, string];
  /** A call (microphone or camera on) holds the count and the card. */
  pauseCalls: boolean;
  /** The vault path of the helper that tells whether a call is on. */
  helper?: string;
  /** Count only while the keyboard or mouse was used in the last `activeSeconds`. */
  activeOnly: boolean;
  activeSeconds: number;
  /** This long without input starts the count over. */
  awayMinutes: number;
  /** This long without input ends a stand uncounted. */
  standAwayMinutes: number;
}

/** Sitting time: a daily limit and a longest-stretch limit; `awayMinutes` without input ends a stretch. */
export interface SittingConfig {
  limitMinutes: number;
  stretchMaxMinutes: number;
  awayMinutes: number;
}

/** Desk breaks: the plan's routine and times (`followPlan`), or the item's own. */
export interface DeskConfig {
  followPlan: boolean;
  every: number;
  from: string;
  to: string;
  minutes: number;
  /** The item's own routine (used when not following the plan, or when the plan has none). */
  steps?: DeskStep[];
}

/** An item's earlier settings, in force through `until`: a change applies from the next day on. */
export interface ItemVersion {
  until: IsoDate;
  schedule?: ItemSchedule;
  amount?: AmountConfig;
  standup?: StandupConfig;
  sitting?: SittingConfig;
  desk?: DeskConfig;
}

export interface TrackedItem {
  /** Lowercase, dashes. */
  id: string;
  kind: ItemKind;
  name: string;
  schedule: ItemSchedule;
  /** The first day it counts. */
  start: IsoDate;
  source: ItemSource;
  when?: ItemSlot;
  /** `when: training`: before or after the session. */
  whenDetail?: 'before' | 'after';
  reminder?: ItemReminder;
  pauses?: ItemPause[];
  /** A linked habit id in habits-data.json: ticks go there too, and its ticks from the item's start feed the stats. */
  habit?: string;
  note?: string;
  /** Supplements: the dose, as written ("5 g"). */
  dose?: string;
  /** Ticks: what done means ("all teeth"). */
  means?: string;
  /** Ticks: a numeric goal shown with it (protein: grams a day, ticked when hit). */
  goal?: { amount: number; unit: string };
  amount?: AmountConfig;
  standup?: StandupConfig;
  sitting?: SittingConfig;
  desk?: DeskConfig;
  earlier?: ItemVersion[];
}

/**
 * One item's record for one day: `done` for supplements and ticks; the
 * day's `amount` for amounts; standing `minutes` and stand-ups `count` for
 * stand-ups, with `deskMinutes`, the part of those minutes stood at the
 * desk with "Standing now" on; breaks `count` for desk breaks; `at`, when it
 * last changed. Sitting time lives in Coach/sitting.json.
 */
export interface ItemDay {
  done?: boolean;
  amount?: number;
  minutes?: number;
  count?: number;
  /** Stand-ups: of `minutes` (and `count`'s stands), the minutes logged as desk stands; the rest came from the stand-up card. */
  deskMinutes?: number;
  at?: string;
}

export const SUGGESTION_STATES = ['open', 'accepted', 'dismissed'] as const;
export type SuggestionState = (typeof SUGGESTION_STATES)[number];

/** A coach suggestion: the item as it would be added, open until accepted or dismissed. */
export interface ItemSuggestion {
  id: string;
  item: TrackedItem;
  on: IsoDate;
  state: SuggestionState;
  /** The day it was accepted or dismissed. */
  decided?: IsoDate;
}

/** The morning check-in's reminder (set on its card in Check-in). */
export interface MorningReminder {
  on: boolean;
  at: string;
}

/**
 * When the tape, photos and tests are due: from the plan (tape every second
 * Sunday, photos in each deload week, tests at each phase end; the plan's
 * own test weeks, when it lists them, have the tests and a photo set too),
 * or every N days from a start date (before there is a plan, or by choice).
 */
export interface BodyRecordSchedule {
  schedule: 'plan' | 'fixed';
  tapeFrom?: IsoDate;
  tapeEvery?: number;
  testsFrom?: IsoDate;
  testsEvery?: number;
}

/** Coach/tracking.json: what is tracked, its log, the coach's suggestions and the check-in reminders. */
export interface Tracking {
  schemaVersion: SchemaVersion;
  items: TrackedItem[];
  /** Day to item id to that item's record. */
  days: Record<IsoDate, Record<string, ItemDay>>;
  suggestions?: ItemSuggestion[];
  morning?: MorningReminder;
  bodyRecord?: BodyRecordSchedule;
  /** The one-time bring-over from Habit Nudges: when, and the items it brought. */
  bringOver?: { on: IsoDate; items: string[] };
}

// ---------------------------------------------------------------- reminder state (Coach/nudges.json)

/** An answer on a card: saved, skipped for today, not today, or the "Did you train?" choices. */
export const NUDGE_ANSWERS = ['done', 'skipped', 'later', 'logged', 'rest', 'not-today'] as const;
export type NudgeAnswer = (typeof NUDGE_ANSWERS)[number];

/** A moment as an ISO timestamp in UTC, as the plugin writes it ("2026-04-10T07:10:00.000Z"). */
export type Timestamp = string;

/** One reminder's state on one day, shared by every Mac: answered, snoozed, the last one shown. */
export interface NudgeEntry {
  how?: NudgeAnswer;
  /** When it was answered. */
  at?: Timestamp;
  /** Snoozed (or closed) until then. */
  snoozedUntil?: Timestamp;
  /** Repeating cards (amounts, desk breaks): the last one answered; the next is counted from here. */
  lastAt?: Timestamp;
  /** What the answer was for: a sitting stretch's start. */
  for?: string;
  /** The Mac that answered. */
  by?: string;
}

/**
 * Coach/nudges.json: reminder state per day and reminder key (`morning`,
 * `tape`, `photos`, `tests`, `train`, `slot:HH:MM`, `slot:after-log`,
 * `amount:<item>`, `desk:<item>`, `sitting:<item>`, `sitting:<item>:stretch`,
 * `standup:<item>`), and the body-record occurrences skipped
 * (`photos:<date>`, `tests:baseline`) with when.
 */
export interface NudgeState {
  schemaVersion: SchemaVersion;
  days: Record<IsoDate, Record<string, NudgeEntry>>;
  skipped?: Record<string, Timestamp>;
}

// ---------------------------------------------------------------- sitting time (Coach/sitting.json)

/** A stretch of sitting: the first input to the last (a call counts), on one local day. */
export interface SittingStretch {
  start: Timestamp;
  end: Timestamp;
}

/** Coach/sitting.json: the stretches per local day and per Mac (each Mac writes only its own). */
export interface SittingLog {
  schemaVersion: SchemaVersion;
  days: Record<IsoDate, Record<string, SittingStretch[]>>;
}

// ---------------------------------------------------------------- the phone's inbox (Coach/Inbox/*.json)

/**
 * The phone entry format's version, `v` (not `schemaVersion`: an entry is a
 * message the phone's shortcuts send, one new file each, not a file Pahlavan
 * keeps). Pahlavan applies it through its own writers and moves it on.
 */
export const INBOX_VERSION = 1;

/** What a phone entry logs: a session, habit ticks, an amount, the morning check-in, the evening "Did you train today?". */
export const INBOX_KINDS = ['session', 'tick', 'amount', 'morning', 'trained'] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** "Did you train today?" from the phone: trained (with no session logged yet), a rest day, or missed. */
export const TRAINED_ANSWERS = ['trained', 'rest', 'missed'] as const;
export type TrainedAnswer = (typeof TRAINED_ANSWERS)[number];

/**
 * A logged lift's top set, as the log takes it; the unit, when left out, is
 * the lift's own in the plan. At Every set only (`trackingLevel: "full"`) a
 * swap names the lift done (`name`) and the plan's logged item it replaces
 * (`planned`), with the swap's reason when known, as `engine log add` takes
 * them; a lift without `planned` is the plan's.
 */
export interface InboxLift {
  name?: string;
  planned?: string;
  swapWhy?: SwapReason;
  weight: number;
  reps: number;
  unit?: Unit;
}

/** One set logged at Every set, as `engine log add` takes it: weight and unit only on a loaded exercise (null or left out for bodyweight), reps seconds on a timed one. */
export interface InboxSet {
  weight?: number | null;
  unit?: Unit | null;
  reps: number;
  /** 0 to 10. */
  rir?: number | null;
}

/**
 * A session from the phone: one of the plan's sessions, its two logged
 * lifts (lifting days only) and what the Log panel's quick fields hold. At
 * Every set (the gym page's entry, `trackingLevel: "full"`) also every set
 * by exercise, a swapped lift's names, the other swaps, the checklist lines
 * skipped and why, and the cardio minutes: `engine log add`'s fields,
 * checked as it checks them. Those go with `trackingLevel` only.
 */
export interface InboxSessionFields {
  type: string;
  lift1?: InboxLift;
  lift2?: InboxLift;
  durationMin?: number;
  express?: boolean;
  /** How it went, 1 to 10 (the Log panel's Session rating). */
  rating?: number;
  notes?: string;
  trackingLevel?: 'full';
  /** Every set done, one item per exercise (each part of a superset its own); a swap names the plan's item as `planned`. */
  exerciseSets?: { name: string; planned?: string; sets: InboxSet[] }[];
  /** Every swap but the logged lifts' (they carry their own): the plan's item, the one done, and why when known. */
  swaps?: { from: string; to: string; why?: SwapReason }[];
  /** The checklist lines not done, by name as the Log panel names them. */
  skipped?: string[];
  /** Why a skipped line was skipped, by its name in `skipped`. */
  skipWhy?: Record<string, SkipReason>;
  /** Cardio minutes, 0 to 600. */
  cardioMin?: number;
  /** How the cardio was done, as the Log panel's pills write it ("bike"), or the plan's. */
  cardioMode?: string;
}

/** The morning check-in's fields (body-data.json's names); steps and floors are yesterday's, as the card asks them. */
export interface InboxMorningFields {
  energy?: number;
  soreness?: number;
  sleepQ?: number;
  sleepH?: number;
  rhr?: number;
  /** Heart rate variability, ms. */
  hrv?: number;
  weight?: number;
  steps?: number;
  floors?: number;
  /** The weight's unit (kg when left out); body-data.json holds kg. */
  weightUnit?: Unit;
}

interface InboxBase {
  v: typeof INBOX_VERSION;
  /** When the phone sent it: an ISO timestamp, with the phone's offset ("2026-11-05T19:02:00-05:00") or in UTC. */
  at: string;
  /** The day it counts for. */
  date: IsoDate;
}

/** One phone entry, as one file in Coach/Inbox/. */
export type InboxEntry =
  | (InboxBase & { kind: 'session'; session: InboxSessionFields })
  | (InboxBase & { kind: 'tick'; ids: string[]; done?: boolean })
  | (InboxBase & { kind: 'amount'; id: string; add: number })
  | (InboxBase & { kind: 'morning'; morning: InboxMorningFields })
  | (InboxBase & { kind: 'trained'; answer: TrainedAnswer });
