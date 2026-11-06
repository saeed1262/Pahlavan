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
import { CATALOGUE_BY_ID } from '../../core/data/exercises.ts';
import { MUSCLE_IDS, MUSCLES } from '../../core/data/muscles.ts';
import { newestBaseline } from '../../core/cycle.ts';
import { addDays, dayText, daysBetween, isIsoDate, mondayOf } from '../../core/dates.ts';
import { deskBreaksFromPlanData, deskTimingFromPlanData } from '../../core/desk-breaks.ts';
import {
  dashboardSets,
  deloadSr,
  exerciseId,
  parseNote,
  parseSr,
  phaseNamesFrom,
  toEngineMuscles,
  type ExerciseExtras,
  type PlanData,
  type PlanDataExtras,
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
  type SessionTemplate,
  type TapeEntry,
  type TestEntry,
  type Unit,
  type Week,
  type WeighIn,
} from '../../core/schema.ts';
import { validateBody, validateCheckinLog, validateCheckins, validateEatingPlan, validateLedger, validateProfile, validateProgram, validateSession } from '../../core/validate.ts';
import { explain, type Reason } from '../../core/reason.ts';
import { matchCatalogue } from './catalogue-match.ts';

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
  /** Week 1's Monday: the first logged plan session (the dashboard's clock); null before any. */
  start: IsoDate | null;
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
  warnings: VaultWarning[];
  /** Problems with the data itself (unreadable or invalid files). */
  errors: VaultWarning[];
}

export interface VaultOptions {
  /** Ladder levels and the program's length are taken as of this date (default: the latest data). */
  asOf?: IsoDate;
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

/** The ladder level's name on a date (the dashboard's ladderNameAt: level 1 before any entry). */
export function ladderNameAt(plan: PlanData, history: Record<string, { level: number; date: IsoDate }[]>, id: string, date: IsoDate | null): string | null {
  const l = plan.ladders.find((x) => x.id === id);
  if (!l) return null;
  const h = (history[id] ?? []).filter((x) => date === null || x.date <= date);
  const level = h.at(-1)?.level ?? 1;
  return l.levels[level - 1]?.name ?? null;
}

// ---------------------------------------------------------------- the adapter

/** Reads the vault's files (already parsed) into schema v1. */
export function fromVault(files: VaultFiles, opts: VaultOptions = {}): VaultData {
  const notes = new Notes();
  const asOf = opts.asOf ?? null;
  const plan = readPlan(files.plan, notes) ?? ({
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
  const ladders = ladderHistory(files.log);
  const guideKeys = new Map(Object.keys(plan.guide).map((k) => [k.toLowerCase(), k]));
  const liftKeys = new Map(Object.keys(plan.lifts).map((k) => [k.toLowerCase(), k]));
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
  const use = (id: string, sr: string) => {
    const u = usage.get(id) ?? { sets: false, minutes: false, rounds: false };
    const p = parseSr(sr);
    if (p.sets !== null) u.sets = true;
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
  const ladderLevelAt = (id: string) => ladderNameAt(plan, ladders, id, asOf);
  const itemExercise = (item: PlanDataItem): string => {
    if (item.ladder) {
      const lv = ladderLevelAt(item.ladder);
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
    use(exercise, item.sr);
    // Every level of a ladder is done the way its item prescribes ("6 min" or sets).
    if (item.ladder) for (const lv of plan.ladders.find((l) => l.id === item.ladder)?.levels ?? []) if (isStr(lv?.name)) use(ensure(lv.name), item.sr);
    const parsed = parseSr(item.sr);
    const note = parseNote(item.note);
    const slot: ExerciseSlot & SlotExtras = {
      exercise,
      sets: Math.max(1, parsed.sets ?? dashboardSets(item.sr)),
      repRange: rangeOf(item, exercise),
      rir: note.rir ?? 2,
    };
    if (lifting && item.logged) {
      slot.main = true;
      slot.progression = { rule: 'double' };
    }
    if (item.ladder) {
      const l = plan.ladders.find((x) => x.id === item.ladder);
      const h = (ladders[item.ladder] ?? []).filter((x) => asOf === null || x.date <= asOf);
      const next = l?.levels[h.at(-1)?.level ?? 1]?.name;
      slot.progression = next ? { rule: 'ladder', next: ensure(next) } : { rule: 'ladder' };
    }
    if (note.until) {
      if (!isIsoDate(note.until.date)) notes.warn('until', `${type} ${item.name}: "until ${note.until.date}" is not a date; ignored.`);
      else slot.until = { until: note.until.date, reason: note.until.reason, ...(note.replaces ? { note: `Replaces ${note.replaces}.` } : {}) };
    }
    if (isStr(item.note) && item.note.trim()) slot.note = item.note;
    slot._item = item;
    slot._derived = { exercise: slot.exercise, sets: slot.sets, repRange: slot.repRange, rir: slot.rir, until: slot.until?.until ?? null };
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
  // The dashboard's deload week: every "N ×" becomes 2 sets; S3 becomes deloadS3.
  const deloadSlots = (t: SessionTemplate & { _type: string }): ExerciseSlot[] => {
    if (t._type === 'S3' && plan.deloadS3.length) {
      return plan.deloadS3
        .filter((x) => isObj(x) && isStr(x.name) && isStr(x.sr))
        .map((x) => {
          const exercise = ensure(x.name);
          use(exercise, x.sr);
          return { exercise, sets: dashboardSets(x.sr), repRange: parseSr(x.sr).repRange ?? [1, 1], rir: 2 };
        });
    }
    return t.slots.map((s) => {
      const item = (s as SlotExtras)._item;
      const { _item: _i, _derived: _d, ...rest } = s as ExerciseSlot & SlotExtras;
      return item && parseSr(item.sr).sets !== null ? { ...rest, sets: dashboardSets(deloadSr(item.sr)) } : rest;
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
  // Week 1: the Monday of the first logged plan session (the dashboard's clock). Until the
  // current cycle (the newest baseline note on or before the date) has a plan session of its
  // own, week 1 is the Monday of the cycle start, so a fresh start reads "Week 1" from day one.
  const cycleNow = newestBaseline([...(files.baselines ?? [])].filter(isIsoDate), asOf ?? undefined);
  const cycleLogged = cycleNow === null || rawSessions.some((s) => planTypes.has(String(s['type'])) && String(s['date']) >= cycleNow);
  const start = firstPlan && cycleLogged ? mondayOf(String(firstPlan['date'])) : cycleNow ? mondayOf(cycleNow) : null;

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
      if (isStr(li['planned']) && li['planned'] && li['planned'] !== name) swapTo.set(li['planned'], name);
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
      if (isObj(sw) && isStr(sw['from']) && isStr(sw['to']) && sw['to'] && sw['to'] !== sw['from']) swapTo.set(sw['from'], sw['to']);
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
    // Pain during the session, as the Log panel saves it ({area, severity 0-10, exercise?}); the pain rule reads it back.
    if (s['pain'] !== undefined && s['pain'] !== null) {
      const list = Array.isArray(s['pain']) ? s['pain'] : [s['pain']];
      const pain: SessionPain[] = [];
      for (const p of list) {
        if (isObj(p) && isStr(p['area']) && p['area'].trim() && isNum(p['severity']) && p['severity'] >= 0 && p['severity'] <= 10) {
          pain.push({ area: p['area'].trim(), severity: p['severity'], ...(isStr(p['exercise']) && p['exercise'].trim() ? { exercise: p['exercise'].trim() } : {}) });
        } else notes.group('bad-pain', 'Pain entries that are not an area with a severity from 0 to 10 were left out.', `${date}: ${JSON.stringify(p)}`);
      }
      if (pain.length) session.pain = pain;
    }
    // The Hotel version (other equipment): it counts for adherence and volume, never for a lift's trend.
    if (s['hotel'] === true) session.hotel = true;

    // The plan snapshot: the dashboard's frozen list of what the plan had, with swaps applied.
    if (lifting || short) {
      const express = s['express'] === true && lifting;
      const week = start ? planWeekOf(start, date) : null;
      const deloadWeek = week !== null && week > 0 && week % 4 === 0;
      let list: { name: string; sets: number }[] | null = Array.isArray(s['exercises'])
        ? (s['exercises'] as unknown[]).filter((x): x is { name: string; sets: number } => isObj(x) && isStr(x['name']) && isNum(x['sets']))
        : null;
      if (!list) {
        list = plannedWork(plan, type, express, deloadWeek, (lid) => ladderNameAt(plan, ladders, lid, date));
        notes.group('snapshot-rebuilt', 'Sessions without a saved exercise list: rebuilt from the current plan, as the dashboard does.', `${date} ${type}`);
      }
      const typeItems = items(type);
      const itemFor = (name: string) =>
        typeItems.find((i) => i.name === name) ??
        typeItems.find((i) => i.ladder && plan.ladders.find((l) => l.id === i.ladder)?.levels.some((lv) => lv.name === name));
      const slots: (ExerciseSlot & { _planned?: string })[] = [];
      const planNames: string[] = [];
      for (const x of list) {
        const sets = Math.round(x.sets);
        if (sets < 1) continue;
        const done = swapTo.get(x.name) ?? x.name;
        const item = itemFor(x.name);
        const exercise = ensure(done);
        const range = item ? rangeOf(item, exerciseId(x.name)) : (liftInfo.get(exerciseId(x.name))?.repRange ?? [1, 1]);
        const slot: ExerciseSlot & { _planned?: string } = { exercise, sets, repRange: range, rir: parseNote(item?.note).rir ?? 2 };
        if (item?.logged && lifting) slot.main = true;
        if (done !== x.name) slot._planned = x.name;
        slots.push(slot);
        planNames.push(x.name);
      }
      const snapshot: PlanSnapshot = {
        program: 'vault-plan',
        weekKind: deloadWeek ? 'deload' : 'loading',
        template: templateId(type),
        kind: (express ? 'express' : lifting ? 'lift' : 'short'),
        slots,
      };
      if (week !== null && week > 0) {
        snapshot.phase = `phase-${Math.floor((week - 1) / 8) + 1}`;
        snapshot.mesocycle = `meso-${Math.floor((week - 1) / 4) + 1}`;
        snapshot.week = ((week - 1) % 4) + 1;
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
    const lk = liftKeys.get(name.toLowerCase());
    const lift = lk ? plan.lifts[lk] : undefined;
    const u = usage.get(id);
    const ex: Exercise & ExerciseExtras = { name: gk ?? name };
    const gm = isObj(guide?.muscles) ? (guide.muscles as { main?: unknown; helps?: unknown; kind?: unknown }) : null;
    const tagKind = gm?.kind === 'cardio' || gm?.kind === 'mobility' ? gm.kind : null;
    const timedOnly = u && !u.sets && (u.minutes || u.rounds);
    if (tagKind) ex.kind = tagKind;
    else if (timedOnly) ex.kind = u.rounds ? 'circuit' : 'timed';
    else {
      ex.unit = asUnit(lift?.unit) ?? liftUnit;
      ex.increment = isNum(lift?.inc) && lift.inc > 0 ? lift.inc : defaultIncrement(ex.unit);
      if (gm) {
        const mapped = toEngineMuscles({
          main: Array.isArray(gm.main) ? gm.main.filter(isStr) : [],
          helps: Array.isArray(gm.helps) ? gm.helps.filter(isStr) : [],
        });
        for (const m of mapped.unknown) notes.group('unknown-muscle', 'Guide entries name muscle groups the engine does not know; those tags were dropped.', `${gk}: ${m}`);
        if (mapped.muscles.main.length || mapped.muscles.helps.length) ex.muscles = mapped.muscles;
      }
    }
    const match = matchCatalogue(name);
    if (match) {
      catalogueMatch[id] = match.id;
      ex.pattern = match.pattern;
      ex.risk = [`abdomen-${match.iap}`];
      ex.equipment = match.equipment[0]!;
    }
    if (gk) {
      ex._guideKey = gk;
      ex._guide = guide!;
    }
    if (lk) {
      ex._liftKey = lk;
      ex._lift = lift!;
    }
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
      notes.group('no-muscles', 'Strength exercises with no muscles in plan-data\'s guide: not counted in sets per muscle.', ex.name);
    }
  }

  // The program: plan weeks from the dashboard's week 1, phases of two 4-week mesocycles.
  const programStart = start ?? mondayOf(asOf ?? '2000-01-03');
  const needed = asOf && asOf >= programStart ? planWeekOf(programStart, asOf) : 1;
  // plan-data's optional phase names, by position (else "Phase N", as the dashboard says).
  const named = phaseNamesFrom(isObj(files.plan) ? files.plan['phases'] : undefined);
  for (const w of named.warnings) notes.warn('plan-data', w);
  // The plan's length (plan-data's `weeks`, else the dashboard's 24); past it, whole phases more.
  const planWeeks = planWeeksOf(files.plan);
  const totalWeeks = Math.max(planWeeks, Math.ceil(needed / 8) * 8);
  if (needed > planWeeks) notes.warn('past-plan-end', `Plan week ${needed} is past the plan's ${planWeeks} weeks: a new cycle is due (planning.md, "Build the macrocycle").`);
  const mesoCount = totalWeeks / 4;
  const phases: Phase[] = [];
  // Phases of two 4-week mesocycles; a plan of an odd number of mesocycles ends on a one-mesocycle phase.
  for (let p = 0; p < Math.ceil(mesoCount / 2); p++) {
    const mesocycles: Mesocycle[] = [0, 1].filter((m) => p * 2 + m < mesoCount).map((m) => {
      const meso = p * 2 + m;
      const weeks: Week[] = [1, 2, 3, 4].map((i) => {
        const n = meso * 4 + i;
        const w: Week = { index: i, kind: i === 4 ? 'deload' : 'loading', start: addDays(programStart, 7 * (n - 1)), sessions: i === 4 ? deload : loading };
        if (n === 1) w.calibration = true;
        return w;
      });
      return { id: `meso-${meso + 1}`, name: `Mesocycle ${meso + 1}`, weeks };
    });
    const nm = named.phases[p];
    phases.push({ id: `phase-${p + 1}`, name: nm?.name ?? `Phase ${p + 1}`, ...(nm?.goal ? { goal: nm.goal } : {}), mesocycles });
  }
  const top: Obj = {};
  for (const [k, v] of Object.entries(isObj(files.plan) ? files.plan : {})) if (k !== 'sessions' && k !== 'lifts' && k !== 'guide') top[k] = v;
  const extras: PlanDataExtras = {
    top,
    topOrder: Object.keys(isObj(files.plan) ? files.plan : {}),
    liftsOrder: Object.keys(plan.lifts),
    guideOrder: Object.keys(plan.guide),
  };
  const program: Program & { _planData: PlanDataExtras } = {
    schemaVersion: SCHEMA_VERSION,
    id: 'vault-plan',
    name: 'plan-data.json',
    exercises,
    macrocycle: { id: 'vault-cycle', name: 'The dashboard\'s cycle', start: programStart, phases },
    _planData: extras,
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
  } else notes.warn('coach-missing', 'Coach/profile.json does not exist yet (intake writes it): the review uses the roadmap\'s weight band and no priority muscles, and `plan` cannot run.');
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
      cycleStart,
      baselines,
      weeks: planWeeksOf(files.plan),
      muscles,
      lifts,
      ladders: plan.ladders
        .filter((l) => isObj(l) && isStr(l.id))
        .map((l) => ({ id: l.id, name: l.name, levels: (l.levels ?? []).map((x) => x.name), history: ladders[l.id] ?? [], carried: [...plan.liftTypes, ...plan.shortTypes].some((t) => items(t).some((i) => i.ladder === l.id)) })),
    },
    catalogueMatch,
    warnings: notes.warnings,
    errors: notes.errors,
  };
}

/** The plan's length in weeks: plan-data's `weeks` (a generated plan writes it), up to whole 4-week mesocycles; else the dashboard's 24. */
export function planWeeksOf(rawPlan: unknown): number {
  const w = isObj(rawPlan) ? rawPlan['weeks'] : undefined;
  return typeof w === 'number' && Number.isInteger(w) && w >= 1 && w <= 104 ? Math.ceil(w / 4) * 4 : 24;
}

/** The plan's Express block, with the finisher as an exercise id. */
function expressOf(plan: PlanData, ensure: (name: string) => string): VaultPlanInfo['express'] {
  const e = plan.express;
  if (!isObj(e) || !isStr(e.mainSets)) return null;
  const f = isObj(e.finish) && isStr(e.finish.name) && e.finish.name.trim() && isStr(e.finish.sr) ? e.finish : null;
  return {
    warmup: isStr(e.warmup) ? e.warmup.replace(/^Warm-up:\s*/i, '') : null,
    mainSets: dashboardSets(e.mainSets),
    secondSets: dashboardSets(isStr(e.secondSets) ? e.secondSets : e.mainSets),
    finish: f ? { exercise: ensure(f.name), name: f.name, sets: dashboardSets(f.sr), repRange: parseSr(f.sr).repRange ?? [1, 1], sr: f.sr } : null,
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
  return items.map((i) => ({ name: (i.ladder ? ladderName(i.ladder) : null) ?? i.name, sets: dashboardSets(deloadWeek ? deloadSr(i.sr) : i.sr) }));
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
  level: number;
  levelName: string | null;
  since: IsoDate | null;
  test?: { field: string; value: number; date: IsoDate };
  testShowsLevel?: { level: number; name: string };
  /** Which test counts and why: a test from before the cycle start does not; only a ladder a plan session carries gets `testShowsLevel`. */
  reason: Reason;
}

/**
 * Each ladder's level on a date and the level its latest test shows, as
 * fitness_log.py review gives them. With `cycleStart`, a test dated before
 * it does not count (a fresh start's tests are the cycle's own), and only a
 * ladder a plan session carries gets `testShowsLevel` (a ladder no session
 * trains has nothing to move up).
 */
export function ladderStatus(data: VaultData, date: IsoDate, cycleStart: IsoDate | null = null): LadderStatus[] {
  return data.plan.ladders.map((l) => {
    const h = l.history.filter((x) => x.date <= date);
    const level = h.at(-1)?.level ?? 0;
    const levelName = level ? (l.levels[level - 1] ?? null) : null;
    const fit = LADDER_TESTS[l.id];
    const all = fit ? [...data.body.tests].filter((x) => x.date <= date && typeof x.results[fit.field] === 'number') : [];
    const t = all.filter((x) => !cycleStart || x.date >= cycleStart).at(-1);
    const older = t ? null : (all.at(-1) ?? null);
    const value = t && fit ? t.results[fit.field]! : null;
    const n = t && fit ? Math.min(fit.level(value!), l.levels.length) : 0;
    const shows = t && n > level && l.carried ? { level: n, name: l.levels[n - 1]! } : null;
    const reason = explain(t ? { field: fit!.field, value, date: t.date } : null, 'ladders.test', { ladder: l.id, level, carried: l.carried, cycleStart, test: t?.date ?? null, before: older?.date ?? null }, {
      note: [
        `${l.name}: level ${level}${levelName ? ` (${levelName})` : ''}${h.at(-1) ? ` since ${dayText(h.at(-1)!.date)}` : ''}.`,
        !fit ? 'No test moves this ladder.' : t ? `The test of ${dayText(t.date)}: ${fit.field} ${value}${n > level ? `, which shows level ${n}` : ''}.` : older ? `Its latest test (${dayText(older.date)}) is from before this cycle began on ${dayText(cycleStart!)}: it does not count.` : 'No test on record yet.',
        t && n > level && !l.carried ? 'No plan session carries this ladder, so the test moves nothing.' : '',
      ].filter(Boolean).join(' '),
    }).reason;
    return {
      id: l.id,
      name: l.name,
      level,
      levelName,
      since: h.at(-1)?.date ?? null,
      ...(t && fit ? { test: { field: fit.field, value: value!, date: t.date } } : {}),
      ...(shows ? { testShowsLevel: shows } : {}),
      reason,
    };
  });
}
