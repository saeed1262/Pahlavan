// The one-time "Bring over from Habit Nudges" offer: what Habit Nudges
// tracks today (its data.json settings and the linked habits it asks
// about, in habits-data.json) as proposed tracked items, each linked to its
// linked habit so its history feeds the stats. Pure: the caller reads both
// files. The user ticks what to bring over; nothing here writes.
//
// Habit Nudges keeps the word cards, the plan reminders, reading, flashcards
// and the work timer; the Workout habit stays with session logging.

import { toMinutes } from './clock.ts';
import { NUDGES_DESK_TIMING, WORKDAYS } from './desk-breaks.ts';
import { explain, type Result } from './reason.ts';
import type { BodyRecordSchedule, IsoDate, MorningReminder, TrackedItem, Weekday } from './schema.ts';
import { firstHabitDay, habitsView, type HabitsView } from './tracking.ts';


/** Habit Nudges' defaults, for settings its data.json leaves out (its DEFAULT_SETTINGS). */
const HN_DEFAULTS = {
  times: { morning: '09:00', evening: '20:00', last: '21:30' },
  water: { habit: 'water', every: 120, start: '09:00', end: '21:00', amounts: [250, 500] },
  desk: { on: true, every: 90, start: '10:00', end: '15:00', weekdays: true },
  body: { on: true, start: '06:00', end: '21:00', measureFrom: '2026-09-30', measureEvery: 14, testsFrom: '2026-10-21', testsEvery: 28 },
  stand: { on: true, sitMinutes: 45, standMinutes: 20, snoozeMinutes: 10, awayMinutes: 30, standAwayMinutes: 5, activeSeconds: 120, habit: 'stand' },
  deskTime: { on: true, idleMinutes: 10, weekends: true, goalHours: 8 },
};

/** Supplements Pahlavan recognises by the habit's name. */
const SUPPLEMENTS = /creatine|multi ?vitamin|magnesium|fish ?oil|omega|vitamin|zinc|iron|calcium|electrolyte/i;
/** Ticks Pahlavan recognises by the habit's name: health habits without a dose. */
const TICKS = /floss|skin|teeth|stretch|sunscreen|lights? out|bed ?time|meditat|walk/i;

/** "Water (mL)" → { label: "Water", unit: "mL" } (Habit Nudges' splitName). */
export function splitName(name: string): { label: string; unit: string } {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name || '');
  if (!m) return { label: name || '', unit: '' };
  const unit = ({ minutes: 'min', minute: 'min', hours: 'h', hour: 'h' } as Record<string, string>)[m[2]!.toLowerCase()] ?? m[2]!;
  return { label: m[1]!, unit };
}

/** One proposed item: offered ticked, with a line of detail and its linked habit. */
export interface BringOverItem {
  item: TrackedItem;
  detail: string;
  /** The linked habit it stays linked to (its name). */
  habitName: string | null;
  /** Ticked when the offer opens. */
  checked: boolean;
}

export interface BringOver {
  items: BringOverItem[];
  /** Homepage habits that stay where they are, and why. */
  left: { habit: string; name: string; why: string }[];
  /** The body record's schedule, continuing Habit Nudges' dates. */
  bodyRecord: BodyRecordSchedule;
  /** The morning check-in at Habit Nudges' body-card time. */
  morning: MorningReminder;
}

export interface BringOverInput {
  /** Habit Nudges' data.json, parsed (null: only its defaults). */
  settings: unknown;
  /** habits-data.json, parsed. */
  habits: unknown;
  today: IsoDate;
  /** The eating plan's protein target in grams a day, for the protein item. */
  proteinG?: number | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
const time = (v: unknown, d: string) => {
  const m = toMinutes(typeof v === 'string' ? v : null);
  return m === null ? d : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const date = (v: unknown, d: string) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d);
const slug = (name: string) => name.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';

/** Habit Nudges' settings over its defaults, as it loads them. */
function settingsOf(raw: unknown) {
  const d = isObj(raw) ? raw : {};
  const sec = <K extends keyof typeof HN_DEFAULTS>(k: K) => ({ ...HN_DEFAULTS[k], ...(isObj(d[k]) ? (d[k]) : {}) }) as (typeof HN_DEFAULTS)[K] & Obj;
  const assign = isObj(d['assign']) ? (d['assign'] as Record<string, unknown>) : {};
  return { times: sec('times'), water: sec('water'), desk: sec('desk'), body: sec('body'), stand: sec('stand'), deskTime: sec('deskTime'), assign };
}

/**
 * The offer: water, stand-ups, desk breaks and sitting time from Habit
 * Nudges' settings; supplements and health ticks from the linked habits
 * it asks about; protein as one tick with the day's gram target, ticked in
 * the evening when hit. Each item starts on its habit's first tick (so its
 * history counts) and is "Added by you, from Habit Nudges".
 */
export function bringOverFromNudges(input: BringOverInput): Result<BringOver> {
  const s = settingsOf(input.settings);
  const hv: HabitsView = habitsView(input.habits) ?? { habits: [], checkins: {} };
  const source = { by: 'user' as const, from: 'Habit Nudges', on: input.today };
  const startOf = (habit: string | null) => (habit ? (firstHabitDay(hv, habit) ?? input.today) : input.today);
  const items: BringOverItem[] = [];
  const left: BringOver['left'] = [];
  const used = new Set<string>();
  const uniq = (id: string) => {
    let x = id;
    for (let i = 2; used.has(x); i++) x = `${id}-${i}`;
    used.add(x);
    return x;
  };
  const habitOf = (id: string) => hv.habits.find((h) => h.id === id) ?? null;
  const daily = { kind: 'daily' as const };

  // Water: Habit Nudges' water card over the water habit.
  const wHabit = habitOf(String(s.water['habit'] ?? 'water'));
  if (wHabit) {
    const { label, unit } = splitName(wHabit.name ?? 'Water');
    const target = num(wHabit.max, 2000);
    const every = num(s.water['every'], 120);
    const from = time(s.water['start'], '09:00');
    const to = time(s.water['end'], '21:00');
    const quick = Array.isArray(s.water['amounts']) ? (s.water['amounts'] as unknown[]).filter((x): x is number => typeof x === 'number' && x > 0) : [];
    items.push({
      item: { id: uniq(slug(label)), kind: 'amount', name: label, schedule: daily, start: startOf(wHabit.id), source, when: 'day', reminder: { every, from, to }, habit: wHabit.id, amount: { target, unit: unit || 'mL', ...(quick.length ? { quick } : {}) } },
      detail: `${target} ${unit || 'mL'}, a card every ${every % 60 === 0 ? `${every / 60} h` : `${every} min`} from ${from} to ${to}`,
      habitName: wHabit.name ?? null,
      checked: true,
    });
  }

  // Stand-ups: Habit Nudges' stand settings over the stand habit.
  if (s.stand['on'] !== false) {
    const sHabit = habitOf(String(s.stand['habit'] ?? 'stand'));
    const st = s.stand;
    const sit = num(st['sitMinutes'], 45);
    const stand = num(st['standMinutes'], 20);
    items.push({
      item: {
        id: uniq('stand-ups'),
        kind: 'standup',
        name: 'Stand-ups',
        schedule: daily,
        start: startOf(sHabit?.id ?? null),
        source,
        ...(sHabit ? { habit: sHabit.id } : {}),
        standup: {
          sitMinutes: sit,
          standMinutes: stand,
          snoozeMinutes: num(st['snoozeMinutes'], 10),
          targetMinutes: num(sHabit?.max, stand * 3),
          pauseCalls: false,
          activeOnly: true,
          activeSeconds: num(st['activeSeconds'], 120),
          awayMinutes: num(st['awayMinutes'], 30),
          standAwayMinutes: num(st['standAwayMinutes'], 5),
        },
      },
      detail: `stand ${stand} min after ${sit} of active sitting`,
      habitName: sHabit?.name ?? null,
      checked: true,
    });
  }

  // Desk breaks: the plan's routine on Habit Nudges' timing.
  if (s.desk['on'] !== false) {
    const every = num(s.desk['every'], NUDGES_DESK_TIMING.every);
    const from = time(s.desk['start'], NUDGES_DESK_TIMING.from);
    const to = time(s.desk['end'], NUDGES_DESK_TIMING.to);
    const weekdays = s.desk['weekdays'] !== false;
    items.push({
      item: { id: uniq('desk-breaks'), kind: 'desk', name: 'Desk breaks', schedule: weekdays ? { kind: 'weekdays', days: [...WORKDAYS] } : daily, start: input.today, source, desk: { followPlan: true, every, from, to, minutes: NUDGES_DESK_TIMING.minutes } },
      detail: `${NUDGES_DESK_TIMING.minutes}-minute routine every ${every} min, ${from} to ${to}${weekdays ? ', weekdays' : ''}`,
      habitName: null,
      checked: true,
    });
  }

  // Sitting time: counted from activity as desk time was; the limits are new.
  if (s.deskTime['on'] !== false) {
    const weekends = s.deskTime['weekends'] !== false;
    items.push({
      item: {
        id: uniq('sitting'),
        kind: 'sitting',
        name: 'Sitting time',
        schedule: weekends ? daily : { kind: 'weekdays', days: [...WORKDAYS] as Weekday[] },
        start: input.today,
        source,
        reminder: { atMinutes: 330, stretch: true },
        sitting: { limitMinutes: 360, stretchMaxMinutes: 45, awayMinutes: num(s.deskTime['idleMinutes'], 10) },
        note: 'Counted from keyboard and mouse. The history before Pahlavan is Habit Nudges\' desk time.',
      },
      detail: 'desk time\'s history feeds the stats; the work timer stays in Habit Nudges',
      habitName: null,
      checked: true,
    });
  }

  // The linked habits Habit Nudges asks about.
  const times = s.times as Record<string, string>;
  const slotOf = (id: string) => {
    const g = typeof s.assign[id] === 'string' ? String(s.assign[id]) : 'last';
    return { group: g, at: time(times[g], g === 'morning' ? '09:00' : g === 'evening' ? '20:00' : '21:30') };
  };
  const word = (g: string) => (g === 'morning' ? 'morning card' : g === 'evening' ? 'evening card' : 'last check of the day');
  for (const h of hv.habits) {
    const name = h.name ?? h.id;
    if (h.id === wHabit?.id || h.id === String(s.stand['habit'] ?? 'stand')) continue;
    if ((h as Obj)['source'] === 'timer') {
      left.push({ habit: h.id, name, why: 'Filled in by the work timer; it stays in Habit Nudges.' });
      continue;
    }
    if (h.id === 'workout' || /^workout$/i.test(name)) {
      left.push({ habit: h.id, name, why: 'Ticked when a session is logged.' });
      continue;
    }
    if (/^protein$/i.test(name) || h.id === 'protein') {
      const g = input.proteinG && input.proteinG > 0 ? Math.round(input.proteinG) : null;
      const at = time(times['evening'], '20:00');
      items.push({
        item: { id: uniq('protein'), kind: 'tick', name: 'Protein', schedule: daily, start: startOf(h.id), source, when: 'evening', reminder: { at }, habit: h.id, ...(g ? { goal: { amount: g, unit: 'g' }, means: `At least ${g} g of protein` } : { means: 'Your protein target reached' }) },
        detail: `${g ? `${g} g a day, ` : ''}ticked in the evening when hit (${at}); the Sunday check-in counts these days`,
        habitName: name,
        checked: true,
      });
      continue;
    }
    const isSupp = SUPPLEMENTS.test(name);
    const isTick = !isSupp && TICKS.test(name);
    if (!isSupp && !isTick) {
      left.push({ habit: h.id, name, why: /read|flash|card|word/i.test(name) ? 'Not a health habit: it stays in Habit Nudges.' : 'Not one Pahlavan recognises; add it in Habits if you want it tracked here.' });
      continue;
    }
    const { group, at } = slotOf(h.id);
    const when = group === 'morning' ? 'morning' : 'evening';
    items.push({
      item: { id: uniq(slug(name)), kind: isSupp ? 'supplement' : 'tick', name, schedule: daily, start: startOf(h.id), source, when, reminder: { at }, habit: h.id },
      detail: `${word(group)}, ${at}`,
      habitName: name,
      checked: true,
    });
  }

  const b = s.body;
  const bodyRecord: BodyRecordSchedule = {
    schedule: 'fixed',
    tapeFrom: date(b['measureFrom'], HN_DEFAULTS.body.measureFrom),
    tapeEvery: num(b['measureEvery'], 14),
    testsFrom: date(b['testsFrom'], HN_DEFAULTS.body.testsFrom),
    testsEvery: num(b['testsEvery'], 28),
  };
  const morning: MorningReminder = { on: b['on'] !== false, at: time(b['start'], '06:00') };
  return explain<BringOver>({ items, left, bodyRecord, morning }, 'habits.import', { habits: hv.habits.length, offered: items.length, left: left.length, settings: isObj(input.settings) }, {
    note: `${items.length} items to bring over (${items.map((x) => x.item.name).join(', ')}); ${left.length} habits stay where they are. The tape and photos every ${bodyRecord.tapeEvery} days from ${bodyRecord.tapeFrom} and the tests every ${bodyRecord.testsEvery} from ${bodyRecord.testsFrom} continue Habit Nudges' dates.`,
  });
}
