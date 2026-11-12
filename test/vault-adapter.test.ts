// The vault adapter on the synthetic vault (test/fixtures/vault) and on small
// in-memory variations of it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromVault, isoWeekDate, ladderStatus, planWeekOf, type VaultFiles } from '../src/adapters/vault/convert.ts';
import { matchCatalogue, NAME_SYNONYMS, normalizeName } from '../src/adapters/vault/catalogue-match.ts';
import { CATALOGUE_BY_ID } from '../src/core/data/exercises.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { paths } from '../src/adapters/vault/layout.ts';
import { buildReview } from '../src/report/review.ts';
import type { SlotExtras } from '../src/core/plan-data.ts';
import type { ExerciseSlot, Session } from '../src/core/schema.ts';
import { validateBody, validateCheckins, validateProgram, validateSession } from '../src/core/validate.ts';
import { fixtureFiles, fsIo, memoryIo, VAULT } from './helpers.ts';

const read = (asOf = '2026-04-12') => readVault(fsIo, VAULT, { asOf });
const { data } = read();
const session = (date: string, type?: string): Session => data.sessions.find((s) => s.date === date && (!type || s.template === type))!;
const slotOf = (s: Session, exercise: string) => s.plan!.slots.find((x) => x.exercise === exercise);
const codes = (ws: { code: string }[]) => ws.map((w) => w.code);
/** A movement the catalogue does not know, standing in for the made-up vault's band external rotation (a catalogue movement). */
const OTHER = 'Cuban Press';
type GuideEntries = Record<string, { muscles?: { main?: string[]; helps?: string[]; override?: unknown; regions?: string[] } }>;

/** The plan with its band external rotation renamed OTHER (sessions and guide, the guide's order kept), then `edit` on its guide. */
function withOther(edit: (g: GuideEntries) => void = () => {}) {
  return fromVault(
    files((f) => {
      const plan = f['plan'] as { sessions: Record<string, { name: string; table?: string }[]>; guide: GuideEntries };
      for (const item of Object.values(plan.sessions).flat()) if (item.name === 'Band External Rotation') item.name = item.table = OTHER;
      plan.guide = Object.fromEntries(Object.entries(plan.guide).map(([k, v]) => [k === 'Band External Rotation' ? OTHER : k, v]));
      edit(plan.guide);
    }),
  );
}

function files(edit: (f: Record<string, unknown>) => void = () => {}): VaultFiles {
  const raw = fixtureFiles('v');
  const f: Record<string, unknown> = {
    plan: JSON.parse(raw[`v/${paths().plan}`]!),
    log: JSON.parse(raw[`v/${paths().log}`]!),
    body: JSON.parse(raw[`v/${paths().body}`]!),
    habits: JSON.parse(raw[`v/${paths().habits}`]!),
    baselines: ['2026-02-23'],
  };
  edit(f);
  return f as unknown as VaultFiles;
}

describe('vault adapter: reading the files', () => {
  it('reads every file of the synthetic vault without errors', () => {
    const r = read();
    assert.deepEqual(r.files, { plan: 'found', log: 'found', body: 'found', habits: 'found', profile: 'found', ledger: 'found', checkins: 'missing', eating: 'missing' });
    assert.deepEqual(r.data.errors, []);
    assert.deepEqual(r.data.coach, { profile: 'ok', ledger: 'ok', checkins: 'missing', eating: 'missing' });
    assert.equal(r.data.plan.cycleStart, '2026-02-23');
    assert.equal(r.data.plan.start, '2026-03-02');
  });

  it('turns unknowns into warnings, never crashes', () => {
    assert.deepEqual(codes(data.warnings), [
      'checkins-missing',
      'snapshot-rebuilt',
      'muscle-tags-differ',
      'bad-value',
      'unknown-field',
      'bad-habit-key',
      'test-not-number',
      'free-text-equipment',
      'unknown-preference',
      'unknown-movement',
      'legacy-default',
    ]);
    const w = (c: string) => data.warnings.find((x) => x.code === c)!.items;
    // Every movement the made-up vault plans is a catalogue movement; one that is not is named.
    assert.ok(!codes(data.warnings).includes('unknown-exercise'));
    assert.deepEqual(withOther().warnings.find((x) => x.code === 'unknown-exercise')!.items, [OTHER]);
    assert.deepEqual(w('free-text-equipment'), ['rowing machine']);
    assert.deepEqual(w('test-not-number'), ['2026-03-07 pistol: "box 4"']);
    assert.deepEqual(w('unknown-movement'), ['shoulder: ring-dip-unknown']);
  });

  it('reads the plan\'s standing rules; one warning names what is left to the old defaults, another what it cannot read', () => {
    const legacy = data.warnings.find((x) => x.code === 'legacy-default')!;
    assert.match(legacy.message, /old default/);
    assert.ok(legacy.items!.some((i) => i.startsWith('rules.lightWeeks: light weeks every 4th plan week')));
    assert.equal(legacy.items!.at(-1), 'lifts without a progression rule: Barbell Back Squat, Goblet Squat, Flat DB Bench Press, Romanian Deadlift, Seated Cable Row (double progression; 2 sessions under lo -> 10 % lighter)');
    assert.equal(data.rules.sources.lightWeeks, 'legacy-default');
    const d = fromVault(files((f) => {
      const plan = f['plan'] as Record<string, unknown>;
      plan['rules'] = { lightWeeks: { every: 5, sets: 'half' }, stall: { response: 'sometimes' }, extra: 1 };
    }));
    assert.equal(d.rules.sources.lightWeeks, 'plan');
    assert.equal(d.rules.sources.stall, 'legacy-default');
    assert.deepEqual(d.warnings.find((x) => x.code === 'rules-invalid')!.items, ['rules.extra: unknown key "extra" (known: calibration, lightWeeks, tests, readiness, soreness, missed, stall, hotel)', 'rules.stall.response: is neither "triage" nor "report"']);
    assert.ok(!d.warnings.find((x) => x.code === 'legacy-default')!.items!.some((i) => i.startsWith('rules.lightWeeks')));
  });

  it('counts a session without a saved exercise list from today’s plan, and the review marks it approximate', () => {
    const rebuilt = data.warnings.find((x) => x.code === 'snapshot-rebuilt')!;
    assert.deepEqual(rebuilt.items, ['2026-03-31 S3']);
    assert.match(rebuilt.message, /sets per muscle are approximate/);
    const week = buildReview(read('2026-04-02').data, '2026-04-02').thisWeek.sessions;
    assert.ok(week.length > 1);
    assert.deepEqual(week.filter((s) => 'approximate' in s).map((s) => [s.date, s.type, s.approximate]), [['2026-03-31', 'S3', true]]);
  });

  it('produces valid schema v1', () => {
    assert.deepEqual(validateProgram(data.program), []);
    assert.deepEqual(validateCheckins(data.checkins), []);
    assert.deepEqual(validateBody(data.body), []);
    for (const s of data.sessions) assert.deepEqual(validateSession(s), [], s.id);
  });

  it('reports a missing plan-data.json or invalid JSON as errors', () => {
    const missing = readVault(memoryIo({}), 'v');
    assert.equal(missing.files.plan, 'missing');
    assert.deepEqual(codes(missing.data.errors), ['missing']);
    const raw = fixtureFiles('v');
    raw[`v/${paths().body}`] = '{ not json';
    const bad = readVault(memoryIo(raw), 'v', { asOf: '2026-04-12' });
    assert.deepEqual(codes(bad.data.errors), ['json']);
    assert.match(bad.data.errors[0]!.message, /body-data\.json is not valid JSON/);
  });

  it('says when the coach files do not exist yet', () => {
    const raw = fixtureFiles('v');
    delete raw[`v/${paths().profile}`];
    delete raw[`v/${paths().ledger}`];
    const r = readVault(memoryIo(raw), 'v', { asOf: '2026-04-12' });
    assert.deepEqual(r.data.coach, { profile: 'missing', ledger: 'missing', checkins: 'missing', eating: 'missing' });
    assert.equal(r.data.profile, null);
    assert.equal(r.data.warnings.filter((w) => w.code === 'coach-missing').length, 2);
    assert.deepEqual(r.data.errors, []);
  });

  it('reports invalid coach files as errors', () => {
    const r = fromVault(files((f) => {
      f['profile'] = { schemaVersion: 1, goals: [] };
      f['ledger'] = { schemaVersion: 2, constraints: [] };
    }));
    assert.deepEqual(r.coach, { profile: 'invalid', ledger: 'invalid', checkins: 'missing', eating: 'missing' });
    assert.ok(r.errors.some((e) => e.code === 'profile' && /availability: is required/.test(e.message)));
    assert.ok(r.errors.some((e) => e.code === 'ledger' && /schema version 1/.test(e.message)));
  });
});

describe('vault adapter: sessions', () => {
  it('turns lift1 and lift2 into top sets at Standard tracking, in their logged or plan unit', () => {
    const s = session('2026-03-04');
    assert.equal(s.trackingLevel, 'standard');
    assert.deepEqual(s.exercises, [
      { exercise: 'romanian-deadlift', sets: [{ weight: 60, unit: 'kg', reps: 8 }] }, // no unit: the lift's own unit (kg)
      { exercise: 'seated-cable-row', sets: [{ weight: 100, unit: 'lb', reps: 10 }] }, // no unit, no lift unit: liftUnit
    ]);
    assert.deepEqual(session('2026-04-06').exercises[0], { exercise: 'romanian-deadlift', sets: [{ weight: 154, unit: 'lb', reps: 8 }] });
  });

  it('leaves 0 x 0 lifts unlogged but keeps their swap in the snapshot', () => {
    const s = session('2026-03-20');
    assert.deepEqual(s.exercises.map((x) => x.exercise), ['seated-cable-row']);
    const slot = slotOf(s, 'hamstring-curl') as ExerciseSlot & { _planned?: string };
    assert.equal(slot._planned, 'Romanian Deadlift');
    assert.equal(slot.main, true);
    assert.equal(slotOf(s, 'romanian-deadlift'), undefined);
  });

  it('applies swaps to the snapshot, as the dashboard counts them', () => {
    const s = session('2026-04-11');
    assert.ok(slotOf(s, 'db-walking-lunge'));
    assert.equal(slotOf(s, 'bulgarian-split-squat'), undefined);
  });

  it('freezes the plan snapshot with the week kind, the template kind and Express', () => {
    assert.equal(session('2026-03-18').plan!.kind, 'express');
    assert.deepEqual(session('2026-03-18').plan!.slots.map((x) => [x.exercise, x.sets]), [
      ['warm-up-band-external-rotation-dislocates', 2], // the dashboard's setsOf("3 min")
      ['goblet-squat', 2],
      ['flat-db-bench-press', 2],
      ['face-pull', 2],
    ]);
    const deload = session('2026-03-23');
    assert.equal(deload.plan!.weekKind, 'deload');
    assert.equal(slotOf(deload, 'goblet-squat')!.sets, 2);
    assert.deepEqual([deload.plan!.phase, deload.plan!.mesocycle, deload.plan!.week], ['phase-1', 'meso-1', 4]);
    assert.equal(session('2026-03-03').plan!.kind, 'short');
    assert.equal(session('2026-03-03').trackingLevel, 'light');
  });

  it('maps skipped checklist lines to exercises, both parts of a paired line, and ignores the warm-up', () => {
    assert.deepEqual(session('2026-04-08').skipped, ['face-pull', 'band-external-rotation']);
    assert.equal(session('2026-03-30').skipped, undefined);
  });

  it('rebuilds a missing snapshot from the plan and says so', () => {
    const s = session('2026-03-31');
    assert.deepEqual(s.plan!.slots.map((x) => x.exercise), ['circuit-squat-jump-burpee', 'cool-down-walk-or-bike']);
  });

  it('keeps custom sessions without a plan, and the dashboard-only fields under _vault', () => {
    const s = session('2026-03-06');
    assert.equal(s.plan, undefined);
    assert.equal(s.template, undefined);
    assert.equal(s.minutes, 15);
    assert.deepEqual((s as Session & { _vault: unknown })._vault, { type: 'custom', label: 'Abs at home', rating: 8, cardioMode: 'bike' });
    assert.equal(s.id, '2026-03-06-custom-abs-at-home');
  });

  it('counts plan weeks from the first logged plan session (the dashboard clock)', () => {
    assert.equal(planWeekOf('2026-03-02', '2026-03-08'), 1);
    assert.equal(planWeekOf('2026-03-02', '2026-03-23'), 4);
    assert.equal(planWeekOf('2026-03-04', '2026-04-12'), 6);
  });
});

describe('vault adapter: the program', () => {
  const week = data.program.macrocycle.phases[0]!.mesocycles[0]!.weeks[1]!;
  const tpl = (id: string) => week.sessions.find((t) => t.id === id)!;

  it('builds templates from the sessions in rotation order, with plan-data types kept', () => {
    assert.deepEqual(week.sessions.map((t) => [t.id, t.kind, (t as typeof t & { _type: string })._type]), [
      ['a', 'lift', 'A'],
      ['b', 'lift', 'B'],
      ['s1', 'short', 'S1'],
      ['s3', 'short', 'S3'],
    ]);
    assert.equal(tpl('a').name, 'Full Body A — Squat');
    assert.deepEqual(data.plan.weekTarget, { lift: 3, short: 1 });
  });

  it('takes the rep range, increment and unit of a logged lift from lifts', () => {
    const goblet = tpl('a').slots[0]!;
    assert.deepEqual([goblet.exercise, goblet.sets, goblet.repRange, goblet.rir, goblet.main], ['goblet-squat', 4, [8, 10], 2, true]);
    assert.deepEqual(goblet.progression, { rule: 'double' });
    const rdl = data.program.exercises['romanian-deadlift']!;
    assert.deepEqual([rdl.unit, rdl.increment], ['kg', 5]);
    assert.deepEqual([data.program.exercises['seated-cable-row']!.unit, data.program.exercises['seated-cable-row']!.increment], ['lb', 10]);
    assert.equal(tpl('b').slots[0]!.rir, 3); // "RIR 3." in the note
  });

  it('reads an until note as a temporary change, with the item it replaces', () => {
    assert.deepEqual(tpl('a').slots[0]!.until, {
      until: '2026-04-19',
      reason: 'knee niggle, easing; the back squat returns after it',
      note: 'Replaces Barbell Back Squat.',
    });
  });

  it('uses the ladder level as of the date, with the next level as the ladder rule', () => {
    const push = tpl('s1').slots[1]!;
    assert.equal(push.exercise, 'floor-push-up');
    assert.deepEqual(push.progression, { rule: 'ladder', next: 'tempo-push-up' });
    const early = readVault(fsIo, VAULT, { asOf: '2026-03-10' }).data.program.macrocycle.phases[0]!.mesocycles[0]!.weeks[0]!;
    assert.equal(early.sessions.find((t) => t.id === 's1')!.slots[1]!.exercise, 'incline-push-up');
  });

  it('marks rounds and minutes items as circuits and timed work, not counted, and keeps cardio and mobility kinds', () => {
    const ex = data.program.exercises;
    assert.equal(ex['circuit-squat-jump-burpee']!.kind, 'circuit');
    assert.equal(ex['circuit-squat-jump-burpee']!.muscles, undefined);
    assert.equal(ex['chest-to-wall-handstand']!.kind, 'timed');
    assert.equal(ex['pike-hold-on-a-bench']!.kind, 'timed'); // every level of a "6 min" ladder
    assert.equal(ex['zone-2-finisher']!.kind, 'cardio');
    assert.equal(ex['doorway-chest-stretch']!.kind, 'mobility');
    // "3 x 20-40 s" has sets; the catalogue's side plank (its abductors on plan-data's glutes) counts, not the guide's shoulders.
    assert.deepEqual(ex['side-plank']!.muscles, { main: ['obliques'], helps: ['abs', 'glutes'] });
  });

  it('runs plan weeks from week 1 in phases of two 4-week mesocycles, deloading every 4th week as the dashboard does', () => {
    const weeks = data.program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks));
    assert.equal(weeks.length, 24);
    assert.equal(data.program.macrocycle.start, '2026-03-02');
    assert.deepEqual(weeks.filter((w) => w.kind === 'deload').map((w) => w.start).slice(0, 2), ['2026-03-23', '2026-04-20']);
    assert.equal(weeks[0]!.calibration, true);
    const d = weeks[3]!.sessions;
    // Every "N ×" item at 2 sets; the zone 2 finisher keeps its minutes, one timed block.
    assert.deepEqual(d.find((t) => t.id === 'a')!.slots.map((s) => s.sets), [2, 2, 2, 2, 1]);
    assert.deepEqual(d.find((t) => t.id === 'a')!.slots[4]!.timed, { minutes: 5 });
    assert.deepEqual(d.find((t) => t.id === 's3')!.slots.map((s) => s.exercise), ['easy-zone-2-bike-or-walk']);
  });

  it('keeps each item as read on its slot', () => {
    const s = tpl('a').slots[0] as ExerciseSlot & SlotExtras;
    assert.equal(s._item!.table, 'Goblet Squat');
    assert.deepEqual([s.exercise, s.sets, s.repRange, s.rir, s.until?.until], ['goblet-squat', 4, [8, 10], 2, '2026-04-19']);
  });

  it('reads the items\' rir and timed fields first; a malformed field falls back to the note, with a warning', () => {
    const v = fromVault(files((f) => {
      const plan = f['plan'] as { sessions: Record<string, Record<string, unknown>[]> };
      plan.sessions['B']![1]!['rir'] = [1, 2];
      plan.sessions['B']![0]!['rir'] = 'three';
      plan.sessions['A']![4]!['timed'] = { minutes: 8 };
      plan.sessions['S3']!.unshift({ name: 'Bike intervals', sr: '30 min', rest: '—', note: 'Hard, then easy.', timed: { minutes: 30, rounds: 4, workMin: 4, restMin: 3 } });
    }), { asOf: '2026-04-12' });
    const wk = v.program.macrocycle.phases[0]!.mesocycles[1]!.weeks[1]!;
    const slots = (id: string) => wk.sessions.find((t) => t.id === id)!.slots as (ExerciseSlot & SlotExtras)[];
    assert.equal(slots('b')[1]!.rir, 1);
    assert.equal(slots('b')[0]!.rir, 3, 'the note\'s "RIR 3." when the field is not a RIR');
    assert.deepEqual([slots('a')[4]!.sets, slots('a')[4]!.timed], [1, { minutes: 8 }]);
    const iv = slots('s3')[0]!;
    assert.deepEqual([iv.exercise, iv.sets, iv.repRange, iv.rir, iv.until, iv.timed], ['bike-intervals', 4, [1, 1], 2, undefined, { minutes: 30, rounds: 4, workMin: 4, restMin: 3 }]);
    assert.equal(v.program.exercises['bike-intervals']!.kind, 'timed', 'a timed field is minutes, not sets');
    const w = v.warnings.find((x) => x.code === 'plan-item-field')!;
    assert.deepEqual(w.items, ['B Romanian Deadlift: rir is "three", not a number of reps in reserve or [lo, hi]']);
    assert.deepEqual(validateProgram(v.program), [], 'the slots\' timed field is schema v1');
  });

  it('extends the program past week 24 when the date needs it, with a warning', () => {
    const late = fromVault(files(), { asOf: '2026-09-01' });
    assert.equal(late.program.macrocycle.phases.length, 4);
    assert.ok(late.warnings.some((w) => w.code === 'past-plan-end'));
  });

  it('matches common exercise names to the catalogue for strain tags and patterns', () => {
    assert.equal(matchCatalogue('Romanian Deadlift')?.id, 'rdl');
    assert.equal(matchCatalogue('Flat DB Bench Press')?.id, 'db-bench');
    assert.equal(matchCatalogue('Bulgarian Split Squat')?.id, 'bulgarian-split-squat');
    assert.equal(matchCatalogue('Seated Cable Row')?.id, 'seated-cable-row');
    assert.equal(matchCatalogue('Band External Rotation')?.id, 'band-external-rotation');
    assert.equal(matchCatalogue(OTHER), null);
    // A movement the catalogue has answers to its own name and aliases, never a synonym for a nearby one.
    for (const [name, id] of [['Chin-up', 'chin-up'], ['Walking Lunge', 'walking-lunge'], ['DB Walking Lunge', 'walking-lunge'], ['L-sit', 'l-sit'], ['Wall walk', 'wall-walk'], ['Pike hold on a bench', 'box-pike-hold'], ['Hex Bar Deadlift', 'trap-bar-deadlift'], ['Farmers Walk', 'farmer-carry'], ['Freestanding handstand 15 s', 'freestanding-handstand']]) {
      assert.equal(matchCatalogue(name!)?.id, id, name);
    }
    // The lying curl is its own movement, hip straight; a plain "leg curl" stays the seated one.
    assert.equal(matchCatalogue('Lying Leg Curl')?.id, 'lying-leg-curl');
    assert.equal(matchCatalogue('Prone leg curl')?.id, 'lying-leg-curl');
    assert.equal(matchCatalogue('Leg Curl')?.id, 'seated-leg-curl');
    assert.equal(matchCatalogue('Hamstring Curl')?.id, 'seated-leg-curl');
    for (const [name, id] of [['Seated Calf Raise', 'seated-calf-raise'], ['Pec Deck', 'pec-deck'], ['Machine Fly', 'pec-deck'], ['Reverse Pec Deck', 'reverse-pec-deck'], ['Rear Delt Machine', 'reverse-pec-deck'], ['Band Lateral Raise', 'band-lateral-raise'], ['Overhead Cable Triceps Extension', 'cable-overhead-triceps-extension'], ['Hip Abduction Machine', 'hip-abduction-machine'], ['Seated Hip Abduction', 'hip-abduction-machine'], ['DB Shrug', 'db-shrug'], ['Slider Leg Curl', 'slider-leg-curl'], ['Towel Leg Curl', 'slider-leg-curl']]) {
      assert.equal(matchCatalogue(name!)?.id, id, name);
    }
    for (const [name, id] of Object.entries(NAME_SYNONYMS)) assert.ok(CATALOGUE_BY_ID.has(id), `${name} -> ${id}`);
    assert.equal(normalizeName('45° Back Extension (DB)'), '45 back extension');
    assert.deepEqual(data.program.exercises['romanian-deadlift']!.risk, ['abdomen-high']);
    assert.equal(data.program.exercises['romanian-deadlift']!.pattern, 'hinge');
    assert.equal(data.catalogueMatch['goblet-squat'], 'goblet-squat');
  });
});

describe('vault adapter: one source of muscle tags', () => {
  type Guide = GuideEntries;
  const withGuide = (edit: (g: Guide) => void) => fromVault(files((f) => edit((f['plan'] as { guide: Guide }).guide)));
  const items = (r: ReturnType<typeof fromVault>, code: string) => r.warnings.find((w) => w.code === code)?.items ?? [];

  it('counts a catalogue movement with the catalogue\'s tags and lists where the guide differs', () => {
    assert.deepEqual(data.program.exercises['face-pull']!.muscles, { main: ['upper-back'], helps: ['shoulders'], regions: ['shoulders-rear', 'upper-back-mid'] });
    const differ = data.warnings.find((w) => w.code === 'muscle-tags-differ')!;
    assert.ok(differ.items!.includes('Face Pull: guide main shoulders, upper-back | catalogue main upper-back, helps shoulders'));
    // The audit: squats help no hamstrings, and the goblet squat's adductors land on glutes, already a main muscle.
    assert.ok(differ.items!.includes('Goblet Squat: guide main quads, glutes, helps abs, upper-back, hamstrings | catalogue main quads, glutes, helps abs, upper-back'));
    // Order is not a difference: the bench press's guide lists shoulders before triceps, the catalogue after.
    assert.ok(!differ.items!.some((i) => i.startsWith('Flat DB Bench Press:')));
    assert.match(differ.message, /muscles\.override/);
  });

  it('keeps the guide\'s own tags for a catalogue movement only with an override reason, and lists it', () => {
    const r = withGuide((g) => {
      g['Face Pull']!.muscles!.override = 'rear delts trained as shoulders here';
    });
    assert.deepEqual(r.program.exercises['face-pull']!.muscles, { main: ['shoulders', 'upper-back'], helps: [] });
    assert.deepEqual(items(r, 'muscle-tags-overridden'), ['Face Pull: rear delts trained as shoulders here']);
    assert.ok(!items(r, 'muscle-tags-differ').some((i) => i.startsWith('Face Pull:')));
    for (const blank of ['', '   ', 3, true]) {
      const b = withGuide((g) => {
        g['Face Pull']!.muscles!.override = blank;
      });
      assert.deepEqual(b.program.exercises['face-pull']!.muscles, { main: ['upper-back'], helps: ['shoulders'], regions: ['shoulders-rear', 'upper-back-mid'] }, JSON.stringify(blank));
      assert.deepEqual(items(b, 'muscle-tags-overridden'), []);
      assert.deepEqual(items(b, 'muscle-tags-override-ignored'), ['Face Pull: the override is not a reason (a non-empty string)'], JSON.stringify(blank));
      assert.ok(items(b, 'muscle-tags-differ').some((i) => i.startsWith('Face Pull:')));
    }
    // A reason with no main muscle beside it: nothing of its own to count, so the catalogue's do, and it is said.
    for (const tags of [{ main: [], helps: ['shoulders'] }, { main: [], helps: [] }]) {
      const e = withGuide((g) => {
        g['Face Pull']!.muscles = { ...tags, override: 'counted my way' };
      });
      assert.deepEqual(e.program.exercises['face-pull']!.muscles, { main: ['upper-back'], helps: ['shoulders'], regions: ['shoulders-rear', 'upper-back-mid'] });
      assert.deepEqual(items(e, 'muscle-tags-override-ignored'), ['Face Pull: the override names no main muscle'], JSON.stringify(tags));
    }
  });

  it('counts a movement the catalogue does not know with the guide\'s tags, a main muscle never also a helper', () => {
    const other = withOther();
    assert.deepEqual(other.program.exercises['cuban-press']!.muscles, { main: ['shoulders'], helps: ['upper-back'] });
    assert.ok(!items(other, 'muscle-tags-differ').some((i) => i.startsWith(`${OTHER}:`)));
    const r = withOther((g) => {
      g[OTHER]!.muscles!.helps = ['shoulders', 'upper-back'];
    });
    assert.deepEqual(r.program.exercises['cuban-press']!.muscles, { main: ['shoulders'], helps: ['upper-back'] });
  });

  it('gives a catalogue movement the catalogue\'s tags when its guide entry has none', () => {
    const r = withGuide((g) => {
      delete g['Hamstring Curl']!.muscles;
    });
    assert.deepEqual(r.program.exercises['hamstring-curl']!.muscles, { main: ['hamstrings'], helps: [], regions: ['hamstrings-knee'] });
    assert.ok(!items(r, 'no-muscles').includes('Hamstring Curl'));
    assert.ok(!items(r, 'muscle-tags-differ').some((i) => i.startsWith('Hamstring Curl:')));
  });

  it('drops muscle ids the engine does not know, with a warning', () => {
    const r = withOther((g) => {
      g['Face Pull']!.muscles!.main = ['shoulders', 'rear-delts'];
      g[OTHER]!.muscles!.main = ['shoulders', 'rotator-cuff'];
    });
    // A catalogue movement counts the catalogue's tags whatever the guide names; one the catalogue does not know keeps the guide's known ones.
    assert.deepEqual(r.program.exercises['face-pull']!.muscles!.main, ['upper-back']);
    assert.deepEqual(r.program.exercises['cuban-press']!.muscles, { main: ['shoulders'], helps: ['upper-back'] });
    assert.deepEqual(items(r, 'unknown-muscle'), [`${OTHER}: rotator-cuff`, 'Face Pull: rear-delts']);
  });

  it('warns about a cardio or mobility entry for a movement the catalogue counts as strength work, and leaves it uncounted', () => {
    const r = withGuide((g) => {
      g['Face Pull']!.muscles = { main: [], helps: [], kind: 'mobility' } as never;
    });
    assert.equal(r.program.exercises['face-pull']!.kind, 'mobility');
    assert.equal(r.program.exercises['face-pull']!.muscles, undefined);
    assert.deepEqual(items(r, 'muscle-tags-uncounted'), ['Face Pull: guide mobility | catalogue main upper-back, helps shoulders']);
    assert.deepEqual(items(data, 'muscle-tags-uncounted'), [], 'the synthetic vault\'s cardio and mobility items are cardio and mobility in the catalogue too');
  });

  it('takes the catalogue\'s regions for a catalogue movement, the guide\'s with an override or for a movement it does not know', () => {
    assert.deepEqual(data.program.exercises['flat-db-bench-press']!.muscles!.regions, ['shoulders-front']);
    assert.equal(withOther().program.exercises['cuban-press']!.muscles!.regions, undefined, 'no regions in the guide, none counted');
    const r = withOther((g) => {
      g['Flat DB Bench Press']!.muscles!.regions = ['chest-upper'];
      g[OTHER]!.muscles!.regions = ['shoulders-rear', 'shoulders-rear'];
    });
    assert.deepEqual(r.program.exercises['flat-db-bench-press']!.muscles!.regions, ['shoulders-front'], 'the catalogue\'s, whatever the guide names');
    assert.deepEqual(r.program.exercises['cuban-press']!.muscles!.regions, ['shoulders-rear']);
    assert.ok(!items(r, 'muscle-tags-differ').some((i) => i.startsWith('Flat DB Bench Press:')), 'regions alone are not a muscle difference');
    const own = withGuide((g) => {
      g['Face Pull']!.muscles = { main: ['shoulders', 'upper-back'], helps: [], regions: ['shoulders-rear'], override: 'rear delts trained as shoulders here' };
    });
    assert.deepEqual(own.program.exercises['face-pull']!.muscles, { main: ['shoulders', 'upper-back'], helps: [], regions: ['shoulders-rear'] });
  });

  it('drops guide regions the engine does not model, with the nearest supported option for an unsupported one', () => {
    const r = withOther((g) => {
      g[OTHER]!.muscles!.regions = ['shoulders-rear', 'rotator-cuff', 'side delts'];
      g['Flat DB Bench Press']!.muscles!.regions = ['inner chest'];
    });
    assert.deepEqual(r.program.exercises['cuban-press']!.muscles!.regions, ['shoulders-rear']);
    assert.deepEqual(items(r, 'unknown-region'), [`${OTHER}: rotator-cuff`, `${OTHER}: side delts (use the id shoulders-side)`]);
    const unsupported = items(r, 'unsupported-region');
    assert.equal(unsupported.length, 1);
    assert.match(unsupported[0]!, /^Flat DB Bench Press: inner chest: nearest the chest as a whole\. A pec deck grew both heads of the chest evenly \(Pinto 2025\)/);
    assert.deepEqual(codes(data.warnings).filter((c) => c.includes('region')), [], 'the synthetic vault names no regions');
  });

  it('warns about a guide region whose muscle the entry does not tag, and counts it nowhere', () => {
    const r = withOther((g) => {
      // OTHER: main shoulders, helps upper-back (a movement the catalogue does not know).
      g[OTHER]!.muscles!.regions = ['shoulders-rear', 'quads-rf'];
      // A catalogue movement's copy: triceps is among its helps, calves are not.
      g['Flat DB Bench Press']!.muscles!.regions = ['triceps-long', 'calves-soleus'];
    });
    assert.deepEqual(r.program.exercises['cuban-press']!.muscles!.regions, ['shoulders-rear']);
    assert.deepEqual(r.program.exercises['flat-db-bench-press']!.muscles!.regions, ['shoulders-front'], 'the catalogue\'s count either way');
    const w = r.warnings.find((x) => x.code === 'region-parent-missing')!;
    assert.deepEqual(w.items, [`${OTHER}: quads-rf (no quads in main or helps)`, 'Flat DB Bench Press: calves-soleus (no calves in main or helps)']);
    assert.match(w.message, /Add the muscle, or remove the region/);
  });
});

describe('vault adapter: body, habits and the coach files', () => {
  it('turns body days into daily check-ins and weigh-ins, kg', () => {
    const c = data.checkins.daily.find((d) => d.date === '2026-04-10')!;
    assert.deepEqual(Object.keys(c).sort(), ['date', 'energy', 'floors', 'rhr', 'sleepH', 'sleepQ', 'soreMuscles', 'soreness', 'steps', 'trained']);
    assert.deepEqual(c.soreMuscles, { glutes: 'sore', quads: 'mild' }); // the body map's slug quadriceps is the muscle quads
    assert.equal(data.checkins.daily.find((d) => d.date === '2026-04-11')!.protein, true);
    assert.equal(data.body.weights[0]!.date, '2026-02-20');
    assert.equal(data.body.weights[0]!.unit, 'kg');
    assert.equal(data.body.weights.length, 48);
  });

  it('drops out-of-range and null values with a warning, never the whole day', () => {
    const d = data.checkins.daily.find((x) => x.date === '2026-03-22')!;
    assert.equal(d.steps, undefined);
    assert.equal(typeof d.sleepH, 'number');
    assert.equal(data.checkins.daily.find((x) => x.date === '2026-03-23')!.rhr, undefined);
    const r = fromVault(files((f) => {
      ((f['body'] as { days: Record<string, Record<string, unknown>> }).days['2026-03-02']!)['energy'] = 7;
    }));
    assert.deepEqual(r.warnings.find((w) => w.code === 'bad-value')!.items, ['2026-03-02 energy: 7', '2026-03-22 steps: -50']);
  });

  it('reads workout and protein ticks by ISO week into trained and protein', () => {
    const tick = data.checkins.daily.find((x) => x.date === '2026-04-09')!;
    assert.equal(tick.trained, true);
    assert.equal(data.checkins.daily.find((x) => x.date === '2026-04-05')!.trained, undefined); // "0" is not a tick
    assert.equal(data.checkins.daily.filter((x) => x.protein).length, 5);
    assert.equal(isoWeekDate(2026, 53, 4), '2027-01-01');
    assert.equal(isoWeekDate(2025, 53, 0), null);
    assert.equal(isoWeekDate(2027, 1, 0), '2027-01-04');
    assert.equal(isoWeekDate(2026, 15, 3), '2026-04-09');
  });

  it('keeps tape in cm, numeric tests and the photo index', () => {
    assert.deepEqual(data.body.tape[0], { date: '2026-02-24', unit: 'cm', waist: 96, hips: 98, chest: 101, arm: 33 });
    assert.deepEqual(data.body.tests[0], { date: '2026-03-07', results: { pushups: 12, pullups: 0, hollowS: 25, handstandS: 10 } });
    assert.deepEqual(data.body.photos[0], { date: '2026-02-24', poses: ['front', 'side', 'back'], folder: 'Progress Photos/2026-02-24/' });
  });

  it('reports ladder levels and what a test shows, as of a date', () => {
    assert.deepEqual(ladderStatus(data, '2026-04-12').map((l) => [l.id, l.level, l.levelName, l.testShowsLevel ?? null]), [
      ['pushup', 2, 'Floor push-up', null],
      ['handstand', 3, 'Chest-to-wall handstand', null],
    ]);
    assert.deepEqual(ladderStatus(data, '2026-03-10')[0]!.testShowsLevel, { level: 2, name: 'Floor push-up' });
  });

  it('reads the profile and the Ledger as schema v1', () => {
    assert.equal(data.profile!.goals[0]!.kind, 'recomposition');
    assert.equal(data.ledger!.constraints[0]!.until, '2026-04-19');
  });
});

// The gym's real weights (profile.loads): each loaded exercise carries them, in its own unit.
describe('vault adapter: the gym\'s real weights', () => {
  const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';
  const DATE = '2026-04-12';
  const withLoads = (loads: unknown) => {
    const f = fixtureFiles('v');
    const p = JSON.parse(f[PROFILE]!);
    p.loads = loads;
    f[PROFILE] = JSON.stringify(p);
    return readVault(memoryIo(f, DATE), 'v', { asOf: DATE });
  };

  it('without loads, no exercise carries weights (the plan step, as before)', () => {
    assert.equal(data.profile!.loads, undefined);
    assert.deepEqual(Object.values(data.program.exercises).filter((e) => e.weights), []);
  });

  it('by the catalogue\'s first equipment id, else dumbbells for a db lift, in the lift\'s unit', () => {
    const r = withLoads({ unit: 'lb', dumbbell: { from: 5, to: 60, step: 5 }, barbell: { bar: 45, plates: [45, 25, 10, 5, 2.5] }, cable: { step: 10, to: 200 } });
    const ex = r.data.program.exercises;
    assert.deepEqual(ex['goblet-squat']!.weights!.slice(0, 3), [5, 10, 15], 'a dumbbell movement');
    assert.equal(ex['goblet-squat']!.weights!.at(-1), 60);
    assert.deepEqual(ex['seated-cable-row']!.weights!.slice(0, 2), [10, 20]);
    // The squat is kg in this plan: the lb bar and plates converted, with a warning.
    assert.deepEqual(ex['barbell-back-squat']!.weights!.slice(0, 3), [20.4, 22.7, 24.9]);
    const w = r.data.warnings.find((x) => x.code === 'loads-unit-differs')!;
    assert.deepEqual(w.items, ['Barbell Back Squat: in kg, the loads in lb', 'Romanian Deadlift: in kg, the loads in lb']);
    assert.match(w.message, /loads are in lb/);
    assert.equal(ex['band-external-rotation']!.weights, undefined, 'no kit for bands');
    assert.equal(ex['hamstring-curl']!.weights, undefined, 'no machine listed');
    assert.deepEqual(validateProgram(r.data.program), []);
  });

  it('a kind the profile has no kit for keeps its plan step', () => {
    const r = withLoads({ unit: 'lb', dumbbell: { weights: [10, 20, 30] } });
    assert.equal(r.data.program.exercises['seated-cable-row']!.weights, undefined);
    assert.deepEqual(r.data.program.exercises['goblet-squat']!.weights, [10, 20, 30]);
    assert.equal(r.data.warnings.find((x) => x.code === 'loads-unit-differs'), undefined, 'the kg lifts have no kit here');
  });

  it('review\'s next targets land on the kit', () => {
    // The bench's two misses at 60 lb: 54 lb is not a dumbbell here, 55 is.
    const r = withLoads({ unit: 'lb', dumbbell: { from: 5, to: 60, step: 5 } });
    const bench = buildReview(r.data, DATE).lifts.find((l) => l.exercise === 'flat-db-bench-press')!;
    const n = bench.next as { value: { action: string; weight: number } };
    assert.deepEqual([n.value.action, n.value.weight], ['lighter', 55]);
    const odd = withLoads({ unit: 'lb', dumbbell: { weights: [40, 50, 52.5, 60] } });
    const b2 = (buildReview(odd.data, DATE).lifts.find((l) => l.exercise === 'flat-db-bench-press')!.next as { value: { weight: number } }).value.weight;
    assert.equal(b2, 52.5);
  });

  it('an invalid kit is a profile error, with the path', () => {
    const r = withLoads({ unit: 'kg', dumbbell: { from: 30, to: 2, step: 2 } });
    assert.ok(r.data.errors.some((e) => e.code === 'profile' && /loads\.dumbbell: from \(30\) is above to \(2\)/.test(e.message)), JSON.stringify(r.data.errors));
  });
});

describe('vault adapter: a lifts entry matched to its exercise by id', () => {
  it('a lift key that differs from the guide key beyond case keeps its entry (db, inc and unit)', () => {
    const f = fixtureFiles('v');
    const P = 'v/3-Personal/Fitness/plan-data.json';
    const plan = JSON.parse(f[P]!);
    plan.lifts['flat db bench-press'] = { ...plan.lifts['Flat DB Bench Press'], inc: 2.5 };
    delete plan.lifts['Flat DB Bench Press'];
    f[P] = JSON.stringify(plan);
    const ex = readVault(memoryIo(f, '2026-04-12'), 'v', { asOf: '2026-04-12' }).data.program.exercises['flat-db-bench-press']! as { increment?: number; _lift?: { db?: boolean } };
    assert.equal(ex._lift?.db, true);
    assert.equal(ex.increment, 2.5);
  });
});
