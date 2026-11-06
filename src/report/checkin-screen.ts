// The Check-in screen's report: the morning check-in as body-data.json holds
// it for the day (Habit Nudges' values, if it saved first), the Sunday
// check-in from `checkin template` (only the open questions) with its answers
// as a form, the record those answers become (what `checkin add` merges) and
// the last coach letter. The Sunday check-in reviews weeks of the current
// cycle only: a week that ended before the cycle start is not asked about,
// and a week the cycle began in asks about its days from the start. Also
// the coach step after it (core/coach-steps.ts), which Today and the Plan
// read from here too. Pure: the plugin passes the letter's text in.

import { morningFrom, type MorningKey } from '../adapters/vault/body-write.ts';
import type { VaultRead } from '../adapters/vault/read.ts';
import { coachSteps, type CoachSteps, type SundayStatus } from '../core/coach-steps.ts';
import { CATALOGUE_BY_ID } from '../core/data/exercises.ts';
import { MUSCLES } from '../core/data/muscles.ts';
import { addDays, dayText, mondayOf } from '../core/dates.ts';
import type { IsoDate, SorenessLevel, WeeklyCheckin } from '../core/schema.ts';
import { buildTemplate, letterFocus, reviewedSunday, type TemplateOptions } from './checkin.ts';
import { scopeInfo, withinCycle } from './cycle.ts';
import { buildSession } from './session.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export type CheckinTemplate = ReturnType<typeof buildTemplate>;
export type AskItem = CheckinTemplate['ask'][number];

// ---------------------------------------------------------------- the letter

export interface Letter {
  path: string;
  date: IsoDate | null;
  kind: string;
  title: string | null;
  focus: string | null;
  sections: { heading: string; text: string }[];
}

/** Markdown to plain text: links to their words, emphasis and code marks gone, tables left out. */
function plainMd(md: string): string {
  return md
    .split('\n')
    .filter((l) => !/^\s*\|/.test(l))
    .join('\n')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_, t: string) => t.slice(t.lastIndexOf('/') + 1).replace(/#.*/, ''))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A coach letter (the skill's Letters/<date>.md): frontmatter, title and its sections as plain text. */
export function parseLetter(path: string, text: string): Letter {
  const fm = /^---\r?\n([^]*?)\r?\n---\r?\n?/.exec(text);
  const front = fm?.[1] ?? '';
  const field = (k: string) => new RegExp(`^${k}:\\s*(.+?)\\s*(?:#.*)?$`, 'm').exec(front)?.[1]?.trim() ?? null;
  const body = fm ? text.slice(fm[0].length) : text;
  const fileDate = /(\d{4}-\d{2}-\d{2})\.md$/.exec(path)?.[1] ?? null;
  const date = (field('date') && /^\d{4}-\d{2}-\d{2}$/.test(field('date')!) ? field('date') : fileDate);
  const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? null;
  const sections: Letter['sections'] = [];
  for (const part of body.split(/^##\s+/m).slice(1)) {
    const nl = part.indexOf('\n');
    const heading = (nl < 0 ? part : part.slice(0, nl)).trim();
    const t = plainMd(nl < 0 ? '' : part.slice(nl + 1));
    sections.push({ heading, text: t });
  }
  return { path, date, kind: field('type') ?? 'coach-letter', title, focus: letterFocus(text), sections };
}

// ---------------------------------------------------------------- the Sunday answers

export interface SundayAnswers {
  /** Each day the template asks about: trained but not logged (with the session), planned rest, or missed. */
  gaps: Record<IsoDate, { choice: 'trained' | 'rest' | 'missed' | null; session: string }>;
  effort: number | null;
  /** The pain question's option (0 none, 1 mild, 2 lingered or over 3/10, 3 something new) and the areas marked. */
  pain: { option: number | null; areas: { area: string; severity: number }[] };
  stress: number | null;
  recovery: number | null;
  /** One number for all lifts; null "didn't notice"; undefined unanswered (a per-lift record stays as it is). */
  rir: number | null | undefined;
  /** The protein answer: the unticked days that reached it (added to the week's ticks, saved as proteinExtra). */
  protein: number | null;
  /** The eating plan's pattern: each line met (true), not met (false) or not answered (null). */
  pattern: Record<string, boolean | null>;
  enjoyment: number | null;
  /** The availability option (0 normal, 1 travel, 2 busy, 3 unsure) and the new period's dates. */
  busy: { option: number | null; from: IsoDate | null; to: IsoDate | null; sessions: number | null; note: string };
  focus: boolean | null;
  notes: string;
  deload: { cancelled: boolean | null; reason: string };
  /** A dashboard deload week (its Monday): trained at full load or not. */
  fullLoad: Record<IsoDate, boolean | null>;
  /** A stalled lift's triage step (0 leaves it off the record). */
  triage: Record<string, number>;
}

const askOf = (t: CheckinTemplate, topic: string) => t.ask.find((a) => a.topic === topic) ?? null;
const knownOf = (t: CheckinTemplate, topic: string) => ((askOf(t, topic) as { known?: unknown } | null)?.known ?? null) as Obj | null;
const optionsOf = (t: CheckinTemplate, topic: string) => ((askOf(t, topic) as { options?: { option: string; value: unknown }[] } | null)?.options ?? []);

/** The eating plan's pattern lines the template asks about (none without an eating plan). */
export function patternLines(t: CheckinTemplate): { id: string; name: string; target: string }[] {
  return ((askOf(t, 'pattern') as { lines?: { id: string; name: string; target: string }[] } | null)?.lines ?? []);
}

/** The days question 1 asks about, the template's and those the record already answers. */
export function gapDays(t: CheckinTemplate): IsoDate[] {
  const k = knownOf(t, 'gaps') ?? {};
  const r = t.record;
  const days = new Set<string>([...((k['tickedNotLogged'] as string[]) ?? []), ...((k['noSessionNoTick'] as string[]) ?? []), ...(r.confirmedUnlogged ?? []).map((c) => c.date), ...(r.restDays ?? []), ...(r.missedDays ?? [])]);
  return [...days].sort();
}

/** The form's starting answers: the record's (an existing check-in), else blank with the template's pre-fills. */
export function answersFromRecord(t: CheckinTemplate): SundayAnswers {
  const r = t.record;
  const gaps: SundayAnswers['gaps'] = {};
  for (const d of gapDays(t)) {
    const u = (r.confirmedUnlogged ?? []).find((c) => c.date === d);
    gaps[d] = u ? { choice: 'trained', session: u.type ?? '' } : (r.restDays ?? []).includes(d) ? { choice: 'rest', session: '' } : (r.missedDays ?? []).includes(d) ? { choice: 'missed', session: '' } : { choice: null, session: '' };
  }
  const aches = r.jointAches;
  const list = Array.isArray(aches) ? aches : [];
  const painOption = aches === undefined || aches === null ? null : aches === false || (Array.isArray(aches) && !aches.length) ? 0 : list.some((a) => a.lingered || a.severity > 3) ? 2 : 1;
  const ticks = Number((knownOf(t, 'protein') ?? {})['proteinTicks'] ?? 0);
  // The answer as saved (proteinExtra), else a record from before 0.14.0 (proteinDays, the ticks at the time plus the answer), within the options.
  const most = Math.max(0, ...optionsOf(t, 'protein').map((o) => Number(o.value)));
  const extra = typeof r.proteinExtra === 'number' ? r.proteinExtra : typeof r.proteinDays === 'number' ? r.proteinDays - ticks : null;
  const fullLoadWeeks = ((knownOf(t, 'full-load') ?? {})['weeks'] as { weekStart: IsoDate }[] | undefined) ?? [];
  const trained = new Set(r.deload?.trainedAtFullLoad ?? []);
  const pattern = Object.fromEntries(patternLines(t).map((l) => [l.id, typeof r.pattern?.[l.id] === 'boolean' ? r.pattern[l.id]! : null]));
  return {
    gaps,
    effort: r.effort ?? null,
    pain: { option: painOption, areas: list.map((a) => ({ area: a.area, severity: a.severity })) },
    stress: r.stress ?? null,
    recovery: r.recovery ?? null,
    rir: typeof r.reportedRir === 'number' ? r.reportedRir : undefined,
    protein: extra === null ? null : Math.max(0, Math.min(most, extra)),
    pattern,
    enjoyment: r.enjoyment ?? null,
    busy: { option: null, from: null, to: null, sessions: null, note: '' },
    focus: r.focusFollowed ?? null,
    notes: r.notes ?? '',
    deload: { cancelled: r.deload?.cancelled ?? null, reason: r.deload?.reason ?? '' },
    fullLoad: Object.fromEntries(fullLoadWeeks.map((w) => [w.weekStart, trained.has(w.weekStart) ? true : null])),
    triage: Object.fromEntries((r.triage ?? []).map((x) => [x.lift, x.step])),
  };
}

const BUSY_KIND: Record<number, 'travel' | 'crunch'> = { 1: 'travel', 2: 'crunch' };

/**
 * The record the answers become: the template's record (the existing one, or
 * the skeleton with its pre-fills) with each answered field set. An
 * unanswered field is null, which `checkin add` leaves out, so an existing
 * value stays.
 */
export function recordFromAnswers(t: CheckinTemplate, a: SundayAnswers): Record<string, unknown> {
  const r: Obj = { ...(t.record as Obj) };
  const rows = Object.entries(a.gaps).sort(([x], [y]) => (x < y ? -1 : 1));
  r['confirmedUnlogged'] = rows.filter(([, g]) => g.choice === 'trained').map(([date, g]) => ({ date, ...(g.session ? { type: g.session } : {}) }));
  r['restDays'] = rows.filter(([, g]) => g.choice === 'rest').map(([d]) => d);
  r['missedDays'] = rows.filter(([, g]) => g.choice === 'missed').map(([d]) => d);
  r['effort'] = a.effort;
  r['jointAches'] = a.pain.option === null ? null : a.pain.option === 0 ? [] : a.pain.areas.length ? a.pain.areas.map((x) => ({ area: x.area, severity: x.severity, ...(a.pain.option === 2 ? { lingered: true } : {}) })) : null;
  r['stress'] = a.stress;
  r['recovery'] = a.recovery;
  if (a.rir !== undefined) r['reportedRir'] = a.rir;
  // Additive: the ticks are counted when read, so a later tick adds itself.
  r['proteinExtra'] = a.protein;
  if (askOf(t, 'pattern')) {
    // Only the lines answered; none answered leaves the field out, so a saved value stays.
    const met = Object.fromEntries(Object.entries(a.pattern).filter(([, v]) => v !== null));
    r['pattern'] = Object.keys(met).length ? met : null;
  }
  r['enjoyment'] = a.enjoyment;
  const known = (t.record).knownBusy ?? [];
  const kind = a.busy.option !== null ? BUSY_KIND[a.busy.option] : undefined;
  const added = kind && a.busy.from && a.busy.to ? [{ from: a.busy.from, to: a.busy.to, kind, ...(kind === 'crunch' && a.busy.sessions !== null ? { sessions: a.busy.sessions } : {}), ...(a.busy.note.trim() ? { note: a.busy.note.trim() } : {}) }] : [];
  r['knownBusy'] = [...known.filter((b) => !added.some((n) => n.from === b.from && n.to === b.to)), ...added];
  const asked = new Set(Object.keys(a.fullLoad));
  const prevDeload = ((t.record).deload ?? {}) as Obj;
  r['deload'] = {
    ...prevDeload,
    cancelled: a.deload.cancelled,
    reason: a.deload.cancelled ? a.deload.reason.trim() || null : null,
    trainedAtFullLoad: [...((prevDeload['trainedAtFullLoad'] as string[] | undefined) ?? []).filter((m) => !asked.has(m)), ...Object.entries(a.fullLoad).filter(([, v]) => v === true).map(([m]) => m)].sort(),
  };
  r['triage'] = Object.entries(a.triage).filter(([, step]) => step > 0).map(([lift, step]) => ({ lift, step, date: t.date }));
  r['focusFollowed'] = a.focus;
  r['notes'] = a.notes.trim() || null;
  return r;
}

const lower = (s: string | undefined) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : '');
const optionText = (t: CheckinTemplate, topic: string, v: unknown) => optionsOf(t, topic).find((o) => JSON.stringify(o.value) === JSON.stringify(v))?.option;

export const TRIAGE_STEP: Record<number, string> = { 1: 'Step 1: check the basics', 2: 'Step 2: an early light week', 3: 'Step 3: change the rep range or variation', 4: 'Step 4: adjust the volume' };

/** "What the coach will save": the answers in words, and what is still open. */
export function sundaySummary(t: CheckinTemplate, a: SundayAnswers, sessionName: (type: string) => string = (x) => x): { items: string[]; open: string[] } {
  const items: string[] = [];
  const open: string[] = [];
  for (const [d, g] of Object.entries(a.gaps).sort(([x], [y]) => (x < y ? -1 : 1))) {
    const day = dayText(d);
    if (!g.choice) open.push(`${day}: trained, rest or missed`);
    else items.push(`${day}: ${g.choice === 'trained' ? `a session done but not logged${g.session ? ` (${sessionName(g.session)})` : ', which one not said'}` : g.choice === 'rest' ? 'a planned rest day' : 'a missed session'}`);
  }
  const say = (topic: string, label: string, v: number | null) => {
    if (!askOf(t, topic)) return;
    if (v === null) open.push(label);
    else items.push(`${label}: ${lower(optionText(t, topic, v))}`);
  };
  say('effort', 'Effort', a.effort);
  if (askOf(t, 'pain')) {
    if (a.pain.option === null) open.push('Pain');
    else if (a.pain.option === 0) items.push('Pain: none');
    else if (!a.pain.areas.length) open.push('Pain: where it hurts');
    else items.push(`Pain: ${a.pain.areas.map((x) => `${x.area}, ${x.severity} of 10`).join('; ')}${a.pain.option === 2 ? ' (lingered or over 3 of 10)' : ''}`);
  }
  say('life', 'The week outside training', a.stress);
  say('recovery', 'Recovery', a.recovery);
  if (askOf(t, 'rir')) {
    if (a.rir === undefined) {
      if (isObj((t.record as Obj)['reportedRir'])) items.push('Reps left on the top sets: per lift, as saved');
      else open.push('Reps left');
    } else items.push(`Reps left on the top sets: ${a.rir === null ? 'did not notice (left out)' : `${optionText(t, 'rir', a.rir)}, on all lifts`}`);
  }
  if (askOf(t, 'protein')) {
    const ticks = Number((knownOf(t, 'protein') ?? {})['proteinTicks'] ?? 0);
    if (a.protein === null) open.push('Protein');
    else items.push(`Protein: ${Math.min(7, ticks + a.protein)} days (${ticks} ticked + ${a.protein})`);
  }
  if (askOf(t, 'pattern')) {
    const lines = patternLines(t);
    const done = lines.filter((l) => a.pattern[l.id] !== null && a.pattern[l.id] !== undefined);
    const left = lines.filter((l) => a.pattern[l.id] === null || a.pattern[l.id] === undefined);
    if (done.length) items.push(`The pattern: ${done.map((l) => `${l.name.toLowerCase()} ${a.pattern[l.id] ? 'met' : 'not met'}`).join(', ')}`);
    if (left.length) open.push(`The pattern: ${left.map((l) => l.name.toLowerCase()).join(', ')}`);
  }
  say('enjoyment', 'Looked forward to sessions', a.enjoyment);
  if (askOf(t, 'availability')) {
    const o = optionsOf(t, 'availability')[a.busy.option ?? -1];
    if (o && (a.busy.option === 1 || a.busy.option === 2)) items.push(`Weeks ahead: ${lower(o.option)}${a.busy.from && a.busy.to ? `, ${dayText(a.busy.from)} to ${dayText(a.busy.to)}` : ', dates not set (not saved)'}`);
    else if (o) items.push(`Weeks ahead: ${lower(o.option)}`);
    for (const b of (t.record).knownBusy ?? []) items.push(`Already noted: ${b.kind}, ${dayText(b.from)} to ${dayText(b.to)}${b.note ? ` (${b.note})` : ''}`);
  }
  if (askOf(t, 'decisions')) {
    if (a.focus !== null) items.push(`Last focus: ${a.focus ? 'followed' : 'not followed'}`);
    if (a.notes.trim()) items.push(`Note: ${a.notes.trim()}`);
  }
  if (askOf(t, 'deload')) {
    if (a.deload.cancelled === null) open.push('Next week’s light week: keep or cancel');
    else items.push(a.deload.cancelled ? `Next week’s light week: cancelled${a.deload.reason.trim() ? ` (${a.deload.reason.trim()})` : ''}` : 'Next week’s light week: kept');
  }
  for (const [m, v] of Object.entries(a.fullLoad)) {
    if (v === null) open.push(`Was the week of ${dayText(m)} trained at full load?`);
    else items.push(`The week of ${dayText(m)}: ${v ? 'trained at full load' : 'a light week, as counted'}`);
  }
  for (const [lift, n] of Object.entries(a.triage)) items.push(n > 0 ? `${lift}: triage ${lower(TRIAGE_STEP[n])}` : `${lift}: no triage step on record`);
  return { items, open };
}

// ---------------------------------------------------------------- the screen

/** Body-map slugs the morning map marks as muscles (the joints and head are for pain only). */
const SLUG_OF = new Map(MUSCLES.map((m) => [m.id, m.highlighter]));

/** The highlighter slugs today's session trains (its exercises' main and helping muscles). */
function trainsToday(read: VaultRead, date: IsoDate): { name: string | null; slugs: string[] } {
  if (read.files.plan === 'missing') return { name: null, slugs: [] };
  const s = buildSession(read.data, date, 'full');
  if (!s.session) return { name: null, slugs: [] };
  const slugs = new Set<string>();
  for (const it of s.items) {
    const m = read.data.program.exercises[it.exercise]?.muscles ?? CATALOGUE_BY_ID.get(it.exercise)?.muscles;
    for (const id of [...(m?.main ?? []), ...(m?.helps ?? [])]) {
      const slug = SLUG_OF.get(id);
      if (slug) slugs.add(slug);
    }
  }
  return { name: s.session.name, slugs: [...slugs] };
}

/**
 * The Sunday check-in the date reviews (the Sunday on or before it) and its
 * status: open on the Sunday, late after it while unsaved, edit on the
 * Sunday once saved, saved after it. Null without a plan, or for a week that
 * ended before the cycle began (nothing in it is this cycle's to review).
 */
export function sundayStatus(read: VaultRead, date: IsoDate): { date: IsoDate; status: SundayStatus; existing: WeeklyCheckin | null } | null {
  if (read.files.plan === 'missing') return null;
  const since = scopeInfo(read.data, date).since;
  const sun = reviewedSunday(date);
  if (since && sun < since) return null;
  const existing = read.data.checkins.weekly.find((w) => w.date === sun) ?? null;
  const isSunday = sun === date;
  return { date: sun, status: existing ? (isSunday ? 'edit' : 'saved') : isSunday ? 'open' : 'late', existing };
}

/**
 * The coach steps for the date: the step after the Sunday check-in the date
 * reviews and where it stands, and the next ones. The newest letter counts
 * only from the cycle start, as the Check-in screen shows it. No plan: none.
 */
export function coachStepsOf(read: VaultRead, date: IsoDate, letter: { path: string; text: string } | null): CoachSteps {
  if (read.files.plan === 'missing') return { now: null, next: [] };
  const sun = sundayStatus(read, date);
  const since = scopeInfo(read.data, date).since;
  const l = letter ? parseLetter(letter.path, letter.text) : null;
  const inCycle = l && !(since && l.date && l.date < since) ? l : null;
  return coachSteps({
    program: read.data.program,
    planWeeks: read.data.plan.weeks,
    date,
    sunday: sun ? { date: sun.date, status: sun.status } : null,
    letter: inCycle ? { date: inCycle.date, kind: inCycle.kind } : null,
  });
}

/**
 * The Check-in screen for the date. `opts.minutes` is now (minutes since
 * midnight) and `opts.tracking` what is tracked: on the check-in Sunday the
 * protein question counts the protein item's ticks and leaves today out
 * while its tick is still ahead.
 */
export function buildCheckin(read: VaultRead, date: IsoDate, letter: { path: string; text: string } | null, opts: { minutes?: number; tracking?: TemplateOptions['tracking'] } = {}) {
  const notes: { code: string; text: string }[] = [];
  const body = read.raw?.body;
  const m = morningFrom(body ?? null, date);
  const day = isObj(body) && isObj(body['days']) && isObj(body['days'][date]) ? (body['days'][date]) : {};
  const sore: Record<string, SorenessLevel> = {};
  for (const [id, v] of Object.entries(isObj(day['soreMuscles']) ? (day['soreMuscles']) : {})) {
    const slug = SLUG_OF.get(id) ?? (MUSCLES.some((x) => x.highlighter === id) ? id : null);
    if (slug && (v === 'mild' || v === 'sore')) sore[slug] = v;
  }
  if (read.files.body === 'missing') notes.push({ code: 'no-body', text: 'No body-data.json yet: the first morning save starts it.' });
  const trains = trainsToday(read, date);
  const morning = {
    date,
    yesterday: addDays(date, -1),
    values: m.values,
    baseline: { ...m.values } as Record<MorningKey, number | null>,
    sore,
    soreFrom: { ...sore },
    checkedAt: m.checkedAt,
    filled: Object.values(m.values).some((v) => v !== null) || Object.keys(sore).length > 0,
    sessionName: trains.name,
    trains: trains.slugs,
  };

  // The Sunday check-in: the one that reviews the week ending on the Sunday on or before today.
  let sunday = null;
  const cycle = scopeInfo(read.data, date);
  const sun = reviewedSunday(date);
  // A letter dated before the cycle start belongs to the cycle before: it is not shown, and its question is not asked.
  const dated = letter ? parseLetter(letter.path, letter.text) : null;
  const cycleLetter = letter && !(cycle.since && dated?.date && dated.date < cycle.since) ? letter : null;
  if (read.files.plan === 'missing') notes.push({ code: 'no-plan', text: 'No plan-data.json: the Sunday check-in is built from the plan and the log.' });
  else if (cycle.since && sun < cycle.since) {
    // That week ended before the cycle began: nothing in it is this cycle's to review.
    const opens = addDays(mondayOf(cycle.since), 6);
    notes.push({ code: 'sunday-before-cycle', text: `The first Sunday check-in of this cycle opens ${dayText(opens)}: last week ended before the cycle began on ${dayText(cycle.since)}.` });
  } else {
    const { status, existing } = sundayStatus(read, date)!;
    const lastLetter = cycleLetter ? { path: cycleLetter.path, focus: letterFocus(cycleLetter.text) } : null;
    // A week the cycle began in is built from the cycle's data, and asks only about its days from the start.
    const partial = cycle.since !== null && mondayOf(sun) < cycle.since;
    const template = buildTemplate(partial ? withinCycle(read.data, cycle.since) : read.data, sun, lastLetter, { now: opts.minutes === undefined ? null : { date, minutes: opts.minutes }, tracking: opts.tracking ?? null });
    if (partial) {
      for (const a of template.ask) {
        const k = (a as { known?: Record<string, unknown> }).known;
        if (!k) continue;
        for (const f of ['tickedNotLogged', 'noSessionNoTick'] as const) if (Array.isArray(k[f])) k[f] = (k[f] as IsoDate[]).filter((d) => d >= cycle.since!);
      }
    }
    // The questions still open, and those a saved record answers (to edit); not the ones that do not apply.
    const openOnly = { ...template, ask: template.ask.filter((a) => a.open || a.answered) };
    const types = read.data.plan.types.map((x) => ({ type: x.type, name: x.label }));
    sunday = {
      status,
      date: sun,
      weekStart: template.weekStart,
      nextOpens: addDays(sun, 7),
      template: openOnly,
      answers: answersFromRecord(openOnly),
      existing,
      sessionTypes: [...types, { type: 'custom', name: 'Something else' }],
      proteinFloorG: (() => {
        const q = askOf(openOnly, 'protein');
        const g = q ? /about (\d+) g/.exec(q.question)?.[1] : undefined;
        return g ? Number(g) : null;
      })(),
    };
  }
  const parsed = cycleLetter ? dated : null;
  if (!parsed) notes.push({ code: 'no-letter', text: `No coach letter${letter ? ' this cycle' : ''} yet: the coach writes one after each Sunday check-in.` });
  // The coach step after the Sunday check-in: what to run once the answers are saved.
  return { date, morning, sunday, letter: parsed, coach: coachStepsOf(read, date, letter), notes };
}

export type CheckinScreen = ReturnType<typeof buildCheckin>;
