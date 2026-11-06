// Session variants: full (the plan as written), express (the plan's Express
// block where it has one, else the main lifts at 2 sets each; on a short day,
// every item at half its rounds, minutes or sets) and hotel (each movement
// pattern kept, with only what travel usually offers: the profile's
// `travelEquipment`, else bodyweight, light dumbbells and bands).
//
// Hotel follows adhoc.md ("Travelling"): about a third of the usual volume on
// a trip of a week or more, which holds strength (Spiering 2021, rules.md).
// With lighter equipment the reps go up (the range shifted up) and the RIR
// one lower, within the screening caps. Every swap passes the Ledger screen
// and carries its reason.

import { CATALOGUE, EQUIPMENT, type CatalogueEntry, type Equipment } from './data/exercises.ts';
import { normalizeEquipment, toExercise } from './plan/context.ts';
import { explain, joinNotes, type Reason, type Result } from './reason.ts';
import { screenExercise } from './safety.ts';
import type { Exercise, ExerciseSlot, IsoDate, LedgerConstraint, Profile, RepRange, SessionTemplate, Unit } from './schema.ts';

export const SESSION_MODES = ['full', 'express', 'hotel'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export const VARIANT = {
  expressSets: 2,
  /** The Hotel version's equipment when the profile has no travel list. */
  hotelEquipment: ['bodyweight', 'dumbbell', 'band'] as readonly Equipment[],
  /** Hotel reps: the range times this, rounded up, at most maxReps (heuristic). */
  repFactor: 1.5,
  maxReps: 30,
  rirDrop: 1,
  /** The lowest RIR hotel work goes to, unless the screening caps ask for more. */
  minRir: 1,
  /** A trip of this many days or more scales each exercise's sets to a third (adhoc.md). */
  longTripDays: 7,
  volumeFraction: 1 / 3,
} as const;

/** A slot of a variant: the slot as it will be done, the planned exercise it replaces, and why. */
export interface VariantSlot extends ExerciseSlot {
  /** The plan's exercise, when this one replaces it. */
  replaces?: string;
  /** No option with the allowed equipment: skip it, or do the nearest ladder level. */
  unavailable?: boolean;
  /** The dose as text, when the variant rewrote the plan's ("2 rounds, 40/20"). */
  sr?: string | null;
  reasons: Reason[];
}

export interface ExpressBlock {
  warmup?: string;
  /** Sets of the first main lift, and of the second. */
  mainSets: number;
  secondSets: number;
  finish?: { exercise: string; sets: number; repRange: RepRange };
}

/** The Express session: the plan's block (first main lift, second, finisher), or the main lifts at 2 sets. */
export function expressVariant(t: SessionTemplate, block?: ExpressBlock | null): Result<{ slots: VariantSlot[]; warmup: string | null }> {
  const mains = t.slots.filter((s) => s.main);
  const rule = 'variant.express';
  const slots: VariantSlot[] = [];
  if (block) {
    mains.slice(0, 2).forEach((s, i) => {
      const sets = i === 0 ? block.mainSets : block.secondSets;
      slots.push({ ...s, sets, reasons: [explain(sets, rule, { exercise: s.exercise, plannedSets: s.sets }, { note: `Express: ${sets} working set(s) at the planned weight, so progression still moves.` }).reason] });
    });
    if (block.finish) {
      const f = block.finish;
      slots.push({ exercise: f.exercise, sets: f.sets, repRange: f.repRange, rir: 2, reasons: [explain(f.sets, rule, { exercise: f.exercise }, { note: "Express: the plan's finisher." }).reason] });
    }
  } else {
    for (const s of mains) {
      slots.push({ ...s, sets: VARIANT.expressSets, reasons: [explain(VARIANT.expressSets, rule, { exercise: s.exercise, plannedSets: s.sets }, { note: `Express: the main lifts only, ${VARIANT.expressSets} sets each (the plan has no Express block).` }).reason] });
    }
  }
  const dropped = t.slots.length - mains.slice(0, block ? 2 : mains.length).length;
  return explain({ slots, warmup: block?.warmup ?? null }, rule, { template: t.id, block: Boolean(block), mains: mains.map((s) => s.exercise) }, {
    note: joinNotes(
      block ? "The plan's Express block: about 20 minutes." : 'No Express block in the plan: the main lifts at 2 sets each.',
      mains.length === 0 && 'This session has no main lifts: nothing to keep.',
      dropped > 0 && `${dropped} other item(s) left out for today.`,
    ),
  });
}

const half = (n: number) => Math.max(1, Math.ceil(n / 2));

/**
 * A dose at half: "4 rounds, 40/20" to "2 rounds, 40/20", "6 min" to
 * "3 min", "5–10 min" to "3–5 min", "4 × 6–12" to "2 × 6–12". Rounded up,
 * at least 1; the reps, times and work/rest stay as written.
 */
export function halveSr(sr: string): string {
  return sr
    .replace(/(\d+)(\s*)(rounds?)\b/i, (_m, n: string, sp: string) => `${half(Number(n))}${sp}${half(Number(n)) === 1 ? 'round' : 'rounds'}`)
    .replace(/(\d+)(?:(\s*[–-]\s*)(\d+))?(\s*min)/, (_m, a: string, dash: string | undefined, b: string | undefined, min: string) => `${half(Number(a))}${b ? `${dash}${half(Number(b))}` : ''}${min}`)
    .replace(/^(\s*)(\d+)(\s*×)/, (_m, pre: string, n: string, x: string) => `${pre}${half(Number(n))}${x}`);
}

/**
 * Express on a short day: the short session keeps every item, each at half
 * its rounds, minutes or sets (rounded up, at least 1), so it takes about
 * half the time and never comes out empty. `srOf` gives an item's dose as the
 * plan writes it.
 */
export function shortExpressVariant(t: SessionTemplate, srOf: (s: ExerciseSlot) => string | null): Result<{ slots: VariantSlot[] }> {
  const rule = 'variant.express';
  const slots: VariantSlot[] = t.slots.map((s) => {
    const sr = srOf(s);
    const halved = sr ? halveSr(sr) : null;
    const sets = half(s.sets);
    const note = sr && halved !== sr ? `${halved} instead of ${sr}.` : `${sets} set(s) instead of ${s.sets}.`;
    return { ...s, sets, sr: halved, reasons: [explain(sets, rule, { exercise: s.exercise, plannedSets: s.sets, sr, halved }, { title: 'Express', note }).reason] };
  });
  return explain({ slots }, rule, { template: t.id, kind: t.kind, items: t.slots.length }, {
    title: 'Express',
    note: 'A short day at half: every item at half its rounds, minutes or sets, rounded up, at least 1. About half the time.',
  });
}

export interface HotelInput {
  template: SessionTemplate;
  /** The program's exercises (names, kinds, muscles). */
  exercises: Readonly<Record<string, Exercise>>;
  /** The catalogue entry a program exercise is (its own id, or a name match). */
  catalogueOf: (id: string) => CatalogueEntry | null;
  ledger: readonly LedgerConstraint[];
  date: IsoDate;
  unit: Unit;
  /** The trip's length in days, when known (a check-in's knownBusy travel). */
  tripDays?: number | null;
  /** The screening caps' lowest RIR (null: none). */
  capMinRir?: number | null;
  catalogue?: readonly CatalogueEntry[];
  /** What travel offers (`travelEquipment`): without it, bodyweight, light dumbbells and bands. */
  travel?: TravelEquipment;
}

/** The equipment the Hotel version may use, and where the list came from. */
export interface TravelEquipment {
  /** Bodyweight always, in the catalogue's order. */
  equipment: Equipment[];
  source: 'profile' | 'default';
  /** Words in the profile's travel list that are no equipment the catalogue knows: left out. */
  unknown: string[];
}

/**
 * What travel usually offers: the profile's `travelEquipment`, read with
 * the same words as `equipment` (bodyweight always; an empty list is
 * bodyweight only), else the default, bodyweight, dumbbells and bands.
 */
export function travelEquipment(profile: Pick<Profile, 'travelEquipment'> | null | undefined): TravelEquipment {
  const list = profile?.travelEquipment;
  if (!list) return { equipment: [...VARIANT.hotelEquipment], source: 'default', unknown: [] };
  const { equipment, unknown } = normalizeEquipment(list);
  return { equipment: EQUIPMENT.filter((q) => equipment.has(q)), source: 'profile', unknown };
}

/** Equipment in a phrase: "bodyweight, dumbbells or a band". */
const KIT: Readonly<Record<Equipment, string>> = { bodyweight: 'bodyweight', dumbbell: 'dumbbells', barbell: 'a barbell', cable: 'a cable', machine: 'machines', band: 'a band', bench: 'a bench', 'pull-up-bar': 'a pull-up bar', kettlebell: 'a kettlebell', rings: 'rings' };
const kitList = (qs: readonly Equipment[], last: 'or' | 'and') => {
  const xs = qs.map((q) => KIT[q]);
  return xs.length <= 1 ? (xs[0] ?? 'bodyweight') : `${xs.slice(0, -1).join(', ')} ${last} ${xs.at(-1)}`;
};

const shared = (a: readonly string[], b: readonly string[]) => a.filter((m) => b.includes(m)).length;
const LEVEL = { beginner: 0, intermediate: 1, advanced: 2 } as const;

/** The hotel session, slot by slot, with only the travel equipment. */
export function hotelVariant(input: HotelInput): Result<{ slots: VariantSlot[]; volumeScaled: boolean }> {
  const travel = input.travel ?? travelEquipment(null);
  const kit: readonly string[] = travel.equipment;
  const allowed = (e: CatalogueEntry) => e.equipment.every((q) => kit.includes(q));
  const cat = input.catalogue ?? CATALOGUE;
  const rule = 'variant.hotel';
  const long = input.tripDays != null && input.tripDays >= VARIANT.longTripDays;
  const floor = Math.max(VARIANT.minRir, input.capMinRir ?? 0);
  const screenSet: Record<string, Exercise> = { ...Object.fromEntries(cat.map((e) => [e.id, toExercise(e, input.unit)])), ...input.exercises };
  const nameOf = (id: string) => input.exercises[id]?.name ?? cat.find((e) => e.id === id)?.name ?? id;
  const shift = (r: RepRange): RepRange =>
    r[0] === 1 && r[1] === 1 ? r : [Math.min(VARIANT.maxReps, Math.ceil(r[0] * VARIANT.repFactor)), Math.min(VARIANT.maxReps, Math.ceil(r[1] * VARIANT.repFactor))];
  const dose = (s: ExerciseSlot) => ({ sets: long ? Math.max(1, Math.ceil(s.sets * VARIANT.volumeFraction)) : s.sets, rir: Math.max(floor, s.rir - VARIANT.rirDrop) });

  const slots: VariantSlot[] = input.template.slots.map((s) => {
    const ex = input.exercises[s.exercise];
    const kind = ex?.kind ?? 'strength';
    if (kind === 'cardio' || kind === 'mobility') {
      return { ...s, reasons: [explain(s.exercise, rule, { exercise: s.exercise, kind }, { note: `${nameOf(s.exercise)}: any cardio machine, or a brisk walk outside.` }).reason] };
    }
    const entry = input.catalogueOf(s.exercise);
    const pattern = entry?.pattern ?? ex?.pattern ?? null;
    const d = dose(s);
    if (entry && allowed(entry)) {
      const repRange = entry.load === 'external' ? shift(s.repRange) : s.repRange;
      return {
        ...s,
        ...d,
        repRange,
        reasons: [explain(s.exercise, rule, { exercise: s.exercise, equipment: entry.equipment, longTrip: long }, { title: 'Hotel', note: joinNotes(`${nameOf(s.exercise)} needs only ${entry.equipment.join(' and ')}: kept${entry.load === 'external' ? `, ${entry.equipment.includes('dumbbell') ? 'with light dumbbells' : 'lighter'}, reps shifted up` : ''}.`, long && 'A third of the sets (a trip of a week or more).') }).reason],
      };
    }
    const candidates = pattern
      ? cat
          .filter((e) => e.pattern === pattern && allowed(e) && e.load !== 'cardio' && e.level !== 'advanced' && screenExercise(e.id, input.ledger, input.date, screenSet).value.allowed)
          // Most main muscles shared, the same kind of load, then the variation furthest along its
          // own progression (light equipment needs the harder one), then the lower level, then id.
          .sort((a, b) => {
            const main = (ex?.muscles?.main ?? entry?.muscles.main ?? []) as string[];
            return (
              shared(b.muscles.main, main) - shared(a.muscles.main, main) ||
              Number(b.load === (entry?.load ?? 'external')) - Number(a.load === (entry?.load ?? 'external')) ||
              b.easier.length - a.easier.length ||
              LEVEL[a.level] - LEVEL[b.level] ||
              (a.id < b.id ? -1 : 1)
            );
          })
      : [];
    const pick = candidates[0];
    if (!pick) {
      return {
        ...s,
        ...d,
        unavailable: true,
        reasons: [explain(null, rule, { exercise: s.exercise, pattern, equipment: travel.equipment }, { note: `${nameOf(s.exercise)}: no ${pattern ?? 'matching'} option with ${kitList(travel.equipment, 'or')} passes the Ledger screen; skip it today, or do the nearest ladder level.` }).reason],
      };
    }
    const repRange = pick.load === 'timed' ? s.repRange : shift(s.repRange);
    return {
      exercise: pick.id,
      sets: d.sets,
      repRange,
      rir: d.rir,
      ...(s.main ? { main: true } : {}),
      replaces: s.exercise,
      reasons: [
        explain(pick.id, rule, { exercise: s.exercise, pattern, equipment: pick.equipment, swap: pick.id, longTrip: long, tripDays: input.tripDays ?? null }, {
          threshold: { equipment: travel.equipment, repFactor: VARIANT.repFactor, rirDrop: VARIANT.rirDrop, minRir: floor, volumeFraction: long ? VARIANT.volumeFraction : 1 },
          note: joinNotes(
            `${pick.name} in place of ${nameOf(s.exercise)}: the same ${pattern} pattern with ${pick.equipment.join(' and ')}; ${repRange[0] === repRange[1] ? repRange[0] : `${repRange[0]}-${repRange[1]}`} reps at RIR ${d.rir}, lighter load and more reps.`,
            long && `A third of the sets (${d.sets}): a trip of a week or more.`,
          ),
        }).reason,
      ],
    };
  });
  return explain({ slots, volumeScaled: long }, rule, { template: input.template.id, tripDays: input.tripDays ?? null, equipment: travel.equipment, equipmentFrom: travel.source, ...(travel.unknown.length ? { unknownEquipment: travel.unknown } : {}) }, {
    threshold: { longTripDays: VARIANT.longTripDays, volumeFraction: VARIANT.volumeFraction },
    note: joinNotes(
      `Hotel: ${slots.filter((x) => x.replaces).length} swap(s), ${slots.filter((x) => x.unavailable).length} without an option.`,
      travel.source === 'profile'
        ? `With what you said travel usually offers: ${kitList(travel.equipment, 'and')}.`
        : 'With bodyweight, light dumbbells and bands (the profile does not say what travel usually offers).',
      travel.unknown.length > 0 && `Not equipment the engine knows, so left out: ${travel.unknown.join(', ')}.`,
      long ? 'A trip of a week or more: about a third of the usual volume, kept close to failure (Spiering 2021).' : 'A short or unknown trip: the usual sets; a trip of a week or more (a check-in knownBusy travel) scales them to a third.',
    ),
  });
}
