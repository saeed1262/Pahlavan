// The vault adapter: the dashboard's files read into schema v1.
//
//   plan-data.json          -> Program (templates, lifts, muscles, until changes)
//   fitness-log-data.json   -> Session[] (top sets at Standard tracking, every set at Full, snapshots)
//   body-data.json          -> Checkins.daily and Body (weights, tape, tests, photos)
//   habits-data.json        -> DailyCheckin.trained and .protein
//   Coach/profile.json      -> Profile (schema v1, the twin of Athlete profile.md)
//   Coach/ledger.json       -> Ledger (the twin of Ledger.md's constraints)
//
// Pure and read-only: the caller reads the files (read.ts) and passes the
// parsed JSON; nothing here writes. Unknowns become warnings, never crashes.

import { normalizeEquipment } from '../../core/plan/context.ts';
import { calibrateSlot, calibrateTimedSlot } from '../../core/calibration.ts';
import { CATALOGUE_BY_ID } from '../../core/data/exercises.ts';
import { MUSCLE_IDS, MUSCLES } from '../../core/data/muscles.ts';
import { parentMissingText, REGION_IDS, regionProblems } from '../../core/data/regions.ts';
import { newestBaseline } from '../../core/cycle.ts';
import { addDays, dayText, daysBetween, isIsoDate, mondayOf } from '../../core/dates.ts';
import { deskBreaksFromPlanData, deskTimingFromPlanData } from '../../core/desk-breaks.ts';
import { swapReasonOf } from '../../core/exercise-facts.ts';
import { loadKindOf, weightsFor } from '../../core/loads.ts';
import {
  dashboardSets,
  deloadSr,
  exerciseId,
  itemFieldProblems,
  itemRir,
  itemSets,
  itemTimed,
  ladderLevelOn,
  ladderStartOf,
  parseNote,
  parseSr,
  phaseNamesFrom,
  planStartOf,
  toEngineMuscles,
  type ExerciseExtras,
  type LadderLevelFrom,
  type PlanData,
  type PlanDataGuide,
  type PlanDataItem,
  type PlanDataLift,
  type SlotExtras,
} from '../../core/plan-data.ts';
import {
  SCHEMA_VERSION,
  SKIP_REASONS,
  type Body,
  type CheckinLog,
  type Checkins,
  type DailyCheckin,
  type EatingPlan,
  type Exercise,
  type ExerciseLog,
  type ExerciseSlot,
  type IsoDate,
  type Ledger,
  type LoggedSet,
  type Mesocycle,
  type Phase,
  type PhotoSet,
  type PlanSnapshot,
  type Profile,
  type Program,
  type RepRange,
  type Session,
  type SessionPain,
  type SkipReason,
  type SorenessLevel,
  type SwapReason,
  type SessionTemplate,
  type TapeEntry,
  type TestEntry,
  type Unit,
  type Week,
  type WeighIn,
} from '../../core/schema.ts';
import { validateBody, validateCheckinLog, validateCheckins, validateEatingPlan, validateLedger, validateProfile, validateProgram, validateSession } from '../../core/validate.ts';
import { explain, type Reason } from '../../core/reason.ts';
import { isLightWeek, LEGACY_DEFAULT_MESSAGE, legacyItems, lightWeekAt, nextLightWeek, planCalendar, readRules, weeksThrough, type ReadRules } from '../../core/rules.ts';
import { readPlanWhy, type ReadPlanWhy } from '../../core/plan-why.ts';
import { canonicalTags, differsItem, tagsText } from './muscle-tags.ts';

export interface VaultWarning {
  code: string;
  message: string;
  items?: string[];
}

export interface VaultFiles {
  plan: unknown;
  log?: unknown;
  body?: unknown;
  habits?: unknown;
  /** Dates of the "Baseline - <date>.md" notes in the fitness folder (the cycle starts). */
  baselines?: readonly string[];
  /** Coach/profile.json, parsed; undefined when the file does not exist. */
  profile?: unknown;
  /** Coach/ledger.json, parsed; undefined when the file does not exist. */
  ledger?: unknown;
  /** Coach/checkins.json (the weekly check-in log), parsed; undefined when the file does not exist. */
  checkins?: unknown;
  /** Coach/eating-plan.json (the eating plan, for the Food tab), parsed; undefined when the file does not exist. */
  eating?: unknown;
}

export type CoachFileState = 'ok' | 'missing' | 'invalid';

/** A logged lift's settings from plan-data's `lifts`. */
export interface LiftInfo {
  exercise: string;
  name: string;
  short?: string;
  unit: Unit;
  increment: number;
  repRange: RepRange;
}

export interface LadderInfo {
  id: string;
  name: string;
  levels: string[];
  history: { level: number; date: IsoDate }[];
  /** A plan session (one of the plan's lifting or short types) has an item on this ladder ("Pull-up (your level)"). */
  carried: boolean;
  /** The plan's starting level (plan-data's `startLevel`), when it declares one among the levels; the count reads it before any level is logged (ladderLevelOn). */
  startLevel?: number;
}

export interface VaultPlanInfo {
  liftUnit: Unit;
  weekTarget: { lift: number; short: number };
  /** Session types in rotation order, with their template ids and display names ("Full Body A", "Short 1"). */
  types: { type: string; template: string; kind: 'lift' | 'short'; label: string }[];
  /** The plan's Express block (the 20-minute version of a lifting day). */
  express: { warmup: string | null; mainSets: number; secondSets: number; finish: { exercise: string; name: string; sets: number; repRange: RepRange; sr: string } | null } | null;
  /** The plan's warm-ups, for lifting and short days. */
  warmups: { lift: string | null; short: string | null };
  /** Week 1's Monday: plan-data's `start`, else the first logged plan session (the dashboard's clock), else the cycle start; null before any, and with no plan. */
  start: IsoDate | null;
  /** Where `start` comes from: plan-data's own `start`, the first logged plan session, or the cycle start (null with none). */
  startFrom?: 'plan' | 'log' | 'cycle' | null;
  /** The newest "Baseline - <date>.md": weight trends start here. */
  cycleStart: IsoDate | null;
  /** Every "Baseline - <date>.md" date in the fitness folder, oldest first (the cycle rule picks from them by date). */
  baselines: IsoDate[];
  /** The plan's length in weeks: plan-data's `weeks` (whole mesocycles), else the dashboard's 24. */
  weeks: number;
  /** plan-data's muscle groups, as engine ids, in the file's order. */
  muscles: string[];
  lifts: LiftInfo[];
  ladders: LadderInfo[];
}

export interface VaultData {
  program: Program;
  sessions: Session[];
  checkins: Checkins;
  body: Body;
  profile: Profile | null;
  ledger: Ledger | null;
  /** The eating plan (Coach/eating-plan.json), or null: none yet, or invalid (an error says why). */
  eatingPlan: EatingPlan | null;
  coach: { profile: CoachFileState; ledger: CoachFileState; checkins: CoachFileState; eating: CoachFileState };
  plan: VaultPlanInfo;
  /** Vault exercise id to the catalogue entry it matched. */
  catalogueMatch: Record<string, string>;
  /**
   * The coach's standing rules from plan-data.json (rules.ts): every kind,
   * the plan's own or the old default, and each logged lift's progression.
   */
  rules: ReadRules;
  /** The coach's reasons for the plan (plan-data.json's `why`, plan-why.ts): the Plan tab's Why this plan card. */
  why: ReadPlanWhy;
  warnings: VaultWarning[];
  /** Problems with the data itself (unreadable or invalid files). */
  errors: VaultWarning[];
}

export interface VaultOptions {
  /** Ladder levels and the program's length are taken as of this date (default: the latest data). */
  asOf?: IsoDate;
  /** No plan-data.json at all (a fresh vault, `assembleVault`): no plan weeks, whatever the log or the baseline note say. */
  noPlan?: boolean;
}

// ---------------------------------------------------------------- small helpers

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const asUnit = (v: unknown): Unit | null => (v === 'kg' || v === 'lb' ? v : null);
const templateId = (type: string) => exerciseId(type);
const defaultIncrement = (unit: Unit) => (unit === 'kg' ? 2.5 : 5);
const byDate = <T extends { date: string }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** The plan week of a date: week 1 holds the start's Monday. */
export function planWeekOf(start: IsoDate, date: IsoDate): number {
  return Math.floor(daysBetween(mondayOf(start), mondayOf(date)) / 7) + 1;
}

/** The date of `hab-<id>-<ISO year>-W<week>-<0=Mon>`; null when the key is malformed. */
export function isoWeekDate(year: number, week: number, weekday: number): IsoDate | null {
  if (!Number.isInteger(year) || year < 1000 || year > 9999 || !(week >= 1 && week <= 53) || !(weekday >= 0 && weekday <= 6)) return null;
  const week1 = mondayOf(`${year}-01-04`);
  const date = addDays(week1, 7 * (week - 1) + weekday);
  return date < mondayOf(`${year + 1}-01-04`) ? date : null;
}

class Notes {
  warnings: VaultWarning[] = [];
  errors: VaultWarning[] = [];
  private grouped = new Map<string, { message: string; items: Set<string> }>();
  warn(code: string, message: string): void {
    this.warnings.push({ code, message });
  }
  error(code: string, message: string): void {
    this.errors.push({ code, message });
  }
  /** One warning per code, listing every item. */
  group(code: string, message: string, item: string): void {
    const g = this.grouped.get(code) ?? { message, items: new Set<string>() };
    g.items.add(item);
    this.grouped.set(code, g);
  }
  flush(): void {
    for (const [code, g] of this.grouped) this.warnings.push({ code, message: g.message, items: [...g.items].sort() });
    this.grouped.clear();
  }
}

// ---------------------------------------------------------------- the plan

interface Usage {
  sets: boolean;
  minutes: boolean;
  rounds: boolean;
}

/** plan-data.json as the adapter reads it (its lists defaulted), or null when it is not a plan. */
export function readPlanData(raw: unknown): PlanData | null {
  return readPlan(raw, new Notes());
}

function readPlan(raw: unknown, notes: Notes): PlanData | null {
  if (!isObj(raw)) {
    notes.error('plan-data', 'plan-data.json is not a JSON object.');
    return null;
  }
  if (!isObj(raw['sessions'])) {
    notes.error('plan-data', 'plan-data.json has no "sessions" object.');
    return null;
  }
  const p = raw as unknown as PlanData;
  const sessions = raw['sessions'];
  const types = (v: unknown, kind: string) => {
    if (!Array.isArray(v)) {
      notes.warn('plan-data', `plan-data.json has no "${kind}" list; none assumed.`);
      return [];
    }
    return v.filter((t): t is string => isStr(t) && Array.isArray(sessions[t]));
  };
  const liftUnit = asUnit(raw['liftUnit']);
  if (!liftUnit) notes.warn('plan-data', `plan-data.json's liftUnit is ${JSON.stringify(raw['liftUnit'] ?? null)}; lb assumed.`);
  const wt = isObj(raw['weekTarget']) ? raw['weekTarget'] : {};
  if (!isNum(wt['lift']) || !isNum(wt['short'])) notes.warn('plan-data', 'plan-data.json has no complete weekTarget; missing counts taken as 0.');
  return {
    ...p,
    liftTypes: types(raw['liftTypes'], 'liftTypes'),
    shortTypes: types(raw['shortTypes'], 'shortTypes'),
    liftUnit: liftUnit ?? 'lb',
    weekTarget: { lift: isNum(wt['lift']) ? wt['lift'] : 0, short: isNum(wt['short']) ? wt['short'] : 0 },
    lifts: isObj(raw['lifts']) ? (raw['lifts'] as Record<string, PlanDataLift>) : {},
    guide: isObj(raw['guide']) ? (raw['guide'] as Record<string, PlanDataGuide>) : {},
    ladders: Array.isArray(raw['ladders']) ? (raw['ladders'] as PlanData['ladders']) : [],
    deloadS3: Array.isArray(raw['deloadS3']) ? (raw['deloadS3'] as PlanData['deloadS3']) : [],
    muscles: isObj(raw['muscles']) ? (raw['muscles'] as Record<string, string>) : {},
  };
}

export function ladderHistory(log: unknown): Record<string, { level: number; date: IsoDate }[]> {
  const out: Record<string, { level: number; date: IsoDate }[]> = {};
  const l = isObj(log) && isObj(log['ladders']) ? (log['ladders']) : {};
  for (const [id, h] of Object.entries(l)) {
    if (!Array.isArray(h)) continue;
    out[id] = h.filter((x): x is { level: number; date: string } => isObj(x) && isNum(x['level']) && isIsoDate(x['date']));
  }
  return out;
}

/**
 * The ladder level's name on a date: the log's level, else the plan's
 * `startLevel`, else level 1 (the dashboard's ladderNameAt read level 1
 * before any entry; a plan that declares its start reads that instead).
 */
export function ladderNameAt(plan: PlanData, history: Record<string, { level: number; date: IsoDate }[]>, id: string, date: IsoDate | null): string | null {
  const l = plan.ladders.find((x) => x.id === id);
  if (!l) return null;
  const { level } = ladderLevelOn(history[id] ?? [], ladderStartOf(l).level, date);
  return l.levels[level - 1]?.name ?? null;
}

// ---------------------------------------------------------------- the adapter

/** Reads the vault's files (already parsed) into schema v1. */
export function fromVault(files: VaultFiles, opts: VaultOptions = {}): VaultData {
  const notes = new Notes();
  const asOf = opts.asOf ?? null;
  const planRead = readPlan(files.plan, notes);
  const plan = planRead ?? ({
    weekTarget: { lift: 0, short: 0 },
    liftTypes: [],
    shortTypes: [],
    titles: {},
    shortNames: {},
    focus: {},
    warmups: { lift: '', short: '' },
    sessions: {},
    liftUnit: 'lb',
    lifts: {},
    express: { warmup: '', mainSets: '', secondSets: '', finish: { name: '', sr: '' } },
    deloadS3: [],
    ladders: [],
    laddersFor: {},
    ladderNote: '',
    guide: {},
    muscles: {},
    deskRoutine: [],
  });
  const liftUnit = plan.liftUnit;
  // The standing rules: the plan's own, else the old defaults (said once, in the legacy-default warning).
  const rules = readRules(planRead ? files.plan : undefined);
  const why = readPlanWhy(planRead ? files.plan : undefined);
  const ladders = ladderHistory(files.log);
  const guideKeys = new Map(Object.keys(plan.guide).map((k) => [k.toLowerCase(), k]));
  const liftKeys = new Map(Object.keys(plan.lifts).map((k) => [k.toLowerCase(), k]));
  // The same id the exercise gets (exerciseId): a lifts key that differs from the guide's beyond case still matches.
  const liftIds = new Map(Object.keys(plan.lifts).map((k) => [exerciseId(k), k]));
  const liftOf = (name: string): PlanDataLift | undefined => {
    const k = liftKeys.get(name.toLowerCase());
    return k ? plan.lifts[k] : undefined;
  };
  const unitOf = (name: string): Unit => asUnit(liftOf(name)?.unit) ?? liftUnit;

  // Exercises: every name the plan, the guide and the log use.
  const names = new Map<string, string>();
  const usage = new Map<string, Usage>();
  const ensure = (name: string): string => {
    const id = exerciseId(name);
    if (!names.has(id)) names.set(id, name);
    return id;
  };
  // How an exercise is done: sets, minutes or rounds (a `timed` field is minutes, whatever its sr says).
  const use = (id: string, sr: string, timedField = false) => {
    const u = usage.get(id) ?? { sets: false, minutes: false, rounds: false };
    const p = parseSr(sr);
    if (timedField) u.minutes = true;
    else if (p.sets !== null) u.sets = true;
    else if (p.rounds !== null) u.rounds = true;
    else if (p.minutes !== null) u.minutes = true;
    else u.sets = true;
    usage.set(id, u);
  };
  for (const k of Object.keys(plan.guide)) ensure(k);
  for (const k of Object.keys(plan.lifts)) ensure(k);
  for (const l of plan.ladders) for (const lv of l.levels ?? []) if (isStr(lv?.name)) ensure(lv.name);

  // Lifts.
  const lifts: LiftInfo[] = [];
  for (const [name, l] of Object.entries(plan.lifts)) {
    if (!isObj(l) || !isNum(l.lo) || !isNum(l.hi) || !isNum(l.inc) || l.lo < 1 || l.lo > l.hi || l.inc <= 0) {
      notes.warn('lift-entry', `lifts["${name}"] needs lo <= hi and a positive inc; left out of progression.`);
      continue;
    }
    if (l.unit !== undefined && !asUnit(l.unit)) notes.warn('lift-entry', `lifts["${name}"].unit is ${JSON.stringify(l.unit)}; ${liftUnit} assumed.`);
    lifts.push({ exercise: exerciseId(name), name, ...(isStr(l.short) ? { short: l.short } : {}), unit: unitOf(name), increment: l.inc, repRange: [Math.round(l.lo), Math.round(l.hi)] });
  }
  const liftInfo = new Map(lifts.map((l) => [l.exercise, l]));

  // Templates.
  // A session's display name: the dashboard's (a lifting title before its dash, a short day's short name).
  const titleOf = (type: string) => (isStr(plan.titles?.[type]) ? plan.titles[type] : type);
  const labelOf = (type: string, kind: 'lift' | 'short') =>
    kind === 'short' && isStr(plan.shortNames?.[type]) ? plan.shortNames[type] : titleOf(type).split(/\s+[\u2014\u2013-]\s+/)[0]!.trim() || type;
  const types = [
    ...plan.liftTypes.map((type) => ({ type, template: templateId(type), kind: 'lift' as const, label: labelOf(type, 'lift') })),
    ...plan.shortTypes.map((type) => ({ type, template: templateId(type), kind: 'short' as const, label: labelOf(type, 'short') })),
  ];
  // Each ladder's declared start; one that is not among its levels is said once and read around.
  const ladderStarts = new Map<string, number>();
  for (const l of plan.ladders) {
    if (!isObj(l) || !isStr(l.id)) continue;
    const s = ladderStartOf(l);
    if (s.problem) notes.warn('plan-data', s.problem);
    if (s.level !== null) ladderStarts.set(l.id, s.level);
  }
  const ladderLevelAt = (id: string) => ladderNameAt(plan, ladders, id, asOf);
  const itemExercise = (item: PlanDataItem): string => {
    if (item.ladder) {
      const lv = ladderLevelAt(item.ladder);
      // Neither a logged level nor a declared start: the item counts as the lowest level, which a plan that means a
      // harder one (a draft before its first logged level) undercounts. Say so, with how to declare the start.
      if (lv && ladderLevelOn(ladders[item.ladder] ?? [], ladderStarts.get(item.ladder), asOf).from === 'lowest') {
        notes.group(
          'ladder-start',
          `Ladder items with no level in the log and no starting level in the plan: the weekly sets assume the ladder's lowest level. Declare the level this plan starts at as the ladder's "startLevel" in plan-data.json ("startLevel": 6 starts it at the sixth level, as \`engine log ladder --level\` counts), or log the level with \`engine log ladder\`.`,
          `${item.ladder}: counted as level 1 (${lv})`,
        );
      }
      if (lv) return ensure(lv);
      notes.group('unknown-ladder', 'Items name a ladder plan-data does not define; the item itself is used.', item.ladder);
    }
    return ensure(item.name);
  };
  const rangeOf = (item: PlanDataItem, exercise: string): RepRange => {
    const lift = item.logged ? liftInfo.get(exerciseId(item.name)) : undefined;
    if (lift) return lift.repRange;
    return parseSr(item.sr).repRange ?? liftInfo.get(exercise)?.repRange ?? [1, 1];
  };
  const buildSlot = (type: string, item: PlanDataItem, lifting: boolean): ExerciseSlot & SlotExtras => {
    const exercise = itemExercise(item);
    // The item's own fields (rir, timed) first; one that is not well formed is read from the note instead.
    const problems = itemFieldProblems(item);
    if (problems.length) notes.group('plan-item-field', 'Plan items whose rir or timed field is not well formed: read from the note and sets as before.', `${type} ${item.name}: ${problems.join('; ')}`);
    const timed = itemTimed(item);
    const timedField = timed !== null && item.timed !== undefined && !problems.some((p) => p.startsWith('timed'));
    use(exercise, item.sr, timedField);
    // Every level of a ladder is done the way its item prescribes ("6 min" or sets).
    if (item.ladder) for (const lv of plan.ladders.find((l) => l.id === item.ladder)?.levels ?? []) if (isStr(lv?.name)) use(ensure(lv.name), item.sr, timedField);
    const note = parseNote(item.note);
    // A timed item's sets are its rounds (1 for steady minutes), never its minutes.
    const slot: ExerciseSlot & SlotExtras = {
      exercise,
      sets: itemSets(item),
      repRange: timedField ? [1, 1] : rangeOf(item, exercise),
      rir: itemRir(item)?.lo ?? 2,
    };
    if (timed) slot.timed = timed;
    if (lifting && item.logged) {
      slot.main = true;
      slot.progression = { rule: 'double' };
    }
    if (item.ladder) {
      const l = plan.ladders.find((x) => x.id === item.ladder);
      // The level above the one the item counts as (the same order: the log's, the plan's start, the lowest).
      const next = l?.levels[ladderLevelOn(ladders[item.ladder] ?? [], ladderStarts.get(item.ladder), asOf).level]?.name;
      slot.progression = next ? { rule: 'ladder', next: ensure(next) } : { rule: 'ladder' };
    }
    if (note.until) {
      if (!isIsoDate(note.until.date)) notes.warn('until', `${type} ${item.name}: "until ${note.until.date}" is not a date; ignored.`);
      else slot.until = { until: note.until.date, reason: note.until.reason, ...(note.replaces ? { note: `Replaces ${note.replaces}.` } : {}) };
    }
    if (isStr(item.note) && item.note.trim()) slot.note = item.note;
    slot._item = item;
    return slot;
  };
  const items = (type: string): PlanDataItem[] =>
    ((plan.sessions[type] ?? []) as unknown[]).filter((x): x is PlanDataItem => isObj(x) && isStr(x['name']) && isStr(x['sr']));
  const loading: (SessionTemplate & { _type: string })[] = types.map(({ type, template, kind }) => ({
    id: template,
    name: (isStr(plan.titles?.[type]) ? plan.titles[type] : type) || type,
    kind,
    slots: items(type).map((item) => buildSlot(type, item, kind === 'lift')),
    _type: type,
  }));
  // The light week (the plan's rule, else the dashboard's): every "N ×" becomes its sets; S3 becomes deloadS3.
  const lw = rules.rules.lightWeeks;
  const deloadSlots = (t: SessionTemplate & { _type: string }): ExerciseSlot[] => {
    if (t._type === 'S3' && plan.deloadS3.length) {
      return plan.deloadS3
        .filter((x) => isObj(x) && isStr(x.name) && isStr(x.sr))
        .map((x) => {
          const exercise = ensure(x.name);
          use(exercise, x.sr);
          const timed = itemTimed(x);
          return { exercise, sets: itemSets(x), repRange: parseSr(x.sr).repRange ?? [1, 1], rir: 2, ...(timed ? { timed } : {}) };
        });
    }
    // A timed item keeps its minutes: the light week halves sets, not cardio.
    return t.slots.map((s) => {
      const item = (s as SlotExtras)._item;
      const { _item: _i, ...rest } = s as ExerciseSlot & SlotExtras;
      return item && !s.timed && parseSr(item.sr).sets !== null ? { ...rest, sets: itemSets({ sr: deloadSr(item.sr, lw.sets) }) } : rest;
    });
  };
  const deload: SessionTemplate[] = loading.map((t) => ({ id: t.id, name: t.name, kind: t.kind, slots: deloadSlots(t) }));
  for (const x of [plan.express?.finish]) if (isObj(x) && isStr(x.name) && x.name.trim() && isStr(x.sr)) use(ensure(x.name), x.sr);

  // Sessions.
  const rawLog = isObj(files.log) ? files.log : {};
  if (files.log !== undefined && !isObj(files.log)) notes.error('log', 'fitness-log-data.json is not a JSON object.');
  const rawSessions = (Array.isArray(rawLog['sessions']) ? rawLog['sessions'] : []).filter((s): s is Obj => {
    const ok = isObj(s) && isIsoDate(s['date']) && isStr(s['type']);
    if (!ok) notes.group('bad-session', 'Sessions without a valid date or type were skipped.', JSON.stringify(s).slice(0, 80));
    return ok;
  });
  rawSessions.sort((a, b) => (String(a['date']) < String(b['date']) ? -1 : String(a['date']) > String(b['date']) ? 1 : 0));
  const planTypes = new Set([...plan.liftTypes, ...plan.shortTypes]);
  const firstPlan = rawSessions.find((s) => planTypes.has(String(s['type'])));
  // Week 1: the plan's own start when it names one (plan-data's `start`, the week holding
  // that date), so the plan weeks agree with the dates the coach chose from day one.
  // Without it, the Monday of the first logged plan session (the dashboard's clock); until the
  // current cycle (the newest baseline note on or before the date) has a plan session of its
  // own, the Monday of the cycle start, so a fresh start reads "Week 1" from day one.
  const own = planStartOf(files.plan);
  if (own.problem) notes.warn('plan-data', own.problem);
  const cycleNow = newestBaseline([...(files.baselines ?? [])].filter(isIsoDate), asOf ?? undefined);
  const cycleLogged = cycleNow === null || rawSessions.some((s) => planTypes.has(String(s['type'])) && String(s['date']) >= cycleNow);
  const startFrom: VaultPlanInfo['startFrom'] = opts.noPlan ? null : own.monday ? 'plan' : firstPlan && cycleLogged ? 'log' : cycleNow ? 'cycle' : null;
  const start = startFrom === 'plan' ? own.monday : startFrom === 'log' ? mondayOf(String(firstPlan!['date'])) : startFrom === 'cycle' ? mondayOf(cycleNow!) : null;

  const sessions: Session[] = [];
  const ids = new Map<string, number>();
  for (const s of rawSessions) {
    const date = String(s['date']);
    const type = String(s['type']);
    const lifting = plan.liftTypes.includes(type);
    const short = plan.shortTypes.includes(type);
    const label = isStr(s['label']) ? s['label'].trim() : '';
    let id = `${date}-${templateId(type)}${type === 'custom' && label ? `-${exerciseId(label)}` : ''}`;
    const n = (ids.get(id) ?? 0) + 1;
    ids.set(id, n);
    if (n > 1) id = `${id}-${n}`;
    if (!lifting && !short && type !== 'custom') notes.group('unknown-type', 'Sessions of a type plan-data does not list are counted as custom.', type);

    // Every set (the Log panel's "Every set": `trackingLevel: "full"` with `exerciseSets`): each
    // exercise's sets as logged, RIR included, and the session read at Full tracking. A set with no
    // weight is a bodyweight or timed one (0 in the exercise's unit); 0 x 0 is not logged.
    const exercises: ExerciseLog[] = [];
    const swapTo = new Map<string, string>();
    // Each swap's reason by the plan's name (a lift's `swapWhy`, a swap's `why`): mine, ledger, soreness or hotel; older entries have none.
    const swapWhy = new Map<string, SwapReason>();
    const whyOf = (from: string, raw: unknown) => {
      const why = swapReasonOf(raw);
      if (why) swapWhy.set(from, why);
      else if (why === undefined) notes.group('swap-why', 'Swap reasons other than mine, ledger, soreness or hotel were left out.', `${date} ${from}: ${JSON.stringify(raw)}`);
    };
    const everySet = new Map<string, ExerciseLog>();
    if (s['trackingLevel'] === 'full' && Array.isArray(s['exerciseSets'])) {
      for (const x of s['exerciseSets'] as unknown[]) {
        if (!isObj(x) || !isStr(x['name']) || !x['name'].trim() || !Array.isArray(x['sets'])) {
          notes.group('bad-sets', 'Every-set entries without a name and a list of sets were left out.', `${date}: ${JSON.stringify(x).slice(0, 60)}`);
          continue;
        }
        const name = x['name'].trim();
        if (isStr(x['planned']) && x['planned'].trim() && x['planned'] !== name) swapTo.set(x['planned'], name);
        const sets: LoggedSet[] = [];
        for (const y of x['sets'] as unknown[]) {
          const w = isObj(y) ? (y['weight'] ?? 0) : null;
          const r = isObj(y) ? y['reps'] : null;
          const rir = isObj(y) ? (y['rir'] ?? undefined) : undefined;
          if (!isNum(w) || w < 0 || !isNum(r) || r < 0 || (rir !== undefined && (!isNum(rir) || rir < 0))) {
            notes.group('bad-set', 'Logged sets with a negative or missing weight, reps or RIR were left out.', `${date} ${name}: ${JSON.stringify(y)}`);
            continue;
          }
          if (w === 0 && r === 0) continue;
          const raw = (y as Obj)['unit'];
          const u = asUnit(raw);
          if (w > 0 && raw !== undefined && raw !== null && !u) notes.group('bad-unit', 'Logged lifts with an unknown unit were read in the lift\'s plan unit.', `${date} ${name}: ${String(raw)}`);
          sets.push({ weight: w, unit: w > 0 && u ? u : unitOf(name), reps: Math.round(r), ...(rir !== undefined ? { rir } : {}) });
        }
        if (!sets.length) continue;
        const id = ensure(name);
        const had = everySet.get(id);
        if (had) had.sets.push(...sets);
        else everySet.set(id, { exercise: id, sets });
      }
    }

    // Logged lifts: the top set, at Standard tracking (every set of it, at Full). 0 x 0 means not logged.
    for (const k of ['lift1', 'lift2']) {
      const li = s[k];
      if (!isObj(li) || !isStr(li['name']) || !li['name'].trim()) continue;
      const name = li['name'].trim();
      if (isStr(li['planned']) && li['planned'] && li['planned'] !== name) {
        swapTo.set(li['planned'], name);
        whyOf(li['planned'], li['swapWhy']);
      }
      const all = everySet.get(exerciseId(name));
      if (all) {
        if (!exercises.includes(all)) exercises.push(all);
        continue;
      }
      const weight = isNum(li['weight']) ? li['weight'] : 0;
      const reps = isNum(li['reps']) ? Math.round(li['reps']) : 0;
      if (weight < 0 || reps < 0) {
        notes.group('bad-lift', 'Logged lifts with a negative weight or reps were skipped.', `${date} ${name}`);
        continue;
      }
      if (weight === 0 && reps === 0) continue;
      let unit = asUnit(li['unit']);
      if (li['unit'] !== undefined && li['unit'] !== null && !unit) notes.group('bad-unit', 'Logged lifts with an unknown unit were read in the lift\'s plan unit.', `${date} ${name}: ${String(li['unit'])}`);
      unit ??= unitOf(name);
      exercises.push({ exercise: ensure(name), sets: [{ weight, unit, reps }] });
    }
    for (const x of everySet.values()) if (!exercises.includes(x)) exercises.push(x);
    for (const sw of Array.isArray(s['swaps']) ? s['swaps'] : []) {
      if (isObj(sw) && isStr(sw['from']) && isStr(sw['to']) && sw['to'] && sw['to'] !== sw['from']) {
        swapTo.set(sw['from'], sw['to']);
        whyOf(sw['from'], sw['why']);
      }
    }

    const session: Session = {
      id,
      date,
      trackingLevel: everySet.size > 0 ? 'full' : exercises.length > 0 || lifting ? 'standard' : 'light',
      exercises,
    };
    if (lifting || short) session.template = templateId(type);
    if (isNum(s['durationMin']) && s['durationMin'] > 0) session.minutes = s['durationMin'];
    // Session RPE (0-10), when the log carries one; the dashboard's 1-10 "rating" is not RPE.
    if (s['sessionRpe'] !== undefined && s['sessionRpe'] !== null) {
      if (isNum(s['sessionRpe']) && s['sessionRpe'] >= 0 && s['sessionRpe'] <= 10) session.rpe = s['sessionRpe'];
      else notes.group('bad-rpe', 'Session RPE values that are not numbers from 0 to 10 were left out.', `${date}: ${JSON.stringify(s['sessionRpe'])}`);
    }
    if (isStr(s['notes']) && s['notes'].trim()) session.note = s['notes'].trim();
    // Pain during the session, as the Log panel saves it ({area, severity 0-10, exercise?}; no severity when it wasn't given); the pain rule reads it back.
    if (s['pain'] !== undefined && s['pain'] !== null) {
      const list = Array.isArray(s['pain']) ? s['pain'] : [s['pain']];
      const pain: SessionPain[] = [];
      for (const p of list) {
        const sev = isObj(p) ? p['severity'] : undefined;
        const given = sev !== undefined && sev !== null;
        if (isObj(p) && isStr(p['area']) && p['area'].trim() && (!given || (isNum(sev) && sev >= 0 && sev <= 10))) {
          pain.push({ area: p['area'].trim(), ...(given ? { severity: sev as number } : {}), ...(isStr(p['exercise']) && p['exercise'].trim() ? { exercise: p['exercise'].trim() } : {}) });
        } else notes.group('bad-pain', 'Pain entries that are not an area (with a severity from 0 to 10, when given) were left out.', `${date}: ${JSON.stringify(p)}`);
      }
      if (pain.length) session.pain = pain;
    }
    // The Hotel version (other equipment): it counts for adherence and volume, never for a lift's trend.
    if (s['hotel'] === true) session.hotel = true;

    // The plan snapshot: the dashboard's frozen list of what the plan had, with swaps applied.
    if (lifting || short) {
      const express = s['express'] === true && lifting;
      const week = start && date >= start ? planWeekOf(start, date) : null;
      const deloadWeek = week !== null && isLightWeek(lw, week);
      let list: { name: string; sets: number }[] | null = Array.isArray(s['exercises'])
        ? (s['exercises'] as unknown[]).filter((x): x is { name: string; sets: number } => isObj(x) && isStr(x['name']) && isNum(x['sets']))
        : null;
      const rebuilt = !list;
      if (!list) {
        list = plannedWork(plan, type, express, deloadWeek, (lid) => ladderNameAt(plan, ladders, lid, date), lw.sets);
        notes.group('snapshot-rebuilt', 'Sessions without a saved exercise list: counted from the plan as it reads today (as the dashboard does), so their sets per muscle are approximate.', `${date} ${type}`);
      }
      const typeItems = items(type);
      const itemFor = (name: string) =>
        typeItems.find((i) => i.name === name) ??
        typeItems.find((i) => i.ladder && plan.ladders.find((l) => l.id === i.ladder)?.levels.some((lv) => lv.name === name));
      // `_rir`: the RIR the plan item gives (the top of a range), null when it gives none (the slot's own rir is then a default): what the effort rule reads for a set logged without one.
      const slots: (ExerciseSlot & { _planned?: string; _swapWhy?: SwapReason; _rir?: number | null; _daySets?: number })[] = [];
      const planNames: string[] = [];
      for (const x of list) {
        const sets = Math.round(x.sets);
        if (sets < 1) continue;
        const done = swapTo.get(x.name) ?? x.name;
        const item = itemFor(x.name);
        const exercise = ensure(done);
        const range = item ? rangeOf(item, exerciseId(x.name)) : (liftInfo.get(exerciseId(x.name))?.repRange ?? [1, 1]);
        const given = itemRir(item);
        const slot: ExerciseSlot & { _planned?: string; _swapWhy?: SwapReason; _rir?: number | null; _daySets?: number } = { exercise, sets, repRange: range, rir: given?.lo ?? 2, _rir: given?.hi ?? null };
        // `_daySets`: the working sets the day called for (a trim, Express's), frozen with the session; progression judges against it.
        const day = (x as { daySets?: unknown }).daySets;
        if (isNum(day) && day >= 1) slot._daySets = Math.round(day);
        if (item?.logged && lifting) slot.main = true;
        if (done !== x.name) {
          slot._planned = x.name;
          const why = swapWhy.get(x.name);
          if (why) slot._swapWhy = why;
        }
        slots.push(slot);
        planNames.push(x.name);
      }
      const snapshot: PlanSnapshot & { _rebuilt?: true } = {
        program: 'vault-plan',
        weekKind: deloadWeek ? 'deload' : 'loading',
        template: templateId(type),
        kind: (express ? 'express' : lifting ? 'lift' : 'short'),
        slots,
      };
      // Not what the plan held that day: the review marks the session's counts approximate.
      if (rebuilt) snapshot._rebuilt = true;
      if (week !== null && week > 0) {
        const at = lightWeekAt(lw, week);
        snapshot.phase = `phase-${at.phase}`;
        snapshot.mesocycle = `meso-${at.mesocycle}`;
        snapshot.week = at.weekInMesocycle;
      }
      session.plan = snapshot;

      // Skipped checklist lines: the plan's names (a paired line names both parts; a ladder's line
      // names its plan item, "Pull-up (your level)", which the list holds as that day's level).
      // Each skipped line's reason (`checklist.why`, by line: the Log panel's time, pain, equipment, energy) goes to every exercise of the line.
      const checklist = isObj(s['checklist']) ? s['checklist'] : {};
      const skippedNames = (Array.isArray(checklist['skipped']) ? checklist['skipped'] : []).filter(isStr);
      const whyOf = isObj(checklist['why']) ? checklist['why'] : {};
      const skipped = new Set<string>();
      const skipWhy: Record<string, SkipReason> = {};
      const planned = new Set(planNames);
      for (const nm of skippedNames) {
        const parts = planned.has(nm) ? [nm] : nm.split(/\s+\+\s+/);
        const raw = whyOf[nm];
        const why = isStr(raw) ? (SKIP_REASONS as readonly string[]).find((r) => r === raw.trim().toLowerCase()) as SkipReason | undefined : undefined;
        if (raw !== undefined && raw !== null && raw !== '' && !why) notes.group('skip-why', 'Skip reasons other than time, pain, equipment or energy were left out.', `${date} ${nm}: ${JSON.stringify(raw)}`);
        for (const part of parts) {
          planNames.forEach((pn, i) => {
            if (pn !== part && itemFor(pn)?.name !== part) return;
            skipped.add(slots[i]!.exercise);
            if (why) skipWhy[slots[i]!.exercise] = why;
          });
        }
      }
      if (skipped.size) session.skipped = [...skipped];
      if (Object.keys(skipWhy).length) session.skipWhy = skipWhy;
    }

    const vault: Obj = { type };
    if (label) vault['label'] = label;
    for (const k of ['express', 'rating', 'cardioMin', 'cardioMode', 'postureDrill', 'swaps', 'checklist']) {
      const v = s[k];
      if (v !== undefined && v !== null && v !== '' && v !== false && !(k === 'cardioMin' && v === 0)) vault[k] = v;
    }
    (session as Session & { _vault: Obj })._vault = vault;
    sessions.push(session);
  }

  // Exercise entries.
  const catalogueMatch: Record<string, string> = {};
  const exercises: Record<string, Exercise & ExerciseExtras> = {};
  for (const [id, name] of names) {
    const gk = guideKeys.get(name.toLowerCase());
    const guide = gk ? plan.guide[gk] : undefined;
    const lk = liftKeys.get(name.toLowerCase()) ?? liftIds.get(id);
    const lift = lk ? plan.lifts[lk] : undefined;
    const u = usage.get(id);
    const ex: Exercise & ExerciseExtras = { name: gk ?? name };
    // One source of muscle tags (muscle-tags.ts): the catalogue's for a movement it knows, else the guide's, or the guide's with an override reason.
    const tags = canonicalTags(name, guide);
    for (const m of tags.unknown) notes.group('unknown-muscle', 'Guide entries name muscle groups the engine does not know; those tags were dropped.', `${gk}: ${m}`);
    const regionIssues = regionProblems(tags.unknownRegions);
    for (const r of regionIssues.unknown) notes.group('unknown-region', `Guide entries name muscle regions that are not region ids; they count nowhere. The regions are ${REGION_IDS.join(', ')}.`, `${gk}: ${r}`);
    for (const r of regionIssues.unsupported) notes.group('unsupported-region', 'Guide entries name muscle regions the evidence does not support; they count nowhere. Each gives the nearest supported option and why.', `${gk}: ${r}`);
    for (const r of tags.regionsWithoutParent) notes.group('region-parent-missing', 'Guide entries name a muscle region whose muscle the entry does not tag in main or helps; those regions count nowhere. Add the muscle, or remove the region.', `${gk}: ${parentMissingText(r)}`);
    if (gk && tags.source === 'catalogue' && tags.differs) {
      notes.group('muscle-tags-differ', 'Guide entries whose muscles differ from the engine catalogue\'s: the catalogue\'s count, in Review, Progress, Plan, the movement guide and `check` alike. The next plan write can copy the catalogue\'s into the entry (`engine catalogue` gives them); to keep an entry\'s own, give it `muscles.override` with the reason, beside at least one main muscle.', differsItem(gk, tags.differs));
    }
    if (gk && tags.source === 'override') {
      notes.group('muscle-tags-overridden', 'For information: guide entries that keep their own muscles over the catalogue\'s (`muscles.override`), with the reason given; their tags count everywhere.', `${gk}: ${tags.override}`);
    }
    if (gk && tags.overrideIgnored) {
      notes.group('muscle-tags-override-ignored', 'Guide entries whose `muscles.override` is not honoured: the catalogue\'s tags count, whatever the entry\'s copy says. An override needs a reason (a non-empty string) beside at least one main muscle.', `${gk}: ${tags.overrideIgnored}`);
    }
    if (gk && tags.uncounted) {
      notes.group('muscle-tags-uncounted', `Guide entries marked cardio or mobility for movements the engine catalogue counts as strength work: not counted in sets per muscle. If one is strength work, remove its \`kind\` and the catalogue's tags count.`, `${gk}: guide ${tags.kind} | catalogue ${tagsText(tags.uncounted)}`);
    }
    const timedOnly = u && !u.sets && (u.minutes || u.rounds);
    if (tags.kind) ex.kind = tags.kind;
    else if (timedOnly) ex.kind = u.rounds ? 'circuit' : 'timed';
    else {
      ex.unit = asUnit(lift?.unit) ?? liftUnit;
      ex.increment = isNum(lift?.inc) && lift.inc > 0 ? lift.inc : defaultIncrement(ex.unit);
      if (tags.tags.main.length || tags.tags.helps.length) ex.muscles = { main: [...tags.tags.main], helps: [...tags.tags.helps], ...(tags.tags.regions?.length ? { regions: [...tags.tags.regions] } : {}) };
    }
    const match = tags.catalogue;
    if (match) {
      catalogueMatch[id] = match.id;
      ex.pattern = match.pattern;
      ex.risk = [`abdomen-${match.iap}`];
      ex.equipment = match.equipment[0]!;
    }
    if (gk) ex._guide = guide!;
    if (lift) ex._lift = lift;
    exercises[id] = ex;
  }

  // Unknown exercises: in this week's plan or the log, strength work, no catalogue match.
  const inUse = new Set<string>([...loading.flatMap((t) => t.slots.map((s) => s.exercise)), ...sessions.flatMap((s) => s.exercises.map((x) => x.exercise))]);
  for (const id of [...inUse].sort()) {
    const ex = exercises[id]!;
    if (!catalogueMatch[id] && (ex.kind ?? 'strength') === 'strength') {
      notes.group('unknown-exercise', 'Exercises in the plan or the log that are not in the engine catalogue: no abdominal-strain tag or movement pattern, so the Ledger screen cannot clear them.', ex.name);
    }
    if ((ex.kind ?? 'strength') === 'strength' && !ex.muscles) {
      notes.group('no-muscles', 'Strength exercises with no muscle tags (neither the engine catalogue nor plan-data\'s guide gives any): not counted in sets per muscle.', ex.name);
    }
  }

  // The program: plan weeks from the dashboard's week 1; a mesocycle ends at each light week, a phase is two.
  const programStart = start ?? mondayOf(asOf ?? '2000-01-03');
  const needed = asOf && asOf >= programStart ? planWeekOf(programStart, asOf) : 1;
  // plan-data's optional phase names, by position (else "Phase N", as the dashboard says).
  const named = phaseNamesFrom(isObj(files.plan) ? files.plan['phases'] : undefined);
  for (const w of named.warnings) notes.warn('plan-data', w);
  // The plan's length (plan-data's `weeks`, else the dashboard's 24); past it, whole phases more.
  const planWeeks = planWeeksOf(files.plan);
  const totalWeeks = weeksThrough(lw, planWeeks, needed);
  if (needed > planWeeks) notes.warn('past-plan-end', `Plan week ${needed} is past the plan's ${planWeeks} weeks: a new cycle is due (planning.md, "Build the macrocycle").`);
  // The calibration weeks (the plan's rule, else plan week 1): the loading sessions with every strength item at the
  // calibration RIR or more, and intervals as easy steady minutes unless the rule keeps cardio as planned, so Today,
  // the log form and review's targets apply what the week says (steady cardio and other timed items keep theirs).
  // Without a plan start every date falls in the stand-in week 1, so there is no calibration week.
  const cal = rules.rules.calibration;
  // A calibration week the plan puts on one of its light weeks: the light week wins, said in a warning.
  const calibrationOnLight: number[] = [];
  const calibrated = loading.map((t) => ({
    ...t,
    slots: t.slots.map((s) => {
      const lifted = (exercises[s.exercise]?.kind ?? 'strength') === 'strength' ? calibrateSlot(s, cal.rir) : s;
      return cal.cardio === 'easy' ? calibrateTimedSlot(lifted) : lifted;
    }),
  }));
  // Phases of two mesocycles, each ending at its light week (every 4th week by default); a plan of an odd number of
  // mesocycles ends on a one-mesocycle phase.
  const phases: Phase[] = planCalendar(lw, totalWeeks).map((mesos, p) => {
    const mesocycles: Mesocycle[] = mesos.map((m) => {
      const weeks: Week[] = m.weeks.map((n, i) => {
        const light = isLightWeek(lw, n);
        const calibrating = cal.weeks.includes(n) && !light && start !== null;
        if (cal.weeks.includes(n) && light) calibrationOnLight.push(n);
        const w: Week = { index: i + 1, kind: light ? 'deload' : 'loading', start: addDays(programStart, 7 * (n - 1)), sessions: light ? deload : calibrating ? calibrated : loading };
        if (calibrating) w.calibration = true;
        // The plan's test weeks (rules.tests): the tests on their Saturday, a photo set on their Sunday. Without them the
        // body record keeps tests at each phase end.
        if (rules.rules.tests.weeks?.includes(n)) w.tests = true;
        return w;
      });
      return { id: `meso-${m.mesocycle}`, name: `Mesocycle ${m.mesocycle}`, weeks };
    });
    const nm = named.phases[p];
    return { id: `phase-${p + 1}`, name: nm?.name ?? `Phase ${p + 1}`, ...(nm?.goal ? { goal: nm.goal } : {}), mesocycles };
  });
  const program: Program = {
    schemaVersion: SCHEMA_VERSION,
    id: 'vault-plan',
    name: 'plan-data.json',
    exercises,
    macrocycle: { id: 'vault-cycle', name: 'The dashboard\'s cycle', start: programStart, phases },
  };
  // The desk routine (plan-data's deskRoutine) on the plan's deskTiming, else Habit Nudges' timing: the plan's desk breaks.
  const timing = deskTimingFromPlanData(isObj(files.plan) ? files.plan['deskTiming'] : undefined);
  for (const w of timing.warnings) notes.warn('plan-data', w);
  const desk = isObj(files.plan) ? deskBreaksFromPlanData(files.plan['deskRoutine'], files.plan['guide'], timing.timing) : null;
  if (desk) program.deskBreaks = desk;
  else if (isObj(files.plan) && files.plan['deskTiming'] !== undefined) notes.warn('plan-data', 'plan-data.json has a deskTiming but no deskRoutine steps: no desk breaks in this plan.');

  // Body days, habits, tape, tests, photos.
  const rawBody = isObj(files.body) ? files.body : {};
  if (files.body !== undefined && !isObj(files.body)) notes.error('body', 'body-data.json is not a JSON object.');
  const days = isObj(rawBody['days']) ? (rawBody['days']) : {};
  const daily = new Map<IsoDate, DailyCheckin>();
  const weights: WeighIn[] = [];
  const RANGES: Record<string, [number, number, boolean]> = {
    sleepH: [0, 24, false],
    sleepQ: [1, 5, false],
    energy: [1, 5, false],
    soreness: [1, 5, false],
    rhr: [20, 250, false],
    hrv: [1, 500, false],
    steps: [0, Infinity, true],
    floors: [0, Infinity, true],
  };
  for (const date of Object.keys(days).sort()) {
    const e = days[date];
    if (!isIsoDate(date) || !isObj(e)) {
      notes.group('bad-day', 'body-data.json days with a malformed date or entry were skipped.', date);
      continue;
    }
    const c: DailyCheckin = { date };
    for (const [k, v] of Object.entries(e)) {
      if (v === null || v === undefined || k === 'checkedAt') continue;
      if (k === 'soreMuscles') {
        const sore = readSoreMuscles(v, (msg) => notes.group('sore-muscles', 'Body-map entries the engine could not read (muscle ids or body-map slugs, mild or sore) were left out.', `${date} ${msg}`));
        if (Object.keys(sore).length) c.soreMuscles = sore;
        continue;
      }
      if (k === 'mark') {
        if (v === 'rest' || v === 'missed') c.mark = v;
        else notes.group('bad-value', 'Body values that are not numbers in range were left out.', `${date} mark: ${JSON.stringify(v)}`);
        continue;
      }
      // The morning check-in's "I'm ill today": a yes or no, read as it is (readiness stops hard training on a yes).
      if (k === 'illness') {
        if (typeof v === 'boolean') c.illness = v;
        else notes.group('bad-value', 'Body values that are not numbers in range were left out.', `${date} illness: ${JSON.stringify(v)}`);
        continue;
      }
      if (k === 'weight') {
        if (isNum(v) && v > 0) weights.push({ date, weight: v, unit: 'kg' });
        else notes.group('bad-value', 'Body values that are not numbers in range were left out.', `${date} weight: ${JSON.stringify(v)}`);
        continue;
      }
      const r = RANGES[k];
      if (!r) {
        notes.group('unknown-field', 'body-data.json fields the engine does not read.', k);
        continue;
      }
      if (!isNum(v) || v < r[0] || v > r[1]) {
        notes.group('bad-value', 'Body values that are not numbers in range were left out.', `${date} ${k}: ${JSON.stringify(v)}`);
        continue;
      }
      (c as unknown as Record<string, number>)[k] = r[2] ? Math.round(v) : v;
    }
    daily.set(date, c);
  }
  const habits = isObj(files.habits) && isObj(files.habits['checkins']) ? (files.habits['checkins']) : {};
  if (files.habits !== undefined && !isObj(files.habits)) notes.error('habits', 'habits-data.json is not a JSON object.');
  for (const [k, v] of Object.entries(habits)) {
    const m = /^hab-(workout|protein)-(\d{4})-W(\d{1,2})-(\d)$/.exec(k);
    if (!m || v !== '1') continue;
    const date = isoWeekDate(Number(m[2]), Number(m[3]), Number(m[4]));
    if (!date) {
      notes.group('bad-habit-key', 'Habit keys that name no real date were skipped.', k);
      continue;
    }
    const c = daily.get(date) ?? { date };
    if (m[1] === 'workout') c.trained = true;
    else c.protein = true;
    daily.set(date, c);
  }
  const tape: TapeEntry[] = [];
  for (const t of Array.isArray(rawBody['tape']) ? rawBody['tape'] : []) {
    if (!isObj(t) || !isIsoDate(t['date'])) continue;
    const e: TapeEntry = { date: t['date'], unit: 'cm' };
    for (const k of ['waist', 'hips', 'chest', 'arm'] as const) if (isNum(t[k]) && t[k] > 0) e[k] = t[k];
    tape.push(e);
  }
  const tests: TestEntry[] = [];
  for (const t of Array.isArray(rawBody['tests']) ? rawBody['tests'] : []) {
    if (!isObj(t) || !isIsoDate(t['date'])) continue;
    const results: Record<string, number> = {};
    for (const [k, v] of Object.entries(t)) {
      if (k === 'date') continue;
      if (isNum(v)) results[k] = v;
      else notes.group('test-not-number', 'Test results that are not numbers were left out (the engine reads numbers only).', `${t['date']} ${k}: ${JSON.stringify(v)}`);
    }
    tests.push({ date: t['date'], results });
  }
  const photos: PhotoSet[] = [];
  for (const ph of Array.isArray(rawBody['photos']) ? rawBody['photos'] : []) {
    if (!isObj(ph) || !isIsoDate(ph['date'])) continue;
    const poses = (Array.isArray(ph['poses']) ? ph['poses'] : []).filter((x): x is string => isStr(x) && x.trim() !== '');
    if (poses.length) photos.push({ date: ph['date'], poses, folder: `Progress Photos/${ph['date']}/` });
  }
  const checkins: Checkins = { schemaVersion: SCHEMA_VERSION, daily: [...daily.values()].sort(byDate), weekly: [] };
  const body: Body = { schemaVersion: SCHEMA_VERSION, weights: weights.sort(byDate), tape: tape.sort(byDate), tests: tests.sort(byDate), photos: photos.sort(byDate) };

  // The coach's machine-readable files.
  let profile: Profile | null = null;
  let profileState: CoachFileState = 'missing';
  if (files.profile !== undefined) {
    const errs = validateProfile(files.profile);
    if (errs.length) {
      profileState = 'invalid';
      for (const e of errs) notes.error('profile', `Coach/profile.json ${e.path}: ${e.message}`);
    } else {
      profileState = 'ok';
      profile = files.profile as Profile;
      const eq = normalizeEquipment(profile.equipment);
      for (const x of eq.unknown) notes.group('free-text-equipment', 'Profile equipment the engine does not recognise (free text): not used to choose exercises.', x);
      for (const id of [...(profile.preferences?.likes ?? []), ...(profile.preferences?.dislikes ?? [])]) {
        if (!CATALOGUE_BY_ID.has(id)) notes.group('unknown-preference', 'Profile likes and dislikes that are not catalogue exercise ids.', id);
      }
    }
  } else notes.warn('coach-missing', 'Coach/profile.json does not exist yet (intake writes it): the review uses the roadmap\'s weight band and no priority muscles, and the coach cannot design a plan yet.');
  // The gym's real weights (profile.loads) on each loaded exercise, in its unit: the kind is the catalogue's first
  // equipment id, else dumbbells for a lift marked db. A kind the profile has no kit for keeps its plan step.
  const loads = profile?.loads;
  if (loads) {
    for (const ex of Object.values(exercises)) {
      if (!ex.unit) continue;
      const w = weightsFor(loadKindOf(ex.equipment, ex._lift?.db) ?? undefined, loads, ex.unit);
      if (!w) continue;
      ex.weights = w;
      if (ex.unit !== loads.unit) {
        notes.group('loads-unit-differs', `The profile's loads are in ${loads.unit} and these lifts in the other unit: their real weights are converted (to 0.1), so targets land on converted numbers. Give the lift the gym's unit (plan-data lifts[name].unit), or write the loads in the lift's.`, `${ex.name}: in ${ex.unit}, the loads in ${loads.unit}`);
      }
    }
  }
  let ledger: Ledger | null = null;
  let ledgerState: CoachFileState = 'missing';
  if (files.ledger !== undefined) {
    const errs = validateLedger(files.ledger);
    if (errs.length) {
      ledgerState = 'invalid';
      for (const e of errs) notes.error('ledger', `Coach/ledger.json ${e.path}: ${e.message}`);
    } else {
      ledgerState = 'ok';
      ledger = files.ledger as Ledger;
      const known = new Set([...CATALOGUE_BY_ID.keys(), ...Object.keys(exercises)]);
      for (const c of ledger.constraints) for (const m of c.noMovements ?? []) if (!known.has(m)) notes.group('unknown-movement', 'Ledger movements that are neither catalogue ids nor exercises in the plan: they block nothing.', `${c.id}: ${m}`);
    }
  } else notes.warn('coach-missing', 'Coach/ledger.json does not exist yet (intake writes it): no Ledger constraints are applied.');
  let checkinsState: CoachFileState = 'missing';
  if (files.checkins !== undefined) {
    const errs = validateCheckinLog(files.checkins);
    if (errs.length) {
      checkinsState = 'invalid';
      for (const e of errs) notes.error('checkins', `Coach/checkins.json ${e.path}: ${e.message}`);
    } else {
      checkinsState = 'ok';
      checkins.weekly = [...(files.checkins as CheckinLog).checkins].sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? -1 : 1));
    }
  } else notes.warn('checkins-missing', 'Coach/checkins.json does not exist yet (the check-in writes it with `engine checkin add`): no check-in answers are used (confirmed sessions, recovery, joint aches, triage steps, deload changes, reported RIR).');
  // The eating plan: missing is a calm state (the Food tab's empty state), so no warning.
  let eatingPlan: EatingPlan | null = null;
  let eatingState: CoachFileState = 'missing';
  if (files.eating !== undefined) {
    const errs = validateEatingPlan(files.eating);
    if (errs.length) {
      eatingState = 'invalid';
      for (const e of errs) notes.error('eating', `Coach/eating-plan.json ${e.path}: ${e.message}`);
    } else {
      eatingState = 'ok';
      eatingPlan = files.eating as EatingPlan;
    }
  }

  // Self-check: the output must be valid schema v1.
  const schemaErrors = [
    ...validateProgram(program).map((e) => `program ${e.path}: ${e.message}`),
    ...validateCheckins(checkins).map((e) => `checkins ${e.path}: ${e.message}`),
    ...validateBody(body).map((e) => `body ${e.path}: ${e.message}`),
    ...sessions.flatMap((s) => validateSession(s).map((e) => `session ${s.id} ${e.path}: ${e.message}`)),
  ];
  for (const e of schemaErrors) notes.error('schema', `The adapter's output is not valid schema v1: ${e}`);

  const baselines = [...(files.baselines ?? [])].filter(isIsoDate).sort();
  const cycleStart = newestBaseline(baselines);
  const muscles: string[] = [];
  for (const k of Object.keys(plan.muscles)) {
    const m = toEngineMuscles({ main: [k] });
    if (m.muscles.main[0]) muscles.push(m.muscles.main[0]);
    else notes.group('unknown-muscle', 'Guide entries name muscle groups the engine does not know; those tags were dropped.', `muscles: ${k}`);
  }
  notes.flush();
  if (planRead) {
    if (rules.problems.length) {
      notes.warnings.push({ code: 'rules-invalid', message: 'Standing rules in plan-data.json Pahlavan cannot read: each kind with a problem uses Pahlavan\'s old default until it is fixed (unknown keys are listed and left out).', items: rules.problems.map((x) => `${x.path}: ${x.message}`) });
    }
    if (calibrationOnLight.length) notes.warnings.push({ code: 'calibration-on-light-week', message: 'Calibration weeks the plan\'s rules put on a light week: the light week is kept and those weeks do not calibrate; move one of the two in `rules`.', items: calibrationOnLight.map((n) => `plan week ${n}`) });
    const legacy = legacyItems(rules);
    if (legacy.length) notes.warnings.push({ code: 'legacy-default', message: LEGACY_DEFAULT_MESSAGE, items: legacy });
  }

  return {
    program,
    sessions,
    checkins,
    body,
    profile,
    ledger,
    eatingPlan,
    coach: { profile: profileState, ledger: ledgerState, checkins: checkinsState, eating: eatingState },
    plan: {
      liftUnit,
      weekTarget: plan.weekTarget,
      types,
      express: expressOf(plan, ensure),
      warmups: { lift: isStr(plan.warmups?.lift) ? plan.warmups.lift : null, short: isStr(plan.warmups?.short) ? plan.warmups.short : null },
      start,
      startFrom,
      cycleStart,
      baselines,
      weeks: planWeeksOf(files.plan),
      muscles,
      lifts,
      ladders: plan.ladders
        .filter((l) => isObj(l) && isStr(l.id))
        .map((l) => ({
          id: l.id,
          name: l.name,
          levels: (l.levels ?? []).map((x) => x.name),
          history: ladders[l.id] ?? [],
          carried: [...plan.liftTypes, ...plan.shortTypes].some((t) => items(t).some((i) => i.ladder === l.id)),
          ...(ladderStarts.has(l.id) ? { startLevel: ladderStarts.get(l.id)! } : {}),
        })),
    },
    catalogueMatch,
    rules,
    why,
    warnings: notes.warnings,
    errors: notes.errors,
  };
}

/**
 * The plan's length in weeks: plan-data's `weeks`, up to the end of the
 * mesocycle holding its last week on the plan's light-week calendar (whole
 * 4-week mesocycles by default; a plan listing its light weeks ends where it
 * says); else the dashboard's 24.
 */
export function planWeeksOf(rawPlan: unknown): number {
  const w = isObj(rawPlan) ? rawPlan['weeks'] : undefined;
  if (!(typeof w === 'number' && Number.isInteger(w) && w >= 1 && w <= 104)) return 24;
  return nextLightWeek(readRules(rawPlan).rules.lightWeeks, w) ?? w;
}

/** The plan's Express block, with the finisher as an exercise id. */
function expressOf(plan: PlanData, ensure: (name: string) => string): VaultPlanInfo['express'] {
  const e = plan.express;
  if (!isObj(e) || !isStr(e.mainSets)) return null;
  const f = isObj(e.finish) && isStr(e.finish.name) && e.finish.name.trim() && isStr(e.finish.sr) ? e.finish : null;
  return {
    warmup: isStr(e.warmup) ? e.warmup.replace(/^Warm-up:\s*/i, '') : null,
    mainSets: itemSets({ sr: e.mainSets }),
    secondSets: itemSets({ sr: isStr(e.secondSets) ? e.secondSets : e.mainSets }),
    finish: f ? { exercise: ensure(f.name), name: f.name, sets: itemSets(f), repRange: parseSr(f.sr).repRange ?? [1, 1], sr: f.sr } : null,
  };
}

/** A body-map entry: engine muscle ids, or the body map's slugs (gluteal, quadriceps), each mild or sore. */
function readSoreMuscles(v: unknown, warn: (msg: string) => void): Record<string, SorenessLevel> {
  const out: Record<string, SorenessLevel> = {};
  if (!isObj(v)) {
    warn('is not an object');
    return out;
  }
  for (const [k, level] of Object.entries(v)) {
    const id = MUSCLE_IDS.includes(k) ? k : MUSCLES.find((m) => m.highlighter === k)?.id;
    if (!id) warn(`${k}: not a muscle id or body-map slug`);
    else if (level !== 'mild' && level !== 'sore') warn(`${k}: ${JSON.stringify(level)} is not mild or sore`);
    else if (out[id] !== 'sore') out[id] = level;
  }
  return out;
}

/** What the plan had for a session without a saved list (the dashboard's plannedWork). */
export function plannedWork(
  plan: PlanData,
  type: string,
  express: boolean,
  deloadWeek: boolean,
  ladderName: (id: string) => string | null,
  /** A light week's sets (the plan's rule; the dashboard's 2 by default). */
  lightSetsRule: number | 'half' = readRules(plan).rules.lightWeeks.sets,
): { name: string; sets: number }[] {
  const items = ((plan.sessions[type] ?? [])).filter((x) => isObj(x) && isStr(x.name) && isStr(x.sr));
  if (express) {
    const logged = items.filter((i) => i.logged);
    const ex = plan.express;
    return [
      ...(isStr(ex?.warmup) ? [{ name: ex.warmup, sets: dashboardSets('3 min') }] : []),
      ...(logged[0] ? [{ name: logged[0].name, sets: dashboardSets(ex?.mainSets ?? '') }] : []),
      ...(logged[1] ? [{ name: logged[1].name, sets: dashboardSets(ex?.secondSets ?? '') }] : []),
      ...(isObj(ex?.finish) && isStr(ex.finish.name) ? [{ name: ex.finish.name, sets: dashboardSets(ex.finish.sr) }] : []),
    ];
  }
  if (deloadWeek && type === 'S3' && plan.deloadS3.length) return plan.deloadS3.map((x) => ({ name: x.name, sets: dashboardSets(x.sr) }));
  return items.map((i) => ({ name: (i.ladder ? ladderName(i.ladder) : null) ?? i.name, sets: dashboardSets(deloadWeek ? deloadSr(i.sr, lightSetsRule) : i.sr) }));
}

// ---------------------------------------------------------------- ladders (the dashboard's Skills card)

/** The lowest ladder level a test result shows (the dashboard's Skills card). */
export const LADDER_TESTS: Readonly<Record<string, { field: string; level: (v: number) => number }>> = {
  pullup: { field: 'pullups', level: (v) => (v >= 1 ? 6 : 0) },
  pushup: { field: 'pushups', level: (v) => (v >= 1 ? 2 : 0) },
  hollow: { field: 'hollowS', level: (v) => (v >= 20 ? 3 : 0) },
  handstand: { field: 'handstandS', level: (v) => (v >= 20 ? 3 : 0) },
};

export interface LadderStatus {
  id: string;
  name: string;
  /** The level on the date, as the count reads it (ladderLevelOn): the log's, else the plan's `startLevel`; 0 with neither (not set). */
  level: number;
  /** Where `level` comes from: `log`, `plan` (the plan's start, no level logged yet) or `lowest` (neither: level 0, not set). */
  from: LadderLevelFrom;
  levelName: string | null;
  /** The day the logged level was set; null before any level is logged (the plan's start has no date). */
  since: IsoDate | null;
  test?: { field: string; value: number; date: IsoDate };
  testShowsLevel?: { level: number; name: string };
  /** Which test counts and why: a test from before the cycle start does not; only a ladder a plan session carries gets `testShowsLevel`. */
  reason: Reason;
}

/**
 * Each ladder's level on a date and the level its latest test shows, as
 * the original log script's review gives them. The level is the one the
 * weekly sets count (the log's, else the plan's `startLevel`), so the
 * review, the Skills card and the count agree before a level is logged;
 * with neither it is 0, not set. With `cycleStart`, a test dated before
 * it does not count (a fresh start's tests are the cycle's own), and only a
 * ladder a plan session carries gets `testShowsLevel` (a ladder no session
 * trains has nothing to move up). A test shows a level only above the
 * level as read, the plan's start included: at or under the start, the
 * Skills card's "Log this level" writes the first entry instead.
 */
export function ladderStatus(data: VaultData, date: IsoDate, cycleStart: IsoDate | null = null): LadderStatus[] {
  return data.plan.ladders.map((l) => {
    const h = l.history.filter((x) => x.date <= date);
    // The start through ladderStartOf, never the raw value: one that is not among the levels is read around.
    const { level: at, from } = ladderLevelOn(h, ladderStartOf(l).level, date);
    const level = from === 'lowest' ? 0 : at;
    const levelName = level ? (l.levels[level - 1] ?? null) : null;
    const fit = LADDER_TESTS[l.id];
    const all = fit ? [...data.body.tests].filter((x) => x.date <= date && typeof x.results[fit.field] === 'number') : [];
    const t = all.filter((x) => !cycleStart || x.date >= cycleStart).at(-1);
    const older = t ? null : (all.at(-1) ?? null);
    const value = t && fit ? t.results[fit.field]! : null;
    const n = t && fit ? Math.min(fit.level(value!), l.levels.length) : 0;
    const shows = t && n > level && l.carried ? { level: n, name: l.levels[n - 1]! } : null;
    const reason = explain(t ? { field: fit!.field, value, date: t.date } : null, 'ladders.test', { ladder: l.id, level, from, carried: l.carried, cycleStart, test: t?.date ?? null, before: older?.date ?? null }, {
      note: [
        `${l.name}: level ${level}${levelName ? ` (${levelName})` : ''}${h.at(-1) ? ` since ${dayText(h.at(-1)!.date)}` : from === 'plan' ? ', the plan\'s start (its startLevel), not logged yet' : ''}.`,
        !fit ? 'No test moves this ladder.' : t ? `The test of ${dayText(t.date)}: ${fit.field} ${value}${n > level ? `, which shows level ${n}` : ''}.` : older ? `Its latest test (${dayText(older.date)}) is from before this cycle began on ${dayText(cycleStart!)}: it does not count.` : 'No test on record yet.',
        t && n > level && !l.carried ? 'No plan session carries this ladder, so the test moves nothing.' : '',
      ].filter(Boolean).join(' '),
    }).reason;
    return {
      id: l.id,
      name: l.name,
      level,
      from,
      levelName,
      since: h.at(-1)?.date ?? null,
      ...(t && fit ? { test: { field: fit.field, value: value!, date: t.date } } : {}),
      ...(shows ? { testShowsLevel: shows } : {}),
      reason,
    };
  });
}
