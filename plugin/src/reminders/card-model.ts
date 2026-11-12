// What each reminder card shows, as signed off in mockups/reminders.html:
// its icon, kicker, title and line under it, the fields or list in its body
// (pre-filled from the files), its buttons (Save or Done, Skip today, the
// Snooze menu with "Skip this photo day"), the one-line Why (the engine's
// reason) and the macOS notification's text. "Ask the coach" (kind coach)
// is drawn from the step on the due card itself. Pure: from a due card (the
// engine's dueNow) and the files as read; ui/cards.ts draws it.

import { bodyFmt, type BodyFmt, type BodyUnits } from '../ui/units.ts';
import { morningFrom, TAPE_FIELDS, TEST_FIELDS, type MorningKey, type RecordField } from '../../../src/adapters/vault/body-write.ts';
import { muscleId } from '../../../src/adapters/vault/log-write.ts';
import { hhmm, type Moment } from '../../../src/core/clock.ts';
import { deskRoutine } from '../../../src/core/desk-breaks.ts';
import { listedTestWeeks, type BodyPart, type PartStatus } from '../../../src/core/body-schedule.ts';
import type { CardKind, DueCard, SnoozeChoices } from '../../../src/core/nudges.ts';
import type { IsoDate, Program, SorenessLevel, TrackedItem, Tracking } from '../../../src/core/schema.ts';
import { hm, type SittingDay } from '../../../src/core/sitting.ts';
import { STAND_FRESH, type StandState } from '../../../src/core/standup.ts';
import { dayValue, type HabitsView } from '../../../src/core/tracking.ts';
import { clean, fmt } from '../ui/format.ts';

export type SnoozeChoice = number | 'evening' | 'tomorrow';

export interface SnoozeEntry {
  label: string;
  choice: SnoozeChoice;
  isDefault: boolean;
}

/** One input on a card: its label, unit and hint, the value it starts with and last time's as the placeholder. */
export interface CardField {
  id: string;
  label: string;
  unit: string;
  hint: string;
  /** The value on file for this day ("" when none). */
  value: string;
  placeholder: string;
  text?: boolean;
}

export interface CardScale {
  key: MorningKey;
  label: string;
  lo: string;
  hi: string;
  value: number | null;
}

export interface CardHabit {
  id: string;
  name: string;
  dose: string | null;
  kind: 'supplement' | 'tick';
  note: string | null;
  /** The linked habit's name. */
  habit: string | null;
  done: boolean;
}

export type CardBody =
  | { kind: 'morning'; scales: CardScale[]; fields: CardField[]; tape: { text: string; fields: CardField[] } | null; sore: SoreArea[]; /** "I'm ill today", as the day holds it. */ ill: boolean }
  | { kind: 'tape'; tape: { text: string; fields: CardField[] } }
  | { kind: 'habits'; items: CardHabit[] }
  | { kind: 'amount'; item: string; value: number; target: number; unit: string; quick: number[]; next: string | null; placeholder: number }
  | { kind: 'standup'; item: string; satMinutes: number; standMinutes: number; standing: { left: number; stood: number } | null }
  | { kind: 'sitting'; item: string; minutes: number; limit: number; longest: number; stretchMax: number; stretch: number | null; lead: string; ideas: { icon: string; text: string }[] }
  | { kind: 'desk'; item: string; steps: { name: string; dose: string; how: string | null }[] }
  | { kind: 'photos'; poses: { id: string; name: string }[]; last: IsoDate | null }
  | { kind: 'tests'; fields: CardField[] }
  | { kind: 'train'; lead: string; session: string | null }
  /** Ask the coach: why now, and the command to run in Claude Code (with Copy). */
  | { kind: 'coach'; lead: string; command: string };

export interface CardView {
  key: string;
  kind: CardKind;
  date: IsoDate;
  /** Opened by hand and not due: Cancel instead of Skip and Snooze, and closing writes nothing. */
  manual: boolean;
  icon: string;
  kicker: string;
  title: string;
  sub: string;
  /** The main button; null on "Did you train today?" (its three choices answer it). */
  primary: string | null;
  skip: { label: string; action: 'skip' | 'later' } | null;
  snooze: SnoozeEntry[] | null;
  /** "Skip this photo day" in the Snooze menu, with the next one. */
  skipPeriod: { label: string; next: string | null } | null;
  /** Closing is a snooze; the stand-up card can't be closed ("Stays open"). */
  closable: boolean;
  why: { note: string; rule: string };
  notify: { title: string; body: string };
  body: CardBody;
  /** The body units the card's weight and lengths are shown and typed in (kept in kg and cm). */
  units: BodyUnits;
}

export interface CardContext {
  now: Moment;
  /** The profile's body units (kg and cm without them). */
  units?: BodyUnits;
  tracking: Tracking | null;
  habits: HabitsView | null;
  /** body-data.json, parsed. */
  body: unknown;
  program: Pick<Program, 'macrocycle' | 'deskBreaks'> | null;
  /** Each stand-up item's count on this Mac. */
  stand?: ReadonlyMap<string, StandState>;
  sitting?: { today: SittingDay; current: { start: number; minutes: number } | null } | null;
  /** The morning check-in's time ("07:30"). */
  morningAt?: string | null;
  /** Today's planned session, for "Log session". */
  session?: string | null;
  /** Opened by hand. */
  manual?: boolean;
  /** The body record's parts today (the tape section's line says how often). */
  parts?: Partial<Record<BodyPart, PartStatus>>;
  /**
   * The current cycle's first day (the cycle-start rule): the "last" hints
   * show nothing dated before it, so a fresh start never offers the old
   * cycle's tape, tests or photo day. Null or absent: everything counts.
   */
  since?: IsoDate | null;
}

// ---------------------------------------------------------------- small parts

const n = (v: number) => v.toLocaleString('en-GB');
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export const snoozeLabel = (m: number) => (m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`);

/** The Snooze menu's entries: the minutes (the default marked), "This evening, 18:00", "Tomorrow morning". */
export function snoozeEntries(s: SnoozeChoices | null): SnoozeEntry[] | null {
  if (!s) return null;
  const out: SnoozeEntry[] = s.minutes.map((m) => ({ label: snoozeLabel(m), choice: m, isDefault: m === s.default }));
  if (s.evening) out.push({ label: `This evening, ${s.evening}`, choice: 'evening', isDefault: false });
  if (s.tomorrow) out.push({ label: 'Tomorrow morning', choice: 'tomorrow', isDefault: false });
  return out;
}

/** "Half an hour", "An hour", "45 minutes", "1 h 30". */
function span(m: number): string {
  if (m === 30) return 'Half an hour';
  if (m === 60) return 'An hour';
  if (m < 60) return `${m} minutes`;
  return hm(m);
}

const SCALES: Omit<CardScale, 'value'>[] = [
  { key: 'energy', label: 'Energy', lo: 'Flat', hi: 'Great' },
  { key: 'soreness', label: 'Soreness', lo: 'None', hi: 'Very sore' },
  { key: 'sleepQ', label: 'Sleep quality', lo: 'Poor', hi: 'Great' },
];

const MORNING_FIELDS: { key: MorningKey; label: string; unit: string; hint: string }[] = [
  { key: 'sleepH', label: 'Sleep', unit: 'h', hint: '7:20 or 7.3' },
  { key: 'rhr', label: 'Resting HR', unit: 'bpm', hint: 'Health, Heart' },
  { key: 'hrv', label: 'HRV', unit: 'ms', hint: 'Health, Heart, Heart Rate Variability' },
  { key: 'weight', label: 'Weight', unit: 'kg', hint: 'after the bathroom' },
  { key: 'steps', label: 'Steps yesterday', unit: '', hint: 'Health, Steps' },
  { key: 'floors', label: 'Floors yesterday', unit: '', hint: 'Health, Flights Climbed' },
];

const TAPE_HINT: Record<string, string> = { waist: 'at the navel, relaxed', hips: 'widest point', chest: 'at the nipples', arm: 'right, relaxed, mid' };
const TEST_HINT: Record<string, { hint: string; placeholder?: string }> = {
  pushups: { hint: 'max clean reps, one set' },
  pullups: { hint: 'strict; 0 if not yet' },
  pullupLevel: { hint: 'if 0 reps: e.g. negatives 3×3', placeholder: 'negatives 3×3' },
  hollowS: { hint: 'good form' },
  sidePlankS: { hint: '' },
  handstandS: { hint: 'chest to wall' },
  wallGapCm: { hint: 'heels, hips, shoulders on the wall: gap behind the head' },
  pistol: { hint: 'e.g. to a box, 3 each', placeholder: 'box 3' },
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const entries = (body: unknown, list: 'tape' | 'tests'): Obj[] => (isObj(body) && Array.isArray(body[list]) ? (body[list] as unknown[]).filter(isObj) : []).sort((a, b) => String(a['date']).localeCompare(String(b['date'])));
const show = (v: unknown) => (typeof v === 'number' || typeof v === 'string' ? String(v) : '');

/** On or after the cycle start (always, without one). */
const inCycle = (e: Obj, since: IsoDate | null) => since === null || String(e['date']) >= since;

/** A quick pick on the morning card: an area, the muscles it marks, and how sore it is this morning. */
export interface SoreArea {
  id: string;
  label: string;
  /** Engine muscle ids (the body log keeps these). */
  muscles: string[];
  level: SorenessLevel | null;
}

/** The areas people are most often sore in, each one or two muscles of the body map. */
export const SORE_AREAS: readonly { id: string; label: string; muscles: string[] }[] = [
  { id: 'chest', label: 'Chest', muscles: ['chest'] },
  { id: 'shoulders', label: 'Shoulders', muscles: ['shoulders'] },
  { id: 'arms', label: 'Arms', muscles: ['biceps', 'triceps'] },
  { id: 'upper-back', label: 'Upper back', muscles: ['upper-back', 'lats'] },
  { id: 'lower-back', label: 'Lower back', muscles: ['lower-back'] },
  { id: 'core', label: 'Core', muscles: ['abs', 'obliques'] },
  { id: 'glutes', label: 'Glutes', muscles: ['glutes'] },
  { id: 'quads', label: 'Quads', muscles: ['quads'] },
  { id: 'hamstrings', label: 'Hamstrings', muscles: ['hamstrings'] },
  { id: 'calves', label: 'Calves', muscles: ['calves'] },
];

/** This morning's sore muscles in the body log (by engine id), as the quick pick's areas: an area shows its sorest muscle. */
export function soreAreas(body: unknown, date: IsoDate): SoreArea[] {
  const days = isObj(body) && isObj(body['days']) ? (body['days']) : {};
  const day = isObj(days[date]) ? (days[date]) : {};
  const raw = isObj(day['soreMuscles']) ? (day['soreMuscles']) : {};
  const byId: Record<string, SorenessLevel> = {};
  for (const [k, v] of Object.entries(raw)) {
    const id = muscleId(k);
    if (id && (v === 'mild' || v === 'sore')) byId[id] = byId[id] === 'sore' ? 'sore' : v;
  }
  return SORE_AREAS.map((a) => {
    const levels = a.muscles.map((m) => byId[m] ?? null);
    return { ...a, level: levels.includes('sore') ? 'sore' : levels.includes('mild') ? 'mild' : null };
  });
}

/** A stored length (cm) as the card shows it: as written in cm, to one decimal in inches. */
const showLen = (v: unknown, F: BodyFmt) => (typeof v === 'number' ? String(F.len(v)) : show(v));

/** The tape's four fields: today's entry if there is one, this cycle's last as the placeholder, in the body unit. */
function tapeFields(body: unknown, date: IsoDate, since: IsoDate | null, F: BodyFmt = bodyFmt(null)): CardField[] {
  const list = entries(body, 'tape');
  const today = list.find((e) => e['date'] === date) ?? {};
  const last = list.filter((e) => String(e['date']) < date && inCycle(e, since)).at(-1) ?? {};
  return TAPE_FIELDS.map((f) => ({ id: f.id, label: f.label, unit: f.unit === 'cm' ? F.l : (f.unit ?? ''), hint: TAPE_HINT[f.id] ?? '', value: showLen(today[f.id], F), placeholder: last[f.id] !== undefined ? `last ${showLen(last[f.id], F)}` : '' }));
}

/** The eight tests: today's entry if there is one; the hint says this cycle's last result and when. */
function testFields(body: unknown, date: IsoDate, since: IsoDate | null, F: BodyFmt = bodyFmt(null)): CardField[] {
  const list = entries(body, 'tests');
  const today = list.find((e) => e['date'] === date) ?? {};
  const before = list.filter((e) => String(e['date']) < date && inCycle(e, since));
  return TEST_FIELDS.map((f: RecordField) => {
    const lastE = [...before].reverse().find((e) => e[f.id] !== undefined && e[f.id] !== null);
    const meta = TEST_HINT[f.id] ?? { hint: '' };
    // The wall test (cm) in the body unit; the others as they are.
    const cm = f.unit === 'cm';
    const own = cm ? F.l : f.unit;
    const val = (v: unknown) => (cm ? showLen(v, F) : show(v));
    const unit = own && own !== 'reps' ? ` ${own.split('/')[0]}` : '';
    const last = lastE ? (f.text ? `last ${show(lastE[f.id])}` : `last ${val(lastE[f.id])}${unit}, ${fmt.day(String(lastE['date']))}`) : '';
    return { id: f.id, label: f.label, unit: f.text ? '' : (own ?? ''), hint: [meta.hint, last].filter(Boolean).join(' · '), value: val(today[f.id]), placeholder: meta.placeholder ?? '', ...(f.text ? { text: true } : {}) };
  });
}

function slotName(card: DueCard): { kicker: string; icon: string } {
  if (card.key === 'slot:after-log') return { kicker: 'After the session', icon: 'dumbbell' };
  const m = card.at;
  if (m < 12 * 60) return { kicker: 'Morning habits', icon: 'pill' };
  if (m < 17 * 60) return { kicker: 'Midday habits', icon: 'pill' };
  return { kicker: 'Evening habits', icon: 'moon' };
}

const itemOf = (t: Tracking | null, id: string | undefined): TrackedItem | undefined => (id ? t?.items.find((x) => x.id === id) : undefined);
const habitName = (habits: HabitsView | null, id: string | undefined) => (id ? (habits?.habits.find((h) => h.id === id)?.name ?? id) : null);

// ---------------------------------------------------------------- the cards

export function cardView(card: DueCard, ctx: CardContext): CardView {
  const date = card.date;
  const day = fmt.dayLong(date);
  const at = hhmm(card.at);
  const manual = ctx.manual === true;
  const F = bodyFmt(ctx.units);
  const skipPeriod = card.skipPeriod ? { label: card.occurrence === 'baseline' ? 'Skip the baseline' : `Skip this ${card.kind === 'tests' ? 'test day' : card.kind === 'photos' ? 'photo day' : 'tape day'}`, next: card.skipPeriod.next ? fmt.wd(card.skipPeriod.next) : null } : null;
  const base = {
    key: card.key,
    kind: card.kind,
    date,
    manual,
    closable: card.closable,
    snooze: manual ? null : snoozeEntries(card.snooze),
    skipPeriod: manual ? null : skipPeriod,
    skip: manual || card.skip === null ? null : card.later ? { label: 'Not today', action: 'later' as const } : { label: card.skip === 'no-more-today' ? 'No more today' : 'Skip today', action: 'skip' as const },
    why: { note: card.reason.note ?? card.reason.title ?? '', rule: card.reason.rule },
    units: F.units,
  };
  const morningAt = ctx.morningAt ?? ctx.tracking?.morning?.at ?? at;
  const since = ctx.since ?? null;
  // Opened by hand and not due: no reminder time, and the body record's parts say when they are next due.
  const nextDue = (part: BodyPart) => {
    const d = ctx.parts?.[part]?.nextDate;
    return d && d > date ? `next due ${fmt.wd(d)}` : d === date ? 'due today' : 'none planned';
  };
  switch (card.kind) {
    case 'morning': {
      const on = morningFrom(ctx.body, date);
      const m = on.values;
      const tape = card.tape ? { text: tapeText(ctx), fields: tapeFields(ctx.body, date, since, F) } : null;
      return {
        ...base,
        icon: tape ? 'tape' : 'clipboard',
        kicker: tape ? 'Morning check-in · tape day' : 'Morning check-in',
        title: day,
        sub: manual ? (tape ? 'The morning numbers, plus the tape' : 'About 30 seconds · feeds today’s readiness') : tape ? `${morningAt} · the morning numbers, plus the tape` : `${morningAt} · about 30 seconds · feeds today’s readiness`,
        primary: 'Save',
        notify: tape ? { title: 'Good morning · tape day', body: 'Weight, sleep, resting HR, steps and floors, plus the tape' } : { title: 'Good morning', body: 'Morning check-in: about 30 seconds' },
        body: {
          kind: 'morning',
          scales: SCALES.map((s) => ({ ...s, value: m[s.key] })),
          fields: MORNING_FIELDS.map((f) => ({ id: f.key, label: f.label, unit: f.key === 'weight' ? F.w : f.unit, hint: f.hint, value: m[f.key] === null ? '' : String(f.key === 'weight' ? F.wt(m[f.key]!) : m[f.key]), placeholder: '' })),
          tape,
          sore: soreAreas(ctx.body, date),
          ill: on.illness,
        },
      };
    }
    case 'tape':
      return {
        ...base,
        icon: 'tape',
        kicker: manual ? 'Tape' : 'Tape day',
        title: day,
        sub: manual ? `${cap(nextDue('tape'))} · waist, hips, chest and arm` : `${morningAt} · waist, hips, chest and arm`,
        primary: 'Save',
        notify: { title: 'Tape day', body: 'Waist, hips, chest and arm' },
        body: { kind: 'tape', tape: { text: tapeText(ctx), fields: tapeFields(ctx.body, date, since, F) } },
      };
    case 'habits': {
      const { kicker, icon } = slotName(card);
      const items: CardHabit[] = card.items.map((id) => {
        const it = itemOf(ctx.tracking, id)!;
        return { id, name: it?.name ?? id, dose: it?.dose ?? (it?.goal ? `${it.goal.amount} ${it.goal.unit}` : null), kind: it?.kind === 'tick' ? 'tick' : 'supplement', note: it?.note ?? null, habit: habitName(ctx.habits, it?.habit), done: it ? dayValue(it, date, { tracking: ctx.tracking, habits: ctx.habits }).done : false };
      });
      return {
        ...base,
        icon,
        kicker,
        title: at,
        sub: `${day} · ${items.length} habit${items.length === 1 ? '' : 's'}`,
        primary: 'Save',
        notify: { title: kicker, body: items.map((x) => (x.kind === 'supplement' && x.dose ? `${x.name} ${x.dose}` : x.name)).join(', ') },
        body: { kind: 'habits', items },
      };
    }
    case 'amount': {
      const it = itemOf(ctx.tracking, card.items[0])!;
      const a = it.amount!;
      const v = dayValue(it, date, { tracking: ctx.tracking, habits: ctx.habits });
      const value = v.value ?? 0;
      const lastAt = v.at ? new Date(v.at) : null;
      const r = it.reminder;
      const next = r?.every ? hhmm(Math.min(24 * 60 - 1, ctx.now.minutes + r.every)) : null;
      const glass = a.unit.toLowerCase() === 'ml' ? 'glass' : 'one';
      return {
        ...base,
        icon: a.unit.toLowerCase() === 'ml' ? 'drop' : 'plus',
        kicker: it.name,
        title: `${n(value)} / ${n(a.target)} ${a.unit}`,
        sub: `${day}${lastAt && v.via === 'pahlavan' ? ` · ${hhmm(ctx.now.minutes + (lastAt.getTime() - ctx.now.ms) / 60_000)} was the last ${glass}` : ''}`,
        primary: 'Done',
        notify: { title: `${it.name}: ${value} / ${a.target} ${a.unit}`, body: a.unit.toLowerCase() === 'ml' ? 'Click to log a glass' : `Click to log ${it.name.toLowerCase()}` },
        body: { kind: 'amount', item: it.id, value, target: a.target, unit: a.unit, quick: a.quick ?? [], next: r?.every && r.to && next! <= r.to ? next : null, placeholder: a.quick?.[0] ? Math.round(a.quick[0] * 1.32) : 0 },
      };
    }
    case 'standup': {
      const it = itemOf(ctx.tracking, card.items[0])!;
      const c = it.standup!;
      const st = ctx.stand?.get(it.id) ?? { ...STAND_FRESH };
      const count = (dayValue(it, date, { tracking: ctx.tracking, habits: ctx.habits }).count ?? 0) + 1;
      const sat = Math.floor(st.satMs / 60_000);
      const standing = st.phase === 'standing' ? { left: Math.max(1, Math.ceil((c.standMinutes * 60_000 - st.stoodMs) / 60_000)), stood: Math.floor(st.stoodMs / 60_000) } : null;
      return {
        ...base,
        icon: 'stand',
        kicker: 'Stand-up',
        title: standing ? 'Standing' : 'Time to stand',
        sub: `${hhmm(ctx.now.minutes)} · stand-up ${count} today`,
        primary: standing ? null : 'I’m standing',
        closable: standing !== null,
        snooze: standing ? null : base.snooze,
        notify: { title: 'Time to stand', body: `You’ve been sitting ${sat} minutes` },
        body: { kind: 'standup', item: it.id, satMinutes: sat, standMinutes: c.standMinutes, standing },
      };
    }
    case 'sitting': {
      const it = itemOf(ctx.tracking, card.items[0])!;
      const c = it.sitting!;
      const today = ctx.sitting?.today ?? { date, minutes: 0, longest: 0, stretches: 0, source: 'none' as const };
      const stretch = card.stretch ? (ctx.sitting?.current?.minutes ?? c.stretchMaxMinutes) : null;
      const left = c.limitMinutes - today.minutes;
      const lead = stretch !== null
        ? `This stretch has run ${stretch} minutes; your longest is ${c.stretchMaxMinutes}. Time away over ${c.awayMinutes} minutes ends it.`
        : `${left > 0 ? `${span(left)} left under` : left === 0 ? 'At' : `${span(-left)} over`} your ${hm(c.limitMinutes)} limit today${today.longest > c.stretchMaxMinutes ? `, and one stretch already ran ${today.longest} minutes (your longest is ${c.stretchMaxMinutes})` : ''}.`;
      const ideas = stretch !== null
        ? [{ icon: 'stand', text: 'Stand up and walk for a minute or two' }, { icon: 'drop', text: 'Refill your water' }, { icon: 'monitor', text: 'Raise the desk for a while' }]
        : [{ icon: 'stand', text: 'Take the next call standing' }, { icon: 'right', text: ctx.now.minutes < 13 * 60 ? 'A 10-minute walk before the afternoon' : 'A 10-minute walk' }, { icon: 'monitor', text: 'Raise the desk for the last hour' }];
      return {
        ...base,
        icon: 'clock',
        kicker: stretch !== null ? 'Sitting time · long stretch' : 'Sitting time',
        title: stretch !== null ? `${stretch} minutes` : `${hm(today.minutes)} of ${hm(c.limitMinutes)}`,
        sub: `${day} · ${hhmm(ctx.now.minutes)}`,
        primary: 'OK',
        notify: stretch !== null ? { title: `Sitting: ${stretch} minutes in one go`, body: 'Time to get up for a few minutes' } : { title: `Sitting: ${hm(today.minutes)} of ${hm(c.limitMinutes)}`, body: left > 0 ? `${span(left)} left under your limit` : 'Over your limit for today' },
        body: { kind: 'sitting', item: it.id, minutes: today.minutes, limit: c.limitMinutes, longest: today.longest, stretchMax: c.stretchMaxMinutes, stretch, lead, ideas },
      };
    }
    case 'desk': {
      const it = itemOf(ctx.tracking, card.items[0])!;
      const r = deskRoutine(it, ctx.program).value;
      const b = card.break ?? { n: 1, of: r.times.length, next: null };
      return {
        ...base,
        icon: 'monitor',
        kicker: manual && !card.break ? 'Desk break' : `Desk break · ${b.n} of ${b.of}`,
        title: `${r.minutes} minutes`,
        sub: manual && !card.break ? `${day} · ${r.times.length} planned today` : `${day} · ${at}${b.next ? ` · next at ${b.next}` : ' · the last one today'}`,
        primary: 'Done',
        notify: { title: `Desk break: ${r.minutes} minutes`, body: r.steps.map((s) => s.name).join(', ') },
        body: { kind: 'desk', item: it.id, steps: r.steps.map((s) => ({ name: s.name, dose: s.dose, how: s.how ?? null })) },
      };
    }
    case 'photos': {
      const list = isObj(ctx.body) && Array.isArray(ctx.body['photos']) ? (ctx.body['photos'] as unknown[]).filter(isObj).filter((e) => inCycle(e, since)).map((e) => String(e['date'])).filter((d) => d < date).sort() : [];
      return {
        ...base,
        icon: 'camera',
        kicker: manual ? 'Progress photos' : 'Photo day',
        title: day,
        sub: manual ? `${cap(nextDue('photos'))} · front, side, back and the posture close-up` : 'Front, side, back and the posture close-up',
        primary: 'Save photos',
        notify: { title: 'Photo day', body: 'Front, side, back and the posture close-up' },
        body: { kind: 'photos', poses: [{ id: 'front', name: 'Front' }, { id: 'side', name: 'Side' }, { id: 'back', name: 'Back' }, { id: 'posture-closeup', name: 'Posture close-up' }], last: list.at(-1) ?? null },
      };
    }
    case 'tests':
      return {
        ...base,
        icon: 'flag',
        kicker: card.occurrence === 'baseline' ? 'Fitness tests · baseline' : 'Fitness tests',
        title: day,
        sub: card.occurrence === 'baseline' ? 'This cycle’s first: where you start from' : manual ? `${cap(nextDue('tests'))} · leave any you can’t do blank` : testsSub(card, ctx.program),
        primary: 'Save',
        notify: { title: 'Fitness tests', body: 'Push-ups, pull-ups, holds and the wall test' },
        body: { kind: 'tests', fields: testFields(ctx.body, date, since, F) },
      };
    case 'train': {
      const workout = ctx.habits?.habits.some((h) => h.id === 'workout') ?? false;
      return {
        ...base,
        icon: 'dumbbell',
        kicker: 'Did you train today?',
        title: day,
        sub: `${at} · only when nothing is logged by then`,
        primary: null,
        notify: { title: 'Did you train today?', body: `Nothing logged for ${day.split(' ')[0]} yet` },
        body: { kind: 'train', lead: `Nothing is logged for ${day}${workout ? ', and the Workout habit isn’t ticked' : ''}.`, session: ctx.session ? clean(ctx.session) : null },
      };
    }
    case 'coach': {
      const c = card.coach!;
      const late = c.state === 'late';
      return {
        ...base,
        icon: 'mail',
        kicker: late ? 'Ask the coach · still to do' : 'Ask the coach',
        title: c.title,
        sub: late ? `For the check-in of ${fmt.wd(c.date)} · no letter yet` : `${day} · your answers are saved`,
        primary: 'OK',
        notify: { title: `Ask the coach: ${c.title}`, body: `Run ${c.command} in Claude Code` },
        body: { kind: 'coach', lead: c.line, command: c.command },
      };
    }
  }
}

/** The tape section's line: how often, "every second Sunday, from your plan" or "every 14 days from Wed 30 Sep". */
function tapeText(ctx: CardContext): string {
  const sch = ctx.parts?.tape?.schedule;
  if (!sch) return '';
  const t = sch.text ? sch.text[0]!.toLowerCase() + sch.text.slice(1) : '';
  return sch.source === 'plan' ? `${t}, from your plan` : t;
}

/**
 * "End of Foundation · in the light week, so you test fresh" from the plan;
 * "Plan week 6 · the plan’s own test week" for a test week the plan lists
 * (rules.tests) that is not a phase end in its light week; else how often.
 */
function testsSub(card: DueCard, program: CardContext['program']): string {
  const occ = typeof card.occurrence === 'string' && card.occurrence !== 'baseline' ? card.occurrence : card.date;
  const phase = program?.macrocycle.phases.find((p) => p.mesocycles.some((m) => m.weeks.some((w) => w.start <= occ && occ < addDaysIso(w.start, 7))));
  if (!phase || !program) return 'After the warm-up on a short day; leave any you can’t do blank';
  if (listedTestWeeks(program)) {
    // The plan's weeks in order, each with whether it ends its phase (the last week of the phase's last mesocycle).
    const weeks = program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m, mi) => m.weeks.map((w, wi) => ({ w, phaseEnd: mi === p.mesocycles.length - 1 && wi === m.weeks.length - 1 }))));
    const i = weeks.findIndex(({ w }) => w.start <= occ && occ < addDaysIso(w.start, 7));
    const at = weeks[i];
    if (at && !(at.phaseEnd && at.w.kind === 'deload')) return `Plan week ${i + 1} · the plan’s own test week`;
  }
  return `End of ${clean(phase.name)} · in the light week, so you test fresh`;
}

function addDaysIso(d: IsoDate, k: number): IsoDate {
  const t = new Date(`${d}T00:00:00Z`).getTime() + k * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
