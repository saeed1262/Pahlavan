// Steps 5 and 6: reps, RIR and starting sets for each slot, the time budget,
// and the progression rule each slot carries for progression.ts.

import type { CatalogueEntry, Pattern } from '../data/exercises.ts';
import { LADDER_BY_ID, type LadderLevel } from '../data/ladders.ts';
import { explain, joinNotes, type Result } from '../reason.ts';
import type { RepRange, SlotProgression } from '../schema.ts';
import { incrementFor, type PlanContext } from './context.ts';
import type { LadderId } from './self-check.ts';
import type { Blueprint, Role } from './template.ts';

/** A slot on a calisthenics ladder: which ladder, the level it starts at, and that level. */
export interface LadderSlot {
  id: LadderId;
  level: number;
  info: LadderLevel;
}

/**
 * The ladder a movement starts on, from the self-check: the movement is the
 * tested level's own (5 strict pull-ups: level 6, pull-ups). Null otherwise.
 */
export function ladderFor(ctx: PlanContext, e: CatalogueEntry): LadderSlot | null {
  for (const r of ctx.selfCheck.ladders) {
    const st = r.value;
    if (st.level === null || st.exercise !== e.id) continue;
    return { id: st.id, level: st.level, info: LADDER_BY_ID.get(st.id)!.levels[st.level - 1]! };
  }
  return null;
}

export const DOSE = {
  warmUpMinutes: 8,
  finisherMinutes: 8,
  /** A set's own time (the work, not the rest after it), minutes. */
  workMinutes: 0.5,
  /** Minimum-dose templates: a shorter warm-up, and their accessories always as supersets (rules.md, the minimum week). */
  minimumDose: { warmUpMinutes: 5 },
  /** A light day's RIR on top (the short weeks' light full-body day): RIR 4 or more is not hard work (concurrent.ts), so it can sit between harder days. */
  lightRirAdd: 3,
  maxSets: 4,
  minSets: 2,
  /** Main lifts keep at least 3 working sets, except in minimum-dose templates. */
  minMainSets: 3,
  calibrationRir: 3,
  seniorRir: 4,
} as const;

const ISOLATION: ReadonlySet<Pattern> = new Set(['biceps', 'triceps', 'lateral-raise', 'rear-delt', 'calves', 'neck-upper-back']);
const CORE: ReadonlySet<Pattern> = new Set(['core-anti-extension', 'core-anti-rotation', 'core-flexion']);

export interface BuiltSlot {
  entry: CatalogueEntry;
  role: Role;
  fixed: boolean;
  /** Ranked first by an emphasis or a modifier: not rotated. */
  pinned: boolean;
  slotIndex: number;
  sets: number;
  repRange: RepRange;
  rir: number;
  progression?: SlotProgression;
  note: string;
  /** Done as a superset with the slot before it (plan-data's `pair`): a set of each, then rest. */
  pair?: boolean;
}

/**
 * Rest between sets (rules.md, "Load, rest, order and range of motion"): at
 * least 90 s between sets, since past 90 s size gains show no clear
 * difference; 2-3 min on heavy compound lifts; a superset of non-competing
 * muscles, when time is the limit, rests 90 s after each pair. `minutes` is
 * what the time budget counts (the low end of 2-3 min).
 */
export const REST = {
  heavy: { text: '2-3 min', minutes: 2 },
  sets: { text: '90 s', minutes: 1.5 },
  pair: { text: '90 s after each pair', minutes: 1.5 },
} as const;

export type RestKind = 'heavy' | 'sets';

/**
 * Heavy compound lifts rest 2-3 min: a main lift (a lighter or volume day's
 * variation at 10 reps or more is not heavy), or a compound accessory at 6
 * reps or fewer (strength work). Everything else, holds included, rests 90 s.
 */
export function restKind(e: CatalogueEntry, role: Role, reps: RepRange): RestKind {
  const compound = e.load !== 'timed' && e.load !== 'cardio' && !ISOLATION.has(e.pattern) && !CORE.has(e.pattern) && e.pattern !== 'skill' && e.pattern !== 'carry';
  if (compound && (role === 'main' ? reps[0] < 10 : reps[0] <= 6)) return 'heavy';
  return 'sets';
}

/** "Rest 2-3 min." or "Rest 90 s.", the slot's rest as the note's first sentence (the exporter's `rest`). */
export function restNote(e: CatalogueEntry, role: Role, reps: RepRange): string {
  return `Rest ${REST[restKind(e, role, reps)].text}.`;
}

export interface BuiltTemplate {
  blueprint: Blueprint;
  minimumDose: boolean;
  slots: BuiltSlot[];
  finisher: string | null;
  /** Minutes available for working sets. */
  capacity: number;
}

export function minSetsFor(t: BuiltTemplate, s: BuiltSlot): number {
  return s.role === 'main' && !t.minimumDose ? DOSE.minMainSets : DOSE.minSets;
}

/** One straight set and the rest after it, minutes. */
export function minutesPerSet(s: BuiltSlot): number {
  return DOSE.workMinutes + REST[restKind(s.entry, s.role, s.repRange)].minutes;
}

export function warmUpMinutes(minimumDose: boolean): number {
  return minimumDose ? DOSE.minimumDose.warmUpMinutes : DOSE.warmUpMinutes;
}

/**
 * The working sets' minutes, rests included. A superset round is a set of
 * each and one rest (90 s after each pair); a partner's extra sets are done
 * on their own.
 */
export function setMinutes(t: BuiltTemplate): number {
  let total = 0;
  t.slots.forEach((s, i) => {
    if (s.pair && i > 0) return;
    const next = t.slots[i + 1];
    if (next?.pair) {
      const rounds = Math.min(s.sets, next.sets);
      total += rounds * (2 * DOSE.workMinutes + REST.pair.minutes) + (s.sets - rounds) * minutesPerSet(s) + (next.sets - rounds) * minutesPerSet(next);
    } else total += s.sets * minutesPerSet(s);
  });
  return total;
}

/** Two slots that work the same muscles (one's main muscle is the other's main or helping one) compete: no superset. */
export function competing(a: CatalogueEntry, b: CatalogueEntry): boolean {
  const all = (e: CatalogueEntry) => [...e.muscles.main, ...e.muscles.helps];
  return a.muscles.main.some((m) => all(b).includes(m)) || b.muscles.main.some((m) => all(a).includes(m));
}

const pairable = (s: BuiltSlot) => s.role === 'accessory' && s.entry.load !== 'cardio';

/**
 * Pairs two accessories of non-competing muscles as a superset, the latest
 * first: two neighbours when they can, else the later one moves up beside the
 * nearest earlier one it does not compete with. False when no pair is left.
 */
export function pairOnce(slots: BuiltSlot[]): boolean {
  const free = (i: number) => pairable(slots[i]!) && !slots[i]!.pair && !slots[i + 1]?.pair;
  for (let k = slots.length - 1; k > 0; k--) {
    if (free(k) && free(k - 1) && !competing(slots[k - 1]!.entry, slots[k]!.entry)) {
      slots[k]!.pair = true;
      return true;
    }
  }
  for (let k = slots.length - 1; k > 0; k--) {
    if (!free(k)) continue;
    for (let j = k - 2; j >= 0; j--) {
      if (!free(j) || competing(slots[j]!.entry, slots[k]!.entry)) continue;
      const [moved] = slots.splice(k, 1);
      slots.splice(j + 1, 0, { ...moved!, pair: true });
      return true;
    }
  }
  return false;
}

/** Takes a slot out of the session; the partner of a superset stays, as straight sets. */
export function dropSlot(slots: BuiltSlot[], s: BuiltSlot): void {
  const at = slots.indexOf(s);
  if (at < 0) return;
  slots.splice(at, 1);
  const next = slots[at];
  if (!s.pair && next?.pair) {
    const { pair: _drop, ...straight } = next;
    slots[at] = straight;
  }
}

/** A paired slot's note: the pair's rest and its partner ("Superset with X: a set of each, then rest."), then the slot's own note after its rest. */
export function pairNotes(slots: BuiltSlot[]): BuiltSlot[] {
  return slots.map((s, i) => {
    const partner = s.pair ? slots[i - 1] : slots[i + 1]?.pair ? slots[i + 1] : undefined;
    if (!partner) return s;
    const rest = s.note.replace(/^Rest [^.]+\.\s*/, '');
    return { ...s, note: `Rest ${REST.pair.text}. Superset with ${partner.entry.name}: a set of each, then rest.${rest ? ` ${rest}` : ''}` };
  });
}

export function estimatedMinutes(t: BuiltTemplate): number {
  return Math.round(warmUpMinutes(t.minimumDose) + setMinutes(t) + (t.finisher ? DOSE.finisherMinutes : 0));
}

const LINEAR_REPS = { strength: 5, muscle: 8, health: 10, hybrid: 8, skill: 6 } as const;

/** Linear progression: novices on external-load main lifts (not on a lighter day's variations, `linear` false). */
export function isLinear(ctx: PlanContext, e: CatalogueEntry, role: Role, linear = true): boolean {
  return linear && ctx.experience === 'novice' && role === 'main' && e.load === 'external';
}

export interface DoseOptions {
  /** The blueprint's own rep ranges (the four-day heavy and lighter pairs). */
  reps?: Blueprint['reps'];
  ladder?: LadderSlot | null;
}

export function repRange(ctx: PlanContext, e: CatalogueEntry, role: Role, day: Blueprint['day'], phase: number, opts: DoseOptions = {}): RepRange {
  if (opts.ladder) return opts.ladder.info.reps ?? [1, 1];
  if (e.load === 'timed' || e.load === 'cardio' || e.pattern === 'carry') return [1, 1];
  if (e.pattern === 'skill') return [3, 6];
  if (CORE.has(e.pattern)) return [8, 12];
  const own = opts.reps;
  // A lighter day's bodyweight work takes the lighter pair's reps too, so the day is lighter for every muscle it trains.
  if (e.load === 'bodyweight') return day === 'light' && own ? (role === 'main' ? own.main : own.accessory) : role === 'main' ? [6, 12] : [8, 15];
  if (ISOLATION.has(e.pattern)) return e.equipment[0] === 'dumbbell' ? [8, 15] : [10, 15];
  if (isLinear(ctx, e, role, own?.linearMain !== null)) {
    const n = own?.linearMain ?? (day === 'heavy' ? 5 : day === 'volume' ? 10 : LINEAR_REPS[ctx.modifier]);
    return [n, n];
  }
  if (own) return role === 'main' ? own.main : own.accessory;
  if (role === 'main' && day === 'heavy') return ctx.modifier === 'strength' ? [3, 5] : [4, 6];
  if (role === 'main' && day === 'volume') return ctx.modifier === 'strength' ? [6, 8] : [10, 12];
  switch (ctx.modifier) {
    case 'strength':
      return role === 'main' ? (phase >= 1 ? [3, 5] : [3, 6]) : [6, 10];
    case 'health':
      return role === 'main' ? [8, 12] : [10, 15];
    case 'skill':
      return role === 'main' ? [5, 8] : [8, 12];
    default:
      return role === 'main' ? [6, 10] : [8, 12];
  }
}

/** rules.md: compound lifts 1-3 (2), isolation and machines 0-2 (1). */
export function baseRir(e: CatalogueEntry): number {
  if (e.load === 'timed' || e.pattern === 'skill' || CORE.has(e.pattern)) return 2;
  if (ISOLATION.has(e.pattern) || e.equipment[0] === 'machine' || e.equipment[0] === 'cable') return 1;
  return 2;
}

export function progressionRule(ctx: PlanContext, e: CatalogueEntry, role: Role, opts: { linear?: boolean; ladder?: LadderSlot | null } = {}): SlotProgression {
  const lad = opts.ladder;
  if (lad) {
    const nextLevel = LADDER_BY_ID.get(lad.id)!.levels[lad.level];
    const next = nextLevel && nextLevel.exercise !== e.id ? ctx.byId.get(nextLevel.exercise) : undefined;
    const ok = next && next.equipment.every((q) => q === 'bodyweight' || ctx.equipment.has(q)) && !ctx.dislikes.has(next.id);
    return { rule: 'ladder', ladder: lad.id, level: lad.level, ...(ok ? { next: next.id } : {}) };
  }
  if (e.load === 'bodyweight' || e.load === 'timed') {
    const next = e.harder.find((id) => {
      const h = ctx.byId.get(id);
      return h && h.equipment.every((q) => q === 'bodyweight' || ctx.equipment.has(q)) && !ctx.dislikes.has(id);
    });
    return next ? { rule: 'ladder', next } : { rule: 'ladder' };
  }
  if (isLinear(ctx, e, role, opts.linear ?? true)) return { rule: 'linear', step: incrementFor(e, ctx.unit) };
  if (ctx.experience === 'advanced' && role === 'main' && opts.linear !== false) return { rule: 'wave' };
  return { rule: 'double' };
}

export function slotNote(e: CatalogueEntry, role: Role, prog: SlotProgression, ladder: LadderSlot | null = null, reps: RepRange = [8, 12]): string {
  const rest = restNote(e, role, reps);
  if (ladder) {
    const l = LADDER_BY_ID.get(ladder.id)!;
    const up = l.levels[ladder.level];
    const detail = ladder.info.detail ? ` (${ladder.info.detail})` : '';
    return `${rest} ${l.name} ladder, level ${ladder.level}: ${ladder.info.name}${detail}, from the self-check. The top of the range on every set two sessions running, then ${up ? `level ${ladder.level + 1} (${up.name})` : 'harder reps or a slower tempo'}.`;
  }
  const hold = e.load === 'timed' ? (e.pattern === 'skill' ? ' Holds of 10-20 s.' : e.pattern === 'lunge' ? ' 20-30 s a side.' : ' Holds of 20-40 s.') : e.pattern === 'carry' ? ' 30-40 m a carry.' : '';
  const how = prog.rule === 'linear' ? ' Linear: add one step each session the reps are made.' : prog.rule === 'ladder' ? ` Ladder: the top of the range on every set, then ${prog.next ?? 'a harder variation'}.` : prog.rule === 'wave' ? ' Weekly wave: RIR 3, 2, 1, then the deload.' : '';
  return `${rest}${hold}${how}`;
}

/**
 * Fits the session in its minutes without cutting rest: accessories of
 * non-competing muscles are paired as supersets first (rules.md: they keep
 * the volume load), then accessory sets are trimmed, then slots, then main
 * sets. A minimum-dose template pairs its accessories whatever the time
 * (the minimum week runs as supersets).
 */
export function fitTime(t: BuiltTemplate): Result<BuiltTemplate> {
  const slots = t.slots.map((s) => ({ ...s }));
  const trimmed: string[] = [];
  const over = () => setMinutes({ ...t, slots }) > t.capacity + 1e-9;
  if (t.minimumDose) while (pairOnce(slots));
  while (over() && pairOnce(slots));
  while (over()) {
    const acc = [...slots].reverse().find((s) => s.role === 'accessory' && !s.fixed && s.sets > DOSE.minSets);
    if (acc) {
      acc.sets--;
      continue;
    }
    const drop = [...slots].reverse().find((s) => s.role === 'accessory' && !s.fixed);
    if (drop) {
      dropSlot(slots, drop);
      trimmed.push(drop.entry.id);
      continue;
    }
    const main = [...slots].reverse().find((s) => s.sets > minSetsFor(t, s));
    if (!main) break;
    main.sets--;
  }
  const paired = slots.filter((s) => s.pair).map((s) => `${slots[slots.indexOf(s) - 1]!.entry.id} + ${s.entry.id}`);
  return explain({ ...t, slots }, 'plan.fit-time', { template: t.blueprint.id, capacity: t.capacity, rest: { heavy: REST.heavy.text, sets: REST.sets.text, pair: REST.pair.text } }, {
    note: joinNotes(
      paired.length > 0 && `Supersets for time (${REST.pair.text}): ${paired.join(', ')}.`,
      trimmed.length > 0 && `Dropped for time: ${trimmed.join(', ')}.`,
    ),
  });
}
