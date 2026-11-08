// How long a plan session takes, from its items as plan-data writes them,
// timed the way the plan generator times its sessions (core/plan/dose.ts):
// the warm-up, then each item's work and the rest after it. A cardio or
// other timed item gives its own minutes ("20 min"), intervals their
// warm-up, rounds of work, the easy minutes between and cool-down (the
// item's `timed`, else the intervals its note describes); a set takes its own
// time (half a minute of reps, a hold's seconds at the low end of its
// range, both sides of a "/side" or "/leg" item) and the item's rest (the
// low end of "2–3 min" or "60–90 s", as the generator's time budget counts
// 2-3 min; 90 s when it gives none); a superset round is a set of each and
// the pair's one rest. And the time check: each session against the day's
// length the profile gives, lifting days `minutesPerSession`, short days
// `shortSessions.minutes`, an estimate over it flagged with its reason.
// Pure.

import { itemTimed } from './plan-data.ts';
import { DOSE, REST } from './plan/dose.ts';
import { explain, joinNotes, type Result } from './reason.ts';
import type { Profile } from './schema.ts';
import { isIntervals, timedMinutes, timedText } from './timed.ts';

/** A plan item as the estimate reads it: plan-data's `sr`, `rest`, `pair`, and for a timed item its `timed` and `note`. */
export interface TimedItem {
  name: string;
  sr: string;
  rest?: string | null;
  pair?: boolean;
  note?: string;
  timed?: unknown;
}

export interface ItemMinutes {
  name: string;
  minutes: number;
  /** How it was counted, in words: "20 min", "3 × (30 s + 60 s rest)", "4 × 4 min hard, 3 min easy between". */
  how: string;
  /** A timed item (its own minutes), not sets with their rests. */
  timed?: true;
}

export interface SessionMinutes {
  /** The whole session, rounded to the minute. */
  minutes: number;
  warmup: number;
  items: ItemMinutes[];
  /** Items whose sets and reps say nothing to time ("as written"): counted as nothing. */
  untimed: string[];
}

export const TIME = {
  /** The dashboard's checklist line for the warm-up, when the plan's warm-up gives no minutes of its own. */
  warmup: { lift: 6, short: 3 },
} as const;

const r2 = (v: number) => Math.round(v * 100) / 100;
const lowEnd = (m: RegExpExecArray) => Number(m[1]);

/** A plan item's rest in minutes (the low end of a range), and whether it comes after each superset pair; null when it gives none ("—", "as needed"). */
export function restMinutes(rest: string | null | undefined): { minutes: number; pair: boolean } | null {
  const s = String(rest ?? '');
  const pair = /after each pair/i.test(s);
  const min = /(\d+(?:\.\d+)?)(?:\s*[–-]\s*\d+(?:\.\d+)?)?\s*min\b/.exec(s);
  if (min) return { minutes: lowEnd(min), pair };
  const sec = /(\d+)(?:\s*[–-]\s*\d+)?\s*s\b/.exec(s);
  return sec ? { minutes: lowEnd(sec) / 60, pair } : null;
}

/** One set's own time, minutes: a hold's seconds (or minutes), else half a minute of reps; both sides for "/side" or "/leg". */
function workOf(spec: string): { minutes: number; text: string } {
  const sides = /\/(side|leg|arm)\b|each side|per side/i.test(spec) ? 2 : 1;
  const sec = /(\d+)(?:\s*[–-]\s*\d+)?\s*s\b/.exec(spec);
  const min = /(\d+(?:\.\d+)?)(?:\s*[–-]\s*\d+(?:\.\d+)?)?\s*min\b/.exec(spec);
  const one = sec ? lowEnd(sec) / 60 : min ? lowEnd(min) : DOSE.workMinutes;
  const secs = Math.round(one * sides * 60);
  return { minutes: one * sides, text: `${secs} s${sides === 2 ? ', both sides' : ''}` };
}

/** The moves of a circuit, from its name ("Circuit: squat jump · burpee" has 2); 1 when it names none. */
const movesOf = (name: string) => Math.max(1, (name.split(':').at(-1) ?? name).split(/\s+·\s+|\s+\+\s+/).length);

/**
 * An item's sets and one set's time, or its own minutes (`how` for
 * intervals: their structure in words); null when nothing in it says a
 * time. `rested`: the time on and off already holds the rest.
 */
function parseItem(item: TimedItem): { sets: number; work: { minutes: number; text: string }; rested?: boolean } | { minutes: number; how?: string } | null {
  // A timed item: its `timed` field, else its sr's minutes and the intervals its note describes.
  const t = itemTimed(item);
  const total = timedMinutes(t);
  if (t && total !== null) return isIntervals(t) ? { minutes: total, how: timedText(t).replace(/ · about [\d.]+ min$/, '') } : { minutes: total };
  const sr = item.sr;
  const name = item.name;
  const s = String(sr ?? '');
  const sets = /^(\d+)\s*[×x]\s*(.*)$/.exec(s.trim());
  if (sets) return { sets: Number(sets[1]), work: workOf(sets[2]!) };
  const rounds = /(\d+)\s*rounds?\b(.*)$/i.exec(s);
  if (rounds) {
    // "4 rounds, 40/20": each move 40 s on and 20 s off, the moves from the name; "2 rounds": half a minute a move.
    const moves = movesOf(name);
    const onOff = /(\d+)\s*\/\s*(\d+)/.exec(rounds[2]!);
    const each = moves > 1 ? ` × ${moves} moves` : '';
    return onOff
      ? { sets: Number(rounds[1]), work: { minutes: (moves * (Number(onOff[1]) + Number(onOff[2]))) / 60, text: `${onOff[1]}/${onOff[2]} s${each}` }, rested: true }
      : { sets: Number(rounds[1]), work: { minutes: moves * DOSE.workMinutes, text: `${Math.round(moves * DOSE.workMinutes * 60)} s${each}` } };
  }
  const named = /(\d+)\s*(?:working\s+)?sets?\b/i.exec(s);
  if (named) return { sets: Number(named[1]), work: workOf(s) };
  const min = /(\d+(?:\.\d+)?)(?:\s*[–-]\s*\d+(?:\.\d+)?)?\s*min\b/.exec(s);
  return min ? { minutes: lowEnd(min) } : null;
}

const secText = (m: number) => `${Math.round(m * 60)} s`;

/**
 * A session's minutes from its items, in their order: the warm-up (the
 * plan's own minutes when its text starts with them, else the dashboard's
 * checklist line: 6 on a lifting day, 3 on a short one), each timed item's
 * minutes, and each set's work and rest; a superset (an item with `pair`
 * after another) as rounds of a set of each and one rest.
 */
export function sessionMinutes(input: { items: readonly TimedItem[]; warmup: string | null; kind: 'lift' | 'short' }): Result<SessionMinutes> {
  const own = /^\s*(\d+(?:\.\d+)?)(?:\s*[–-]\s*\d+(?:\.\d+)?)?\s*min\b/.exec(input.warmup ?? '');
  const warmup = own ? lowEnd(own) : TIME.warmup[input.kind];
  const items: ItemMinutes[] = [];
  const untimed: string[] = [];
  const list = input.items;
  for (let i = 0; i < list.length; i++) {
    const it = list[i]!;
    const p = parseItem(it);
    if (!p) {
      untimed.push(it.name);
      continue;
    }
    if ('minutes' in p) {
      items.push({ name: it.name, minutes: p.minutes, how: p.how ?? `${p.minutes} min`, timed: true });
      continue;
    }
    if (p.rested) {
      // A circuit timed on and off: its rounds hold their rest.
      items.push({ name: it.name, minutes: r2(p.sets * p.work.minutes), how: `${p.sets} rounds × (${p.work.text})` });
      continue;
    }
    const next = list[i + 1];
    const q = next?.pair ? parseItem(next) : null;
    const restOf = (x: TimedItem) => restMinutes(x.rest)?.minutes ?? REST.sets.minutes;
    if (next && q && 'sets' in q) {
      // A superset: rounds of a set of each and the pair's one rest; a partner's extra sets on their own.
      const rest = restMinutes(next.rest)?.minutes ?? restMinutes(it.rest)?.minutes ?? REST.pair.minutes;
      const rounds = Math.min(p.sets, q.sets);
      const extra = (p.sets - rounds) * (p.work.minutes + restOf(it)) + (q.sets - rounds) * (q.work.minutes + restOf(next));
      items.push({ name: `${it.name} + ${next.name}`, minutes: r2(rounds * (p.work.minutes + q.work.minutes + rest) + extra), how: `superset: ${rounds} × (${p.work.text} + ${q.work.text} + ${secText(rest)} rest)${extra ? ', and the extra sets' : ''}` });
      i++;
      continue;
    }
    const rest = restOf(it);
    items.push({ name: it.name, minutes: r2(p.sets * (p.work.minutes + rest)), how: `${p.sets} × (${p.work.text} + ${secText(rest)} rest)` });
  }
  const total = Math.round(warmup + items.reduce((a, x) => a + x.minutes, 0));
  const timed = items.filter((x) => x.timed);
  const sets = items.filter((x) => !timed.includes(x));
  return explain<SessionMinutes>({ minutes: total, warmup, items, untimed }, 'time.estimate', { kind: input.kind, items: list.length, warmup: own ? input.warmup : null }, {
    threshold: { workMinutes: DOSE.workMinutes, restWhenNone: REST.sets.minutes, warmup: TIME.warmup },
    note: joinNotes(
      `About ${total} min: a ${warmup}-min warm-up${timed.length ? `, ${timed.map((x) => `${x.minutes} min of ${x.name}${x.how === `${x.minutes} min` ? '' : ` (${x.how})`}`).join(', ')}` : ''}${sets.length ? `, and ${r2(sets.reduce((a, x) => a + x.minutes, 0))} min of sets with their rests` : ''}.`,
      'Each set counts its own time (half a minute of reps, a hold’s seconds at the low end, both sides) and the rest after it, the low end of a range, as the plan generator times a session; set-up and walking between stations are not counted.',
      untimed.length > 0 && `Not timed: ${untimed.join(', ')} (its sets and reps give no time).`,
    ),
  });
}

export interface TimeCheckRow {
  type: string;
  name: string;
  kind: 'lift' | 'short';
  minutes: number;
  /** The day's length from the profile; null without a profile. */
  limit: number | null;
  /** Minutes over the limit; 0 when it fits, null without a limit. */
  over: number | null;
}

/** A day's length from the profile: lifting days `minutesPerSession`, short days `shortSessions.minutes` (else the same). */
export function dayLength(availability: Profile['availability'] | null | undefined, kind: 'lift' | 'short'): number | null {
  if (!availability) return null;
  return kind === 'short' ? (availability.shortSessions?.minutes ?? availability.minutesPerSession) : availability.minutesPerSession;
}

/** Each plan session's estimate against its day's length: over it is flagged, with the parts that take the time. */
export function timeCheck(sessions: readonly { type: string; name: string; kind: 'lift' | 'short'; estimate: Result<SessionMinutes> }[], availability: Profile['availability'] | null | undefined): Result<TimeCheckRow>[] {
  return sessions.map((s) => {
    const limit = dayLength(availability, s.kind);
    const minutes = s.estimate.value.minutes;
    const over = limit === null ? null : Math.max(0, minutes - limit);
    const day = s.kind === 'short' ? (availability?.shortSessions ? 'short days' : 'sessions') : 'lifting days';
    const biggest = [...s.estimate.value.items].sort((a, b) => b.minutes - a.minutes)[0];
    return explain<TimeCheckRow>({ type: s.type, name: s.name, kind: s.kind, minutes, limit, over }, 'time.check', { type: s.type, kind: s.kind, minutes, limit, source: s.kind === 'short' && availability?.shortSessions ? 'availability.shortSessions.minutes' : 'availability.minutesPerSession' }, {
      threshold: limit === null ? undefined : { minutes: limit },
      note: limit === null
        ? `${s.type} (${s.name}): about ${minutes} min. No profile, so no day length to check it against.`
        : over
          ? `${s.type} (${s.name}) takes about ${minutes} min, ${over} min over your ${limit}-minute ${day}${biggest ? `; ${biggest.name} is the longest part, ${biggest.minutes} min` : ''}. Shorten it, or plan the day longer.`
          : `${s.type} (${s.name}) takes about ${minutes} min: it fits your ${limit}-minute ${day}.`,
    });
  });
}
