// What the Log panel saves and the engine now reads: every set (each
// exercise's sets with weight, reps and RIR) for e1RM, next and the sets
// done; the Hotel version, left out of the lifts' strength numbers but
// counted for adherence and volume; and each skipped line's reason (time,
// pain, equipment, energy), grouped by exercise in review's `skips` with the
// flags they raise. Old entries without these fields read as before.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { buildLogEntry, checklistLines } from '../src/adapters/vault/log-write.ts';
import { run } from '../src/cli/cli.ts';
import { bestSet, topSets, trendSets } from '../src/core/history.ts';
import type { Exercise, Session } from '../src/core/schema.ts';
import { skipReport, SKIPS, type SkipLine } from '../src/core/skips.ts';
import { validateSession } from '../src/core/validate.ts';
import { setsPerMuscle } from '../src/core/volume.ts';
import { buildProgress, buildProgressMore, buildReview, buildTemplate, buildToday, context, liftTopSets, skipWarnings } from '../src/report/index.ts';
import { fixtureFiles, memoryIo, session, set, slot } from './helpers.ts';

type Json = Record<string, any>;
const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const CHECKINS = 'v/3-Personal/Fitness/Coach/checkins.json';
type Edit = (f: Record<string, string>) => void;

/** The synthetic log with some sessions changed, by date. */
const edit = (by: Record<string, (s: Json) => void>): Edit => (f) => {
  const log = JSON.parse(f[LOG]!);
  for (const s of log.sessions) by[s.date]?.(s);
  f[LOG] = JSON.stringify(log);
};
const files = (...edits: Edit[]) => {
  const f = fixtureFiles('v');
  for (const e of edits) e(f);
  return f;
};
const read = (date: string, ...edits: Edit[]) => readVault(memoryIo(files(...edits), date), 'v', { asOf: date });
const review = (date: string, ...edits: Edit[]) => buildReview(read(date, ...edits).data, date);
const lift = (r: ReturnType<typeof buildReview>, id: string) => r.lifts.find((l) => l.exercise === id)! as ReturnType<typeof buildReview>['lifts'][number] & { hotel?: { value: { sessions: { date: string }[] }; reason: { rule: string; title: string; note?: string } } };
const lb = (weight: number, reps: number, rir?: number) => ({ weight, unit: 'lb', reps, ...(rir !== undefined ? { rir } : {}) });

/** Wed 8 Apr's Full Body A logged with every set: the goblet squat's best set by e1RM (55 x 10) is not its top set (60 x 5). */
const EVERY = edit({
  '2026-04-08': (s) => {
    s.trackingLevel = 'full';
    s.lift1 = { name: 'Goblet Squat', ...lb(60, 5) };
    s.lift2 = { name: 'Flat DB Bench Press', ...lb(60, 8) };
    s.exerciseSets = [
      { name: 'Goblet Squat', sets: [lb(60, 5), lb(55, 10)] },
      { name: 'Flat DB Bench Press', sets: [lb(60, 8, 1), lb(60, 8, 1), lb(60, 8, 2)] },
    ];
  },
});

describe('every set, read back', () => {
  it('the Log panel’s every-set entry reads as Full tracking, each exercise with its sets and RIR, a logged lift not counted twice', () => {
    const f = files();
    const plan = JSON.parse(f[PLAN]!);
    const log = JSON.parse(f[LOG]!);
    const lines = checklistLines(plan, 'A', false, false).map((l) => ({ name: l.name, done: true }));
    const built = buildLogEntry(
      {
        date: '2026-04-09',
        type: 'A',
        lift1: { name: 'Goblet Squat', ...lb(60, 5) },
        lift2: { name: 'Flat DB Bench Press', ...lb(60, 8) },
        lines,
        trackingLevel: 'full',
        exerciseSets: [
          { name: 'Goblet Squat', sets: [{ ...lb(60, 5), rir: null }, { weight: 55, unit: 'lb', reps: 10, rir: 2 }] },
          { name: 'Flat DB Bench Press', sets: [lb(60, 8, 1)] },
          { name: 'Side Plank', sets: [{ weight: null, unit: null, reps: 45 }] },
        ],
      },
      { plan, log, today: '2026-04-12' },
    );
    assert.ok(built.ok);
    log.sessions.push(built.entry);
    f[LOG] = JSON.stringify(log);
    const s = readVault(memoryIo(f, '2026-04-12'), 'v', { asOf: '2026-04-12' }).data.sessions.find((x) => x.date === '2026-04-09')!;
    assert.equal(s.trackingLevel, 'full');
    assert.deepEqual(s.exercises, [
      { exercise: 'goblet-squat', sets: [{ weight: 60, unit: 'lb', reps: 5 }, { weight: 55, unit: 'lb', reps: 10, rir: 2 }] },
      { exercise: 'flat-db-bench-press', sets: [{ weight: 60, unit: 'lb', reps: 8, rir: 1 }] },
      // A set without a weight (bodyweight, or a hold) is 0 in the exercise's unit, as a bodyweight lift1 is.
      { exercise: 'side-plank', sets: [{ weight: 0, unit: 'lb', reps: 45 }] },
    ]);
    assert.deepEqual(validateSession(s), []);
  });

  it('e1RM takes each session’s best set by e1RM (Epley, as before), not its top set, and says so', () => {
    const r = review('2026-04-12', EVERY);
    const t = lift(r, 'goblet-squat').e1rm;
    const last = t.value.points.at(-1)!;
    assert.deepEqual([last.date, last.weight, last.reps], ['2026-04-08', 55, 10]);
    assert.ok(Math.abs(last.e1rm - 55 * (1 + 10 / 30)) < 1e-9);
    assert.match(t.reason.note!, /Every set logged: each session's best set by e1RM is used, not its heaviest \(Wed 8 Apr: 55 lb x 10 over 60 lb x 5\)\./);
    // The top set is still the lift's top set: its last top set, the week's lifts and the progression base read it.
    assert.deepEqual([lift(r, 'goblet-squat').last!.weight, lift(r, 'goblet-squat').last!.reps], [60, 5]);
    assert.deepEqual(r.thisWeek.sessions.find((s) => s.date === '2026-04-08')!.lifts.map((l) => [l.name, l.weight, l.reps, (l as Json).sets]), [['Goblet Squat', 60, 5, 2], ['Flat DB Bench Press', 60, 8, 3]]);
    // The Progress tab reads the same sets, naming the heaviest beside the best.
    const p = buildProgress(read('2026-04-12', EVERY), '2026-04-12') as Json;
    const sq = p.lifts.find((l: Json) => l.exercise === 'goblet-squat');
    assert.deepEqual(sq.sets.at(-1).top, { weight: 60, reps: 5 });
    assert.equal(sq.sets.at(-1).weight, 55);
    // Records keep the top-set rule: the 8th's 60 x 5 is the heaviest, so it is the record, beside its e1RM.
    const more = buildProgressMore(read('2026-04-12', EVERY), '2026-04-12') as Json;
    const rec = more.training.lifts.find((l: Json) => l.exercise === 'goblet-squat').records;
    assert.deepEqual([rec.sets.at(-1).weight, rec.sets.at(-1).reps, rec.sets.at(-1).record], [60, 5, true]);
  });

  it('bestSet: the best Epley e1RM in kg, ties to the heavier; reps + RIR over 10 has none; none at all is the top set', () => {
    assert.deepEqual(bestSet([set(100, 5), set(90, 10)]), set(90, 10));
    assert.deepEqual(bestSet([set(90, 10, 'kg', 1), set(100, 5)]), set(100, 5), '90 x 10 at RIR 1 is 11 reps: no e1RM');
    assert.deepEqual(bestSet([set(50, 12), set(60, 11)]), set(60, 11), 'no e1RM on any: the top set');
    assert.deepEqual(bestSet([set(100, 6, 'lb'), set(50, 6, 'kg')]), set(50, 6, 'kg'), 'compared in kg');
    assert.deepEqual(bestSet([set(0, 20), set(20, 0)]), undefined, 'no set with a weight and reps');
    // One set per session, as topSets has it, with the heaviest named when it is not the one used.
    const s = [session('2026-03-02', { level: 'full', logged: { sq: [set(100, 5), set(90, 10)] } }), session('2026-03-05', { logged: { sq: [set(100, 6)] } })];
    assert.deepEqual(trendSets(s, 'sq'), [{ date: '2026-03-02', weight: 90, unit: 'kg', reps: 10, top: { weight: 100, unit: 'kg', reps: 5 } }, { date: '2026-03-05', weight: 100, unit: 'kg', reps: 6 }]);
    assert.deepEqual(trendSets([s[1]!], 'sq'), topSets([s[1]!], 'sq'));
  });

  it('a logged RIR on the sets feeds next where the check-in’s reported RIR did, and wins over it', () => {
    const asked: Edit = (f) => void (f[CHECKINS] = JSON.stringify({ schemaVersion: 1, checkins: [{ date: '2026-04-12', weekStart: '2026-04-06', reportedRir: 3 }] }));
    const top8 = edit({ '2026-04-08': (s) => void (s.lift2 = { name: 'Flat DB Bench Press', ...lb(60, 8) }) });
    // Standard: the top set alone, with the check-in's RIR 3: every set assumed at 8, in reserve, so add weight.
    const std = lift(review('2026-04-12', top8, asked), 'flat-db-bench-press').next!;
    assert.equal((std.value as Json).action, 'increase');
    assert.match(std.reason.note!, /check-in reported RIR 3 on the top sets/);
    // Every set with RIR 1, 1, 2: less than 2 in reserve, so hold; the check-in's RIR is for sessions without one.
    const full = lift(review('2026-04-12', EVERY, asked), 'flat-db-bench-press').next!;
    assert.deepEqual([(full.value as Json).action, (full.value as Json).weight, (full.value as Json).assumedAllSets], ['hold', 60, false]);
    assert.deepEqual(full.reason.inputs['loggedRir'], [1, 1, 2]);
    assert.equal(full.reason.inputs['reportedRir'], undefined);
    assert.match(full.reason.note!, /RIR as logged on the sets: 1, 1, 2 \(the 2026-04-12 check-in's reported RIR is for sessions without one\)\./);
    // The RIR is in the trend's set too (Epley with RIR, as before): 60 x 8 at RIR 2.
    const p = lift(review('2026-04-12', EVERY), 'flat-db-bench-press').e1rm.value.points.at(-1)!;
    assert.deepEqual([p.weight, p.reps, p.rir], [60, 8, 2]);
  });

  it('volume done counts the sets done; a planned item logged without sets (a superset’s pair) counts its planned sets', () => {
    // Fri 3 Apr's A: the goblet squat logged with 2 of its 4 sets, the bench with its 3; Face Pull + Band ER, a pair, takes no sets in the panel.
    const full = edit({
      '2026-04-03': (s) => {
        s.trackingLevel = 'full';
        s.exerciseSets = [
          { name: 'Goblet Squat', sets: [lb(55, 8), lb(55, 8)] },
          { name: 'Flat DB Bench Press', sets: [lb(60, 5), lb(60, 5), lb(60, 5)] },
        ];
      },
    });
    const before = review('2026-04-05').volume.done;
    const after = review('2026-04-05', full).volume.done;
    assert.equal(after.value.total['quads']! - before.value.total['quads']!, -2, 'goblet squat: 2 sets done, not the 4 planned');
    assert.equal(after.value.total['chest'], before.value.total['chest'], 'bench: 3 done, 3 planned');
    assert.equal(after.value.total['shoulders'], before.value.total['shoulders'], 'the pair at its planned sets');
    assert.match(after.reason.note!, /Every set logged on 1 session: the sets done, and a planned item logged without sets \(a superset's pair, a row left blank\) at its planned sets\./);
  });

  it('setsPerMuscle at Full: the logged sets, a skipped item left out, an unlogged planned one at its sets', () => {
    const EX: Record<string, Exercise> = {
      squat: { name: 'Squat', unit: 'kg', increment: 2.5, muscles: { main: ['quads'], helps: [] } },
      row: { name: 'Row', unit: 'kg', increment: 2.5, muscles: { main: ['lats'], helps: [] } },
      curl: { name: 'Curl', unit: 'kg', increment: 1, muscles: { main: ['biceps'], helps: [] } },
    };
    const s: Session = { ...session('2026-03-24', { level: 'full', logged: { squat: [set(60, 5), set(60, 5)] }, slots: [slot('squat', 4, 5, 8), slot('row', 3, 8, 10), slot('curl', 2, 10, 12)], skipped: ['curl'] }) };
    const r = setsPerMuscle([s], EX, '2026-03-23', '2026-03-29');
    assert.deepEqual(r.value.total, { quads: 2, lats: 3 });
    assert.equal(r.value.estimated, true);
    // Every planned item logged: not an estimate, as before.
    const all = setsPerMuscle([session('2026-03-24', { level: 'full', logged: { squat: [set(60, 5)] }, slots: [slot('squat', 4, 5, 8)] })], EX, '2026-03-23', '2026-03-29');
    assert.deepEqual([all.value.total, all.value.estimated], [{ quads: 1 }, false]);
  });

  it('a malformed every-set entry or set is left out with a warning, the rest kept', () => {
    const bad = edit({
      '2026-04-08': (s) => {
        s.trackingLevel = 'full';
        s.exerciseSets = [{ name: 'Goblet Squat', sets: [lb(55, 8), { weight: -5, reps: 8 }, { weight: 50, reps: 'eight' }, { weight: 50, reps: 8, rir: -1 }] }, { sets: [] }];
      },
    });
    const r = read('2026-04-12', bad);
    const s = r.data.sessions.find((x) => x.date === '2026-04-08')!;
    assert.deepEqual(s.exercises.find((x) => x.exercise === 'goblet-squat')!.sets, [{ weight: 55, unit: 'lb', reps: 8 }]);
    assert.equal(r.data.warnings.find((w) => w.code === 'bad-set')!.items!.length, 3);
    assert.equal(r.data.warnings.find((w) => w.code === 'bad-sets')!.items!.length, 1);
  });
});

describe('Hotel sessions', () => {
  // Wed 8 Apr's A done at the hotel: the goblet squat with light dumbbells, reps up.
  const HOTEL = edit({ '2026-04-08': (s) => void ((s.hotel = true), (s.lift1 = { name: 'Goblet Squat', ...lb(30, 15) })) });

  it('a Hotel session is left out of the lift’s e1RM trend, stall check and next target, and the lift says so', () => {
    const plain = lift(review('2026-04-12', edit({ '2026-04-08': (s) => void (s.lift1 = { name: 'Goblet Squat', ...lb(30, 15) }) })), 'goblet-squat');
    const r = review('2026-04-12', HOTEL);
    const l = lift(r, 'goblet-squat');
    assert.ok(plain.sessions > l.sessions, 'the Hotel session no longer counts as a session of the lift');
    assert.ok(l.e1rm.value.points.every((p) => p.date !== '2026-04-08'));
    assert.equal((l.next!.reason.inputs['last'] as Json).date, '2026-04-03', 'next starts from the last session at home');
    assert.deepEqual(l.hotel!.value.sessions, [{ date: '2026-04-08', name: 'Full Body A' }]);
    assert.deepEqual([l.hotel!.reason.rule, l.hotel!.reason.title], ['lifts.hotel', 'Hotel session']);
    assert.equal(l.hotel!.reason.note, "Left out of Goblet Squat's e1RM trend, stall check and next target: the Hotel session of Wed 8 Apr (other equipment).");
    assert.match(l.e1rm.reason.note!, /the Hotel session of Wed 8 Apr \(other equipment\)\.$/);
    // The stall check reads the same trend.
    assert.deepEqual(l.stall.reason.inputs, lift(review('2026-04-12', edit({ '2026-04-08': (s) => void (s.lift1 = null) })), 'goblet-squat').stall.reason.inputs);
    // The week marks it, with its reason.
    const w = r.thisWeek.sessions.find((s) => s.date === '2026-04-08') as Json;
    assert.equal(w.hotel, true);
    assert.equal(w.hotelReason.rule, 'lifts.hotel');
    assert.equal(w.hotelReason.note, "Done as the Hotel version (bodyweight, light dumbbells, bands): it counts for adherence and the week's sets, by its own exercises, and is left out of the lifts' e1RM trends, stall checks and next targets (Goblet Squat, Flat DB Bench Press).");
    // The Progress tab's strength note.
    const p = buildProgress(read('2026-04-12', HOTEL), '2026-04-12') as Json;
    assert.equal(p.lifts.find((x: Json) => x.exercise === 'goblet-squat').hotel, 'Hotel session left out: Wed 8 Apr (other equipment).');
    assert.equal(p.lifts.find((x: Json) => x.exercise === 'romanian-deadlift').hotel, null);
    // The Sunday RIR question asks about the week's top sets at home only.
    const rir = (t: ReturnType<typeof buildTemplate>) => ((t.ask.find((a) => a.topic === 'rir') as { known: Json }).known['topSets'] as Json[]).map((x) => x.date);
    assert.ok(rir(buildTemplate(read('2026-04-12').data, '2026-04-12', null)).includes('2026-04-08'));
    assert.ok(!rir(buildTemplate(read('2026-04-12', HOTEL).data, '2026-04-12', null)).includes('2026-04-08'));
  });

  it('a Hotel swap: the plan’s lift it replaced names it, the swap feeds no trend; adherence and volume count it by its own exercises', () => {
    const swap = edit({
      '2026-04-11': (s) => {
        s.hotel = true;
        s.lift1 = { name: 'Dumbbell Romanian Deadlift', planned: 'Romanian Deadlift', ...lb(40, 15) };
      },
    });
    const home = review('2026-04-12');
    const r = review('2026-04-12', swap);
    assert.deepEqual(lift(r, 'romanian-deadlift').hotel!.value.sessions.map((x) => x.date), ['2026-04-11']);
    assert.equal(r.lifts.find((l) => l.exercise === 'dumbbell-romanian-deadlift'), undefined, 'a lift done only at the hotel is not a lift with a trend');
    assert.deepEqual(r.adherence.value, home.adherence.value);
    assert.equal(r.thisWeek.lifting.done, home.thisWeek.lifting.done);
    const s = read('2026-04-12', swap).data.sessions.find((x) => x.date === '2026-04-11')!;
    assert.equal(s.hotel, true);
    assert.ok(s.plan!.slots.some((x) => x.exercise === 'dumbbell-romanian-deadlift'), 'the snapshot holds the swap, so volume counts its own muscles');
    assert.equal(r.volume.done.value.sessions, home.volume.done.value.sessions);
    assert.deepEqual(liftTopSets(context(read('2026-04-12', swap).data, '2026-04-12'), 'dumbbell-romanian-deadlift'), []);
  });
});

describe('skip reasons', () => {
  /** Face Pull + Band ER skipped for pain on two A days; the split squat for equipment on two B days; the finisher for time on two days of one week. */
  const SKIPS_EDIT = edit({
    '2026-04-03': (s) => void (s.checklist = { done: 4, total: 5, skipped: ['Face Pull + Band External Rotation'], why: { 'Face Pull + Band External Rotation': 'pain' } }),
    '2026-04-06': (s) => void (s.checklist = { done: 3, total: 5, skipped: ['Bulgarian Split Squat', 'Zone 2 finisher'], why: { 'Bulgarian Split Squat': 'equipment', 'Zone 2 finisher': 'time' } }),
    '2026-04-08': (s) => void (s.checklist = { done: 3, total: 5, skipped: ['Face Pull + Band External Rotation', 'Zone 2 finisher'], why: { 'Face Pull + Band External Rotation': 'Pain', 'Zone 2 finisher': 'time' } }),
    '2026-04-11': (s) => void ((s.swaps = []), (s.checklist = { done: 4, total: 5, skipped: ['Bulgarian Split Squat'], why: { 'Bulgarian Split Squat': 'equipment' } })),
  });

  it('the adapter reads each skipped line’s reason onto its exercises (both of a pair), and leaves out an unknown one with a warning', () => {
    const r = read('2026-04-12', SKIPS_EDIT, edit({ '2026-04-01': (s) => void (s.checklist = { done: 4, total: 5, skipped: ['Side Plank'], why: { 'Side Plank': 'bored' } }) }));
    const s = r.data.sessions.find((x) => x.date === '2026-04-08')!;
    assert.deepEqual(s.skipWhy, { 'face-pull': 'pain', 'band-external-rotation': 'pain', 'zone-2-finisher': 'time' });
    assert.deepEqual(validateSession(s), []);
    const odd = r.data.sessions.find((x) => x.date === '2026-04-01')!;
    assert.deepEqual([odd.skipped, odd.skipWhy], [['side-plank'], undefined]);
    assert.deepEqual(r.data.warnings.find((w) => w.code === 'skip-why')!.items, ['2026-04-01 Side Plank: "bored"']);
    // A reason goes with a skipped item.
    assert.ok(validateSession({ ...s, skipWhy: { squat: 'time' } }).some((e) => /is not in skipped/.test(e.message)));
    assert.ok(validateSession({ ...s, skipWhy: { 'face-pull': 'tired' } }).length > 0);
  });

  it('review’s skips: the last 4 weeks’ skipped lines by exercise with their reasons, and a reason for the whole', () => {
    const k = review('2026-04-12', SKIPS_EDIT).skips;
    assert.deepEqual([k.value.from, k.value.to, k.value.lines, k.value.withReason], ['2026-03-16', '2026-04-12', 8, 8]);
    assert.deepEqual(k.value.byExercise.map((g) => [g.name, g.reasons]), [
      ['Band External Rotation', { pain: 2 }],
      ['Bulgarian Split Squat', { equipment: 2 }],
      ['Face Pull', { pain: 2 }],
      ['Zone 2 finisher', { time: 2 }],
    ]);
    assert.deepEqual(k.value.byExercise[0]!.skips, [{ date: '2026-04-03', type: 'A', session: 'Full Body A', reason: 'pain' }, { date: '2026-04-08', type: 'A', session: 'Full Body A', reason: 'pain' }]);
    assert.deepEqual([k.reason.rule, k.reason.title], ['skips', 'Skipped lines']);
    assert.equal(k.reason.note, "8 items skipped since Mon 16 Mar (a paired line's two count apart), 8 with a reason (time 2, pain 4, equipment 2). 4 flags: 2 for pain, 1 for equipment, 1 for time.");
  });

  it('Pain twice in 4 weeks is the pain rule’s swap; Equipment twice suggests a swap; each once in the warnings and Today’s Data notes', () => {
    const r = review('2026-04-12', SKIPS_EDIT);
    const pain = r.skips.value.flags.filter((f) => f.value.kind === 'pain');
    assert.deepEqual(pain.map((f) => [f.value.exercises[0]!.name, f.value.action, f.value.dates]), [['Band External Rotation', 'pain-rule', ['2026-04-03', '2026-04-08']], ['Face Pull', 'pain-rule', ['2026-04-03', '2026-04-08']]]);
    assert.deepEqual([pain[1]!.reason.rule, pain[1]!.reason.title, pain[1]!.reason.threshold], ['skips.pain', 'Skipped for pain', { skips: 2, days: 28 }]);
    assert.equal(pain[1]!.reason.note, 'Face Pull skipped for pain twice in 4 weeks (Fri 3 Apr, Wed 8 Apr): the pain rule, so change the load, the range or the exercise (a pain-free variant) and keep training everything else; a Ledger entry. Tell the coach.');
    const eq = r.skips.value.flags.find((f) => f.value.kind === 'equipment')!;
    assert.deepEqual([eq.value.exercises[0]!.name, eq.value.action, eq.value.dates], ['Bulgarian Split Squat', 'suggest-swap', ['2026-04-06', '2026-04-11']]);
    assert.match(eq.reason.note!, /^Bulgarian Split Squat skipped for equipment twice in 4 weeks \(Mon 6 Apr, Sat 11 Apr\): suggest a swap/);
    const w = skipWarnings(r.skips);
    assert.deepEqual(w.map((x) => [x.code, x.items]), [['skip-pain', ['Band External Rotation', 'Face Pull']], ['skip-equipment', ['Bulgarian Split Squat']]]);
    assert.equal(w[0]!.message, 'Skipped for pain twice or more in 4 weeks: Band External Rotation (Fri 3 Apr, Wed 8 Apr); Face Pull (Fri 3 Apr, Wed 8 Apr). The pain rule: change the load, the range or the exercise, and keep training everything else. Tell the coach, for the Ledger.');
    const today = buildToday(read('2026-04-12', SKIPS_EDIT), '2026-04-12', 'full', 'v');
    assert.deepEqual(today.warnings.filter((x) => x.code.startsWith('skip-')).map((x) => x.code), ['skip-pain', 'skip-equipment']);
    const out = JSON.parse(run(['review', '--vault', 'v', '--date', '2026-04-12'], memoryIo(files(SKIPS_EDIT), '2026-04-12')).stdout) as Json;
    assert.deepEqual(out.warnings.filter((x: Json) => x.code.startsWith('skip-')), w);
    assert.equal(out.skips.value.flags.length, 4);
  });

  it('once is no flag, and a skip older than 4 weeks is out', () => {
    const once = review('2026-04-12', edit({ '2026-04-08': (s) => void (s.checklist = { done: 3, total: 4, skipped: ['Face Pull + Band External Rotation'], why: { 'Face Pull + Band External Rotation': 'pain' } }) }));
    assert.deepEqual([once.skips.value.withReason, once.skips.value.flags], [2, []]);
    assert.deepEqual(skipWarnings(once.skips), []);
    // Five weeks on, the 3rd and the 8th are both past the 4 weeks.
    assert.deepEqual(review('2026-05-10', SKIPS_EDIT).skips.value.flags.filter((f) => f.value.kind === 'pain'), []);
  });

  it('Time on 2 sessions of one week: the session is too long for you, pointing at the review’s time; in different weeks, nothing', () => {
    const r = review('2026-04-12', SKIPS_EDIT);
    const t = r.skips.value.flags.find((f) => f.value.kind === 'time')!;
    assert.deepEqual([t.value.week, t.value.types, t.value.dates, t.value.action], ['2026-04-06', ['B', 'A'], ['2026-04-06', '2026-04-08'], 'too-long']);
    const planned = (type: string) => r.time.sessions.filter((x) => x.type === type).map((x) => ({ type: x.type, name: x.name, minutes: x.check.value.minutes, limit: x.check.value.limit, over: x.check.value.over }));
    assert.deepEqual(t.value.time, [...planned('B'), ...planned('A')]);
    assert.equal(t.reason.inputs['see'], 'time');
    assert.match(t.reason.note!, /^Lines skipped for time on 2 sessions in the week of Mon 6 Apr \(Full Body B, Mon 6 Apr; Full Body A, Wed 8 Apr\): the session is too long for you\. As planned \(the review's time\): B about \d+ min of your 60, A about \d+ min of your 60; as logged: B 60 min, A 60 min\./);
    const apart = review('2026-04-12', edit({
      '2026-04-01': (s) => void (s.checklist = { done: 4, total: 5, skipped: ['Zone 2 finisher'], why: { 'Zone 2 finisher': 'time' } }),
      '2026-04-08': (s) => void (s.checklist = { done: 4, total: 5, skipped: ['Zone 2 finisher'], why: { 'Zone 2 finisher': 'time' } }),
    }));
    assert.deepEqual(apart.skips.value.flags, []);
  });

  it('Energy on a low-readiness day is a note, never a rule on its own; on another day, nothing', () => {
    const line = (date: string, session: string, reason: SkipLine['reason']): SkipLine => ({ date, session, type: 'A', sessionName: 'Full Body A', exercise: 'face-pull', name: 'Face Pull', reason });
    const lines = [line('2026-04-03', 's1', 'energy'), line('2026-04-08', 's2', 'energy')];
    const k = skipReport(lines, '2026-04-12', { bandOn: (d) => (d === '2026-04-08' ? 'low' : 'normal') });
    assert.deepEqual(k.value.flags.map((f) => [f.value.kind, f.value.action, f.value.dates]), [['energy', 'note', ['2026-04-08']]]);
    assert.equal(k.value.flags[0]!.reason.note, "Face Pull skipped for energy on Wed 8 Apr, a low-readiness day: a note for the coach with the week's sleep and stress, not a rule on its own.");
    assert.deepEqual(skipWarnings(k), [], 'not in the warnings');
    assert.deepEqual(skipReport(lines, '2026-04-12').value.flags, [], 'no readiness: no note');
    assert.equal(SKIPS.lowBand, 'low');
  });
});

describe('old entries read as before', () => {
  it('no Full tracking, no Hotel, no skip reasons; every lift’s trend sets are its top sets; nothing to flag', () => {
    const r = read('2026-04-12');
    assert.ok(r.data.sessions.every((s) => s.trackingLevel !== 'full' && s.hotel === undefined && s.skipWhy === undefined));
    const ctx = context(r.data, '2026-04-12');
    const rv = buildReview(r.data, '2026-04-12');
    for (const l of rv.lifts) assert.deepEqual(liftTopSets(ctx, l.exercise), topSets(ctx.sessions, l.exercise), l.name);
    assert.ok(rv.lifts.every((l) => !('hotel' in l)));
    assert.ok(rv.thisWeek.sessions.every((s) => !('hotel' in s) && !('everySet' in s)));
    // The fixture's one skipped line in the 4 weeks (the 8th's pair, two items) has no reason: listed, nothing flagged.
    assert.deepEqual([rv.skips.value.lines, rv.skips.value.withReason, rv.skips.value.flags], [2, 0, []]);
    assert.deepEqual(rv.skips.value.byExercise.map((g) => [g.name, g.reasons]), [['Band External Rotation', { none: 1 }], ['Face Pull', { none: 1 }]]);
    assert.deepEqual(skipWarnings(rv.skips), []);
    assert.equal(buildToday(r, '2026-04-12', 'full', 'v').warnings.filter((w) => w.code.startsWith('skip-')).length, 0);
  });
});
