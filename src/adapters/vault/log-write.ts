// Writing the dashboard's files, as pure functions from text to text: the
// session entry in fitness-log-data.json's exact shape (fitness_log.py add
// is the reference, check for check), its merge with what is on disk now,
// the add-only Workout habit tick in habits-data.json, and the per-muscle
// sore-muscle merge in body-data.json. The caller reads and writes the files
// and passes today's date in; nothing here touches the clock or the disk.

import { daysBetween, isIsoDate, mondayOf } from '../../core/dates.ts';
import { MUSCLE_IDS, MUSCLES } from '../../core/data/muscles.ts';
import { dashboardSets, deloadSr, type PlanData } from '../../core/plan-data.ts';
import type { IsoDate, SorenessLevel } from '../../core/schema.ts';
import { habitCheckinKey } from '../../core/tracking.ts';
import { ladderHistory, ladderNameAt, plannedWork, readPlanData } from './convert.ts';
import { habitsTextOr } from './habits-write.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
/** Python's truthiness, for the `x or default` the script uses. */
const truthy = (v: unknown) => !(v === undefined || v === null || v === false || v === 0 || v === '' || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0));

/** Python's repr of a string, as the script's error messages print it. */
function pyRepr(s: unknown): string {
  if (s === null || s === undefined) return 'None';
  const t = String(s);
  if (t.includes("'") && !t.includes('"')) return `"${t}"`;
  return `'${t.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
const pyList = (xs: readonly string[]) => `[${xs.map(pyRepr).join(', ')}]`;

// ---------------------------------------------------------------- the entry

export interface RawLift {
  name?: string;
  planned?: string;
  weight?: number | null;
  reps?: number | null;
  unit?: string | null;
}

/** One line of the dashboard's checklist for the session ("Face Pull + Band External Rotation"), done or skipped. */
export interface LogLine {
  name: string;
  done: boolean;
  /** Why it was skipped (optional): time, pain, equipment, energy. */
  why?: string | null;
}

export interface LoggedSetInput {
  weight?: number | null;
  unit?: string | null;
  reps: number;
  rir?: number | null;
}

/**
 * The input: fitness_log.py add's own shape (date, type, label, lift1, lift2,
 * express, durationMin, cardioMin, cardioMode, rating, postureDrill, notes,
 * swaps), plus what Pahlavan adds.
 */
export interface LogInput {
  date?: string;
  type?: string;
  label?: string | null;
  lift1?: RawLift | null;
  lift2?: RawLift | null;
  express?: boolean;
  durationMin?: number | null;
  cardioMin?: number | null;
  cardioMode?: string | null;
  rating?: number | null;
  postureDrill?: boolean;
  notes?: string | null;
  swaps?: { from: string; to: string }[];
  /** The checklist lines, in the dashboard's order (`checklistLines`). */
  lines?: LogLine[];
  sessionRpe?: number | null;
  pain?: { area: string; severity: number; exercise?: string | null }[];
  hotel?: boolean;
  trackingLevel?: 'standard' | 'full';
  exerciseSets?: { name: string; planned?: string | null; sets: LoggedSetInput[] }[];
}

export interface LogContext {
  /** plan-data.json, parsed. */
  plan: unknown;
  /** fitness-log-data.json as read, parsed (for the ladder levels and the plan's start); null when there is none. */
  log?: unknown;
  /** Today's date: a later date is refused, as the script does. */
  today: IsoDate;
  /** Editing: the session as it is in the file. Fields Pahlavan does not own are kept. */
  original?: Obj | null;
}

export type BuildResult = { ok: true; entry: Obj } | { ok: false; error: string };

/** The keys fitness_log.py add writes, in its order. */
export const SCRIPT_KEYS = ['date', 'type', 'label', 'express', 'lift1', 'lift2', 'durationMin', 'cardioMin', 'cardioMode', 'rating', 'postureDrill', 'notes', 'swaps'] as const;
/** The keys a save from Pahlavan owns: the script's, the dashboard's two, and the new ones. */
export const OWNED_KEYS = [...SCRIPT_KEYS, 'checklist', 'exercises', 'sessionRpe', 'pain', 'hotel', 'trackingLevel', 'exerciseSets'] as const;

/** The session's key in the log: date, type and label, as the dashboard and the script match sessions. */
export const sessionKey = (s: { date?: unknown; type?: unknown; label?: unknown }) => `${String(s.date)}|${String(s.type)}|${s.label ? String(s.label) : ''}`;

/** A lift's unit: its own in plan-data's lifts, else liftUnit (the script's lift_unit, by the done exercise's name). */
export function liftUnit(plan: Obj, name: string): unknown {
  const lifts = isObj(plan['lifts']) ? plan['lifts'] : {};
  const own = isObj(lifts[name]) ? (lifts[name])['unit'] : undefined;
  return truthy(own) ? own : plan['liftUnit'];
}

/** The plan's week for a date, counted from the first logged plan session (the dashboard's planStartOf). */
function planWeekAt(plan: PlanData, log: unknown, date: IsoDate): number {
  const types = [...plan.liftTypes, ...plan.shortTypes];
  const sessions = isObj(log) && Array.isArray(log['sessions']) ? (log['sessions'] as Obj[]) : [];
  const dates = [...sessions.filter((s) => isObj(s) && types.includes(String(s['type'])) && isIsoDate(s['date'])).map((s) => String(s['date'])), date].sort();
  const start = dates[0]!;
  return Math.floor(daysBetween(mondayOf(start), mondayOf(date)) / 7) + 1;
}

/**
 * The session entry for fitness-log-data.json: fitness_log.py add's checks
 * and fields exactly (in its order, with its messages), then the dashboard's
 * `checklist` and `exercises`, then Pahlavan's own fields. On an edit, the
 * fields Pahlavan does not own come over from the original.
 */
export function buildLogEntry(raw: LogInput, ctx: LogContext): BuildResult {
  const plan = isObj(ctx.plan) ? ctx.plan : {};
  const fail = (error: string): BuildResult => ({ ok: false, error });
  const liftTypes = Array.isArray(plan['liftTypes']) ? (plan['liftTypes'] as string[]) : [];
  const shortTypes = Array.isArray(plan['shortTypes']) ? (plan['shortTypes'] as string[]) : [];
  const sessions = isObj(plan['sessions']) ? plan['sessions'] : {};

  if (!isIsoDate(raw.date)) return fail('date must be YYYY-MM-DD');
  const date = raw.date;
  if (date > ctx.today) return fail(`${date} is in the future`);
  const t = raw.type;
  const allowed = [...liftTypes, ...shortTypes, 'custom'];
  if (!isStr(t) || !allowed.includes(t)) return fail(`type must be one of ${pyList(allowed)}`);
  if (t === 'custom' && !String(raw.label ?? '').trim()) return fail('a custom session needs a label');
  const lifting = liftTypes.includes(t);
  const lifts: Obj[] = [];
  if (lifting) {
    const items = Array.isArray(sessions[t]) ? (sessions[t] as Obj[]) : [];
    const logged = items.filter((x) => isObj(x) && truthy(x['logged'])).map((x) => String(x['name']));
    const keys = ['lift1', 'lift2'] as const;
    for (let i = 0; i < Math.min(keys.length, logged.length); i++) {
      const k = keys[i]!;
      // An edit keeps the lift the session logged, even when the plan has changed since.
      const was = ctx.original && isObj(ctx.original[k]) ? (ctx.original[k]) : null;
      const wasPlanned = was ? String(truthy(was['planned']) ? was['planned'] : was['name']) : null;
      const li0 = raw[k];
      const keeps = was && isObj(li0) && (truthy(li0.planned) ? li0.planned : String(li0.name ?? '').trim()) === wasPlanned;
      const planned = keeps ? wasPlanned! : logged[i]!;
      const li = raw[k];
      if (!isObj(li)) return fail(`${t} logs two lifts: ${k} should be ${planned} (or a swap with "planned": "${planned}")`);
      const name = String(li.name ?? '').trim();
      const pl = truthy(li.planned) ? li.planned : name;
      if (pl !== planned) return fail(`${k} of ${t} is ${planned}; got ${pyRepr(name)}${truthy(li.planned) ? ` planned as ${pyRepr(li.planned)}` : ''}`);
      const w = 'weight' in li ? li.weight : 0;
      const r = 'reps' in li ? li.reps : 0;
      if (!isNum(w) || w < 0 || !isNum(r) || !Number.isInteger(r) || r < 0) return fail(`${k}: weight is a number, reps a whole number`);
      const unit = truthy(li.unit) ? li.unit : liftUnit(plan, name);
      if (unit !== 'lb' && unit !== 'kg') return fail(`${k}: unit is lb or kg, not ${pyRepr(unit)}`);
      lifts.push({ name, ...(name !== planned ? { planned } : {}), weight: w, reps: r, unit });
    }
  } else if (truthy(raw.lift1) || truthy(raw.lift2)) return fail(`a ${t} session has no logged lifts`);
  if (truthy(raw.express) && !lifting) return fail('only a lifting session can be Express');

  const entry: Obj = { date, type: t };
  if (t === 'custom') entry['label'] = String(raw.label).trim();
  if (truthy(raw.express)) entry['express'] = true;
  Object.assign(entry, {
    lift1: lifting ? (lifts[0] ?? null) : null,
    lift2: lifting ? (lifts[1] ?? null) : null,
    durationMin: truthy(raw.durationMin) ? raw.durationMin : null,
    cardioMin: truthy(raw.cardioMin) ? raw.cardioMin : 0,
    cardioMode: String(raw.cardioMode ?? '').trim(),
    rating: truthy(raw.rating) ? raw.rating : null,
    postureDrill: truthy(raw.postureDrill),
    notes: String(raw.notes ?? '').trim(),
  });
  if (truthy(raw.swaps)) entry['swaps'] = raw.swaps;

  // The dashboard's two: the checklist (from the form's done and skipped
  // lines) and the plan's exercise list frozen with the session.
  if (!raw.lines && ctx.original && isObj(ctx.original['checklist'])) entry['checklist'] = ctx.original['checklist'];
  else if (raw.lines && raw.lines.length) {
    const skipped = raw.lines.filter((l) => !l.done);
    const why = Object.fromEntries(skipped.filter((l) => l.why).map((l) => [l.name, String(l.why)]));
    entry['checklist'] = { done: raw.lines.length - skipped.length, total: raw.lines.length, skipped: skipped.map((l) => l.name), ...(Object.keys(why).length ? { why } : {}) };
  }
  const orig = ctx.original ?? null;
  const keepList = orig && Array.isArray(orig['exercises']) && orig['type'] === t && orig['date'] === date && Boolean(orig['express']) === Boolean(entry['express']);
  const pd = readPlanData(ctx.plan);
  if (keepList) entry['exercises'] = orig['exercises'];
  else if (pd && Array.isArray(pd.sessions[t])) {
    const history = ladderHistory(ctx.log);
    const week = planWeekAt(pd, ctx.log, date);
    entry['exercises'] = plannedWork(pd, t, Boolean(entry['express']), week > 0 && week % 4 === 0, (id) => ladderNameAt(pd, history, id, date));
  }

  // Pahlavan's own fields; the engine reads them, the script and the dashboard keep them.
  if (isNum(raw.sessionRpe)) entry['sessionRpe'] = raw.sessionRpe;
  if (raw.pain && raw.pain.length) entry['pain'] = raw.pain.map((p) => ({ area: p.area, severity: p.severity, ...(p.exercise ? { exercise: p.exercise } : {}) }));
  if (raw.hotel) entry['hotel'] = true;
  if (raw.trackingLevel === 'full' && raw.exerciseSets) {
    entry['trackingLevel'] = 'full';
    entry['exerciseSets'] = raw.exerciseSets.map((x) => ({
      name: x.name,
      ...(x.planned ? { planned: x.planned } : {}),
      sets: x.sets.filter((s) => isNum(s.reps)).map((s) => ({ ...(isNum(s.weight) ? { weight: s.weight, unit: s.unit ?? null } : {}), reps: s.reps, ...(isNum(s.rir) ? { rir: s.rir } : {}) })),
    }));
  }
  if (orig) for (const [k, v] of Object.entries(orig)) if (!(OWNED_KEYS as readonly string[]).includes(k) && !(k in entry)) entry[k] = v;
  return { ok: true, entry };
}

// ---------------------------------------------------------------- the checklist lines

export interface ChecklistLine {
  name: string;
  sr: string;
  /** The plan items in the line: one, or two for a paired line; none for the warm-up. */
  parts: string[];
  warmup?: boolean;
}

/**
 * The dashboard's checklist for a session (its exercisesFor): the warm-up
 * line, then the plan's items with paired ones joined; Express is its own
 * four lines; a deload week halves to 2 sets, and S3 becomes the deload block.
 */
export function checklistLines(rawPlan: unknown, type: string, express: boolean, deloadWeek: boolean): ChecklistLine[] {
  const plan = readPlanData(rawPlan);
  if (!plan || !Array.isArray(plan.sessions[type])) return [];
  const lifting = plan.liftTypes.includes(type);
  if (express && lifting) {
    const logged = (plan.sessions[type]).filter((i) => i.logged);
    const ex = plan.express;
    return [
      { name: ex.warmup, sr: '3 min', parts: [ex.warmup] },
      ...(logged[0] ? [{ name: logged[0].name, sr: ex.mainSets, parts: [logged[0].name] }] : []),
      ...(logged[1] ? [{ name: logged[1].name, sr: ex.secondSets, parts: [logged[1].name] }] : []),
      ...(ex.finish ? [{ name: ex.finish.name, sr: ex.finish.sr, parts: [ex.finish.name] }] : []),
    ];
  }
  if (deloadWeek && type === 'S3' && plan.deloadS3.length) return plan.deloadS3.map((x) => ({ name: x.name, sr: x.sr, parts: [x.name] }));
  const lines: ChecklistLine[] = [{ name: 'Warm-up', sr: lifting ? '6 min' : '3 min', parts: [], warmup: true }];
  for (const it of plan.sessions[type]) {
    const sr = deloadWeek ? deloadSr(it.sr) : it.sr;
    const prev = lines.at(-1)!;
    if (it.pair && lines.length > 1) lines[lines.length - 1] = { name: `${prev.name} + ${it.name}`, sr: `${prev.sr} / ${sr}`, parts: [...prev.parts, it.name] };
    else lines.push({ name: it.name, sr, parts: [it.name] });
  }
  return lines;
}

/** A session's plan week is a deload week (every 4th from the first logged plan session). */
export function isDeloadDate(rawPlan: unknown, log: unknown, date: IsoDate): boolean {
  const plan = readPlanData(rawPlan);
  if (!plan) return false;
  const w = planWeekAt(plan, log, date);
  return w > 0 && w % 4 === 0;
}

/** The sets the dashboard counts for a dose, re-exported for the form. */
export { dashboardSets };

// ---------------------------------------------------------------- the merge

export type MergeResult =
  | { result: 'added' | 'updated' | 'deleted'; text: string; entry: Obj | null }
  | { result: 'already'; existing: Obj }
  | { result: 'conflict'; disk: Obj | null }
  | { result: 'unreadable'; error: string };

export interface MergeOptions {
  mode: 'add' | 'edit' | 'delete';
  /** Editing or deleting: the session's key and its JSON when the form opened. */
  original?: { key: string; json: string } | null;
  /** Keep this version over a change made elsewhere (after showing both). */
  force?: boolean;
  /** The plan and Today's date: a session saved for that day also sets Today's ticks (`ticksAfterSave`). */
  ticks?: { plan: unknown; today: IsoDate } | null;
}

const pretty = (o: unknown) => JSON.stringify(o, null, 2);

/**
 * The log with this session merged in, against the file as it is now. Only
 * the one session changes (matched by date, type and label); every other
 * session and every other top-level key stays as it is on disk. An add of a
 * session already there is `already`; an edit of a session that changed or
 * went since the form opened is a `conflict` unless forced.
 */
export function mergeLog(diskText: string | null, entry: Obj | null, opts: MergeOptions): MergeResult {
  let doc: Obj;
  if (diskText === null) doc = { sessions: [] };
  else {
    try {
      const v = JSON.parse(diskText) as unknown;
      if (!isObj(v)) return { result: 'unreadable', error: 'fitness-log-data.json is not a JSON object' };
      doc = v;
    } catch (e) {
      return { result: 'unreadable', error: `fitness-log-data.json is not valid JSON (${e instanceof Error ? e.message : String(e)})` };
    }
  }
  if (doc['sessions'] === undefined) doc['sessions'] = [];
  if (!Array.isArray(doc['sessions'])) return { result: 'unreadable', error: 'fitness-log-data.json has no "sessions" list' };
  const list = doc['sessions'] as Obj[];
  const key = entry ? sessionKey(entry) : null;

  if (opts.mode === 'add') {
    const existing = list.find((s) => isObj(s) && sessionKey(s) === key);
    if (existing) return { result: 'already', existing };
    list.push(entry!);
    setTicks(doc, entry!, opts);
    return { result: 'added', text: pretty(doc), entry };
  }

  const o = opts.original!;
  const same = list.findIndex((s) => isObj(s) && sessionKey(s) === o.key && JSON.stringify(s) === o.json);
  const idx = same >= 0 ? same : list.findIndex((s) => isObj(s) && sessionKey(s) === o.key);
  if (!opts.force && (idx < 0 || JSON.stringify(list[idx]) !== o.json)) return { result: 'conflict', disk: idx >= 0 ? list[idx]! : null };
  if (opts.mode === 'delete') {
    if (idx >= 0) list.splice(idx, 1);
    return { result: 'deleted', text: pretty(doc), entry: null };
  }
  const clash = list.find((s, i) => i !== idx && isObj(s) && sessionKey(s) === key);
  if (clash) return { result: 'already', existing: clash };
  if (idx >= 0) list[idx] = entry!;
  else list.push(entry!);
  setTicks(doc, entry!, opts);
  return { result: 'updated', text: pretty(doc), entry };
}

/**
 * Today's checklist record after `entry` is saved: a session dated Today's
 * day with a checklist ticks every line of its session but the ones it
 * skipped, so Today's circles agree with the log whichever way the session
 * was logged. Null leaves the record as it is: a session on another day, a
 * custom one, or a checklist whose lines no longer match the plan's. A pick
 * made on Today that day is kept.
 */
export function ticksAfterSave(log: Obj, entry: Obj, plan: unknown, today: IsoDate): Obj | null {
  const type = entry['type'];
  const ck = entry['checklist'];
  if (entry['date'] !== today || typeof type !== 'string' || !isObj(ck)) return null;
  const express = Boolean(entry['express']);
  const lines = checklistLines(plan, type, express, isDeloadDate(plan, log, today));
  if (!lines.length || ck['total'] !== lines.length) return null;
  const skipped = Array.isArray(ck['skipped']) ? ck['skipped'].map(String) : [];
  const prev = log['todayChecklist'];
  const picked = isObj(prev) && prev['date'] === today && prev['picked'] === true;
  return { date: today, type, express, checked: lines.map((l) => !skipped.includes(l.name)), picked };
}

function setTicks(doc: Obj, entry: Obj, opts: MergeOptions): void {
  const tc = opts.ticks ? ticksAfterSave(doc, entry, opts.ticks.plan, opts.ticks.today) : null;
  if (tc) doc['todayChecklist'] = tc;
}

// ---------------------------------------------------------------- the habit

/** The homepage tracker's key for the Workout habit on a date: hab-workout-<ISO year>-W<ISO week>-<day, 0 = Monday>. */
export function habitKey(date: IsoDate): string {
  return habitCheckinKey('workout', date);
}

/** habits-data.json with the date's Workout ticked: add-only, never unticks; a missing or unreadable file is left alone. */
export function mergeHabit(text: string | null, date: IsoDate): { result: 'ticked'; text: string } | { result: 'already' } | { result: 'unreadable'; error: string } {
  let doc: unknown;
  try {
    // A vault with no habits file yet gets its first one (Workout and Protein), with this tick.
    doc = JSON.parse(habitsTextOr(text));
  } catch {
    return { result: 'unreadable', error: 'habits-data.json is not valid JSON' };
  }
  if (!isObj(doc)) return { result: 'unreadable', error: 'habits-data.json is not a JSON object' };
  const k = habitKey(date);
  const checkins = isObj(doc['checkins']) ? doc['checkins'] : (doc['checkins'] = {});
  if (checkins[k] === '1') return { result: 'already' };
  checkins[k] = '1';
  return { result: 'ticked', text: pretty(doc) };
}

// ---------------------------------------------------------------- sore muscles

/** A body-map slug or a muscle id, as the engine's muscle id. */
export function muscleId(k: string): string | null {
  return MUSCLE_IDS.includes(k) ? k : (MUSCLES.find((m) => m.highlighter === k)?.id ?? null);
}

/**
 * body-data.json with the day's sore muscles changed, muscle by muscle: only
 * the muscles in `changes` move (a level sets it, null clears it); every
 * other muscle, field and day stays. Keys are the engine's muscle ids; an
 * entry under a body-map slug for the same muscle is replaced. A missing or
 * unreadable file is left alone.
 */
export function mergeSoreMuscles(text: string | null, date: IsoDate, changes: Readonly<Record<string, SorenessLevel | null>>): { result: 'merged'; text: string } | { result: 'unchanged' } | { result: 'unreadable'; error: string } {
  if (text === null) return { result: 'unreadable', error: 'no body-data.json' };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { result: 'unreadable', error: 'body-data.json is not valid JSON' };
  }
  if (!isObj(doc)) return { result: 'unreadable', error: 'body-data.json is not a JSON object' };
  const days = isObj(doc['days']) ? doc['days'] : (doc['days'] = {});
  const day = isObj(days[date]) ? (days[date]) : {};
  if (!applySore(day, changes)) return { result: 'unchanged' };
  days[date] = day;
  return { result: 'merged', text: pretty(doc) };
}

/** One day's `soreMuscles` changed in place, muscle by muscle (see mergeSoreMuscles); true when it changed. */
export function applySore(day: Obj, changes: Readonly<Record<string, SorenessLevel | null>>): boolean {
  const before = JSON.stringify(day['soreMuscles'] ?? null);
  const sore: Obj = isObj(day['soreMuscles']) ? { ...(day['soreMuscles']) } : {};
  for (const [k, level] of Object.entries(changes)) {
    const id = muscleId(k);
    if (!id) continue;
    const want = level === 'mild' || level === 'sore' ? level : null;
    if (want && sore[id] === want && Object.keys(sore).every((key) => key === id || muscleId(key) !== id)) continue;
    for (const key of Object.keys(sore)) if (muscleId(key) === id) delete sore[key];
    if (want) sore[id] = want;
  }
  if (Object.keys(sore).length) day['soreMuscles'] = sore;
  else delete day['soreMuscles'];
  return JSON.stringify(day['soreMuscles'] ?? null) !== before;
}

// ---------------------------------------------------------------- ladders

export type LadderMerge =
  | { result: 'set'; text: string; ladder: string; level: number; name: string }
  | { result: 'already'; ladder: string; level: number; name: string }
  | { result: 'invalid'; error: string }
  | { result: 'unreadable'; error: string };

/**
 * fitness-log-data.json with a ladder's level set, as `fitness_log.py ladder
 * ID LEVEL --date D` writes it: `{level, date}` appended to `ladders[id]`,
 * unless the last entry already holds that level ("already"). The ladder and
 * its levels come from plan-data.json; the script's messages, word for word.
 * Every other key, session and ladder stays.
 */
export function mergeLadder(logText: string | null, rawPlan: unknown, id: string, level: number, date: IsoDate): LadderMerge {
  const ladders = isObj(rawPlan) && Array.isArray(rawPlan['ladders']) ? (rawPlan['ladders'] as Obj[]).filter(isObj) : [];
  const ladder = ladders.find((l) => l['id'] === id);
  if (!ladder) return { result: 'invalid', error: `no ladder ${pyRepr(id)}; ladders: ${pyList(ladders.map((l) => String(l['id'])))}` };
  const levels = Array.isArray(ladder['levels']) ? (ladder['levels'] as Obj[]) : [];
  if (!Number.isInteger(level) || level < 1 || level > levels.length) return { result: 'invalid', error: `${String(ladder['name'])} has levels 1-${levels.length}` };
  let doc: unknown = { sessions: [] };
  if (logText !== null) {
    try {
      doc = JSON.parse(logText);
    } catch {
      return { result: 'unreadable', error: 'fitness-log-data.json is not valid JSON' };
    }
  }
  if (!isObj(doc)) return { result: 'unreadable', error: 'fitness-log-data.json is not a JSON object' };
  const all = isObj(doc['ladders']) ? doc['ladders'] : (doc['ladders'] = {});
  const hist = Array.isArray(all[id]) ? (all[id] as Obj[]) : (all[id] = []);
  const name = String(levels[level - 1]?.['name'] ?? '');
  const last = hist.at(-1);
  if (isObj(last) && last['level'] === level) return { result: 'already', ladder: id, level, name };
  (hist).push({ level, date });
  return { result: 'set', text: pretty(doc), ladder: id, level, name };
}

// ---------------------------------------------------------------- a corrected top set

export interface FixRequest {
  date: string;
  type: string;
  label?: string | null;
  lift: 'lift1' | 'lift2';
  weight?: number | null;
  reps?: number | null;
  /** Drops the lift's "planned": a swap the plan has since adopted, so the lift stands for itself. */
  clearPlanned?: boolean;
}

export type FixMerge =
  | { result: 'fixed'; text: string; changed: string[]; before: Obj; after: Obj }
  | { result: 'already'; changed: string[]; before: Obj; after: Obj }
  | { result: 'invalid'; error: string }
  | { result: 'unreadable'; error: string };

/**
 * fitness-log-data.json with one logged lift corrected, as `fitness_log.py
 * fix` writes it: the session by date, type and label; the lift's weight
 * (a whole number kept whole), reps, or "planned" cleared once its name is
 * the plan's logged lift for that slot. The script's checks and messages,
 * word for word; every other session, field and key stays.
 */
export function mergeFix(logText: string | null, rawPlan: unknown, req: FixRequest): FixMerge {
  let doc: unknown = { sessions: [] };
  if (logText !== null) {
    try {
      doc = JSON.parse(logText);
    } catch {
      return { result: 'unreadable', error: 'fitness-log-data.json is not valid JSON' };
    }
  }
  if (!isObj(doc)) return { result: 'unreadable', error: 'fitness-log-data.json is not a JSON object' };
  const key = `${req.date}|${req.type}|${req.label ?? ''}`;
  const sessions = Array.isArray(doc['sessions']) ? (doc['sessions'] as unknown[]) : [];
  const s = sessions.find((x): x is Obj => isObj(x) && sessionKey(x) === key);
  if (!s) return { result: 'invalid', error: `no session logged for ${req.date} ${req.type}${req.label ? ` ${req.label}` : ''}` };
  const li = s[req.lift];
  if (!isObj(li)) return { result: 'invalid', error: `that session has no ${req.lift}` };
  const weight = req.weight ?? null;
  const reps = req.reps ?? null;
  if (weight === null && reps === null && !req.clearPlanned) return { result: 'invalid', error: 'give --weight, --reps, --clear-planned or a mix' };
  if ((weight !== null && weight < 0) || (reps !== null && reps < 0)) return { result: 'invalid', error: "weight and reps can't be negative" };
  if (req.clearPlanned) {
    if (!('planned' in li)) return { result: 'invalid', error: `${req.lift} (${String(li['name'])}) has no "planned" to clear` };
    // Cleared, the lift stands for itself: its name must be the plan's logged lift, as add checks.
    const items = isObj(rawPlan) && isObj(rawPlan['sessions']) && Array.isArray((rawPlan['sessions'])[req.type]) ? ((rawPlan['sessions'])[req.type] as unknown[]) : [];
    const logged = items.filter((x): x is Obj => isObj(x) && Boolean(x['logged'])).map((x) => String(x['name']));
    const planned = logged[req.lift === 'lift1' ? 0 : 1];
    if (li['name'] !== planned) return { result: 'invalid', error: `${req.lift} of ${req.type} is ${planned ?? 'unset'} in the plan, not ${pyRepr(li['name'])}: "planned" stays` };
  }
  const before: Obj = { ...li };
  if (weight !== null) li['weight'] = weight;
  if (reps !== null) li['reps'] = reps;
  if (req.clearPlanned) delete li['planned'];
  const changed = Object.keys({ ...before, ...li }).filter((f) => (f in before) !== (f in li) || JSON.stringify(before[f]) !== JSON.stringify(li[f]));
  const after: Obj = { ...li };
  if (!changed.length) return { result: 'already', changed, before, after };
  return { result: 'fixed', text: pretty(doc), changed, before, after };
}

// ---------------------------------------------------------------- today's checklist

export type ChecklistMerge = { result: 'saved'; text: string; checklist: Obj } | { result: 'unchanged' } | { result: 'unreadable'; error: string };

/**
 * fitness-log-data.json with `todayChecklist` replaced, as the dashboard's
 * saveChecklist writes it: `next` is built from the record on disk (so a
 * tick made elsewhere since is kept); the sessions, the ladders and every
 * other key stay as they are. A missing log starts as `{sessions: []}`.
 */
export function mergeTodayChecklist(logText: string | null, next: (log: Obj) => Obj): ChecklistMerge {
  let doc: unknown = { sessions: [] };
  if (logText !== null) {
    try {
      doc = JSON.parse(logText);
    } catch {
      return { result: 'unreadable', error: 'fitness-log-data.json is not valid JSON' };
    }
  }
  if (!isObj(doc)) return { result: 'unreadable', error: 'fitness-log-data.json is not a JSON object' };
  const tc = next(doc);
  if (JSON.stringify(doc['todayChecklist'] ?? null) === JSON.stringify(tc)) return { result: 'unchanged' };
  doc['todayChecklist'] = tc;
  return { result: 'saved', text: pretty(doc), checklist: tc };
}
