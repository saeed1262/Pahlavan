// The Log panel's model: today's session as the engine builds it (the pick,
// if any), laid onto the dashboard's checklist lines, with each logged lift's
// target, unit and step; or a logged session read back for an edit. And the
// way back: the filled form as the log writer's input, and the sore muscles
// that changed. Pure: the date is an input.

import { ladderHistory, ladderNameAt, readPlanData } from '../adapters/vault/convert.ts';
import { buildLogEntry, sessionKey, checklistLines, isDeloadDate, type LogInput } from '../adapters/vault/log-write.ts';
import type { VaultRead } from '../adapters/vault/read.ts';
import { calibrationCardioNote } from '../core/calibration.ts';
import { CATALOGUE, CATALOGUE_BY_ID, type CatalogueEntry } from '../core/data/exercises.ts';
import { MUSCLES } from '../core/data/muscles.ts';
import { dayText } from '../core/dates.ts';
import { exerciseId } from '../core/plan-data.ts';
import { toExercise } from '../core/plan/context.ts';
import { explain, joinNotes, type Result } from '../core/reason.ts';
import { screenExercise } from '../core/safety.ts';
import type { Exercise, IsoDate, SorenessLevel } from '../core/schema.ts';
import type { SessionMode } from '../core/variant.ts';
import { scopeInfo } from './cycle.ts';
import { ledgerConstraints } from './review.ts';
import type { buildSession } from './session.ts';
import { todayChecklistOf } from './dashboard.ts';

type Obj = Record<string, unknown>;
type Session = ReturnType<typeof buildSession>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export type RowKind = 'warmup' | 'load' | 'reps' | 'timed' | 'cardio';

export interface FormSet {
  weight: number | null;
  reps: number | null;
  rir: number | null;
}

export interface FormRow {
  key: string;
  /** The dashboard's checklist line this row ticks (null: not on the checklist). */
  line: string | null;
  parts: string[];
  kind: RowKind;
  /** What is done today: the engine's item, or the line itself. */
  name: string;
  /** The plan's item when another is done in its place. */
  planned: string | null;
  /** Why it was swapped: the reason's title ("Injury limit", "Hotel swap"), or "Your swap". */
  swapWhy: string | null;
  sr: string;
  /**
   * A timed item as Today shows it: `text` the dose in words (intervals:
   * "4 × 4 min hard, 3 min easy between · about 25 min"; a calibration
   * week's easy minutes), `note` the calibration week's line when it applies.
   */
  timed?: { text: string; note: string | null };
  sets: number;
  repRange: [number, number] | null;
  rir: number | null;
  /** Which logged lift this is (lift1 = 0, lift2 = 1), or null. */
  lift: 0 | 1 | null;
  unit: 'lb' | 'kg';
  step: number;
  /** `calibrate`: a calibration week's target (the weight held, or none to find, at the bottom of the range). */
  target: { weight: number | null; reps: number; rir: number; calibrate?: true } | null;
  /** When there is no target: the engine's start note ("pick a weight for 8-10 reps at RIR 4"); a calibration week's target: how to find the load. */
  targetNote: string | null;
  last: { weight: number; unit: string; reps: number; date: IsoDate } | null;
  /** Other exercises it could be swapped for (names). */
  swaps: string[];
  done: boolean;
  why: string | null;
  /** Standard tracking: the top set. */
  top: { weight: number | null; reps: number | null };
  /** Full tracking: every set. */
  rows: FormSet[];
}

export interface LogForm {
  edit: boolean;
  /** Editing: the session as it was in the file when the form opened. */
  original: { key: string; json: string; entry: Obj } | null;
  date: IsoDate;
  type: string;
  label: string | null;
  typeName: string;
  /** The session the engine suggested (null when editing). */
  suggested: string | null;
  choices: { type: string; name: string; kind: string; suggested: boolean }[];
  lifting: boolean;
  mode: SessionMode;
  tracking: 'standard' | 'full';
  rows: FormRow[];
  warmup: string | null;
  plannedRpe: number | null;
  rpe: number | null;
  minutes: number | null;
  cardio: number;
  /** As written in the log ("bike", or the user's own words); the panel's pills write lower case. */
  cardioMode: string | null;
  rating: number | null;
  posture: boolean;
  notes: string;
  painOn: boolean;
  pain: { area: string; severity: number; during: string | null };
  /** Sore muscles by body-map slug, and as the form found them (only changes are written). */
  sore: Record<string, SorenessLevel>;
  soreFrom: Record<string, SorenessLevel>;
  /** An edit: each row's done and reason as read, so an untouched checklist is kept as it was. */
  baseline?: Record<string, { done: boolean; why: string | null }>;
  /** A new log whose rows start from today's ticks on Today's checklist: how many start done and skipped. */
  fromTicks?: { done: number; skipped: number };
  /** A new log: what it started with (the plan's defaults, today's ticks), so a rebuild for another date keeps only what the user changed. */
  start?: FormStart;
}

/** A new form's starting values: the session's fields the plan fills in, and each row's. */
export interface FormStart {
  minutes: number | null;
  cardio: number;
  cardioMode: string | null;
  rating: number | null;
  posture: boolean;
  rows: Record<string, Pick<FormRow, 'name' | 'planned' | 'swapWhy' | 'done' | 'why' | 'top' | 'rows'>>;
}

/** The form's values now, as a start (copies: the panel edits the form in place). */
export function formStart(f: LogForm): FormStart {
  return {
    minutes: f.minutes,
    cardio: f.cardio,
    cardioMode: f.cardioMode,
    rating: f.rating,
    posture: f.posture,
    rows: Object.fromEntries(f.rows.map((r) => [r.key, { name: r.name, planned: r.planned, swapWhy: r.swapWhy, done: r.done, why: r.why, top: { ...r.top }, rows: r.rows.map((x) => ({ ...x })) }])),
  };
}

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s*—\s*/g, ' · ');
const rangeText = (r: [number, number]) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`);

function planOf(read: VaultRead): Obj {
  return isObj(read.raw?.plan) ? (read.raw.plan) : {};
}
function liftInfo(plan: Obj, name: string): { unit?: string; inc?: number } {
  const lifts = isObj(plan['lifts']) ? plan['lifts'] : {};
  return isObj(lifts[name]) ? (lifts[name]) : {};
}
function unitStep(plan: Obj, name: string, planned: string | null, unit?: string | null): { unit: 'lb' | 'kg'; step: number } {
  const own = liftInfo(plan, name);
  const u = (unit ?? own.unit ?? plan['liftUnit'] ?? 'lb') === 'kg' ? 'kg' : 'lb';
  const inc = own.inc ?? (planned ? liftInfo(plan, planned).inc : undefined);
  return { unit: u, step: isNum(inc) ? inc : u === 'kg' ? 2.5 : 5 };
}
function catalogueEntry(read: VaultRead, id: string): CatalogueEntry | null {
  return CATALOGUE_BY_ID.get(id) ?? (read.data.catalogueMatch[id] ? (CATALOGUE_BY_ID.get(read.data.catalogueMatch[id]) ?? null) : null);
}
function kindOf(read: VaultRead, id: string, name: string, sr: string): RowKind {
  const ex = read.data.program.exercises[id];
  const c = catalogueEntry(read, id);
  if (ex?.kind === 'cardio' || c?.load === 'cardio' || /\bmin\b/.test(sr) && !/×/.test(sr)) return 'cardio';
  if (c?.load === 'timed' || /\d\s*s\b|s\/side/.test(sr)) return 'timed';
  if (c?.load === 'bodyweight' || c?.equipment[0] === 'band' || /band|bodyweight/i.test(name)) return 'reps';
  return 'load';
}

/** "easy, conversational" reads "Easy, conversational". */
const sentence = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);

/**
 * A timed item's dose for the panel: intervals in words, else (a calibration
 * week's easy minutes, with `note` its line) its minutes as the session has
 * them; null for a steady item done as planned (its sr says it).
 */
function timedRow(it: { sr?: string; timed?: { text: string; rounds?: number; minutes: number } }, note: string | null): FormRow['timed'] | null {
  const t = it.timed;
  if (!t) return null;
  if ((t.rounds ?? 0) >= 2) return { text: plain(t.text), note };
  return note ? { text: plain(it.sr ?? t.text), note } : null;
}

/** Alternatives for a swap: the catalogue's nearest (easier, harder, the same pattern) that the profile's equipment and the Ledger allow. */
export function swapOptions(read: VaultRead, id: string, date: IsoDate, limit = 4): string[] {
  const c = catalogueEntry(read, id);
  if (!c) return [];
  const unit = read.data.plan.liftUnit;
  const all: Record<string, Exercise> = { ...read.data.program.exercises };
  for (const e of CATALOGUE) if (!all[e.id]) all[e.id] = toExercise(e, unit);
  const constraints = ledgerConstraints(read.data);
  const equipment = read.data.profile ? new Set(read.data.profile.equipment) : null;
  const near = [...c.easier, ...c.harder, ...CATALOGUE.filter((e) => e.pattern === c.pattern && e.id !== c.id).map((e) => e.id)];
  const seen = new Set<string>([c.id]);
  const out: string[] = [];
  for (const x of near) {
    const e = CATALOGUE_BY_ID.get(x);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    if (equipment && !e.equipment.every((q) => q === 'bodyweight' || equipment.has(q))) continue;
    if (constraints.length && !screenExercise(e.id, constraints, date, all).value.allowed) continue;
    out.push(e.name);
    if (out.length >= limit) break;
  }
  return out;
}

export function soreToday(read: VaultRead, date: IsoDate): Record<string, SorenessLevel> {
  const d = read.data.checkins.daily.find((x) => x.date === date);
  const out: Record<string, SorenessLevel> = {};
  for (const [id, v] of Object.entries(d?.soreMuscles ?? {})) {
    const slug = MUSCLES.find((m) => m.id === id)?.highlighter;
    if (slug) out[slug] = v;
  }
  return out;
}

/** The dashboard's cardio default for a new log: the S3 circuit, a lifting day's finisher, nothing on another short day. */
function cardioDefault(plan: Obj, type: string): { min: number; mode: string | null } {
  if (type === 'S3') return { min: 16, mode: 'intervals' };
  const lifting = Array.isArray(plan['liftTypes']) && (plan['liftTypes'] as string[]).includes(type);
  return { min: lifting ? 10 : 0, mode: null };
}

/**
 * A new log, from the session Today shows (the pick, if any), in its mode.
 * The "Last" line and the prefilled weights count from the cycle start: a
 * lift whose last top set is from before it starts blank (its target still
 * shown, a tap away), so a fresh start never offers the old cycle's numbers.
 */
export function logFormFor(read: VaultRead, session: Session, date: IsoDate): LogForm | null {
  if (!session.session) return null;
  const since = scopeInfo(read.data, date).since;
  const plan = planOf(read);
  const type = session.session.type;
  const lifting = Array.isArray(plan['liftTypes']) && (plan['liftTypes'] as string[]).includes(type);
  const express = session.mode === 'express' && lifting;
  const lines = checklistLines(plan, type, express, isDeloadDate(plan, read.raw?.log, date));
  const loggedNames = (isObj(plan['sessions']) && Array.isArray((plan['sessions'])[type]) ? ((plan['sessions'])[type] as Obj[]) : []).filter((x) => x['logged']).map((x) => String(x['name']));
  const used = new Set<number>();
  const find = (part: string) => {
    const i = session.items.findIndex((it, k) => !used.has(k) && (it.planName === part || it.replaces?.name === part || it.name === part));
    if (i >= 0) used.add(i);
    return i >= 0 ? session.items[i]! : null;
  };
  const rows: FormRow[] = [];
  lines.forEach((line, n) => {
    const key = `${n}:${line.name}`;
    const base = { key, line: line.name, parts: line.parts, planned: null, swapWhy: null, sets: 1, repRange: null, rir: null, lift: null, unit: 'lb' as const, step: 5, target: null, targetNote: null, last: null, swaps: [], done: true, why: null, top: { weight: null, reps: null }, rows: [] };
    if (line.warmup || (express && n === 0)) {
      rows.push({ ...base, kind: 'warmup', name: line.warmup ? 'Warm-up' : plain(line.name), sr: plain(session.warmup ?? line.sr) });
      return;
    }
    const items = line.parts.map(find).filter((x): x is NonNullable<typeof x> => x !== null);
    const fin = !items.length && session.finisher && line.parts.includes(session.finisher.name) ? session.finisher : null;
    if (fin) {
      const easy = session.flags.find((f) => f.rule === 'plan.calibration.cardio');
      const ft = timedRow(fin, easy ? `${sentence(calibrationCardioNote((easy.inputs as { source?: 'plan' | 'restart' }).source))}.` : null);
      rows.push({ ...base, kind: 'cardio', name: plain(fin.name), sr: plain(fin.sr), ...(ft ? { timed: ft } : {}) });
      return;
    }
    if (!items.length) {
      rows.push({ ...base, kind: kindOf(read, exerciseId(line.parts[0] ?? line.name), line.name, line.sr), name: plain(line.name), sr: plain(line.sr) });
      return;
    }
    const it = items[0]!;
    const part = line.parts[0]!;
    const sr = items.length > 1 ? items.map((x) => x.sr ?? `${x.sets} × ${rangeText(x.repRange)}`).join(' / ') : (it.sr ?? `${it.sets} × ${rangeText(it.repRange)}`);
    const kind = kindOf(read, it.exercise, it.name, sr);
    const planned = it.replaces ? part : null;
    const { unit, step } = unitStep(plan, it.name, planned, it.target?.unit);
    const lift = lifting && items.length === 1 && loggedNames.indexOf(part) >= 0 ? (loggedNames.indexOf(part) as 0 | 1) : null;
    const target = it.target ? { weight: it.target.weight, reps: it.target.reps, rir: it.target.rir, ...(it.target.action === 'calibrate' ? { calibrate: true as const } : {}) } : null;
    const calibrateNote = target?.calibrate
      ? target.weight === null
        ? `Calibration week: find a weight that leaves ${target.rir} reps in reserve at ${target.reps} reps.`
        : `Calibration week: start at ${target.weight} ${unit} and adjust until ${target.reps} reps leave ${target.rir} in reserve.`
      : null;
    const why = it.replaces ? it.adjustments.find((a) => a.rule === 'safety.ledger' || a.rule === 'variant.hotel' || a.rule.startsWith('soreness'))?.title ?? 'Swap' : null;
    const start = it.adjustments.find((a) => a.rule === 'progression.start');
    const lastAny = it.last as { weight: number; unit: string; reps: number; date: IsoDate } | null;
    const before = Boolean(lastAny && since && lastAny.date < since);
    const last = before ? null : lastAny;
    const fill = before ? null : target;
    const timed = kind === 'timed';
    const tw = items.length === 1 ? timedRow(it, it.adjustments.some((a) => a.rule === 'plan.calibration.cardio') ? (it.cue ?? null) : null) : null;
    rows.push({
      ...base,
      kind,
      name: items.length > 1 ? items.map((x) => plain(x.name)).join(' + ') : plain(it.name),
      planned,
      swapWhy: why,
      sr: plain(sr),
      ...(tw ? { timed: tw } : {}),
      sets: it.sets,
      repRange: it.repRange,
      rir: it.rir,
      lift,
      unit,
      step,
      target,
      targetNote: before ? `Your last top set is from before this cycle: enter what you used${target ? ', or tap Same as target' : ''}.` : target ? calibrateNote : start?.note ? plain(start.note).replace(/^[^:]+:\s*/, '') : null,
      last: last ?? null,
      swaps: items.length === 1 ? swapOptions(read, it.replaces?.exercise ?? it.exercise, date) : [],
      top: fill ? { weight: fill.weight, reps: fill.reps } : { weight: null, reps: null },
      rows: Array.from({ length: it.sets }, () => ({ weight: fill?.weight ?? null, reps: fill?.reps ?? (timed ? it.repRange[1] : null), rir: null })),
    });
  });
  session.items.forEach((it, k) => {
    if (used.has(k)) return;
    rows.push({ key: `x${k}:${it.exercise}`, line: null, parts: [], kind: kindOf(read, it.exercise, it.name, it.sr ?? ''), name: plain(it.name), planned: it.replaces?.name ?? null, swapWhy: it.replaces ? 'Swap' : null, sr: plain(it.sr ?? `${it.sets} × ${rangeText(it.repRange)}`), sets: it.sets, repRange: it.repRange, rir: it.rir, lift: null, unit: 'lb', step: 5, target: null, targetNote: null, last: null, swaps: [], done: true, why: null, top: { weight: null, reps: null }, rows: [] });
  });
  // Today's ticks on this session's checklist: once any line is ticked, the
  // ticked rows start Done and the rest Skipped, so a skip is marked once.
  const ticks = todayChecklistOf(read.raw?.log, date, type, express, lines.length).checked;
  let fromTicks: LogForm['fromTicks'];
  if (ticks.some(Boolean)) {
    lines.forEach((_, n) => {
      const r = rows[n];
      if (r) r.done = ticks[n] === true;
    });
    const n = rows.slice(0, lines.length);
    fromTicks = { done: n.filter((r) => r.done).length, skipped: n.filter((r) => !r.done).length };
  }
  const pl = 'plannedLoad' in session ? session.plannedLoad : null;
  const cd = cardioDefault(plan, type);
  const sore = soreToday(read, date);
  const form: LogForm = {
    edit: false,
    original: null,
    date,
    type,
    label: null,
    typeName: plain(session.session.name),
    suggested: session.session.suggested?.type ?? type,
    choices: session.choices,
    lifting,
    mode: session.mode,
    tracking: 'standard',
    rows,
    warmup: session.warmup ?? null,
    plannedRpe: pl?.rpe ?? null,
    rpe: null,
    minutes: pl?.minutes ?? null,
    cardio: rows.some((r) => r.kind === 'cardio') || type === 'S3' ? cd.min : 0,
    cardioMode: cd.mode,
    rating: null,
    posture: false,
    notes: '',
    painOn: false,
    pain: { area: 'Lower back', severity: 3, during: null },
    sore,
    soreFrom: { ...sore },
    ...(fromTicks ? { fromTicks } : {}),
  };
  form.start = formStart(form);
  return form;
}

/**
 * A new log with today's swaps chosen on Today's chips (by the plan's item):
 * each row of that item starts with the swap, as the row's own Swap menu
 * would set it ("Your swap"; a logged lift starts blank, its target being the
 * planned exercise's). Rows and swaps that don't meet are left alone.
 */
export function withSwaps(form: LogForm, by: Readonly<Record<string, string>>): LogForm {
  if (form.edit || !Object.keys(by).length) return form;
  const rows = form.rows.map((r) => {
    const item = r.parts[0] ?? r.planned ?? r.name;
    const to = by[item] ?? (r.planned ? by[r.planned] : undefined);
    if (!to || to === r.name) return r;
    const lift = r.lift !== null;
    return { ...r, planned: r.planned ?? item, name: to, swapWhy: 'Your swap', ...(lift ? { target: null, top: { weight: null, reps: null }, targetNote: 'New to the log: enter what you used.' } : {}) };
  });
  return { ...form, rows };
}

/**
 * A new custom session ("Something else"): a label, minutes, cardio, session
 * RPE, rating and notes, no checklist and no lifts, as the original log
 * script's add and the dashboard's dialog log one. `choices` lets the session menu go back to
 * a planned session.
 */
export function customLogForm(read: VaultRead, date: IsoDate, label = '', choices: LogForm['choices'] = read.data.plan.types.map((t) => ({ type: t.type, name: t.label, kind: t.kind, suggested: false })), suggested: string | null = null): LogForm {
  const sore = soreToday(read, date);
  return {
    edit: false,
    original: null,
    date,
    type: 'custom',
    label,
    typeName: 'Something else',
    suggested,
    choices,
    lifting: false,
    mode: 'full',
    tracking: 'standard',
    rows: [],
    warmup: null,
    plannedRpe: null,
    rpe: null,
    minutes: null,
    cardio: 0,
    cardioMode: null,
    rating: null,
    posture: false,
    notes: '',
    painOn: false,
    pain: { area: 'Lower back', severity: 3, during: null },
    sore,
    soreFrom: { ...sore },
    start: { minutes: null, cardio: 0, cardioMode: null, rating: null, posture: false, rows: {} },
  };
}

/** An edit: a logged session read back from its dashboard entry. */
export function logFormFromEntry(read: VaultRead, entry: Obj): LogForm {
  const plan = planOf(read);
  const type = String(entry['type']);
  const date = String(entry['date']);
  const lifting = Array.isArray(plan['liftTypes']) && (plan['liftTypes'] as string[]).includes(type);
  const express = entry['express'] === true && lifting;
  // The session's own frozen list when it has one (the plan may have changed since); else today's plan lines.
  const frozen = Array.isArray(entry['exercises']) ? (entry['exercises'] as Obj[]).filter((x) => isObj(x) && typeof x['name'] === 'string') : null;
  const lines = type === 'custom' ? [] : frozen ? frozen.map((x) => ({ name: String(x['name']), sr: `${Number(x['sets']) || 1} sets`, parts: [String(x['name'])], warmup: false })) : checklistLines(plan, type, express, isDeloadDate(plan, read.raw?.log, date));
  const liftOf = (k: 'lift1' | 'lift2') => (isObj(entry[k]) ? String((entry[k])['planned'] || (entry[k])['name']) : null);
  const planLogged = (isObj(plan['sessions']) && Array.isArray((plan['sessions'])[type]) ? ((plan['sessions'])[type] as Obj[]) : []).filter((x) => x['logged']).map((x) => String(x['name']));
  const loggedNames = lifting && (liftOf('lift1') || liftOf('lift2')) ? [liftOf('lift1') ?? planLogged[0] ?? '', liftOf('lift2') ?? planLogged[1] ?? ''] : planLogged;
  const checklist = isObj(entry['checklist']) ? entry['checklist'] : {};
  // A paired line ("Face Pull + Band External Rotation") names each of its parts.
  const skipped = new Set((Array.isArray(checklist['skipped']) ? (checklist['skipped'] as string[]) : []).flatMap((n) => (frozen ? [n, ...n.split(' + ')] : [n])));
  const why = isObj(checklist['why']) ? (checklist['why'] as Record<string, string>) : {};
  const swapTo = new Map<string, string>();
  for (const s of Array.isArray(entry['swaps']) ? (entry['swaps'] as Obj[]) : []) if (isObj(s)) swapTo.set(String(s['from']), String(s['to']));
  const sets = new Map<string, Obj[]>();
  for (const x of Array.isArray(entry['exerciseSets']) ? (entry['exerciseSets'] as Obj[]) : []) if (isObj(x) && Array.isArray(x['sets'])) sets.set(String(x['name']), x['sets'] as Obj[]);
  const rows: FormRow[] = lines.map((line, n) => {
    const part = line.parts[0] ?? line.name;
    const li = lifting && line.parts.length === 1 && loggedNames.indexOf(part) >= 0 ? (loggedNames.indexOf(part) as 0 | 1) : null;
    const lift = li !== null ? (entry[li === 0 ? 'lift1' : 'lift2'] as Obj | null) : null;
    const done = li !== null && isObj(lift) ? String(lift['name']) : line.parts.length === 1 ? (swapTo.get(part) ?? part) : line.name;
    const planned = li !== null && isObj(lift) ? (lift['planned'] ? String(lift['planned']) : null) : done !== part && line.parts.length === 1 ? part : null;
    const kind: RowKind = line.warmup || (express && n === 0) ? 'warmup' : kindOf(read, exerciseId(done), done, line.sr);
    const { unit, step } = unitStep(plan, done, planned, isObj(lift) ? (lift['unit'] as string | undefined) : undefined);
    const own = sets.get(done) ?? [];
    return {
      key: `${n}:${line.name}`,
      line: line.name,
      parts: line.parts,
      kind,
      name: line.warmup ? 'Warm-up' : plain(done),
      planned,
      swapWhy: planned ? 'Swap' : null,
      sr: plain(line.sr),
      sets: own.length || 1,
      repRange: null,
      rir: null,
      lift: li,
      unit,
      step,
      target: null,
      targetNote: null,
      last: null,
      swaps: [],
      done: !skipped.has(line.name),
      why: why[line.name] ?? null,
      top: isObj(lift) ? { weight: isNum(lift['weight']) ? lift['weight'] : null, reps: isNum(lift['reps']) ? lift['reps'] : null } : { weight: null, reps: null },
      rows: own.map((s) => ({ weight: isNum(s['weight']) ? s['weight'] : null, reps: isNum(s['reps']) ? s['reps'] : null, rir: isNum(s['rir']) ? s['rir'] : null })),
    };
  });
  const pain = Array.isArray(entry['pain']) && isObj(entry['pain'][0]) ? (entry['pain'][0]) : null;
  const titles = isObj(plan['titles']) ? (plan['titles'] as Record<string, string>) : {};
  const choice = read.data.plan.types.find((t) => t.type === type);
  return {
    edit: true,
    original: { key: sessionKey(entry), json: JSON.stringify(entry), entry },
    baseline: Object.fromEntries(rows.map((r) => [r.key, { done: r.done, why: r.why }])),
    date,
    type,
    label: entry['label'] ? String(entry['label']) : null,
    typeName: plain(type === 'custom' ? String(entry['label'] ?? 'Custom') : (choice?.label ?? titles[type] ?? type)),
    suggested: null,
    choices: read.data.plan.types.map((t) => ({ type: t.type, name: t.label, kind: t.kind, suggested: false })),
    lifting,
    mode: express ? 'express' : entry['hotel'] === true ? 'hotel' : 'full',
    tracking: entry['trackingLevel'] === 'full' ? 'full' : 'standard',
    rows,
    warmup: null,
    plannedRpe: null,
    rpe: isNum(entry['sessionRpe']) ? entry['sessionRpe'] : null,
    minutes: isNum(entry['durationMin']) ? entry['durationMin'] : null,
    cardio: isNum(entry['cardioMin']) ? entry['cardioMin'] : 0,
    cardioMode: entry['cardioMode'] ? String(entry['cardioMode']) : null,
    rating: isNum(entry['rating']) ? entry['rating'] : null,
    posture: entry['postureDrill'] === true,
    notes: String(entry['notes'] ?? ''),
    painOn: Boolean(pain),
    pain: { area: pain ? String(pain['area']) : 'Lower back', severity: pain && isNum(pain['severity']) ? pain['severity'] : 3, during: pain && pain['exercise'] ? String(pain['exercise']) : null },
    sore: {},
    soreFrom: {},
  };
}

/** Full tracking's top set: the heaviest, then the most reps, as the dashboard reads a top set. */
export function topOf(row: FormRow, tracking: 'standard' | 'full'): { weight: number | null; reps: number | null } {
  if (tracking !== 'full' || !row.rows.length) return row.top;
  const sets = row.rows.filter((r) => isNum(r.reps));
  if (!sets.length) return { weight: null, reps: null };
  return sets.reduce((a, b) => ((b.weight ?? 0) > (a.weight ?? 0) || ((b.weight ?? 0) === (a.weight ?? 0) && (b.reps ?? 0) > (a.reps ?? 0)) ? b : a));
}

/** The filled form as the log writer's input (the original log script's add shape, plus Pahlavan's fields). */
export function inputFromForm(f: LogForm): LogInput {
  const lift = (i: 0 | 1) => {
    const r = f.rows.find((x) => x.lift === i);
    if (!r) return undefined;
    const t = topOf(r, f.tracking);
    return { name: r.name, ...(r.planned ? { planned: r.planned } : {}), weight: r.done ? (t.weight ?? 0) : 0, reps: r.done ? (t.reps ?? 0) : 0, unit: r.unit };
  };
  const strength = (r: FormRow) => r.done && r.parts.length <= 1 && (r.kind === 'load' || r.kind === 'reps' || r.kind === 'timed');
  return {
    date: f.date,
    type: f.type,
    ...(f.type === 'custom' ? { label: f.label ?? '' } : {}),
    ...(f.lifting ? { lift1: lift(0) ?? null, lift2: lift(1) ?? null } : {}),
    ...(f.mode === 'express' && f.lifting ? { express: true } : {}),
    durationMin: f.minutes,
    cardioMin: f.cardio,
    cardioMode: f.cardioMode ?? '',
    rating: f.rating,
    postureDrill: f.posture,
    notes: f.notes,
    swaps: f.rows.filter((r) => r.planned && r.lift === null && r.parts.length === 1).map((r) => ({ from: r.planned!, to: r.name })),
    ...(f.edit && f.baseline && f.rows.every((r) => f.baseline![r.key]?.done === r.done && (f.baseline![r.key]?.why ?? null) === (r.done ? null : r.why))
      ? {}
      : { lines: f.rows.filter((r) => r.line !== null).map((r) => ({ name: r.line!, done: r.done, why: r.done ? null : r.why })) }),
    sessionRpe: f.rpe,
    pain: f.painOn ? [{ area: f.pain.area, severity: f.pain.severity, exercise: f.pain.during }] : [],
    hotel: f.mode === 'hotel',
    trackingLevel: f.tracking,
    ...(f.tracking === 'full'
      ? { exerciseSets: f.rows.filter(strength).map((r) => ({ name: r.name, planned: r.planned, sets: r.rows.filter((s) => isNum(s.reps)).map((s) => ({ weight: r.kind === 'load' ? s.weight : null, unit: r.kind === 'load' ? r.unit : null, reps: s.reps!, rir: s.rir })) })).filter((x) => x.sets.length) }
      : {}),
  };
}

/** The sore muscles the form changed (engine ids: a level, or null to clear). */
export function soreChanges(f: LogForm): Record<string, SorenessLevel | null> {
  const out: Record<string, SorenessLevel | null> = {};
  for (const slug of new Set([...Object.keys(f.sore), ...Object.keys(f.soreFrom)])) {
    if ((f.sore[slug] ?? null) === (f.soreFrom[slug] ?? null)) continue;
    const id = MUSCLES.find((m) => m.highlighter === slug)?.id ?? slug;
    out[id] = f.sore[slug] ?? null;
  }
  return out;
}

// ---------------------------------------------------------------- the frozen list, for a session logged elsewhere

export interface FrozenList {
  date: IsoDate;
  type: string;
  /** Express: a lifting session's own block (a short day is saved as itself, as the Log panel saves it). */
  express: boolean;
  /** The plan week is a light week (the plan's light weeks, every 4th by default, counted from the first logged plan session): its sets by the rule. */
  deloadWeek: boolean;
  /** The entry's `exercises`, word for word: each plan line's name (a ladder's level that day) and its sets. */
  exercises: { name: string; sets: number }[];
  /** The entry's logged lifts as it names them: the lift done, and the plan's as `planned` for a swap; null on a short day. */
  lift1: { name: string; planned?: string } | null;
  lift2: { name: string; planned?: string } | null;
  /**
   * The entry's `checklist`, word for word as the Log panel's save writes a
   * new log: the plan's checklist lines (the warm-up, each item, a paired
   * line as one "A + B"), `done` of `total`, and the lines skipped by name.
   */
  checklist: { done: number; total: number; skipped: string[]; why?: Record<string, string> };
}

/**
 * The checklist lines `--skip` names: a line by its name ("Warm-up", "Ab
 * wheel rollout", a paired "Face Pull + Band External Rotation"), or by its
 * item's name that day (a ladder's level, as the exercise list names it).
 * The names may come split at every comma (the CLI's "<name>,<name>"): the
 * longest run of pieces that names a line wins, so a line with a comma in
 * its name still matches. One part of a paired line is refused (the Log
 * panel skips a paired line as a whole), and so is a name that is no line.
 */
function skippedLines(read: VaultRead, type: string, lines: readonly { name: string; parts: string[] }[], date: IsoDate, names: readonly string[]): { ok: true; names: string[]; via: string[] } | { ok: false; error: string } {
  const plan = readPlanData(read.raw?.plan);
  const items = plan && Array.isArray(plan.sessions[type]) ? (plan.sessions[type] as { name: string; ladder?: string }[]) : [];
  const history = ladderHistory(read.raw?.log);
  // Each plan item's name that day: a ladder item goes by its level ("Core (abs) (your level)" is "Hollow hold, arms by sides").
  const dayName = (part: string) => {
    const it = items.find((x) => x.name === part);
    return it?.ladder && plan ? (ladderNameAt(plan, history, it.ladder, date) ?? part) : part;
  };
  const key = (x: string) => x.trim().toLowerCase();
  const resolve = (name: string): { line: { name: string; parts: string[] }; how: 'line' | 'part' | 'paired' } | null => {
    const n = key(name);
    const line = lines.find((l) => key(l.name) === n);
    if (line) return { line, how: 'line' };
    const byPart = lines.find((l) => l.parts.some((p) => key(p) === n || key(dayName(p)) === n));
    return byPart ? { line: byPart, how: byPart.parts.length > 1 ? 'paired' : 'part' } : null;
  };
  const out: string[] = [];
  const via: string[] = [];
  for (let i = 0; i < names.length; ) {
    if (!key(names[i]!)) {
      i++;
      continue;
    }
    let j = names.length;
    let hit: ReturnType<typeof resolve> = null;
    for (; j > i; j--) if ((hit = resolve(names.slice(i, j).join(',')))) break;
    const said = (hit ? names.slice(i, j).join(',') : names[i]!).trim();
    if (!hit) return { ok: false, error: `"${said}" is not a line of ${type} on ${dayText(date)}; its lines: ${lines.map((l) => l.name).join('; ')}` };
    if (hit.how === 'paired') return { ok: false, error: `"${said}" is one part of the paired line "${hit.line.name}": the Log panel skips a paired line as a whole, so name the line` };
    if (!out.includes(hit.line.name)) out.push(hit.line.name);
    if (hit.how === 'part') via.push(`"${said}" is the line ${hit.line.name}.`);
    i = j;
  }
  return { ok: true, names: out, via };
}

/** A light week's sets in words: "2 sets of each", "half the sets". */
const lightSetsWords = (sets: number | 'half') => (sets === 'half' ? 'half the sets' : `${sets} set${sets === 1 ? '' : 's'} of each`);

/**
 * The exercise list a session's log entry freezes, exactly as the Log
 * panel's save writes it (buildLogEntry's own `exercises`, from the plan as
 * it reads on that date: its lines and sets, a light week's sets by the
 * plan's rule, the ladder levels of that day, Express's own block), for a
 * session logged elsewhere (`engine log add`), so the engine reads its plan
 * snapshot from the list and not from a later plan. `lifts` are the done
 * lifts' names, for a swap: they only set the entry's `planned`, never the
 * list. An error for what buildLogEntry refuses (a date after today, a lift
 * on a short day).
 */
export function frozenList(read: VaultRead, opts: { date: IsoDate; type: string; mode: SessionMode; lifts?: [string | null, string | null]; skip?: readonly string[] }, today: IsoDate): { ok: true; list: Result<FrozenList> } | { ok: false; error: string } {
  const plan = planOf(read);
  const lifting = Array.isArray(plan['liftTypes']) && (plan['liftTypes'] as string[]).includes(opts.type);
  const given = opts.lifts ?? [null, null];
  if (!lifting && (given[0] || given[1])) return { ok: false, error: `a ${opts.type} session has no logged lifts` };
  // The checklist's lines, as the Log panel's rows have them; a skipped line by its name, or by its item's name that day (a ladder's level).
  const expressMode = opts.mode === 'express' && lifting;
  const deload = isDeloadDate(plan, read.raw?.log, opts.date);
  const lines = checklistLines(plan, opts.type, expressMode, deload);
  const skipped = skippedLines(read, opts.type, lines, opts.date, opts.skip ?? []);
  if (!skipped.ok) return skipped;
  const logged = (isObj(plan['sessions']) && Array.isArray((plan['sessions'])[opts.type]) ? ((plan['sessions'])[opts.type] as Obj[]) : []).filter((x) => isObj(x) && x['logged']).map((x) => String(x['name']));
  // Each logged lift as the Log panel sends it: the done name, with the plan's as `planned` when it differs.
  const lift = (i: 0 | 1) => {
    const planned = logged[i];
    if (!planned) return undefined;
    const name = given[i]?.trim() || planned;
    return { name, ...(name !== planned ? { planned } : {}), weight: 0, reps: 0 };
  };
  const express = opts.mode === 'express' && lifting;
  const input: LogInput = {
    date: opts.date,
    type: opts.type,
    ...(lifting ? { lift1: lift(0) ?? null, lift2: lift(1) ?? null } : {}),
    ...(express ? { express: true } : {}),
    hotel: opts.mode === 'hotel',
    lines: lines.map((l) => ({ name: l.name, done: !skipped.names.includes(l.name) })),
  };
  const built = buildLogEntry(input, { plan: read.raw?.plan, log: read.raw?.log, today });
  if (!built.ok) return built;
  const e = built.entry;
  const named = (k: 'lift1' | 'lift2') => (isObj(e[k]) ? { name: String((e[k])['name']), ...((e[k])['planned'] ? { planned: String((e[k])['planned']) } : {}) } : null);
  const exercises = Array.isArray(e['exercises']) ? (e['exercises'] as { name: string; sets: number }[]) : [];
  const deloadWeek = deload;
  const checklist = (isObj(e['checklist']) ? e['checklist'] : { done: 0, total: 0, skipped: [] }) as FrozenList['checklist'];
  const value: FrozenList = { date: opts.date, type: opts.type, express, deloadWeek, exercises, lift1: named('lift1'), lift2: named('lift2'), checklist };
  const swaps = [value.lift1, value.lift2].filter((l) => l?.planned).map((l) => `${l!.name} for ${l!.planned}`);
  return {
    ok: true,
    list: explain(value, 'log.freeze', { date: opts.date, type: opts.type, express, deloadWeek, lifts: given, skip: opts.skip ?? [] }, {
      note: joinNotes(
        `The plan's ${opts.type} as it reads on ${dayText(opts.date)}: ${exercises.length} line${exercises.length === 1 ? '' : 's'}${express ? ', its Express block' : ''}${deloadWeek ? `, a light week (${lightSetsWords(read.data.rules.rules.lightWeeks.sets)})` : ''}, the ladder levels of that day; a timed line counts a set per 2 minutes, as the dashboard counts it.`,
        'The Log panel writes this list into the session’s entry as `exercises`, so the session keeps the plan it was done on.',
        swaps.length > 0 && `A swap names the plan's lift as \`planned\` (${swaps.join('; ')}); the list keeps the plan's names.`,
        `The entry's \`checklist\` as the Log panel writes it: ${checklist.done} of ${checklist.total} lines done${checklist.skipped.length ? `, skipped: ${checklist.skipped.join('; ')}` : ''}.${skipped.via.length ? ` ${skipped.via.join(' ')}` : ''}`,
      ),
    }),
  };
}
