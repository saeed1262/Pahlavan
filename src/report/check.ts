// The plan check (`engine check`, and `plan-write` before it writes): what a
// plan, written or a draft, is held to. The coach designs the plan; the
// engine calculates and checks it. Two kinds of finding:
//
// - Hard errors block a write and no override clears them: a movement the
//   Ledger or the safety screen rules out, data Pahlavan cannot read as
//   written, a logged lift with no `lifts` entry, an override with no reason.
// - Everything evidence-based is a warning with its rule id, its evidence
//   grade (taken from the evidence library, evidence.ts, which `engine
//   evidence` shows), the numbers and a plain reason. The plan's `overrides`
//   (overrides.ts) turn a matched warning into information, shown with the
//   coach's reason.
//
// Information findings say what was read around (a note's RIR where the
// field would be clearer, movements the catalogue does not know). Pure: the
// date and the previous plan (when the plan checked is a draft) are inputs.

import type { VaultData, VaultWarning } from '../adapters/vault/convert.ts';
import { canonicalTags } from '../adapters/vault/muscle-tags.ts';
import { paths } from '../adapters/vault/layout.ts';
import type { VaultRead } from '../adapters/vault/read.ts';
import { EFFORT_TARGETS, MAX_LOADING_RUN, REP_LIMITS, type Grade } from '../core/data/evidence.ts';
import { CATALOGUE_BY_ID, PATTERNS, usableWith, type CatalogueEntry } from '../core/data/exercises.ts';
import { LOWER_BODY, MUSCLES, MUSCLE_IDS, UPPER_BODY } from '../core/data/muscles.ts';
import { dayText } from '../core/dates.ts';
import { readOverrides, type PlanOverride } from '../core/overrides.ts';
import { readPlanWhy } from '../core/plan-why.ts';
import { effectiveSlot } from '../core/plan.ts';
import { PROGRESSION } from '../core/progression.ts';
import { normalizeEquipment } from '../core/plan/context.ts';
import { finestStep, kitWord, loadKindOf, stepInKit } from '../core/loads.ts';
import { CORE, ISOLATION, REST } from '../core/plan/dose.ts';
import { ITEM_KEYS, itemRir, itemSets, LIFT_KEYS, noteRir, parseNote, parseSr, readRir, type ExerciseExtras, type PlanDataItem, type SlotExtras } from '../core/plan-data.ts';
import { isLightWeek, lightWeekAt } from '../core/rules.ts';
import { screenExercise, screeningCaps } from '../core/safety.ts';
import type { Exercise, ExerciseSlot, IsoDate, SessionTemplate } from '../core/schema.ts';
import { SPLIT_LABELS } from '../core/schema.ts';
import { restMinutes, timeCheck } from '../core/session-time.ts';
import { isIntervals, readTimed, timedFromText, timedMinutes, timedText } from '../core/timed.ts';
import { checkRegions, checkVolume, declaredRegions, overRoom, plannedSetsPerMuscle, postureEmphasis, PRIORITY_ROOM, priorityMuscles, pullPushAim, pullPushSets, REGION_RULES, VOLUME, weekRoom } from '../core/volume.ts';
import { checkGrade } from './evidence.ts';
import { limitText, overlapShare, overLimit, percent, planMovements, sharedMovements } from './overlap.ts';
import { regionOptionsFor, type RegionOptions } from './region-options.ts';
import { buildReview, context, effortOf, ledgerConstraints, planMinutes, type Ctx } from './review.ts';

// ---------------------------------------------------------------- the shape

export type FindingLevel = 'error' | 'warning' | 'info';
/** rules.md's grades: Strong, Moderate, Weak, and (H) a heuristic (the evidence library's, data/evidence.ts). */
export type { Grade };

export interface Finding {
  code: string;
  level: FindingLevel;
  message: string;
  /** What the finding is about, each with its numbers ("shoulders: 22.5 sets a week, over the cap of 20"). */
  items: string[];
  /** The rule's id, as reasons name rules elsewhere. */
  rule?: string;
  /** The evidence grade of an evidence-based warning (absent for the profile's own limits and the plan's conventions). */
  grade?: Grade;
  /** The rule in plain words: what it holds and why. */
  reason?: string;
  /** The plan's override that turned this warning into information, with the coach's reason. */
  override?: PlanOverride;
}

export interface CheckSummary {
  errors: number;
  warnings: number;
  info: number;
  /** Findings an override turned into information. */
  overridden: number;
  /** No hard error: the plan may be written. */
  ok: boolean;
}

export interface CheckReport {
  findings: Finding[];
  summary: CheckSummary;
}

export interface CheckOptions {
  /** The plan as written (plan-data.json parsed), when the plan checked is a draft: exercise changes are judged against it. */
  previous?: unknown;
  /**
   * Facts about the vault outside the plan that the CLI found with its file
   * access (Pahlavan's version against the coach's, `version-differs`): each
   * a warning, ungraded (a fact, not evidence), never blocking a write.
   */
  outside?: readonly VaultWarning[];
  /**
   * The draft is a redesign (`--redesign`): a new plan rather than a change
   * inside this one. Its exercise changes are information
   * (redesign-changes), and a draft that keeps most of the plan as written
   * warns (similar-to-current). Never stored in the plan.
   */
  redesign?: boolean;
}

// ---------------------------------------------------------------- the collector

/** One thing a finding is about: its words, and the names an override may give it (a muscle, "A Face Pull", a session type). */
export interface CheckItem {
  text: string;
  keys: string[];
}

interface Draft {
  code: string;
  level: FindingLevel;
  message: string;
  items: CheckItem[];
  rule?: string;
  grade?: Grade;
  reason?: string;
  override?: PlanOverride;
}

/** The findings as they are collected: one per code and level, its items gathered. */
export class Findings {
  readonly list: Draft[] = [];
  add(code: string, level: FindingLevel, message: string, items: readonly CheckItem[], meta: { rule?: string; grade?: Grade; reason?: string } = {}): void {
    if (!items.length) return;
    const had = this.list.find((d) => d.code === code && d.level === level && !d.override);
    if (had) {
      for (const it of items) if (!had.items.some((x) => x.text === it.text)) had.items.push(it);
      return;
    }
    this.list.push({ code, level, message, items: [...items], ...meta });
  }
}

const item = (text: string, ...keys: (string | null | undefined)[]): CheckItem => ({ text, keys: [...new Set([text, ...keys.filter((k): k is string => Boolean(k))])] });

/** What every check reads: the vault (or the draft), the date, the plan's ordinary loading week and each of its items. */
export interface CheckContext {
  read: VaultRead;
  data: VaultData;
  date: IsoDate;
  /** The plan file as parsed (the draft's, when it is one). */
  raw: Record<string, unknown>;
  /** The review's context on the date (effort, the Ledger, the light weeks). */
  review: Ctx;
  /** The plan's ordinary loading week (no light week, no calibration week), its temporary changes as on the date. */
  templates: SessionTemplate[];
  /** Each item of those sessions with what it is. */
  slots: SlotRef[];
  /** The plan week holding the date, and its place in the light-week calendar; null before the plan starts. */
  place: ReturnType<typeof lightWeekAt> | null;
  previous?: unknown;
  /** The draft is a redesign (CheckOptions.redesign). */
  redesign: boolean;
}

export interface SlotRef {
  /** The session type ("A", "S1"), its kind and template. */
  type: string;
  kind: 'lift' | 'short';
  template: SessionTemplate;
  slot: ExerciseSlot;
  /** The plan item as written. */
  item: PlanDataItem | null;
  /** The item's name as written ("Pull-up (your level)"). */
  name: string;
  exercise: Exercise | undefined;
  catalogue: CatalogueEntry | undefined;
}

export type PlanCheck = (c: CheckContext, f: Findings) => void;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const r2 = (v: number) => Math.round(v * 100) / 100;
const labelOf = (muscle: string) => MUSCLES.find((m) => m.id === muscle)?.label ?? muscle;
const rirText = (r: { lo: number; hi: number }) => (r.lo === r.hi ? `${r.lo}` : `${r.lo}–${r.hi}`);
const rangeOf = (r: readonly [number, number]) => ({ lo: r[0], hi: r[1] });
const isStrength = (s: SlotRef) => (s.exercise?.kind ?? 'strength') === 'strength' && !s.slot.timed;

// ---------------------------------------------------------------- the adapter's own warnings and errors

/** Adapter problems that block a write: Pahlavan would read around them, so the plan would not run as written. */
const BLOCKING = new Set(['unknown-ladder', 'rules-invalid', 'plan-item-field', 'lift-entry', 'plan-data', 'until']);
/** Adapter notes that are information here. */
const INFO = new Set(['muscle-tags-overridden', 'unknown-exercise', 'snapshot-rebuilt', 'legacy-default', 'draft-plan']);
/** The adapter's notes on single records of the log, the body record and the habits: `review` reports them; they say nothing about the plan. */
const OTHER_FILES = new Set(['bad-value', 'unknown-field', 'bad-habit-key', 'test-not-number', 'bad-set', 'bad-sets', 'bad-lift', 'bad-unit', 'bad-rpe', 'bad-pain', 'skip-why', 'sore-muscles', 'bad-day', 'bad-session', 'missing', 'checkins-missing']);
/** Adapter errors about the plan or the safety inputs (the profile's screen, the Ledger); the other files' do not block a plan write. */
const PLAN_ERRORS = new Set(['plan-data', 'missing', 'profile', 'ledger', 'schema']);
/** One message for the codes the adapter gives one warning each. */
const GROUP_MESSAGES: Readonly<Record<string, string>> = {
  'plan-data': 'plan-data.json is not as Pahlavan reads it.',
  'lift-entry': 'Lifts entries Pahlavan cannot use as written.',
  until: 'Temporary changes whose date is not a date.',
  'past-plan-end': 'The date is past the plan\'s last week.',
  'coach-missing': 'Coach files that do not exist yet: what they hold is not checked.',
};
const BLOCKING_REASON = 'Invalid data blocks a plan write: Pahlavan reads around it, so the plan would not run as written.';

function adapterFindings(c: VaultRead, f: Findings): void {
  const own = [paths().plan, paths().profile, paths().ledger, ...(c.draft ? [c.draft.file] : [])];
  // No plan written yet (a fresh vault after the intake) and no draft: nothing to check, which is no error.
  const noPlan = c.files.plan === 'missing' && !c.draft;
  if (noPlan) {
    f.add('no-plan', 'info', 'There is no plan yet: nothing to check. Check a draft with --plan <draft.json> before plan-write writes it.', [item(`${paths().plan} does not exist yet`)], {
      reason: 'A fresh vault has no plan until the plan job writes the first one through plan-write, which checks the draft first.',
    });
  }
  for (const e of c.data.errors) {
    if (noPlan && e.code === 'missing' && e.message.startsWith(`${paths().plan} `)) continue;
    const planScope = PLAN_ERRORS.has(e.code) || (e.code === 'json' && own.some((p) => e.message.startsWith(p)));
    const items = (e.items?.length ? e.items : [e.message]).map((t) => item(t));
    if (planScope) f.add(e.code, 'error', GROUP_MESSAGES[e.code] ?? 'A file the plan check needs cannot be read.', items, { reason: BLOCKING_REASON });
    else f.add(e.code, 'warning', 'A vault file outside the plan has a problem: it does not block a plan write.', items);
  }
  // The adapter's notes are about the plan it read; with none, they would only describe an empty one.
  if (noPlan) return;
  for (const w of c.data.warnings) {
    if (OTHER_FILES.has(w.code)) continue;
    const level: FindingLevel = BLOCKING.has(w.code) ? 'error' : INFO.has(w.code) ? 'info' : 'warning';
    const grouped = Boolean(w.items?.length);
    const items = (grouped ? w.items! : [w.message]).map((t) => item(t, t.split(':')[0]!.trim()));
    const message = grouped ? w.message : (GROUP_MESSAGES[w.code] ?? w.message);
    f.add(w.code, level, message, items, level === 'error' ? { reason: BLOCKING_REASON } : {});
  }
}

// ---------------------------------------------------------------- hard errors: the plan's own data

/** Types, keys and lists Pahlavan cannot read as written (the adapter skips such an item, or reads around it). */
function structure(c: CheckContext, f: Findings): void {
  const raw = c.raw;
  const out: CheckItem[] = [];
  const sessions = isObj(raw['sessions']) ? raw['sessions'] : {};
  const lists: Record<string, string[]> = {};
  for (const key of ['liftTypes', 'shortTypes'] as const) {
    const v = raw[key];
    if (!Array.isArray(v)) continue;
    lists[key] = [];
    v.forEach((t, i) => {
      if (typeof t !== 'string') out.push(item(`${key}[${i}] is not a session type (text)`));
      else if (!Array.isArray(sessions[t])) out.push(item(`${key} names "${t}", which sessions does not hold as a list`));
      else lists[key]!.push(t);
    });
  }
  for (const t of lists['liftTypes'] ?? []) if ((lists['shortTypes'] ?? []).includes(t)) out.push(item(`${t} is in both liftTypes and shortTypes`));
  // The sessions the plan lists (one it does not list is never read).
  const listed = new Set([...(lists['liftTypes'] ?? []), ...(lists['shortTypes'] ?? [])]);
  const named = new Set([...(Array.isArray(raw['liftTypes']) ? raw['liftTypes'] : []), ...(Array.isArray(raw['shortTypes']) ? raw['shortTypes'] : [])]);
  const unlisted = Array.isArray(raw['liftTypes']) && Array.isArray(raw['shortTypes']) ? Object.keys(sessions).filter((t) => !named.has(t)) : [];
  f.add('session-unlisted', 'warning', 'Sessions neither liftTypes nor shortTypes names: Pahlavan never shows, logs or counts them.', unlisted.map((t) => item(`sessions.${t}`, t)), {
    rule: 'plan.sessions',
    reason: 'Pahlavan reads only the sessions liftTypes and shortTypes name. Name the session in one of them, or take it out of the plan (an old session belongs in the archive).',
  });
  for (const [type, list] of Object.entries(sessions)) {
    if (!listed.has(type) || !Array.isArray(list)) continue;
    list.forEach((it, i) => {
      if (!isObj(it)) {
        out.push(item(`sessions.${type}[${i}] is not an object`));
        return;
      }
      const name = typeof it['name'] === 'string' && it['name'].trim() ? it['name'] : null;
      const at = name ? `${type} ${name}` : `sessions.${type}[${i}]`;
      if (!name) out.push(item(`${at} has no name: it is left out of the session`));
      if (typeof it['sr'] !== 'string') out.push(item(`${at} has no sr (its sets and reps as text): it is left out of the session`));
      for (const k of ['table', 'rest', 'note', 'label', 'ladder']) if (it[k] !== undefined && typeof it[k] !== 'string') out.push(item(`${at}: ${k} is not text`));
      for (const k of ['logged', 'pair']) if (it[k] !== undefined && typeof it[k] !== 'boolean') out.push(item(`${at}: ${k} is not true or false`));
      const unknown = Object.keys(it).filter((k) => !k.startsWith('_') && !(ITEM_KEYS as readonly string[]).includes(k));
      if (unknown.length) out.push(item(`${at}: unknown key(s) ${unknown.join(', ')} (an item's keys: ${ITEM_KEYS.join(', ')})`));
    });
  }
  if (raw['lifts'] !== undefined && !isObj(raw['lifts'])) out.push(item('lifts is not an object of lifts by name'));
  for (const [name, l] of Object.entries(isObj(raw['lifts']) ? raw['lifts'] : {})) {
    if (!isObj(l)) {
      out.push(item(`lifts["${name}"] is not an object`));
      continue;
    }
    const unknown = Object.keys(l).filter((k) => !k.startsWith('_') && !(LIFT_KEYS as readonly string[]).includes(k));
    if (unknown.length) out.push(item(`lifts["${name}"]: unknown key(s) ${unknown.join(', ')} (a lift's keys: ${LIFT_KEYS.join(', ')})`));
    if (l['short'] !== undefined && typeof l['short'] !== 'string') out.push(item(`lifts["${name}"].short is not text`));
    for (const k of ['db', 'chart']) if (l[k] !== undefined && typeof l[k] !== 'boolean') out.push(item(`lifts["${name}"].${k} is not true or false`));
    if (l['step'] !== undefined && (typeof l['step'] !== 'number' || !(l['step'] > 0))) out.push(item(`lifts["${name}"].step is not a number above 0`));
  }
  if (raw['guide'] !== undefined && !isObj(raw['guide'])) out.push(item('guide is not an object of entries by name'));
  for (const [name, g] of Object.entries(isObj(raw['guide']) ? raw['guide'] : {})) {
    const m = isObj(g) ? g['muscles'] : undefined;
    if (m === undefined) continue;
    if (!isObj(m)) out.push(item(`guide["${name}"].muscles is not an object`));
    else for (const k of ['main', 'helps']) if (m[k] !== undefined && (!Array.isArray(m[k]) || !(m[k] as unknown[]).every((x) => typeof x === 'string'))) out.push(item(`guide["${name}"].muscles.${k} is not a list of muscle ids`));
  }
  const ov = readOverrides(raw['overrides']);
  out.push(...ov.problems.map((p) => item(p)));
  f.add('invalid-data', 'error', 'Data in the plan Pahlavan cannot read as written.', out, { reason: BLOCKING_REASON });
  f.add('override-without-reason', 'error', 'Overrides with no reason: an override states why the plan goes outside the evidence, so one without a reason is refused.', ov.withoutReason.map((t) => item(t)), {
    reason: 'An override records the coach\'s reason for going outside an evidence range (and, ideally, the Decision that holds it). Without a reason it is an unexplained exception, so it blocks the write.',
  });
  f.add('why-shape', 'error', 'A Why this plan card (the plan\'s `why`) Pahlavan cannot read as written.', readPlanWhy(raw).problems.map((p) => item(p)), {
    rule: 'plan.why-card',
    reason: 'The card is the coach\'s reasons for the plan, which the person reads on the Plan tab: a date, a lead, the reasons with their grades, and the split (the family picked, the ones compared, the ones left out). Written wrong, it would show half a reason, so it blocks the write.',
  });
}

/** The plan's items by session type, as written (valid items only: `structure` reports the rest). */
function rawItems(c: CheckContext): { type: string; kind: 'lift' | 'short'; item: PlanDataItem }[] {
  const sessions = isObj(c.raw['sessions']) ? c.raw['sessions'] : {};
  return c.data.plan.types.flatMap((t) => ((sessions[t.type] ?? []) as unknown[]).filter((x): x is PlanDataItem => isObj(x) && typeof x['name'] === 'string' && typeof x['sr'] === 'string').map((it) => ({ type: t.type, kind: t.kind, item: it })));
}

const SR_MINUTES = /(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s*min\b/;

/** Fields that contradict the item's own note or sets: the field counts, so the note says something the plan does not do. */
function contradictions(c: CheckContext, f: Findings): void {
  const rir: CheckItem[] = [];
  const timed: CheckItem[] = [];
  const rirNote: CheckItem[] = [];
  const timedNote: CheckItem[] = [];
  for (const { type, item: it } of rawItems(c)) {
    const at = `${type} ${it.name}`;
    const field = readRir(it.rir);
    const inNote = noteRir(it.note);
    // Compared only when the note names one RIR: "RIR 3 in the calibration week, then RIR 1–2" is the coach's own wording.
    const single = ((it.note ?? '').match(/\bRIR \d/g) ?? []).length === 1;
    if (field.rir && inNote && single && (field.rir.lo !== inNote.lo || field.rir.hi !== inNote.hi)) rir.push(item(`${at}: rir ${rirText(field.rir)}, the note says RIR ${rirText(inNote)}`, at, it.name));
    if (it.rir === undefined && inNote) rirNote.push(item(`${at}: RIR ${rirText(inNote)} (from the note)`, at, it.name));
    const t = readTimed(it.timed).timed;
    const fromNote = timedFromText('', it.note);
    if (t) {
      const total = timedMinutes(t);
      const m = SR_MINUTES.exec(String(it.sr));
      const lo = m ? Number(m[1]) : null;
      const hi = m ? Number(m[2] ?? m[1]) : null;
      if (total !== null && lo !== null && hi !== null && (total < lo - 0.5 || total > hi + 0.5)) timed.push(item(`${at}: sr says ${m![0]}, the timed field adds up to ${total} min`, at, it.name));
      if (isIntervals(fromNote) && (fromNote.rounds !== t.rounds || fromNote.workMin !== t.workMin || (fromNote.restMin ?? 0) !== (t.restMin ?? 0))) {
        timed.push(item(`${at}: the note describes ${fromNote.rounds} × ${fromNote.workMin} min, ${fromNote.restMin ?? 0} min between; the timed field has ${timedText(t)}`, at, it.name));
      }
    } else if (it.timed === undefined && isIntervals(fromNote)) timedNote.push(item(`${at}: ${timedText({ ...fromNote, ...(timedFromText(it.sr) ?? {}) })} (from the note)`, at, it.name));
  }
  const fieldWins = 'The field counts everywhere (Today, the log form, the time estimate), so the note may tell the user something else; rewrite the note\'s sentence or the field, or say why the note differs (an override).';
  f.add('rir-differs', 'warning', 'Items whose rir field and note (one RIR in it) disagree.', rir, { rule: 'plan.fields', reason: fieldWins });
  f.add('timed-differs', 'warning', 'Items whose timed field disagrees with their sr minutes or the intervals their note describes.', timed, { rule: 'plan.fields', reason: fieldWins });
  f.add('rir-in-note', 'info', 'For information: items whose RIR is read from the note; the item\'s rir field says it more clearly (the note stays the cue).', rirNote);
  f.add('timed-in-note', 'info', 'For information: intervals read from the note; the item\'s timed field says them more clearly.', timedNote);
}

/** A muscle in both main and helps of a guide entry whose tags count (a movement the catalogue does not know, or one with an override). */
function duplicateTags(c: CheckContext, f: Findings): void {
  const out: CheckItem[] = [];
  for (const [name, g] of Object.entries(isObj(c.raw['guide']) ? c.raw['guide'] : {})) {
    const m = isObj(g) && isObj(g['muscles']) ? g['muscles'] : null;
    if (!m || !Array.isArray(m['main']) || !Array.isArray(m['helps'])) continue;
    const both = (m['main'] as unknown[]).filter((x): x is string => typeof x === 'string' && (m['helps'] as unknown[]).includes(x));
    if (both.length && canonicalTags(name, g).source !== 'catalogue') out.push(item(`${name}: ${both.join(', ')} in main and helps`, name));
  }
  f.add('muscle-tags-duplicate', 'error', 'Guide entries that count a muscle as both main and helping.', out, {
    reason: 'A set counts 1 for a main muscle and half for a helping one; a muscle in both is a contradiction (Pahlavan counts it once, as main). These entries\' tags are the ones that count, so the entry must say which it is.',
  });
}

/** Logged lifts and the log's two lift slots. */
function lifts(c: CheckContext, f: Findings): void {
  const keys = new Set(Object.keys(isObj(c.raw['lifts']) ? c.raw['lifts'] : {}).map((k) => k.toLowerCase()));
  const missing: CheckItem[] = [];
  const counts: CheckItem[] = [];
  const byType = new Map<string, { kind: 'lift' | 'short'; logged: string[] }>();
  for (const { type, kind, item: it } of rawItems(c)) {
    const b = byType.get(type) ?? { kind, logged: [] };
    if (it.logged === true) {
      b.logged.push(it.name);
      if (kind === 'lift' && !keys.has(it.name.toLowerCase())) missing.push(item(`${type} ${it.name}`, it.name, type));
    }
    byType.set(type, b);
  }
  for (const [type, b] of byType) {
    if (b.kind === 'lift' && b.logged.length > 2) counts.push(item(`${type}: ${b.logged.length} items marked logged (${b.logged.join(', ')}); the log records the first two`, type));
    if (b.kind === 'short' && b.logged.length) counts.push(item(`${type}: a short day with ${b.logged.join(', ')} marked logged; a short day logs no lifts`, type));
  }
  f.add('no-lift-entry', 'error', 'Logged lifts with no `lifts` entry: no rep range or step, so no next target, no stall check and no progression rule.', missing, {
    reason: 'A logged lift\'s targets come from its lifts entry (lo, hi, inc and its progression rule). Add the entry, or stop marking the item logged.',
  });
  f.add('logged-count', 'warning', 'Logged items the log cannot record.', counts, { rule: 'log.lifts', reason: 'A lifting session\'s log entry records two lifts (lift1 and lift2), the first two items marked logged; a short day records none.' });
}

// ---------------------------------------------------------------- hard errors: safety

/** The Ledger's constraints active on the date and the safety screen's limits. */
function safety(c: CheckContext, f: Findings): void {
  const exercises = c.data.program.exercises;
  const constraints = ledgerConstraints(c.data);
  const blocked: CheckItem[] = [];
  const conditions: CheckItem[] = [];
  const seen = new Set<string>();
  for (const s of constraints.length ? c.slots : []) {
    const key = `${s.type}|${s.slot.exercise}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = screenExercise(s.slot.exercise, constraints, c.date, exercises);
    const at = `${s.type} ${s.name}`;
    if (!r.value.allowed) {
      const until = r.value.blockedUntil ? ` through ${dayText(r.value.blockedUntil)}` : '';
      const swaps = r.value.swaps.slice(0, 3).map((x) => exercises[x]?.name ?? x);
      blocked.push(item(`${at}: ruled out by ${r.value.blockedBy.join(', ')}${until}${swaps.length ? `; swaps: ${swaps.join(', ')}` : ''}`, at, s.name, s.type));
    } else if (r.value.conditions.length) conditions.push(item(`${at}: ${r.value.conditions.join('; ')}`, at, s.name));
  }
  f.add('ledger-blocked', 'error', 'Movements the Ledger rules out on this date.', blocked, {
    rule: 'safety.ledger',
    reason: 'An active Ledger constraint (a movement or an abdominal-strain tag ruled out) is a safety limit, not evidence to weigh: the plan may not prescribe the movement while it holds. Swap it, or write a temporary change (until the constraint\'s date) that replaces it.',
  });
  f.add('ledger-conditions', 'info', 'For information: movements allowed under an active Ledger constraint, with how to do them.', conditions, { rule: 'safety.ledger' });

  const profile = c.data.profile;
  if (!profile) return;
  const outcome = profile.screening.outcome;
  if (outcome === 'blocked') {
    f.add('screening-blocked', 'error', 'The safety screen is Blocked: no plan and no progression advice until a clinician clears it.', [item(`screening: blocked (${dayText(profile.screening.date)})`)], {
      rule: 'safety.screening-caps',
      reason: 'A Blocked screen means logging only (intake.md): the coach writes no plan until a clinician clears the user and the screen is taken again.',
    });
    return;
  }
  const firstMesocycle = !c.place || c.place.mesocycle === 1;
  const caps = screeningCaps(outcome, { firstMesocycle }).value;
  const limits: CheckItem[] = [];
  const seenItem = new Set<string>();
  for (const s of c.slots) {
    const at = `${s.type} ${s.name}`;
    if (seenItem.has(at)) continue;
    seenItem.add(at);
    if (caps.minRir !== null && isStrength(s)) {
      const r = s.item ? itemRir(s.item) : null;
      const lo = r?.lo ?? s.slot.rir;
      if (lo < caps.minRir) limits.push(item(`${at}: RIR ${r ? rirText(r) : `${lo} (Pahlavan's default: the item gives none)`}; the ${outcome} screen needs ${caps.minRir} or more`, at, s.name));
    }
    if (!caps.vigorous && s.item && isIntervals(s.slot.timed ?? null)) limits.push(item(`${at}: hard intervals; the ${outcome} screen allows easy cardio only`, at, s.name));
  }
  if (caps.fullBodyOnly) {
    for (const t of c.templates.filter((x) => x.kind === 'lift' || x.kind === 'express')) {
      const main = t.slots.flatMap((s) => exercises[s.exercise]?.muscles?.main ?? []);
      const lower = main.some((m) => LOWER_BODY.includes(m));
      const upper = main.some((m) => UPPER_BODY.includes(m));
      const type = c.data.plan.types.find((x) => x.template === t.id)?.type ?? t.id;
      if (!(lower && upper)) limits.push(item(`${type}: not full body (${lower ? 'lower' : upper ? 'upper' : 'no tagged'} muscles only); the ${outcome} screen allows full-body sessions only`, type));
    }
  }
  f.add('screening-limit', 'error', `Items past the ${outcome} screen's limits.`, limits, {
    rule: 'safety.screening-caps',
    reason: `The safety screen's outcome sets limits the plan keeps (${screeningCaps(outcome, { firstMesocycle }).reason.note}); they are safety, not evidence to weigh.`,
  });
}

// ---------------------------------------------------------------- warnings: evidence

/** Sets per muscle against the tiers, the priority muscles' 10–16, the weekly cap and the per-session cap (rules.md, "Volume"). */
function volume(c: CheckContext, f: Findings): void {
  const { data } = c;
  const exercises = data.program.exercises;
  const weights = weightsOf(c);
  const planned = plannedSetsPerMuscle(c.templates, exercises, { weights, effort: effortOf(c.review) }).value;
  // A declared weak region's muscle is a priority muscle too (`priorityMuscles`): held to 10–16 like the profile's.
  const priority = priorityMuscles(data.profile, data.program.priorityMuscles);
  const muscles = data.plan.muscles.length ? data.plan.muscles : [...new Set([...Object.keys(planned.perWeek), ...priority])];
  const posture = postureEmphasis(data.profile);
  const below: CheckItem[] = [];
  const cap: CheckItem[] = [];
  const under: CheckItem[] = [];
  const over: CheckItem[] = [];
  for (const b of checkVolume(planned.perWeek, { muscles, priority, split: planned.split })) {
    const v = b.value;
    const m = v.muscle;
    const sets = r2(v.sets);
    if (v.status === 'below-minimum') below.push(item(`${m}: ${sets} sets a week, under the minimum dose of ${VOLUME.minimum}`, m, labelOf(m)));
    else if (v.status === 'at-cap') cap.push(item(`${m}: ${sets} sets a week, over the cap of ${VOLUME.highTop}`, m, labelOf(m)));
    else if (v.status === 'priority-low') under.push(item(`${m}: ${sets} sets a week, under ${VOLUME.efficientTop} for a priority muscle (10–16)`, m, labelOf(m)));
    else if (v.status === 'priority-direct-under') under.push(item(`${m}: ${sets} sets a week, but only ${r2((v.hardDirect ?? 0) + (v.unknown ?? 0))} direct and near failure; a priority muscle needs ${VOLUME.efficientTop} of those`, m, labelOf(m)));
    else if (v.status === 'priority-high' && !(posture && (m === 'upper-back' || m === 'lats'))) over.push(item(`${m}: ${sets} sets a week, over ${VOLUME.priorityTop} (the priority tier is 10–16)`, m, labelOf(m)));
  }
  const session = planned.overSession.map((o) => {
    const type = typeOfTemplate(c, o.template);
    return item(`${type} ${o.muscle}: ${o.sets} direct sets in one session, over about ${VOLUME.perSessionDirectMax}`, type, o.muscle, `${type} ${o.muscle}`, labelOf(o.muscle));
  });
  f.add('volume-below-minimum', 'warning', 'Muscles under the minimum dose (4 sets a week).', below, {
    rule: 'volume.bands',
    grade: checkGrade('volume-below-minimum'),
    reason: 'Growth rises with weekly sets; about 4 a week is the minimum effective dose, the floor for any muscle (rules.md, "Volume"; the shape Strong, the tier numbers Moderate).',
  });
  f.add('volume-over-cap', 'warning', 'Muscles over the weekly cap (20 sets a week).', cap, {
    rule: 'volume.bands',
    grade: checkGrade('volume-over-cap'),
    reason: 'Returns keep falling past about 20 weekly sets and few studies go past 25, so the plan stays at or under 20, for fatigue and time; above it only as a short deliberate block (rules.md, "Volume", the cap is a heuristic).',
  });
  f.add('priority-under', 'warning', 'Priority muscles short of their 10 sets.', under, {
    rule: 'volume.bands',
    grade: checkGrade('priority-under'),
    reason: 'A priority muscle gets 10–16 weekly sets, and its minimum of 10 counts only direct sets taken near failure (0–3 RIR): half credit from compound lifts and easy sets does not fill it (rules.md, "Volume"; which muscles are priorities is the profile\'s).',
  });
  f.add('priority-over', 'warning', 'Priority muscles past the top of their tier (16 sets a week).', over, {
    rule: 'volume.bands',
    grade: checkGrade('priority-over'),
    reason: 'The priority tier is 10–16 weekly sets; past 16 the added sets buy less and cost recovery. With the posture emphasis, upper back and lats may run to the cap.',
  });
  f.add('session-cap', 'warning', 'Muscles with more than about 8 direct sets in one session.', session, {
    rule: 'volume.session-cap',
    grade: checkGrade('session-cap'),
    reason: 'Past about 8 direct sets for one muscle in one session, more sets were unlikely to add a detectable effect (one preprint): a muscle needing more than about 16 a week needs two or more sessions.',
  });
}

/**
 * More priority muscles than the week has room for (H): the effective ones
 * (the profile's, the declared regions' muscles and the confirmed lagging
 * areas) against the room (volume.ts, `weekRoom`) for the plan's lifting
 * days at the profile's minutes. A priority the plan trains only on its
 * short sessions does not count. planning.md: the coach ranks which come first (the user confirms), the rest
 * wait under Later priorities; keeping them all is an override with its
 * reason.
 */
function priorityRoom(c: CheckContext, f: Findings): void {
  const profile = c.data.profile;
  if (!profile) return;
  const priority = priorityMuscles(profile, c.data.program.priorityMuscles);
  const liftingDays = c.data.plan.weekTarget.lift;
  const minutes = profile.availability.minutesPerSession;
  const room = weekRoom(liftingDays, minutes);
  const mainOn = (kind: 'lift' | 'short') => [...new Set(c.slots.filter((s) => s.kind === kind && s.exercise?.kind !== 'cardio').flatMap((s) => s.exercise?.muscles?.main ?? []))];
  const over = overRoom(priority, room, mainOn('short'), mainOn('lift'));
  if (!over) return;
  const names = (ms: readonly string[]) => ms.map(labelOf).join(', ');
  const short = over.onShort.length ? `; ${names(over.onShort)}, trained only on the short sessions, use none of it` : '';
  const text = `${over.counted.length} priority muscles (${names(over.counted)}) on ${liftingDays} lifting day(s) of ${minutes} min, where the week has room for ${room}${short}`;
  f.add('priority-room', 'warning', 'More priority muscles than the week has room for.', [item(text, ...over.counted, ...over.counted.map(labelOf))], {
    rule: 'volume.priority-room',
    grade: checkGrade('priority-room'),
    reason: `Up to 2–3 priority muscles per phase (rules.md, "Volume", the Priority row; which muscles, and how many a week holds, are heuristics): each takes ${VOLUME.efficientTop}–${VOLUME.priorityTop} weekly sets, so the week has room for ${PRIORITY_ROOM.fourDays} with 4 or more lifting days, ${PRIORITY_ROOM.threeDays} with 3, ${PRIORITY_ROOM.twoDaysOr30Min} with 2 or ${PRIORITY_ROOM.shortSessionMinutes}-minute sessions. Past it every priority gets less, or the sessions run longer. The coach ranks which come first this phase from the assessment and the data, the user confirms, and the rest wait under the Athlete profile's Later priorities; keeping them all (longer sessions, chosen knowingly) is an override with that reason.`,
  });
}

/** The most options a region finding lists. */
const REGION_OPTIONS = 5;

/**
 * The options a short region's finding lists (region-options.ts: the
 * equipment, the Ledger on the date, the dislikes and the findings acting in
 * full), best first, "(in the plan)" where more sets would do; when none
 * fits, `blocked` says what ruled each biasing movement out.
 */
function regionCover(c: CheckContext, optionsOf: (region: string) => RegionOptions, region: string): { options: string[]; blocked: string[] } {
  const inPlan = new Set(c.slots.map((s) => s.catalogue?.id).filter((x): x is string => Boolean(x)));
  const o = optionsOf(region);
  return { options: o.options.slice(0, REGION_OPTIONS).map((e) => `${e.name}${inPlan.has(e.id) ? ' (in the plan)' : ''}`), blocked: o.blocked.slice(0, REGION_OPTIONS) };
}

/**
 * The region rules (volume.ts, REGION_RULES): each coverage region of a priority
 * muscle (the profile's, and each declared region's muscle) gets 4 direct
 * region sets a week, and each region the person declares weak 6 direct
 * region sets near failure. A short region is a warning listing the
 * catalogue movements that would cover it, as options; one no catalogue
 * movement can cover with the equipment and the Ledger is information, not a
 * failure. The rough-guide and other non-coverage regions are `review`'s to
 * report, unless declared.
 */
function regionCoverage(c: CheckContext, f: Findings): void {
  const profile = c.data.profile;
  if (!profile) return;
  const declared = declaredRegions(profile);
  const priority = priorityMuscles(profile, c.data.program.priorityMuscles);
  if (!priority.length) return;
  const planned = plannedSetsPerMuscle(c.templates, c.data.program.exercises, { weights: weightsOf(c), effort: effortOf(c.review) }).value;
  const coverage: CheckItem[] = [];
  const declaredShort: CheckItem[] = [];
  const uncoverable: CheckItem[] = [];
  const optionsOf = regionOptionsFor(c.data, c.date);
  for (const row of checkRegions(planned.regions ?? {}, { priority, declared })) {
    const v = row.value;
    if (v.status !== 'short') continue;
    const what =
      v.rule === 'declared'
        ? `${v.counted} direct sets near failure a week${v.unknown > 0 ? ` (${v.unknown} of unknown effort, counted)` : ''}, under ${v.min} for a declared weak region`
        : `${v.counted} direct sets a week, under ${v.min} for a priority muscle's coverage region`;
    const head = `${v.id} (${v.label}): ${what}`;
    const cover = regionCover(c, optionsOf, v.id);
    if (!cover.options.length) uncoverable.push(item(`${head}; no catalogue movement that biases it fits${cover.blocked.length ? `: ${cover.blocked.join(', ')}` : ''}`, v.id, v.label));
    else (v.rule === 'declared' ? declaredShort : coverage).push(item(`${head}; options: ${cover.options.join(', ')}`, v.id, v.label));
  }
  const options = 'The options are catalogue movements that bias the region and fit the equipment, the Ledger, the dislikes and the findings acting in full, best first ("in the plan" where more sets would do): choices for the coach, not instructions.';
  f.add('region-coverage', 'warning', `Coverage regions of priority muscles with under ${REGION_RULES.coverage} direct sets a week.`, coverage, {
    rule: 'volume.region-coverage',
    grade: checkGrade('region-coverage'),
    reason: `A muscle grows unevenly with the exercise (the rectus femoris grows from leg extensions and barely from squats; the side delts least from pressing), so a priority muscle's whole sets can hide a region with no direct work. Each of its coverage regions gets at least ${REGION_RULES.coverage} direct sets a week from a movement that biases it; the ${REGION_RULES.coverage} is a heuristic. ${options}`,
  });
  f.add('region-declared-short', 'warning', `Declared weak regions with under ${REGION_RULES.declared} direct sets near failure a week.`, declaredShort, {
    rule: 'volume.region-declared',
    grade: checkGrade('region-declared-short'),
    reason: `A region the person declares weak (the profile's priorityRegions, or a body-assessment row's regions: declared, never diagnosed, since no validated way spots a lagging region from photos or a tape) gets at least ${REGION_RULES.declared} direct sets near failure a week (0–3 RIR; an unknown effort counts) from movements that bias it, inside its muscle's priority 10–16; the ${REGION_RULES.declared} is a heuristic. ${options}`,
  });
  f.add('region-uncoverable', 'info', 'For information: regions short of their rule that no catalogue movement can cover with this equipment and Ledger.', uncoverable, {
    rule: 'volume.region-coverage',
    reason: 'Not a failure: no movement in the catalogue that biases the region fits. A movement the catalogue does not know can still cover it (its guide entry names the region), or the equipment may change.',
  });
}

/** RIR by exercise type (rules.md, "Effort"; EFFORT_TARGETS): compound lifts 1–3, isolation and machines 0–2, heavy strength work (6 reps or fewer) 2–4. */
function effort(c: CheckContext, f: Findings): void {
  const outcome = c.data.profile?.screening.outcome;
  // Under a screen with an RIR floor the floor holds instead (a hard error when it is not met).
  if (outcome && screeningCaps(outcome, { firstMesocycle: !c.place || c.place.mesocycle === 1 }).value.minRir !== null) return;
  const out: CheckItem[] = [];
  for (const s of uniqueItems(c)) {
    const e = s.catalogue;
    if (!s.item || s.item.ladder || !isStrength(s) || !e || e.load === 'timed' || e.load === 'cardio' || CORE.has(e.pattern) || ['skill', 'carry', 'conditioning', 'mobility'].includes(e.pattern)) continue;
    const p = parseSr(s.item.sr);
    if (!p.repRange || p.seconds) continue;
    const r = itemRir(s.item);
    if (!r) continue;
    const isolation = ISOLATION.has(e.pattern);
    const T = EFFORT_TARGETS;
    const [[a, b], what] =
      !isolation && p.repRange[1] <= T.strengthRepsMax
        ? [T.strength, `heavy strength work (${T.strengthRepsMax} reps or fewer)`]
        : isolation || e.equipment[0] === 'machine' || e.equipment[0] === 'cable'
          ? [T.isolation, 'isolation and machine work']
          : [T.compound, 'a compound lift'];
    if (r.lo < a || r.hi > b) out.push(item(`${s.type} ${s.name}: RIR ${rirText(r)}; ${what} aims for ${a}–${b}`, `${s.type} ${s.name}`, s.name));
  }
  f.add('rir-by-type', 'warning', 'Items whose RIR is outside the target for their type of exercise.', out, {
    rule: 'effort.rir-by-type',
    grade: checkGrade('rir-by-type'),
    reason: `Growth improves closer to failure while strength stays flat across RIR, and failure is optional (Moderate); the targets by type are a heuristic: compound lifts ${rirText(rangeOf(EFFORT_TARGETS.compound))}, isolation and machines ${rirText(rangeOf(EFFORT_TARGETS.isolation))}, heavy strength work ${rirText(rangeOf(EFFORT_TARGETS.strength))}. An RIR of ${PROGRESSION.unreliableRir} or more is too light to judge.`,
  });
}

/**
 * Core, skill, carry and conditioning work, which the rest rule for size
 * does not cover (the patterns `effort` leaves out); a movement the
 * catalogue does not know counts as core when its main muscles are only
 * abs and obliques.
 */
function notSizeWork(s: SlotRef): boolean {
  const pattern = s.catalogue?.pattern ?? s.exercise?.pattern;
  if (pattern) return CORE.has(pattern) || ['skill', 'carry', 'conditioning', 'mobility'].includes(pattern);
  const main = s.exercise?.muscles?.main ?? [];
  return main.length > 0 && main.every((m) => m === 'abs' || m === 'obliques');
}

/** Rep ranges and rest between sets (rules.md, "Load, rest, order and range of motion", and "Effort"). */
function dose(c: CheckContext, f: Findings): void {
  const range: CheckItem[] = [];
  const rirReps: CheckItem[] = [];
  const rest: CheckItem[] = [];
  const heavy: CheckItem[] = [];
  const all = c.slots;
  for (const s of uniqueItems(c)) {
    if (!s.item || !isStrength(s)) continue;
    const p = parseSr(s.item.sr);
    if (!p.repRange || p.seconds) continue;
    const at = `${s.type} ${s.name}`;
    const [lo, hi] = p.repRange;
    if (hi > REP_LIMITS.repsMax) range.push(item(`${at}: up to ${hi} reps, past the about ${REP_LIMITS.repsMax} that size studies cover`, at, s.name));
    const r = itemRir(s.item);
    if (r && hi > REP_LIMITS.rirRepsMax) rirReps.push(item(`${at}: up to ${hi} reps at RIR ${rirText(r)}; reps in reserve are judged poorly past about ${REP_LIMITS.rirRepsMax}`, at, s.name));
    const rm = restMinutes(s.item.rest);
    if (!rm || notSizeWork(s)) continue;
    const e = s.catalogue;
    // In a superset (this item paired to the one before, or the next paired to it) the rest comes after the pair.
    const i = all.indexOf(s);
    const inPair = Boolean(s.item.pair) || all[i + 1]?.template === s.template && Boolean(all[i + 1]?.item?.pair);
    const compound = e !== undefined && e.load !== 'timed' && e.load !== 'cardio' && !ISOLATION.has(e.pattern) && !CORE.has(e.pattern) && !['skill', 'carry'].includes(e.pattern);
    const isHeavy = compound && (s.slot.main ? lo < 10 : hi <= EFFORT_TARGETS.strengthRepsMax);
    const restText = rm.minutes < 1 ? `${Math.round(rm.minutes * 60)} s` : `${r2(rm.minutes)} min`;
    if (rm.minutes < REST.sets.minutes - 1e-9) rest.push(item(`${at}: rest ${restText}, under ${REST.sets.text}${inPair ? ' after the pair' : ''}`, at, s.name));
    else if (isHeavy && !inPair && rm.minutes < REST.heavy.minutes - 1e-9) heavy.push(item(`${at}: rest ${restText} on a heavy compound lift (${lo}–${hi} reps), under ${REST.heavy.minutes} min`, at, s.name));
  }
  f.add('rep-range', 'warning', 'Rep ranges past about 30 reps.', range, {
    rule: 'dose.rep-range',
    grade: checkGrade('rep-range'),
    reason: 'Loads from about 30 to 100 % of 1RM (about 6 to 30 reps) build equal size when taken near failure; past about 30 reps the studies run out and the sets mostly add time.',
  });
  f.add('rep-range-rir', 'warning', 'Sets gauged by RIR past about 15 reps.', rirReps, {
    rule: 'effort.rir-accuracy',
    grade: checkGrade('rep-range-rir'),
    reason: 'RIR accuracy is better near failure and worse above about 12 reps (people underpredict the reps left by about 1), so sets gauged by RIR stay at about 15 reps or fewer.',
  });
  f.add('rest', 'warning', 'Rests under 90 s between sets.', rest, {
    rule: 'dose.rest',
    grade: checkGrade('rest'),
    reason: 'At least 90 s between sets: past 90 s size gains show no clear difference, under it they are smaller. A superset of non-competing muscles rests 90 s after each pair. Core, skill and carry work is not held to it.',
  });
  f.add('rest-heavy', 'warning', 'Heavy compound lifts resting under 2 minutes.', heavy, {
    rule: 'dose.rest',
    grade: checkGrade('rest-heavy'),
    reason: '2–3 min on heavy compound lifts: trained lifters likely need more than 2 min between heavy sets for strength.',
  });
}

/** Pull against push under the posture emphasis (rules.md, "Volume"). */
function pullPush(c: CheckContext, f: Findings): void {
  const aim = pullPushAim(c.data.profile);
  if (!aim) return;
  const r = pullPushSets(c.templates, c.data.program.exercises, { weights: weightsOf(c), aim });
  if (r.value.status !== 'below') return;
  f.add('pull-push', 'warning', 'Pulling against pushing sets under the posture emphasis.', [item(`${r.value.pull} pulling to ${r.value.push} pushing sets a week (${r.value.ratio ?? 0} to 1); the ${aim.why === 'finding' ? 'posture finding' : 'posture goal'} holds at least ${aim.floor} to 1`, 'pull-push')], {
    rule: 'volume.pull-push',
    grade: checkGrade('pull-push'),
    reason: r.reason.note ?? 'Pulling at least as much as pushing for the posture emphasis.',
  });
}

/** A light week in every mesocycle (rules.md, "Deloads": never two mesocycles running without one). */
function lightWeeks(c: CheckContext, f: Findings): void {
  const lw = c.data.rules.rules.lightWeeks;
  const total = c.data.plan.weeks;
  const runs: [number, number][] = [];
  let from: number | null = null;
  for (let w = 1; w <= total + 1; w++) {
    const light = w > total || isLightWeek(lw, w);
    if (!light && from === null) from = w;
    if (light && from !== null) {
      if (w - from > MAX_LOADING_RUN) runs.push([from, w - 1]);
      from = null;
    }
  }
  f.add('no-light-week', 'warning', `Stretches of more than ${MAX_LOADING_RUN} loading weeks with no light week.`, runs.map(([a, b]) => item(`plan weeks ${a}–${b}: ${b - a + 1} loading weeks in a row`, `weeks ${a}-${b}`)), {
    rule: 'deload.schedule',
    grade: checkGrade('no-light-week'),
    reason: 'A light week manages fatigue; no evidence sets its timing (athletes surveyed deload every 5.6 ± 2.3 weeks). Pahlavan\'s heuristic: 3 loading weeks and a light week, and never two mesocycles running without one.',
  });
}

/** Each session's minutes as planned against the profile's day lengths. */
function time(c: CheckContext, f: Findings): void {
  const av = c.data.profile?.availability;
  if (!av) return;
  const rows = timeCheck(planMinutes(c.data, c.date), av).filter((r) => (r.value.over ?? 0) > 0);
  f.add('time-over', 'warning', 'Sessions that run over the profile\'s day length.', rows.map((r) => item(`${r.value.type}: about ${r.value.minutes} min of ${r.value.limit}`, r.value.type)), {
    rule: 'time.check',
    reason: 'The profile\'s session lengths are the person\'s real time; a plan that does not fit gets cut short on the day, and the cut is rarely the coach\'s choice.',
  });
}

/** The user's own rules from the profile (`planRules`). */
function planRules(c: CheckContext, f: Findings): void {
  const rules = c.data.profile?.planRules;
  if (!rules) return;
  const out: CheckItem[] = [];
  const lifting = c.slots.filter((s) => s.kind === 'lift');
  if (rules.setsPerExercise !== undefined) {
    for (const s of uniqueItems(c)) {
      if (s.kind !== 'lift' || !s.item || !isStrength(s) || parseSr(s.item.sr).sets === null) continue;
      const n = itemSets(s.item);
      if (n !== rules.setsPerExercise) out.push(item(`${s.type} ${s.name}: ${n} sets; the profile's rule is ${rules.setsPerExercise} an exercise`, `${s.type} ${s.name}`, s.name, 'setsPerExercise'));
    }
  }
  if (rules.liftSession) {
    const known = (alt: string) => (PATTERNS as readonly string[]).includes(alt) || MUSCLE_IDS.includes(alt);
    for (const entry of rules.liftSession.patterns) {
      const alts = entry.split('|').map((x) => x.trim()).filter(Boolean);
      const unknown = alts.filter((a) => !known(a));
      if (unknown.length) {
        out.push(item(`liftSession: "${unknown.join('", "')}" is neither a movement pattern nor a muscle id, so "${entry}" is not checked`, 'liftSession', entry));
        continue;
      }
      for (const t of c.data.plan.types.filter((x) => x.kind === 'lift')) {
        const has = lifting.some((s) => s.type === t.type && alts.some((a) => s.catalogue?.pattern === a || s.exercise?.pattern === a || (s.exercise?.muscles?.main ?? []).includes(a)));
        if (!has) out.push(item(`${t.type}: nothing for "${entry}"; the profile's rule wants it in every lifting session`, t.type, entry, 'liftSession'));
      }
    }
  }
  if (rules.shortDayCore) {
    for (const t of c.data.plan.types.filter((x) => x.kind === 'short')) {
      const has = c.slots.some((s) => {
        const pattern = s.exercise?.pattern ?? s.catalogue?.pattern;
        return s.type === t.type && ((pattern !== undefined && CORE.has(pattern)) || (s.exercise?.muscles?.main ?? []).some((m) => m === 'abs' || m === 'obliques'));
      });
      if (!has) out.push(item(`${t.type}: no core exercise; the profile's rule wants one on every short day`, t.type, 'shortDayCore'));
    }
  }
  f.add('plan-rule', 'warning', 'Where the plan breaks the user\'s own plan rules (the profile\'s planRules).', out, {
    rule: 'profile.planRules',
    reason: 'The user stated these rules for any plan (the profile\'s planRules): the coach designs within them, or says why not.',
  });
}

/** An increase over the load-jump guide under a lift's own progression rule (reported by the review as a fact, not applied). */
function loadJumps(c: CheckContext, f: Findings): void {
  const review = buildReview(c.data, c.date);
  const out: CheckItem[] = [];
  for (const l of review.lifts) {
    const next = l.next as { value: { weight?: number | null } | null; reason: { inputs: Record<string, unknown> } } | null;
    const cap = next?.reason.inputs['loadCap'] as { proposed?: number; limit?: number; bigJump?: boolean; applied?: boolean } | undefined;
    if (!cap || cap.applied !== false || typeof cap.proposed !== 'number') continue;
    if (typeof cap.limit === 'number' && cap.proposed > cap.limit) out.push(item(`${l.name}: next ${cap.proposed} ${l.unit}, over the guide's ${cap.limit} ${l.unit}`, l.name));
    else if (cap.bigJump) out.push(item(`${l.name}: next ${cap.proposed} ${l.unit}; one step is more than 10 % of the load`, l.name));
  }
  f.add('load-jump', 'warning', 'Next targets over the load-jump guide, under the lift\'s own progression rule.', out, {
    rule: 'safety.load-cap',
    grade: checkGrade('load-jump'),
    reason: 'The guide: at most one step a session and about 10 % in 7 days. The plan\'s own rule sets the step, so the review reports the jump rather than capping it.',
  });
}

/** Exercises changed against the plan as written, inside a mesocycle (main lifts: inside a phase). */
function exerciseChanges(c: CheckContext, f: Findings): void {
  const prev = c.previous;
  if (!isObj(prev) || !isObj(prev['sessions'])) return;
  const place = c.place;
  if (!place) return;
  // A light week ends its mesocycle: changes then start the next one. A phase is two mesocycles.
  const accessoryOk = place.light || place.weekInMesocycle === 1;
  const mainOk = (place.light && place.mesocycle % 2 === 0) || (place.weekInMesocycle === 1 && place.mesocycle % 2 === 1);
  if (accessoryOk && mainOk) return;
  const names = (sessions: unknown, type: string, logged: boolean) => {
    const list = isObj(sessions) && Array.isArray(sessions[type]) ? (sessions[type] as unknown[]) : [];
    return [...new Set(list.filter((x): x is PlanDataItem => isObj(x) && typeof x['name'] === 'string' && (!logged || x['logged'] === true)).map((x) => x.name))];
  };
  const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));
  const when = `plan week ${place.planWeek}, week ${place.weekInMesocycle} of mesocycle ${place.mesocycle}`;
  const out: CheckItem[] = [];
  for (const t of c.data.plan.types) {
    if (!Array.isArray(prev['sessions'][t.type])) {
      if (!accessoryOk) out.push(item(`${t.type}: a new session (${when})`, t.type));
      continue;
    }
    const diff = (logged: boolean) => {
      const a = names(prev['sessions'], t.type, logged);
      const b = names(c.raw['sessions'], t.type, logged);
      return { out: a.filter((x) => !lower(b).has(x.toLowerCase())), in: b.filter((x) => !lower(a).has(x.toLowerCase())) };
    };
    const d = diff(false);
    if (!accessoryOk && (d.out.length || d.in.length)) out.push(item(`${t.type}: ${[d.out.length && `out ${d.out.join(', ')}`, d.in.length && `in ${d.in.join(', ')}`].filter(Boolean).join('; ')} (${when})`, t.type, ...d.out, ...d.in));
    else if (!mainOk) {
      const m = diff(true);
      if (m.out.length || m.in.length) out.push(item(`${t.type} main lifts: ${[m.out.length && `out ${m.out.join(', ')}`, m.in.length && `in ${m.in.join(', ')}`].filter(Boolean).join('; ')} (${when}; main lifts stay for a phase)`, t.type, ...m.out, ...m.in));
    }
  }
  for (const type of Object.keys(prev['sessions'])) {
    if (!accessoryOk && c.data.plan.types.every((t) => t.type !== type) && [...(Array.isArray(prev['liftTypes']) ? prev['liftTypes'] : []), ...(Array.isArray(prev['shortTypes']) ? prev['shortTypes'] : [])].includes(type)) out.push(item(`${type}: dropped (${when})`, type));
  }
  // A redesign is a new plan, so its changes are the point: listed for the record, not warned about.
  if (c.redesign) {
    f.add('redesign-changes', 'info', 'A redesign: the exercises that change, against the plan as written.', out, {
      rule: 'plan.exercise-changes',
      reason: 'Inside a plan, exercises change only at mesocycle boundaries (exercise-change). A redesign replaces the plan, so its changes are listed for the record rather than warned about; the Decision says why the plan is redesigned, and similar-to-current says when the redesign keeps most of the old plan.',
    });
    return;
  }
  f.add('exercise-change', 'warning', 'Exercises changed inside a mesocycle, against the plan as written.', out, {
    rule: 'plan.exercise-changes',
    grade: checkGrade('exercise-change'),
    reason: 'By default exercises change at mesocycle boundaries, main lifts are kept for a whole phase and at most half the accessories rotate at a time; a change the data calls for (a stall, pain, a movement often skipped) is made with its reason: systematic variation helps regional growth and strength, frequent random rotation may hurt.',
  });
}

/**
 * A redesign that keeps most of the plan as written (overlap.ts): over half
 * of the draft's movements are also in the old plan, so it reads as an edit
 * of it. The shared movements are the items, so an override can answer one
 * (a main lift kept for its trend) or, with no item, all of them.
 */
function similarToCurrent(c: CheckContext, f: Findings): void {
  if (!c.redesign || !isObj(c.previous)) return;
  const draft = planMovements(c.raw);
  const current = planMovements(c.previous);
  const share = overlapShare(draft, current);
  if (!overLimit(share)) return;
  const shared = sharedMovements(draft, current);
  const items = shared.map((m) => {
    const was = current.find((x) => x.id === m.id)!.name;
    const same = was.toLowerCase() === m.name.toLowerCase();
    return item(`${m.name}${same ? '' : ` (${was} in the plan as written)`}`, m.name, was, m.id);
  });
  f.add('similar-to-current', 'warning', `${percent(share!)} of the draft's movements (${shared.length} of ${draft.length}) are in the plan as written (over ${limitText()}).`, items, {
    rule: 'plan.redesign',
    grade: checkGrade('similar-to-current'),
    reason: `A redesign is a new plan for the person as they are now, designed from a blank draft (engine draft), not an edit of the old one. Variety against continuity: keeping a movement that works (a main lift still progressing, one the person likes, the only one the equipment allows) is fine, and an override says why; a redesign that keeps most of the old plan should say why it is a redesign. Over ${limitText()} of the draft's movements shared warns (a heuristic).`,
  });
}

/**
 * A draft that drops or changes the written plan's `start`: plan week 1 would
 * move, so the calibration week comes again and the light weeks, tests and
 * phases shift. Only a fresh start or a reset begins a new week 1, and says so
 * with an override.
 */
function startChange(c: CheckContext, f: Findings): void {
  const prev = c.previous;
  if (!isObj(prev) || prev['start'] === undefined) return;
  const was = prev['start'];
  const now = c.raw['start'];
  if (now === was) return;
  const text = now === undefined ? `start ${String(was)} dropped: the plan weeks would count from the log again` : `start ${String(was)} changed to ${String(now)}`;
  f.add('start-changed', 'warning', 'The draft moves the written plan\'s plan week 1.', [item(text, 'start')], {
    rule: 'plan.start',
    reason: 'The plan\'s start makes its week plan week 1: a new start restarts the calibration week and shifts the light weeks, the tests and the phases (Pahlavan\'s "Week N of M" with them). A change inside the plan, the next month or a phase review\'s next block keeps the written start; only a fresh start or a reset begins a new week 1, with an override giving that reason.',
  });
}

/** Each plan movement once per session that the fit checks judge: catalogue-matched, not timed. */
const catalogued = (c: CheckContext) => uniqueItems(c).filter((s): s is SlotRef & { catalogue: CatalogueEntry } => s.catalogue !== undefined && !s.slot.timed);

/** The tools a movement needs that `have` lacks, in words ("cable or band", "dumbbell or kettlebell and bench"). */
function toolsMissing(e: CatalogueEntry, have: ReadonlySet<string>): string {
  const ok = (q: string) => q === 'bodyweight' || have.has(q);
  const [first, ...rest] = e.equipment;
  const out: string[] = [];
  if (first && !ok(first)) out.push([first, ...e.alsoWith].join(' or '));
  out.push(...rest.filter((q) => !ok(q)));
  return out.join(' and ');
}

/**
 * Movements the profile's equipment does not cover (the catalogue's tools;
 * a tool that stands in for the defining one counts, bodyweight always
 * does). Cardio is left out (its mode is the person's choice on the day),
 * and so are movements the catalogue does not know. No profile: nothing to
 * judge by; an empty equipment list is bodyweight only.
 */
function equipmentFit(c: CheckContext, f: Findings): void {
  const profile = c.data.profile;
  if (!profile) return;
  const have = normalizeEquipment(profile.equipment ?? []).equipment;
  const out = catalogued(c)
    .filter((s) => s.catalogue.load !== 'cardio' && !usableWith(s.catalogue, have))
    .map((s) => item(`${s.type} ${s.name}: needs ${toolsMissing(s.catalogue, have)}`, `${s.type} ${s.name}`, s.name, s.catalogue.id));
  f.add('equipment-missing', 'warning', 'Movements the profile\'s equipment does not cover (a tool that stands in counts).', out, {
    rule: 'profile.equipment',
    reason: 'The profile\'s equipment is what the person has, in its words read as the catalogue\'s tools: bodyweight always counts, and so does a tool that stands in for the defining one (a kettlebell for a goblet squat). A movement that needs a tool they do not have cannot be done as written: swap it, or add the tool to the profile; an override says why it stays (a gym the profile does not list yet).',
  });
}

/** Movements the person said they dislike (the profile's preferences.dislikes, catalogue ids). */
function dislikedMovements(c: CheckContext, f: Findings): void {
  const dislikes = new Set(c.data.profile?.preferences?.dislikes ?? []);
  if (!dislikes.size) return;
  const out = uniqueItems(c)
    .filter((s) => s.catalogue && dislikes.has(s.catalogue.id))
    .map((s) => item(`${s.type} ${s.name}: ${s.catalogue!.name} is on the profile's dislikes`, `${s.type} ${s.name}`, s.name, s.catalogue!.id));
  f.add('disliked-movement', 'warning', 'Movements the person said they dislike (the profile\'s preferences.dislikes).', out, {
    rule: 'profile.dislikes',
    reason: 'The plan is built around what the person will do: a movement they said they dislike is swapped for one that trains the same muscles and fits the equipment and the Ledger, or kept with an override saying why.',
  });
}

/**
 * Lifts whose step (`lifts[name].inc`) the gym's real weights cannot make
 * (the profile's loads): a 1 kg step on dumbbells that go 2 kg at a time, a
 * 1.25 kg step on a bar whose smallest pair of plates is 2.5 kg. The targets
 * still land on real weights; the plan's step should be one the gym has. A
 * fact the profile states, no grade.
 */
function gymSteps(c: CheckContext, f: Findings): void {
  if (!c.data.profile?.loads) return;
  const out: CheckItem[] = [];
  for (const l of c.data.plan.lifts) {
    const ex = c.data.program.exercises[l.exercise] as (Exercise & ExerciseExtras) | undefined;
    const weights = ex?.weights;
    if (!weights?.length || stepInKit(l.increment, weights)) continue;
    const fine = finestStep(weights);
    if (fine === null) continue;
    // The nearest step the kit makes: a multiple of its finest step (ties to the smaller).
    const k = Math.max(1, Math.round(l.increment / fine - 1e-9));
    const fix = [k, k + 1, k - 1].filter((n) => n >= 1).map((n) => Number((n * fine).toFixed(2))).find((x) => stepInKit(x, weights)) ?? fine;
    const word = kitWord(loadKindOf(ex?.equipment, ex?._lift?.db));
    out.push(item(`${l.name}: inc ${l.increment} ${l.unit}, but no ${word} here is ${l.increment} ${l.unit} from another (the finest step is ${fine} ${l.unit}): set inc to ${fix}`, l.name));
  }
  f.add('step-not-in-gym', 'warning', 'Lifts whose step (lifts[name].inc) the gym\'s weights cannot make (the profile\'s loads).', out, {
    rule: 'profile.loads',
    reason: 'The profile\'s loads are the weights the gym has. Every target lands on one of them, but the load-jump cap and the notes still read the lift\'s inc, so it should be a step the gym can make: the dumbbells\' step, two of the smallest plate on a bar, a stack\'s step. Set inc to the step given, or correct the loads; an override says why it stays.',
  });
}

/** "Week 1 (...)" or "Weeks 2–3:" in a note: a week-by-week change plan-data has no place for. */
const WEEK_OVERRIDE = /\bweeks?\s+\d+(?:\s*(?:[–-]|and|,|&)\s*\d+)*\s*[:(]/i;

/** The plan's conventions: each item's "Why:", and no week-by-week changes hidden in a note. */
function conventions(c: CheckContext, f: Findings): void {
  const why: CheckItem[] = [];
  const week: CheckItem[] = [];
  for (const { type, item: it } of rawItems(c)) {
    const at = `${type} ${it.name}`;
    if (!parseNote(it.note).why) why.push(item(at, it.name));
    const m = WEEK_OVERRIDE.exec(it.note ?? '');
    if (m) week.push(item(`${at}: "${(it.note ?? '').slice(m.index, m.index + 60).trim()}…"`, at, it.name));
  }
  f.add('no-why', 'warning', 'Items with no "Why:" line in their note.', why, {
    rule: 'plan.why',
    reason: 'Each item says why it is in the plan ("Why: ..."), in words tied to the person (a goal, a finding, a preference): Today and the movement guide show it, and the next coach reads it.',
  });
  const card = readPlanWhy(c.raw);
  f.add('no-why-card', 'warning', 'The plan has no Why this plan card (`why`): the Plan tab says the coach hasn\'t written its reasons yet.', card.present ? [] : [item('why')], {
    rule: 'plan.why-card',
    reason: 'Every plan carries the coach\'s reasons to the person, in the coach\'s voice: what in their data shaped it and why this split over the others. A candidate still being compared may skip it; the plan that is written has it.',
  });
  f.add('why-split-missing', 'warning', 'Split families the Why this plan card names nowhere (picked, compared or left out).', card.why ? card.missing.map((k) => item(`${SPLIT_LABELS[k]} (${k})`, k)) : [], {
    rule: 'plan.why-card',
    reason: 'The card accounts for every family in rules.md\'s Split families table but Concurrent (how cardio fits into any plan, not a split): the one picked, the ones built and compared, and each one left out with a line from its Fits column, so the person can see why this split and not another.',
  });
  f.add('week-override-in-note', 'warning', 'Notes that change the item for certain weeks: Pahlavan reads no week-by-week change from a note.', week, {
    rule: 'plan.week-override',
    reason: 'plan-data holds one week that repeats. The calibration, light and test weeks are standing rules (`rules`); a change for a while is a temporary change ("until YYYY-MM-DD: ..."); a different month is the next month\'s plan, written when it comes.',
  });
}

// ---------------------------------------------------------------- helpers

function typeOfTemplate(c: CheckContext, template: string): string {
  return c.data.plan.types.find((t) => t.template === template)?.type ?? template;
}

/** Each session template's weight in a week: the weekly target over the session types of its kind (as the review weighs them). */
function weightsOf(c: CheckContext): Record<string, number> {
  const target = c.data.plan.weekTarget;
  const lifting = (t: SessionTemplate) => t.kind === 'lift' || t.kind === 'express';
  const liftCount = c.templates.filter(lifting).length;
  const shortCount = c.templates.length - liftCount;
  return Object.fromEntries(c.templates.map((t) => [t.id, lifting(t) ? (liftCount ? target.lift / liftCount : 0) : shortCount ? target.short / shortCount : 0]));
}

/** Each item once per session (a session listing an exercise twice is judged once). */
function uniqueItems(c: CheckContext): SlotRef[] {
  const seen = new Set<string>();
  return c.slots.filter((s) => {
    const k = `${s.type}|${s.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function contextOf(read: VaultRead, date: IsoDate, opts: CheckOptions): CheckContext | null {
  const raw = read.raw?.plan;
  const data = read.data;
  if (!isObj(raw) || !isObj(raw['sessions'])) return null;
  const weeks = data.program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks));
  // The plan's ordinary loading week: every one shares the plan's own sessions (a light or calibration week is derived from them).
  const week = weeks.find((w) => w.kind === 'loading' && !w.calibration) ?? weeks.find((w) => w.kind === 'loading') ?? weeks[0];
  const templates = (week?.sessions ?? []).map((t) => ({ ...t, slots: t.slots.map((s) => effectiveSlot(s, date).value) }));
  const slots: SlotRef[] = [];
  for (const t of templates) {
    const type = data.plan.types.find((x) => x.template === t.id);
    if (!type) continue;
    for (const slot of t.slots) {
      const own = (slot as ExerciseSlot & SlotExtras)._item ?? null;
      const exercise = data.program.exercises[slot.exercise];
      const cat = data.catalogueMatch[slot.exercise];
      slots.push({ type: type.type, kind: type.kind, template: t, slot, item: own, name: own?.name ?? exercise?.name ?? slot.exercise, exercise, catalogue: cat ? CATALOGUE_BY_ID.get(cat) : undefined });
    }
  }
  const review = context(data, date);
  const place = review.planWeek ? lightWeekAt(data.rules.rules.lightWeeks, review.planWeek) : null;
  return { read, data, date, raw, review, templates, slots, place, ...(opts.previous !== undefined ? { previous: opts.previous } : {}), redesign: opts.redesign === true };
}

// ---------------------------------------------------------------- the check

/** The hard errors' checks, on the plan's own data and the safety limits. */
const HARD_CHECKS: readonly PlanCheck[] = [structure, contradictions, duplicateTags, lifts, safety];

/**
 * The evidence and convention checks, each a warning a stated override may
 * turn into information. Each is one PlanCheck: a new rule joins the list.
 */
export const EVIDENCE_CHECKS: readonly PlanCheck[] = [volume, priorityRoom, regionCoverage, effort, dose, pullPush, lightWeeks, time, planRules, equipmentFit, dislikedMovements, gymSteps, loadJumps, exerciseChanges, similarToCurrent, startChange, conventions];

/** A warning from outside the plan (`CheckOptions.outside`): what it is, and its reason. */
const OUTSIDE_MESSAGE = 'A fact about the vault, not the plan: it does not block a plan write.';
const OUTSIDE_REASON = 'Read from the vault beside the plan (Pahlavan\'s own files); the coach tells the user what to do about it.';

/**
 * The plan's findings on the date: the adapter's warnings and errors
 * (re-levelled: what blocks a write is an error, what was only read around
 * is information), then the hard checks and the evidence checks, then the
 * plan's overrides applied. A plan the adapter cannot read gets the
 * adapter's findings only.
 */
export function buildCheck(read: VaultRead, date: IsoDate, opts: CheckOptions = {}): CheckReport {
  const f = new Findings();
  adapterFindings(read, f);
  for (const w of opts.outside ?? []) f.add(w.code, 'warning', OUTSIDE_MESSAGE, (w.items?.length ? w.items : [w.message]).map((t) => item(t)), { reason: OUTSIDE_REASON });
  const c = contextOf(read, date, opts);
  if (c) for (const check of [...HARD_CHECKS, ...EVIDENCE_CHECKS]) check(c, f);
  const drafts = applyOverrides(f.list, c ? readOverrides(c.raw['overrides']).overrides : []);
  const order: Record<FindingLevel, number> = { error: 0, warning: 1, info: 2 };
  const findings: Finding[] = drafts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => order[a.d.level] - order[b.d.level] || a.i - b.i)
    .map(({ d }) => ({
      code: d.code,
      level: d.level,
      message: d.message,
      items: d.items.map((x) => x.text),
      ...(d.rule ? { rule: d.rule } : {}),
      ...(d.grade ? { grade: d.grade } : {}),
      ...(d.reason ? { reason: d.reason } : {}),
      ...(d.override ? { override: d.override } : {}),
    }));
  const count = (l: FindingLevel) => findings.filter((x) => x.level === l).length;
  return { findings, summary: { errors: count('error'), warnings: count('warning'), info: count('info'), overridden: findings.filter((x) => x.override).length, ok: count('error') === 0 } };
}

/**
 * The plan's overrides on the findings: one matching a warning (its code,
 * and its item when it names one) turns the warning, or that item of it,
 * into information carrying the override. An override never applies to a
 * hard error; one that matches nothing is listed (`override-unused`).
 */
function applyOverrides(list: readonly Draft[], overrides: readonly PlanOverride[]): Draft[] {
  const out = list.map((d) => ({ ...d, items: [...d.items] }));
  const unused: CheckItem[] = [];
  const matches = (x: CheckItem, name: string) => x.keys.some((k) => k.toLowerCase() === name.toLowerCase());
  for (const o of overrides) {
    const label = `${o.code}${o.item ? `: ${o.item}` : ''}`;
    if (out.some((d) => d.code === o.code && d.level === 'error')) {
      unused.push(item(`${label} (a hard error: an override never applies to one)`));
      continue;
    }
    const w = out.find((d) => d.code === o.code && d.level === 'warning');
    if (w) {
      const hit = o.item ? w.items.filter((x) => matches(x, o.item!)) : w.items;
      if (!hit.length) {
        unused.push(item(`${label} (the ${o.code} warning has no such item)`));
        continue;
      }
      w.items = w.items.filter((x) => !hit.includes(x));
      out.push({ ...w, level: 'info', items: hit, override: o });
      continue;
    }
    if (out.some((d) => d.code === o.code && d.level === 'info' && !d.override && (!o.item || d.items.some((x) => matches(x, o.item!))))) continue;
    unused.push(item(`${label} (no ${o.code} finding${o.item ? ' with that item' : ''} on this plan)`));
  }
  const kept = out.filter((d) => d.items.length > 0);
  if (unused.length) kept.push({ code: 'override-unused', level: 'info', message: 'For information: overrides that match no warning on this plan (they can go).', items: unused });
  return kept;
}

/** The findings as the envelope's warnings and errors: each finding once, with its level. */
export function envelopeLists(report: CheckReport): { warnings: (VaultWarning & { level: FindingLevel })[]; errors: (VaultWarning & { level: FindingLevel })[] } {
  const as = (x: Finding) => ({ code: x.code, message: x.message, items: x.items, level: x.level });
  return { warnings: report.findings.filter((x) => x.level !== 'error').map(as), errors: report.findings.filter((x) => x.level === 'error').map(as) };
}
