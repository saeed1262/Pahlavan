// The fitness dashboard's own rules, ported so Pahlavan and the dashboard
// agree line for line: today's checklist record (`todayChecklist`, shared
// with the dashboard and Isfahan's briefing), the For today reminders it
// adds (pressing, lifting days left, short sessions to go), the plan as
// plain text (`planText`, with `nextTarget` and the plan notes), the "New
// record" check (`recordsIn`), the movement guide, the month count, the
// recent list and the plan's notes. Each mirrors the function named in
// the vault's old fitness dashboard (its view.js); the tests compare against it.
// Pure: no clock, no I/O.

import { ownNote } from '../core/reason.ts';
import { checklistLines, type ChecklistLine } from '../adapters/vault/log-write.ts';
import { calibrationNote } from '../core/calibration.ts';
import { lightDoseText, readRules } from '../core/rules.ts';
import { MUSCLES } from '../core/data/muscles.ts';
import { daysBetween, mondayOf } from '../core/dates.ts';
import type { IsoDate } from '../core/schema.ts';
import { paths } from '../adapters/vault/layout.ts';
import { canonicalTags } from '../adapters/vault/muscle-tags.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const asObj = (v: unknown): Obj => (isObj(v) ? v : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

interface Sess { date: string; type: string; label?: string; express?: boolean; lift1?: Lift | null; lift2?: Lift | null; durationMin?: number | null; cardioMin?: number; checklist?: { done?: number; total?: number; skipped?: string[] } }
interface Lift { name: string; weight: number; reps: number; unit?: string; planned?: string }

const sessionsOf = (log: unknown): Sess[] => (Array.isArray(asObj(log)['sessions']) ? (asObj(log)['sessions'] as unknown[]).filter((s): s is Sess => isObj(s) && typeof s['date'] === 'string' && typeof s['type'] === 'string') : []);
/** sortedSessions: by date, stable. */
const sorted = (log: unknown): Sess[] => [...sessionsOf(log)].sort((a, b) => a.date.localeCompare(b.date));

// ---------------------------------------------------------------- the checklist record

export interface TodayChecklist {
  date: IsoDate;
  type: string;
  express: boolean;
  checked: boolean[];
  picked?: boolean;
}

/** The dashboard's checklist lines for a session (exercisesFor), with the warm-up's steps (warmupLine). */
export function dashChecklist(plan: unknown, type: string, express: boolean, deload: boolean): (ChecklistLine & { steps: string[] })[] {
  const warm = asObj(asObj(plan)['warmups']);
  const lifting = strs(asObj(plan)['liftTypes']).includes(type);
  return checklistLines(plan, type, express, deload).map((l) => ({ ...l, steps: l.warmup ? String((lifting ? warm['lift'] : warm['short']) ?? '').split(/\s+·\s+|(?<=\.)\s+(?=Then )/).filter(Boolean) : [] }));
}

/**
 * getTodayChecklist: today's record when it is for this session (same date,
 * type, Express flag and number of lines), else a fresh one with nothing
 * ticked. A record without the flag reads as the full session.
 */
export function todayChecklistOf(log: unknown, date: IsoDate, type: string, express: boolean, length: number): TodayChecklist {
  const tc = asObj(log)['todayChecklist'];
  if (isObj(tc) && tc['date'] === date && tc['type'] === type && !!tc['express'] === express && Array.isArray(tc['checked']) && tc['checked'].length === length) return tc as unknown as TodayChecklist;
  return { date, type, express, checked: Array.from({ length }, () => false) };
}

/** toggleCheck: line `i` ticked or unticked, on today's record for this session. */
export function toggledChecklist(log: unknown, date: IsoDate, type: string, express: boolean, length: number, i: number): TodayChecklist {
  const tc = todayChecklistOf(log, date, type, express, length);
  const checked = [...tc.checked];
  checked[i] = !checked[i];
  return { ...tc, checked };
}

/** savePlanChoice: the session (and its version) chosen for today; `picked` marks a choice over the rotation's. */
export function chosenChecklist(log: unknown, date: IsoDate, type: string, express: boolean, length: number, picked: boolean): TodayChecklist {
  return { ...todayChecklistOf(log, date, type, express, length), picked };
}

/**
 * Today's record, when it names a session the plan has: its type, Express
 * flag and whether it was picked. Isfahan's briefing follows the pick only.
 */
export function choiceFromChecklist(log: unknown, plan: unknown, date: IsoDate): { type: string; express: boolean; picked: boolean } | null {
  const tc = asObj(log)['todayChecklist'];
  if (!isObj(tc) || tc['date'] !== date || typeof tc['type'] !== 'string') return null;
  const titles = asObj(asObj(plan)['titles']);
  const type = tc['type'];
  if (!titles[type]) return null;
  return { type, express: tc['express'] === true, picked: tc['picked'] === true };
}

/**
 * The session Today shows, given today's record: a pick wins; an unpicked
 * short type is the dashboard's 30-minute choice and wins too; otherwise the
 * suggestion stands, in Express when the record says so for that session.
 */
export function followChoice(choice: { type: string; express: boolean; picked: boolean } | null, shortTypes: readonly string[], suggested: string | null): { type: string | null; express: boolean | null } {
  if (!choice) return { type: null, express: null };
  if (choice.picked || shortTypes.includes(choice.type)) return { type: choice.type, express: choice.express };
  return { type: null, express: choice.type === suggested ? choice.express : null };
}

/** nextInRotation: the type after the last logged session of these types (custom never advances it). */
export function nextInRotation(log: unknown, types: readonly string[]): string {
  const done = sorted(log).filter((s) => types.includes(s.type));
  if (!done.length) return types[0] ?? '';
  return types[(types.indexOf(done.at(-1)!.type) + 1) % types.length] ?? '';
}

/**
 * Which line of the checklist each of today's rows ticks: the warm-up row,
 * a session item (the first item of a paired line), the finisher, or none.
 * Matched by the plan's names (an item swapped in keeps the planned name).
 */
export function checklistTargets(lines: readonly ChecklistLine[], items: readonly { name: string; planName?: string; replaces?: { name: string } | null }[], finisher: string | null): ({ kind: 'warmup' } | { kind: 'item'; index: number } | { kind: 'finisher' } | { kind: 'none' })[] {
  const used = new Set<number>();
  return lines.map((l, n) => {
    if (l.warmup || (n === 0 && /warm-?up/i.test(l.name))) return { kind: 'warmup' as const };
    for (const part of l.parts) {
      const k = items.findIndex((it, j) => !used.has(j) && (it.planName === part || it.replaces?.name === part || it.name === part));
      if (k >= 0) {
        used.add(k);
        for (const other of l.parts.slice(1)) {
          const j = items.findIndex((it, x) => !used.has(x) && (it.planName === other || it.replaces?.name === other || it.name === other));
          if (j >= 0) used.add(j);
        }
        return { kind: 'item' as const, index: k };
      }
    }
    if (finisher && l.parts.includes(finisher)) return { kind: 'finisher' as const };
    return { kind: 'none' as const };
  });
}

// ---------------------------------------------------------------- For today

export const STANDING_REMINDERS = [
  'Band external rotation before any pressing; shoulder pain stops the exercise',
  'Pull more than you push: face pulls, rear delts or pull-aparts every session',
  'Short on time? Express beats skipping. Lifting before short days',
  'Deload every 4th week (weeks 4, 8, 12, 16, 20, 24)',
  'Protein ≥ 140 g/day · sleep toward 7 h',
  'Desk posture routine daily, 5 min',
] as const;

export interface DashReminder {
  id: 'pressing' | 'lifting-gap' | 'short-gap';
  icon: 'dumbbell' | 'clock' | 'pulse';
  warn: boolean;
  text: string;
  rule: string;
}

/**
 * The dashboard's For today rules R1 (pressing: band external rotation
 * first), R3 (lifting days still to do against the days left: Express beats
 * skipping) and R3b (short sessions to go), word for word. After a session
 * is logged today, R1 looks at the next lifting day.
 */
export function dashboardReminders(input: { plan: unknown; log: unknown; date: IsoDate; focusType: string | null; deload: boolean }): DashReminder[] {
  const plan = asObj(input.plan);
  const lifts = strs(plan['liftTypes']);
  const shorts = strs(plan['shortTypes']);
  const target = asObj(plan['weekTarget']);
  const all = sorted(input.log);
  const doneToday = all.some((s) => s.date === input.date);
  const focus = doneToday ? nextInRotation(input.log, lifts) : input.focusType;
  const when = doneToday ? 'The next lifting day' : 'Today';
  const dow = daysBetween(mondayOf(input.date), input.date);
  const daysLeft = 6 - dow;
  const week = all.filter((s) => s.date >= mondayOf(input.date) && s.date <= input.date);
  const liftThisWeek = week.filter((s) => lifts.includes(s.type)).length;
  const shortThisWeek = week.filter((s) => shorts.includes(s.type)).length;
  const liftGap = Number(target['lift'] ?? 0) - liftThisWeek;
  const shortGap = Number(target['short'] ?? 0) - shortThisWeek;
  const out: DashReminder[] = [];
  const press = focus ? checklistLines(input.plan, focus, false, input.deload).find((e) => /press|bench|push-?up|dip/i.test(e.name)) : undefined;
  if (press) out.push({ id: 'pressing', icon: 'dumbbell', warn: false, text: `${when} has pressing (${press.name}): band external rotation first.`, rule: STANDING_REMINDERS[0] });
  if (liftGap > 0 && daysLeft + 1 <= liftGap) out.push({ id: 'lifting-gap', icon: 'clock', warn: true, text: `${liftGap} lifting day${liftGap === 1 ? '' : 's'} still to do with ${daysLeft + 1} day${daysLeft ? 's' : ''} left: an Express lift (20 min) beats skipping.`, rule: STANDING_REMINDERS[2] });
  else if (shortGap > 0) out.push({ id: 'short-gap', icon: 'pulse', warn: false, text: daysLeft === 0 ? `Short sessions came to ${shortThisWeek} of ${Number(target['short'] ?? 0)} this week.` : `${shortGap} short session${shortGap === 1 ? '' : 's'} to go this week, after the lifting days.`, rule: STANDING_REMINDERS[2] });
  return out;
}

// ---------------------------------------------------------------- next weight, plan notes, plan text

const LB_PER_KG = 2.20462;
const roundTo = (v: number, step: number) => +(Math.round(v / step) * step).toFixed(1);
const unitOf = (plan: Obj, name: string) => (asObj(asObj(plan['lifts'])[name])['unit'] as string | undefined) || (plan['liftUnit'] as string | undefined) || 'lb';
const inUnit = (w: number, unit: string, to: string) => (unit === to ? w : unit === 'kg' ? w * LB_PER_KG : w / LB_PER_KG);
const beats = (l: { weight: number; reps: number }, best: { weight: number; reps: number }) => l.weight > best.weight || (l.weight === best.weight && l.reps > best.reps);

/** liftHistory: a lift's logged top sets, oldest first, and the best so far (the first set is the baseline). */
function liftHistory(plan: Obj, list: readonly Sess[], liftName: string) {
  const sets: { date: string; weight: number; reps: number; unit: string }[] = [];
  let best: { weight: number; reps: number; date: string } | null = null;
  for (const s of list) {
    for (const l of [s.lift1, s.lift2]) {
      if (!l || l.name !== liftName || !l.weight) continue;
      const isRecord = !!best && beats(l, best);
      if (!best || isRecord) best = { weight: l.weight, reps: l.reps, date: s.date };
      sets.push({ date: s.date, weight: l.weight, reps: l.reps, unit: l.unit || unitOf(plan, l.name) });
    }
  }
  return { sets, best };
}

/** nextTarget: the double-progression hint for a logged lift, in its unit (null without a rep range). */
export function nextTargetDash(rawPlan: unknown, log: unknown, liftName: string, deload: boolean): { weight?: number; reps?: number; short: string; text: string } | null {
  const plan = asObj(rawPlan);
  const l = asObj(asObj(plan['lifts'])[liftName]);
  if (!Object.keys(l).length) return null;
  const p = { lo: Number(l['lo']), hi: Number(l['hi']), inc: Number(l['inc']), unit: unitOf(plan, liftName) };
  const last = liftHistory(plan, sorted(log), liftName).sets.at(-1);
  if (!last) return { short: 'first time: calibrate', text: `First time: find a weight for ${p.lo}–${p.hi} reps with 2–3 in reserve.` };
  const u = p.unit;
  const base = last.unit === u ? last.weight : roundTo(inUnit(last.weight, last.unit, u), p.inc);
  const was = `${last.weight}${last.unit === u ? '' : ` ${last.unit}`} × ${last.reps}`;
  if (deload) {
    // The light week's load: the plan's rule, else the dashboard's 0.9.
    const load = readRules(rawPlan).rules.lightWeeks.load;
    const w = roundTo(base * load, p.inc);
    return { weight: w, reps: p.lo, short: `deload ${w} ${u} × ${p.lo}`, text: `Deload week: ${w} ${u} × ${p.lo}, about ${Math.round((1 - load) * 100)}% under last time (${was}).` };
  }
  if (last.reps >= p.hi) {
    const w = roundTo(base + p.inc, 0.5);
    return { weight: w, reps: p.lo, short: `next ${w} ${u} × ${p.lo}`, text: `Next: ${w} ${u} × ${p.lo}, if every set reached ${p.hi} last time (${was}). Otherwise stay at ${base}.` };
  }
  const reps = Math.min(p.hi, Math.max(p.lo, last.reps + 1));
  return { weight: base, reps, short: `next ${base} ${u} × ${reps}`, text: `Next: ${base} ${u} × ${reps}, one more rep than last time (${was}).` };
}

/** planNote: an item's note split into the standing part and an "until <date>:" change while it lasts. */
export function planNoteDash(rawPlan: unknown, type: string, name: string, date: IsoDate): { note: string; temp: { until: string; text: string; short: string; weight: number | null } | null } {
  const items = asObj(asObj(rawPlan)['sessions'])[type];
  const item = Array.isArray(items) ? (items as Obj[]).find((i) => isObj(i) && i['name'] === name) : undefined;
  const note = String(item?.['note'] ?? '');
  const m = /^until (\d{4}-\d{2}-\d{2}):\s*(.+?\.)(?=\s|$)\s*([\s\S]*)$/.exec(note);
  if (!m) return { note, temp: null };
  if (m[1]! < date) return { note: m[3]!, temp: null };
  const w = /\bstart at (\d+(?:\.\d+)?)/.exec(m[2]!);
  return { note: m[3]!, temp: { until: m[1]!, text: m[2]!, short: m[2]!.split(';')[0]!.replace(/\.$/, ''), weight: w ? +w[1]! : null } };
}

/** planDetail: the hint (a main lift's target, or a temporary change) and the notes under a checklist line. `shortDay` formats the until date. */
export function planDetailDash(rawPlan: unknown, log: unknown, type: string, line: ChecklistLine, date: IsoDate, deload: boolean, shortDay: (d: string) => string) {
  const plan = asObj(rawPlan);
  const items = Array.isArray(asObj(plan['sessions'])[type]) ? (asObj(plan['sessions'])[type] as Obj[]) : [];
  const main = items.filter((i) => i['logged']).map((i) => String(i['name'])).find((n) => line.name.startsWith(n));
  const target = main ? nextTargetDash(rawPlan, log, main, deload) : null;
  const notes = (line.parts.length ? line.parts : [line.name]).map((n) => planNoteDash(rawPlan, type, n, date));
  const temp = notes.map((n) => n.temp).find(Boolean) ?? null;
  const hint = temp ? `${temp.short}  ·  until ${shortDay(temp.until)}` : target ? target.short : '';
  return { hint, temp, noteText: notes.map((n) => n.note).filter(Boolean).join('  ·  ') };
}

/** levelsText: "Your levels: Push-up L2 · Floor push-up · …" for a type that trains ladders. */
export function levelsText(rawPlan: unknown, log: unknown, type: string): string {
  const plan = asObj(rawPlan);
  const ids = strs(asObj(plan['laddersFor'])[type]);
  if (!ids.length) return '';
  const ladders = Array.isArray(plan['ladders']) ? (plan['ladders'] as Obj[]) : [];
  const parts = ids.map((id) => {
    const l = ladders.find((x) => x['id'] === id);
    const hist = asObj(asObj(log)['ladders'])[id];
    const cur = Array.isArray(hist) && hist.length ? (hist.at(-1) as { level: number }) : null;
    const levels = Array.isArray(l?.['levels']) ? (l['levels'] as Obj[]).map((v) => String(v['name'])) : [];
    return cur ? `${String(l?.['name'] ?? id)} L${cur.level} · ${levels[cur.level - 1] ?? ''}` : `${String(l?.['name'] ?? id)}: not set`;
  });
  return `Your levels: ${parts.join(' · ')}`;
}

export const DELOAD_NOTE = 'Deload week: 2 sets of everything, about 10% lighter. S3 is 20 min easy Zone 2 + abs.';

/** The copy's light-week line: the dashboard's own under the old default, else the plan's rule in words. */
export function deloadNote(rawPlan: unknown): string {
  const r = readRules(rawPlan);
  return r.sources.lightWeeks === 'legacy-default' ? DELOAD_NOTE : `Deload week: ${lightDoseText(r.rules.lightWeeks)} (the plan's rule).`;
}

/** Today's session as the engine builds it (session.ts), for planText: its items' targets and RIR, and its flags. */
export interface CopySession {
  items: readonly { name: string; planName?: string; replaces?: { name: string } | null; rir: number; target: { weight: number | null; unit: string; reps: number; rir: number; action: string } | null; sr?: string; timed?: { text: string; rounds?: number } | null; cue?: string }[];
  finisher: { name: string } | null;
  flags: readonly { rule: string; note?: string }[];
}

/** A line's hint from the engine's target: the numbers Today shows; null to keep the dashboard's own. */
function copyHint(t: CopySession['items'][number]['target']): string | null {
  if (!t) return null;
  if (t.weight !== null) return `${t.action === 'calibrate' ? 'start at' : 'next'} ${t.weight} ${t.unit} × ${t.reps} @ RIR ${t.rir}`;
  return t.action === 'calibrate' ? `find a weight for ${t.reps} reps @ RIR ${t.rir}` : null;
}

/**
 * planText: today's plan as plain text, line for line the checklist: the
 * session and day, the deload note, each line with its sets and reps, its
 * hint, notes and steps, then the levels line. `dayLabel` and `shortDay`
 * are the dates as the plugin's locale writes them (the dashboard uses
 * toLocaleDateString). With `session` (Today's, from the engine) the copy
 * says what Today says: the calibration week's line, each target and RIR.
 */
export function planText(input: { plan: unknown; log: unknown; date: IsoDate; type: string; express: boolean; deload: boolean; dayLabel: string; shortDay: (d: string) => string; session?: CopySession }): string {
  const titles = asObj(asObj(input.plan)['titles']);
  const out = [`${String(titles[input.type] ?? input.type)}${input.express ? ' · Express' : ''} · ${input.dayLabel}`];
  if (input.deload) out.push(deloadNote(input.plan));
  const sess = input.session;
  const calFlag = sess?.flags.find((f) => f.rule === 'plan.calibration');
  const calRir = readRules(input.plan).rules.calibration.rir;
  const calibrating = sess ? (calFlag ? ownNote(calFlag) : undefined) ?? (sess.items.some((x) => x.target?.action === 'calibrate') ? `Calibration week: ${calibrationNote(calRir)}.` : null) : null;
  if (calibrating) out.push(calibrating);
  out.push('');
  const lines = dashChecklist(input.plan, input.type, input.express, input.deload && !input.express);
  const rows = sess ? checklistTargets(lines, sess.items, sess.finisher?.name ?? null) : [];
  lines.forEach((ex, i) => {
    const { hint, noteText, temp } = planDetailDash(input.plan, input.log, input.type, ex, input.date, input.deload, input.shortDay);
    const row = rows[i];
    const item = sess && row?.kind === 'item' ? sess.items[row.index] : undefined;
    const rir = item ? (item.target?.rir ?? item.rir) : null;
    // A timed item as Today has it: intervals in words; the calibration week's easy minutes, with their line.
    const single = ex.parts.length <= 1;
    const changed = single && item?.timed && item.sr && item.sr !== ex.sr ? item.sr : null;
    const dose = single && item?.timed?.rounds ? item.timed.text : (changed ?? ex.sr);
    const shown = temp ? hint : (item && copyHint(item.target)) ?? hint;
    const notes = rir !== null ? noteText.replace(/\bRIR \d+(?:\.\d+)?/g, `RIR ${rir}`) : noteText;
    // A single item's RIR on its line when nothing else says it (a plan that keeps it in the rir field, not the note),
    // as Today's row says it: not for holds, minutes or rounds.
    const sayRir = single && item && !item.timed && rir !== null && !/s\/side|min|rounds|\bs\b/.test(ex.sr) && !/\bRIR\b/.test(`${shown} ${notes}`);
    out.push(`${i + 1}. ${ex.name}: ${dose}${sayRir ? ` @ RIR ${rir}` : ''}`);
    if (shown) out.push(`   ${shown}`);
    if (changed && item?.cue) out.push(`   ${item.cue}`);
    if (notes) out.push(`   ${notes}`);
    for (const st of ex.steps) out.push(`   - ${st}`);
  });
  const levels = levelsText(input.plan, input.log, input.type);
  if (levels) out.push('', levels);
  return out.join('\n');
}

// ---------------------------------------------------------------- records

/** recordsIn: the records a new entry sets against everything logged before it ("Bench 60 × 7"). */
export function recordsIn(entry: Obj, logBefore: unknown, rawPlan: unknown): string[] {
  const plan = asObj(rawPlan);
  const list = sorted(logBefore);
  const shortOf = (name: string) => {
    const types = strs(plan['liftTypes']);
    const main = types.flatMap((t) => (Array.isArray(asObj(plan['sessions'])[t]) ? (asObj(plan['sessions'])[t] as Obj[]) : []).filter((i) => i['logged']).map((i) => String(i['name'])));
    return main.includes(name) ? String(asObj(asObj(plan['lifts'])[name])['short'] ?? name) : name;
  };
  return [entry['lift1'], entry['lift2']]
    .filter((l): l is Lift => isObj(l) && typeof l['weight'] === 'number' && l['weight'] > 0)
    .filter((l) => {
      const { best } = liftHistory(plan, list, l.name);
      return Boolean(best && beats(l, best));
    })
    .map((l) => `${shortOf(l.name)} ${l.weight} × ${l.reps}`);
}

// ---------------------------------------------------------------- the movement guide

export interface GuideEntry {
  title: string;
  /** A ladder item whose level is not set yet: the guide shows level 1. */
  unset: boolean;
  works: string;
  setup: string | null;
  do: string | null;
  avoid: string | null;
  video: { url: string; label: string; checked: boolean };
  /** Body-map slugs: the muscles it mainly works, and those it helps. */
  main: string[];
  helps: string[];
}

const SLUG_OF = new Map(MUSCLES.map((m) => [m.id, m.highlighter]));

/** guideEntries: the guide for a checklist or session name (a ladder item at its level; parts expanded; a combined line piece by piece). */
export function guideFor(rawPlan: unknown, log: unknown, name: string, depth = 0): GuideEntry[] {
  if (depth > 4) return [];
  const plan = asObj(rawPlan);
  const guide = asObj(plan['guide']);
  const keys = new Map<string, string>();
  for (const [k, e] of Object.entries(guide)) for (const n of [k, ...strs(asObj(e)['aka'])]) keys.set(n.toLowerCase(), k);
  const items = Object.values(asObj(plan['sessions'])).flatMap((x) => (Array.isArray(x) ? (x as Obj[]) : []));
  const item = items.find((i) => isObj(i) && i['name'] === name);
  if (item && typeof item['ladder'] === 'string') {
    const ladders = Array.isArray(plan['ladders']) ? (plan['ladders'] as Obj[]) : [];
    const l = ladders.find((x) => x['id'] === item['ladder']);
    const hist = asObj(asObj(log)['ladders'])[item['ladder']];
    const cur = Array.isArray(hist) && hist.length ? (hist.at(-1) as { level: number }) : null;
    const n = cur ? cur.level : 1;
    const levels = Array.isArray(l?.['levels']) ? (l['levels'] as Obj[]).map((v) => String(v['name'])) : [];
    const lvl = levels[n - 1];
    if (!lvl) return [];
    return guideFor(rawPlan, log, lvl, depth + 1).map((e) => ({ ...e, title: `${String(l?.['name'] ?? '')} · L${n} ${lvl}`, unset: !cur }));
  }
  const key = keys.get(name.toLowerCase());
  if (key) {
    const e = asObj(guide[key]);
    if (Array.isArray(e['parts'])) return strs(e['parts']).flatMap((p) => guideFor(rawPlan, log, p, depth + 1));
    return [entryOf(plan, key, e)];
  }
  const pieces = name.replace(/^[^:]*:\s*/, '').split(/\s+\+\s+|\s+·\s+/);
  if (pieces.length === 1 && pieces[0] === name) return [];
  return pieces.filter((x) => keys.has(x.toLowerCase())).flatMap((x) => guideFor(rawPlan, log, x, depth + 1));
}

function entryOf(plan: Obj, key: string, e: Obj): GuideEntry {
  const names = asObj(plan['muscles']);
  const list = (ids: string[]) => ids.map((id) => String(names[id] ?? id)).join(', ');
  const m = asObj(e['muscles']);
  // The muscles that count (muscle-tags.ts): the catalogue's for a movement it knows, so the card and its body map agree with Review and Progress.
  const tags = canonicalTags(key, e);
  let works = '';
  if (tags.kind) works = `${tags.kind === 'cardio' ? 'Cardio' : 'Mobility'}${strs(m['areas']).length ? `: ${list(strs(m['areas'])).toLowerCase()}` : ''}`;
  else if (tags.tags.main.length) {
    const main = list(tags.tags.main).toLowerCase();
    works = main.charAt(0).toUpperCase() + main.slice(1) + (tags.tags.helps.length ? ` · helps ${list(tags.tags.helps).toLowerCase()}` : '');
  }
  const slugs = (ids: readonly string[]) => [...new Set(ids.map((id) => SLUG_OF.get(id)).filter((x): x is string => Boolean(x)))];
  const v = asObj(e['video']);
  const checked = typeof v['url'] === 'string';
  const q = String(e['q'] ?? key);
  return {
    title: key,
    unset: false,
    works,
    setup: typeof e['setup'] === 'string' ? e['setup'] : null,
    do: typeof e['do'] === 'string' ? e['do'] : null,
    avoid: typeof e['avoid'] === 'string' ? e['avoid'] : null,
    video: checked ? { url: String(v['url']), label: `${String(v['title'] ?? 'Video')} · ${String(v['channel'] ?? '')}`.replace(/ · $/, ''), checked } : { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, label: `Search YouTube: ${q}`, checked },
    main: slugs(tags.tags.main),
    helps: slugs(tags.tags.helps).filter((x) => !slugs(tags.tags.main).includes(x)),
  };
}

// ---------------------------------------------------------------- the month, the recent list, the plan's notes

/** The sessions logged this calendar month (every kind), for the banner's chip. */
export function sessionsThisMonth(log: unknown, date: IsoDate): number {
  return sessionsOf(log).filter((s) => s.date.slice(0, 7) === date.slice(0, 7) && s.date <= date).length;
}

/** sessionName: the plan's title for the session ("Heavy: squat and press · Express"; "Full Body A" for a plan without titles), a short day's name, or the custom label. */
export function sessionName(rawPlan: unknown, s: { type: string; label?: string; express?: boolean }): string {
  const plan = asObj(rawPlan);
  const title = asObj(plan['titles'])[s.type];
  if (strs(plan['liftTypes']).includes(s.type)) return `${typeof title === 'string' && title ? title : `Full Body ${s.type}`}${s.express ? ' · Express' : ''}`;
  if (strs(plan['shortTypes']).includes(s.type)) return String(asObj(plan['shortNames'])[s.type] ?? s.type);
  return s.label || 'Custom';
}

/** The recent list: the last `n` sessions, newest first, with the checklist count and the minutes. */
export function recentSessions(log: unknown, rawPlan: unknown, n = 4) {
  return sorted(log).slice(-n).reverse().map((s) => ({
    date: s.date,
    type: s.type,
    label: s.label,
    name: sessionName(rawPlan, s),
    check: s.checklist && typeof s.checklist.total === 'number' ? { done: Number(s.checklist.done ?? 0), total: s.checklist.total, skipped: s.checklist.skipped ?? [] } : null,
    minutes: typeof s.durationMin === 'number' ? s.durationMin : null,
    cardio: typeof s.cardioMin === 'number' ? s.cardioMin : 0,
  }));
}

/**
 * The plan's notes, as the dashboard's "The plan" card lists them, from the
 * files that exist in the fitness folder: the newest Month N Plan and
 * Baseline note stand in for the dashboard's fixed names.
 */
export function planLinks(files: readonly string[]): { label: string; path: string; icon: string }[] {
  const base = `${paths().fitness}/`;
  const names = new Set(files.map((f) => f.slice(f.lastIndexOf('/') + 1)));
  const month = [...names].map((f) => /^Month (\d+) Plan\.md$/.exec(f)).filter((m): m is RegExpExecArray => Boolean(m)).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  const baseline = [...names].filter((f) => /^Baseline - \d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().at(-1);
  const out: { label: string; path: string; icon: string }[] = [];
  const add = (label: string, file: string | undefined, icon: string) => file && names.has(file) && out.push({ label, path: `${base}${file}`, icon });
  add('6-Month Roadmap', '6-Month Roadmap.md', 'flag');
  add(month ? `Month ${month[1]} Plan` : '', month?.[0], 'calendar');
  add('Exercise Guide', 'Exercise Guide.md', 'body');
  add('Weekly Tracker', 'Weekly Tracker.md', 'table');
  add('Session History', 'Session History.md', 'history');
  add('Baseline (day 1)', baseline, 'flag');
  add('Workout log (email template)', 'Workout Log (email template).md', 'mail');
  return out;
}
