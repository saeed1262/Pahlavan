// The exercise facts (core/exercise-facts.ts): each planned exercise's
// planned, done-as-planned, skipped and swapped counts with their reasons,
// over the cycle and its last 4 weeks, on a made-up log; and the swap's
// reason, saved by the Log panel and `log add` (`lift.swapWhy`,
// `swaps[].why`), read back by the adapter onto the slot and into review's
// `exercises`. An Express session's left-out items are not planned that
// day, and an older entry with no checklist counts as not recorded.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLogEntry, mergeFix } from '../src/adapters/vault/log-write.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { run } from '../src/cli/cli.ts';
import { exerciseFacts, SWAP_WORDS, swapReasonOf } from '../src/core/exercise-facts.ts';
import type { ExerciseSlot, Session } from '../src/core/schema.ts';
import { validateSession } from '../src/core/validate.ts';
import { buildReview, inputFromForm, logFormFromEntry } from '../src/report/index.ts';
import { fixtureFiles, memoryIo, session, set, slot } from './helpers.ts';

type Json = Record<string, any>;
type Slot = ExerciseSlot & { _planned?: string; _swapWhy?: string };
const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';

const sl = (exercise: string, extra: Partial<Slot> = {}): Slot => ({ ...slot(exercise, 3, 8, 10), ...extra });
const withPlan = (s: Session, extra: Partial<Session> = {}): Session => ({ ...s, ...extra });

/**
 * A made-up log, squat, row and plank planned each session:
 * 23 Feb, an older entry with no checklist, the squat logged; 2 Mar all done; 9 Mar the squat skipped
 * for pain, the row swapped (yours), the plank skipped for time; 16 Mar Express (the squat only);
 * 23 Mar at the hotel, the squat swapped with no reason saved, the row skipped with none;
 * 6 Apr the row swapped for the Ledger, twice over the span with 9 Mar; 30 Mar a rebuilt plan, left out.
 */
const LOG_SESSIONS: Session[] = [
  session('2026-02-23', { logged: { squat: [set(60, 5)] }, slots: [sl('squat'), sl('row'), sl('plank')] }),
  session('2026-03-02', { logged: { squat: [set(62.5, 5)] }, slots: [sl('squat'), sl('row'), sl('plank')] }),
  withPlan(session('2026-03-09', { slots: [sl('squat'), sl('band-row', { _planned: 'Row', _swapWhy: 'mine' }), sl('plank')], skipped: ['squat', 'plank'] }), { skipWhy: { squat: 'pain', plank: 'time' } }),
  session('2026-03-16', { logged: { squat: [set(65, 5)] }, slots: [sl('squat', { main: true })] }),
  withPlan(session('2026-03-23', { slots: [sl('goblet-squat', { _planned: 'Squat' }), sl('row'), sl('plank')], skipped: ['row'] }), { hotel: true }),
  session('2026-04-06', { logged: { squat: [set(65, 6)] }, slots: [sl('squat'), sl('cable-row', { _planned: 'Row', _swapWhy: 'ledger' }), sl('plank')] }),
];
const rebuilt = session('2026-03-30', { slots: [sl('squat'), sl('row'), sl('plank')] });
(rebuilt.plan as Session['plan'] & { _rebuilt?: true })._rebuilt = true;
const SESSIONS = [...LOG_SESSIONS, rebuilt];
const NAMES: Record<string, string> = { squat: 'Squat', row: 'Row', plank: 'Plank', 'band-row': 'Band Row', 'cable-row': 'Cable Row', 'goblet-squat': 'Goblet Squat' };
const OPTS = { from: '2026-02-23', to: '2026-04-12', last4From: '2026-03-16', recorded: (s: Session) => s.date !== '2026-02-23', nameOf: (id: string) => NAMES[id] ?? null };
const facts = () => exerciseFacts(SESSIONS, OPTS);
const row = (id: string) => facts().value.exercises.find((x) => x.id === id)!;

describe('exercise facts on a made-up log', () => {
  it('counts each planned exercise: planned, as planned, skipped and swapped with their reasons, not recorded', () => {
    const sq = row('squat');
    assert.deepEqual([sq.planned, sq.asPlanned, sq.skipped.n, sq.swapped.n, sq.unrecorded], [6, 4, 1, 1, 0]);
    assert.deepEqual(sq.skipped.reasons, { time: 0, pain: 1, equipment: 0, energy: 0, none: 0 });
    // The hotel session's swap with no reason saved is the Hotel version's.
    assert.deepEqual(sq.swapped.why, { mine: 0, ledger: 0, soreness: 0, hotel: 1, unknown: 0 });
    assert.deepEqual(sq.swapped.to, [{ name: 'Goblet Squat', n: 1 }]);
    const r = row('row');
    assert.deepEqual([r.planned, r.asPlanned, r.skipped.n, r.swapped.n, r.unrecorded], [5, 1, 1, 2, 1]);
    assert.deepEqual(r.skipped.reasons, { time: 0, pain: 0, equipment: 0, energy: 0, none: 1 });
    assert.deepEqual(r.swapped.why, { mine: 1, ledger: 1, soreness: 0, hotel: 0, unknown: 0 });
    assert.deepEqual(r.swapped.to, [{ name: 'Band Row', n: 1 }, { name: 'Cable Row', n: 1 }]);
    assert.equal(r.note, 'Row: planned 5 times, done as planned 1, skipped 1 (no reason 1), swapped 2 (your swap 1, the Ledger 1; for Band Row, Cable Row), 1 not recorded (an older entry with no checklist); last done Mon 2 Mar.');
    const p = row('plank');
    assert.deepEqual([p.planned, p.asPlanned, p.skipped.n, p.swapped.n, p.unrecorded], [5, 3, 1, 0, 1]);
    assert.deepEqual(p.skipped.reasons.time, 1);
  });

  it('an Express session’s left-out items are not planned that day; a rebuilt plan is left out and counted', () => {
    // 16 Mar's Express holds only the squat: the row and the plank are planned 5 times, not 6.
    assert.deepEqual([row('row').planned, row('plank').planned], [5, 5]);
    const f = facts();
    assert.deepEqual([f.value.sessions, f.value.unrecordedSessions, f.value.leftOut], [6, 1, 1]);
    assert.equal(f.reason.rule, 'exercises');
    assert.equal(f.reason.title, 'Exercise facts');
    assert.equal(f.reason.note, 'Since Mon 23 Feb to Sun 12 Apr: 6 sessions with a plan, 3 exercises in them, skipped 3 and swapped 3 in all; the last 4 weeks from Mon 16 Mar. 1 of the sessions is an older entry with no checklist: its items count as not recorded, unless their sets were logged. 1 session with no saved exercise list left out: its plan is today\'s, not that day\'s.');
  });

  it('an older entry with no checklist: its logged sets count as done as planned, the rest not recorded', () => {
    const old = exerciseFacts(SESSIONS, { ...OPTS, to: '2026-02-28' }).value.exercises;
    assert.deepEqual(old.map((x) => [x.id, x.asPlanned, x.unrecorded, x.lastDone]), [['plank', 0, 1, null], ['row', 0, 1, null], ['squat', 1, 0, '2026-02-23']]);
    // Every session recorded by default (a session in the engine's own format).
    assert.equal(exerciseFacts(SESSIONS, { ...OPTS, recorded: undefined, to: '2026-02-28' }).value.exercises.find((x) => x.id === 'row')!.asPlanned, 1);
  });

  it('the last 4 weeks are a subset; the last day done is the latest done, not swapped or skipped', () => {
    const sq = row('squat');
    assert.deepEqual([sq.last4.planned, sq.last4.asPlanned, sq.last4.swapped.n, sq.last4.skipped.n], [3, 2, 1, 0]);
    assert.equal(sq.lastDone, '2026-04-06');
    assert.equal(row('row').lastDone, '2026-03-02', 'swapped on 9 Mar and 6 Apr, skipped on 23 Mar');
    assert.deepEqual(row('row').last4.swapped.why, { mine: 0, ledger: 1, soreness: 0, hotel: 0, unknown: 0 });
    // The most skipped or swapped first.
    assert.deepEqual(facts().value.exercises.map((x) => x.id), ['row', 'squat', 'plank']);
  });

  it('nothing planned in the span: no rows, and the note says so', () => {
    const none = exerciseFacts(SESSIONS, { ...OPTS, from: '2026-05-01', to: '2026-05-10', last4From: '2026-05-01' });
    assert.deepEqual([none.value.exercises, none.value.sessions], [[], 0]);
  });
});

describe('a swap’s reason: the words and the codes', () => {
  it('the Log panel’s words and the codes map to the closed set; the bare "Swap" is none; anything else is refused', () => {
    assert.deepEqual(SWAP_WORDS, { mine: 'Your swap', ledger: 'Injury limit', soreness: 'Soreness', hotel: 'Hotel swap' });
    assert.deepEqual(['mine', 'Your swap', 'LEDGER', 'Injury limit', 'soreness', 'Hotel swap', 'Swap', '', null, undefined, 'bored', 3].map(swapReasonOf), ['mine', 'mine', 'ledger', 'ledger', 'soreness', 'hotel', null, null, null, null, undefined, undefined]);
  });
});

// ---------------------------------------------------------------- through the vault

const PLAN_OF = (f: Record<string, string>) => JSON.parse(f['v/3-Personal/Fitness/plan-data.json']!);
/** A B session on Sun 12 Apr: the RDL swapped (yours, in the panel's word), the split squat swapped for soreness. */
const B_INPUT = {
  date: '2026-04-12',
  type: 'B',
  lift1: { name: 'Dumbbell Romanian Deadlift', planned: 'Romanian Deadlift', swapWhy: 'Your swap', weight: 40, reps: 10, unit: 'lb' },
  lift2: { name: 'Seated Cable Row', weight: 115, reps: 10, unit: 'lb' },
  swaps: [{ from: 'Bulgarian Split Squat', to: 'DB Walking Lunge', why: 'soreness' }],
};

function withEntry(entry: Json): Record<string, string> {
  const f = fixtureFiles('v');
  const log = JSON.parse(f[LOG]!);
  log.sessions.push(entry);
  f[LOG] = JSON.stringify(log);
  return f;
}

describe('the swap’s reason, saved and read back', () => {
  it('the writer saves each swap’s reason as its code, on the lift and in swaps; a lift done as planned has none', () => {
    const f = fixtureFiles('v');
    const r = buildLogEntry(B_INPUT, { plan: PLAN_OF(f), log: JSON.parse(f[LOG]!), today: '2026-04-12' });
    assert.ok(r.ok, !r.ok ? r.error : '');
    assert.deepEqual(r.entry['lift1'], { name: 'Dumbbell Romanian Deadlift', planned: 'Romanian Deadlift', swapWhy: 'mine', weight: 40, reps: 10, unit: 'lb' });
    assert.deepEqual(r.entry['lift2'], { name: 'Seated Cable Row', weight: 115, reps: 10, unit: 'lb' });
    assert.deepEqual(r.entry['swaps'], [{ from: 'Bulgarian Split Squat', to: 'DB Walking Lunge', why: 'soreness' }]);
    // Without a reason, the script's own shape.
    const plain = buildLogEntry({ ...B_INPUT, lift1: { ...B_INPUT.lift1, swapWhy: null }, swaps: [{ from: 'Bulgarian Split Squat', to: 'DB Walking Lunge' }] }, { plan: PLAN_OF(f), log: JSON.parse(f[LOG]!), today: '2026-04-12' });
    assert.ok(plain.ok);
    assert.deepEqual([(plain.entry['lift1'] as Json)['swapWhy'], plain.entry['swaps']], [undefined, [{ from: 'Bulgarian Split Squat', to: 'DB Walking Lunge' }]]);
  });

  it('an unknown reason is refused by the writer, and left out by the adapter with a warning', () => {
    const f = fixtureFiles('v');
    const ctx = { plan: PLAN_OF(f), log: JSON.parse(f[LOG]!), today: '2026-04-12' };
    const bad = buildLogEntry({ ...B_INPUT, swaps: [{ from: 'Bulgarian Split Squat', to: 'DB Walking Lunge', why: 'bored' }] }, ctx);
    assert.deepEqual(bad, { ok: false, error: "swaps: why is one of mine, ledger, soreness, hotel, not 'bored'" });
    const badLift = buildLogEntry({ ...B_INPUT, lift1: { ...B_INPUT.lift1, swapWhy: 'tired' } }, ctx);
    assert.deepEqual(badLift, { ok: false, error: "lift1: swapWhy is one of mine, ledger, soreness, hotel, not 'tired'" });
    const good = buildLogEntry(B_INPUT, ctx);
    assert.ok(good.ok);
    const read = readVault(memoryIo(withEntry({ ...good.entry, swaps: [{ from: 'Bulgarian Split Squat', to: 'DB Walking Lunge', why: 'bored' }] }), '2026-04-12'), 'v', { asOf: '2026-04-12' });
    const s = read.data.sessions.find((x) => x.date === '2026-04-12')!;
    const bss = s.plan!.slots.find((x) => (x as Slot)._planned === 'Bulgarian Split Squat') as Slot;
    assert.deepEqual([bss.exercise, bss._swapWhy], ['db-walking-lunge', undefined]);
    assert.deepEqual(read.data.warnings.find((w) => w.code === 'swap-why')!.items, ['2026-04-12 Bulgarian Split Squat: "bored"']);
  });

  it('the adapter puts the reason on the slot beside the plan’s name, and review’s exercises count it; old entries read as before', () => {
    const f = fixtureFiles('v');
    const built = buildLogEntry(B_INPUT, { plan: PLAN_OF(f), log: JSON.parse(f[LOG]!), today: '2026-04-12' });
    assert.ok(built.ok);
    const read = readVault(memoryIo(withEntry({ ...built.entry, checklist: { done: 6, total: 6, skipped: [] } }), '2026-04-12'), 'v', { asOf: '2026-04-12' });
    const s = read.data.sessions.find((x) => x.date === '2026-04-12')!;
    const slots = s.plan!.slots as Slot[];
    assert.deepEqual(slots.filter((x) => x._planned).map((x) => [x.exercise, x._planned, x._swapWhy]), [
      ['dumbbell-romanian-deadlift', 'Romanian Deadlift', 'mine'],
      ['db-walking-lunge', 'Bulgarian Split Squat', 'soreness'],
    ]);
    assert.deepEqual(validateSession(s), []);
    const ex = buildReview(read.data, '2026-04-12').exercises.value.exercises;
    const rdl = ex.find((x) => x.id === 'romanian-deadlift')!;
    assert.deepEqual([rdl.swapped.n, rdl.swapped.why], [2, { mine: 1, ledger: 0, soreness: 0, hotel: 0, unknown: 1 }], 'the fixture’s 20 Mar swap is an old entry: its reason unknown');
    const bss = ex.find((x) => x.id === 'bulgarian-split-squat')!;
    assert.deepEqual([bss.swapped.why.soreness, bss.swapped.why.unknown, bss.swapped.to], [1, 1, [{ name: 'DB Walking Lunge', n: 2 }]]);
    // The fixture alone: no reason anywhere, no warning.
    const old = readVault(memoryIo(fixtureFiles('v'), '2026-04-12'), 'v', { asOf: '2026-04-12' });
    assert.ok(old.data.sessions.every((x) => (x.plan?.slots ?? []).every((y) => (y as Slot)._swapWhy === undefined)));
    assert.equal(old.data.warnings.find((w) => w.code === 'swap-why'), undefined);
  });

  it('an edit reads the saved reason back as the panel’s word, and saves it again as its code', () => {
    const f = fixtureFiles('v');
    const built = buildLogEntry(B_INPUT, { plan: PLAN_OF(f), log: JSON.parse(f[LOG]!), today: '2026-04-12' });
    assert.ok(built.ok);
    const files = withEntry(built.entry);
    const read = readVault(memoryIo(files, '2026-04-12'), 'v', { asOf: '2026-04-12' });
    const form = logFormFromEntry(read, built.entry);
    assert.deepEqual(form.rows.filter((r) => r.planned).map((r) => [r.name, r.planned, r.swapWhy]), [
      ['Dumbbell Romanian Deadlift', 'Romanian Deadlift', 'Your swap'],
      ['DB Walking Lunge', 'Bulgarian Split Squat', 'Soreness'],
    ]);
    const again = buildLogEntry(inputFromForm(form), { plan: PLAN_OF(files), log: JSON.parse(files[LOG]!), today: '2026-04-12', original: built.entry });
    assert.ok(again.ok, !again.ok ? again.error : '');
    assert.deepEqual([(again.entry['lift1'] as Json)['swapWhy'], again.entry['swaps']], ['mine', [{ from: 'Bulgarian Split Squat', to: 'DB Walking Lunge', why: 'soreness' }]]);
    // A swap saved without a reason reads "Swap", and saves none.
    const bare = { ...built.entry, lift1: { ...(built.entry['lift1'] as Json), swapWhy: undefined }, swaps: [{ from: 'Bulgarian Split Squat', to: 'DB Walking Lunge' }] };
    const f2 = logFormFromEntry(read, bare);
    assert.deepEqual(f2.rows.filter((r) => r.planned).map((r) => r.swapWhy), ['Swap', 'Swap']);
    const i2 = inputFromForm(f2);
    assert.deepEqual([(i2.lift1 as Json)['swapWhy'], i2.swaps], [undefined, [{ from: 'Bulgarian Split Squat', to: 'DB Walking Lunge' }]]);
  });

  it('`log fix --clear-planned` drops the reason with the swap', () => {
    const f = fixtureFiles('v');
    const log = JSON.parse(f[LOG]!);
    const s = log.sessions.find((x: Json) => x.date === '2026-03-20');
    s.lift1 = { ...s.lift1, name: 'Romanian Deadlift', planned: 'Romanian Deadlift', swapWhy: 'mine' };
    const m = mergeFix(JSON.stringify(log), PLAN_OF(f), { date: '2026-03-20', type: 'B', lift: 'lift1', clearPlanned: true });
    assert.equal(m.result, 'fixed');
    assert.deepEqual(m.result === 'fixed' ? [m.after['planned'], m.after['swapWhy'], m.changed.sort()] : null, [undefined, undefined, ['planned', 'swapWhy']]);
  });
});

describe('`log add` with a swap’s reason and a pain', () => {
  it('writes them as the Log panel does, and the review reads them back: the reason counted, the pain not given', () => {
    const f = fixtureFiles('v');
    f['v/s.json'] = JSON.stringify({ ...B_INPUT, lift1: { ...B_INPUT.lift1, swapWhy: 'mine' }, pain: [{ area: 'Knee', exercise: 'DB Walking Lunge' }], skipped: ['Side Plank'] });
    const io = { ...memoryIo(f, '2026-04-12'), writeLog: (_root: string, text: string) => void (f[LOG] = text), writeHabits: () => {} };
    const r = run(['log', 'add', '--file', 'v/s.json', '--vault', 'v', '--write'], io as never);
    const out = JSON.parse(r.stdout) as Json;
    assert.equal(r.code, 0, JSON.stringify(out.errors));
    assert.deepEqual([out.session.lift1.swapWhy, out.session.swaps, out.session.pain], ['mine', [{ from: 'Bulgarian Split Squat', to: 'DB Walking Lunge', why: 'soreness' }], [{ area: 'Knee', exercise: 'DB Walking Lunge' }]]);
    const review = buildReview(readVault(memoryIo(f, '2026-04-12'), 'v', { asOf: '2026-04-12' }).data, '2026-04-12');
    const bss = review.exercises.value.exercises.find((x) => x.id === 'bulgarian-split-squat')!;
    assert.deepEqual([bss.last4.swapped.why.soreness, bss.last4.swapped.why.unknown], [1, 1]);
    assert.equal(review.exercises.value.exercises.find((x) => x.id === 'side-plank')!.last4.skipped.n, 1);
    const lunge = review.pain.byExercise.value.find((g) => g.key === 'db-walking-lunge')!;
    assert.deepEqual([lunge.count, lunge.max, lunge.notGiven, lunge.verdict], [1, null, 1, 'ask']);
    // An unknown reason: refused, nothing written.
    f['v/s.json'] = JSON.stringify({ ...B_INPUT, date: '2026-04-11', swaps: [{ from: 'Bulgarian Split Squat', to: 'DB Walking Lunge', why: 'because' }] });
    const bad = run(['log', 'add', '--file', 'v/s.json', '--vault', 'v'], io as never);
    assert.equal(bad.code, 1);
    assert.match(JSON.parse(bad.stdout).errors[0].message, /swaps: why is one of mine, ledger, soreness, hotel, not 'because'/);
  });
});
