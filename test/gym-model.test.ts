// The gym page's model: the link read back, a session's ticks, edits and
// skips, and the session entry Send hands to the shortcut, as the Log
// panel's form becomes the log's input at Every set (the logged lifts' top
// sets, each done row's ticked sets, a superset's parts by name, a swap's
// planned item and reason, the lines not done and why, Express, minutes,
// cardio, the shortcut's question).
// And the phone's storage: a state restored, old days cleared.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encodeBase64url } from '../src/core/base64url.ts';
import { SWAP_WORDS } from '../src/core/exercise-facts.ts';
import { gymLink, type GymData, type GymSession } from '../src/core/gym.ts';
import { validateInboxEntry } from '../src/core/validate.ts';
import {
  autoMinutes,
  editSet,
  entryOf,
  freshState,
  hasExpress,
  markSent,
  openingSession,
  pickSession,
  readHash,
  restoreState,
  rowDone,
  rowWords,
  sessionChoices,
  setCardio,
  setCounts,
  setMinutes,
  setNotes,
  setWhy,
  skipRow,
  staleKeys,
  stateKey,
  SWAP_LABELS,
  swapWords,
  tickRow,
  tickSet,
  unskipRow,
  type GymState,
} from '../web/gym/model.ts';
import { SAMPLE } from '../web/gym/sample.ts';

const A = SAMPLE.sessions[0]!;
const AX = SAMPLE.sessions[1]!;
const S1 = SAMPLE.sessions[2]!;
const T0 = Date.UTC(2026, 10, 10, 23, 0, 0);
const min = (m: number) => T0 + m * 60_000;
const SQUAT = '1:Barbell Back Squat';
const PULL = '2:Pull-up';
const BENCH = '3:Dumbbell Bench Press';
const PAIR = '4:Face Pull + Band External Rotation';
const PLANK = '5:Side Plank';
const ZONE2 = '6:Zone 2 finisher';
const WARM = '0:Warm-up';
/** The sample's A with its squat (lift1) done as another, your own swap, and the pair's second part as another, with no reason given. */
const SWAPPED: GymSession = {
  ...A,
  rows: A.rows.map((r) =>
    r.key === SQUAT
      ? { ...r, name: 'Goblet Squat', planned: 'Barbell Back Squat', swap: 'mine' }
      : r.key === PAIR
        ? { ...r, name: 'Face Pull + Cable External Rotation', parts: r.parts!.map((p, i) => (i === 1 ? { ...p, name: 'Cable External Rotation', planned: 'Band External Rotation', swap: null } : p)) }
        : r,
  ),
};

/** Ticks sets in order, a minute apart from T0: [row key, part or null, set index]. */
function ticks(s: GymSession, st: GymState, refs: [string, number | null, number][]): GymState {
  return refs.reduce((x, [key, part, i], n) => tickSet(s, x, { key, part, i }, min(n)), st);
}

describe('the gym link, read back', () => {
  it('round-trips the sample through the page\'s link', () => {
    const link = gymLink(SAMPLE);
    assert.deepEqual(readHash(link.slice(link.indexOf('#'))), SAMPLE);
  });

  it('reads nothing from a missing, broken or malformed link', () => {
    assert.equal(readHash(''), null);
    assert.equal(readHash('#'), null);
    assert.equal(readHash('#%%%'), null);
    assert.equal(readHash(`#${encodeBase64url(JSON.stringify({ ...SAMPLE, sessions: [] }))}`), null, 'no sessions');
    assert.equal(readHash(`#${encodeBase64url(JSON.stringify({ ...SAMPLE, sessions: [{ type: 'A', name: 'A' }] }))}`), null, 'a session without rows');
    const badRow = { ...A, rows: [{ ...A.rows[1]!, kind: 'jog' }] };
    assert.equal(readHash(`#${encodeBase64url(JSON.stringify({ ...SAMPLE, sessions: [badRow] }))}`), null, 'a row of an unknown kind');
  });

  it('offers each type once, the next first, and Express where a type has both', () => {
    const d: GymData = { ...SAMPLE, next: 'S1' };
    assert.deepEqual(sessionChoices(d), [{ type: 'S1', name: 'Short 1 · Skills', next: true }, { type: 'A', name: 'Full Body A', next: false }]);
    assert.equal(hasExpress(SAMPLE, 'A'), true);
    assert.equal(hasExpress(SAMPLE, 'S1'), false);
    assert.equal(pickSession(SAMPLE, 'S1', 'express'), S1, 'no Express variant: the type\'s own');
    assert.equal(openingSession(SAMPLE), A);
    assert.equal(openingSession(SAMPLE, { type: 'A', mode: 'express' }), AX, 'the one last shown that day');
    assert.equal(openingSession(SAMPLE, { type: 'Z', mode: 'full' }), A);
  });

  it('words a card\'s line as the plan gives it', () => {
    assert.equal(rowWords(A.rows[1]!), '3 × 5–8 @ RIR 2 · rest 3 min · last 115 lb × 6');
    assert.equal(rowWords(A.rows[2]!), '3 × 5–8 @ RIR 2 · rest 2 min · last 6 reps');
    assert.equal(rowWords(A.rows[4]!), '2 × 12–15 each · rest 90 s after each pair');
    assert.equal(rowWords(A.rows[5]!), '2 × 30 s · rest 45 s · last 30 s');
  });

  it('words a swap as the plan\'s exercise it stands in for, with the Log panel\'s word for why', () => {
    assert.equal(swapWords(A.rows[3]!), 'In place of Dumbbell Bench Press · Injury limit');
    assert.equal(swapWords(SWAPPED.rows[1]!), 'In place of Barbell Back Squat · Your swap');
    assert.equal(swapWords(SWAPPED.rows[4]!.parts![1]!), 'In place of Band External Rotation', 'no reason given: none shown');
    assert.equal(swapWords(A.rows[1]!), null, 'as planned');
    assert.deepEqual(SWAP_LABELS, SWAP_WORDS, 'the Log panel\'s words');
  });

  it('reads a link from before swaps (no planned or swap on a row) as every row as planned', () => {
    const old = JSON.parse(JSON.stringify(SAMPLE, (k, v) => (k === 'planned' || k === 'swap' ? undefined : v))) as GymData;
    const d = readHash(gymLink(old).slice(gymLink(old).indexOf('#')))!;
    assert.ok(d, 'it reads');
    const a = d.sessions[0]!;
    assert.equal(swapWords(a.rows[3]!), null);
    const e = entryOf(a, ticks(a, freshState(d.date, a), [[SQUAT, null, 0]]));
    assert.equal(e.swaps, undefined);
    assert.deepEqual(e.lift1, { weight: 120, reps: 6, unit: 'lb' });
  });
});

describe('the session entry Send hands over', () => {
  it('before anything is ticked: the lifts 0 × 0, no sets, every line skipped', () => {
    const e = entryOf(A, freshState(SAMPLE.date, A));
    assert.deepEqual(e, {
      type: 'A',
      lift1: { weight: 0, reps: 0, unit: 'lb' },
      lift2: { weight: 0, reps: 0, unit: 'lb' },
      cardioMin: 0,
      trackingLevel: 'full',
      exerciseSets: [],
      swaps: [{ from: 'Dumbbell Bench Press', to: 'Dumbbell Floor Press', why: 'ledger' }],
      skipped: ['Warm-up', 'Barbell Back Squat', 'Pull-up', 'Dumbbell Bench Press', 'Face Pull + Band External Rotation', 'Side Plank', 'Zone 2 finisher'],
      _say: 'A · 0 sets · 7 skipped',
    });
  });

  it('a swap, as the Log panel sends it: the row\'s sets by what was done with the plan\'s as planned, and in swaps with its reason', () => {
    let st = editSet(A, freshState(SAMPLE.date, A), { key: BENCH, part: null, i: 0 }, { weight: 40 });
    st = ticks(A, st, [[BENCH, null, 0]]);
    const e = entryOf(A, st);
    assert.deepEqual(e.exerciseSets, [{ name: 'Dumbbell Floor Press', planned: 'Dumbbell Bench Press', sets: [{ weight: 40, unit: 'lb', reps: 8, rir: null }] }]);
    assert.deepEqual(e.swaps, [{ from: 'Dumbbell Bench Press', to: 'Dumbbell Floor Press', why: 'ledger' }]);
    assert.ok(!e.skipped!.includes('Dumbbell Bench Press'), 'the line is done: by its plan name');
  });

  it('a swapped logged lift: named with the plan\'s as planned and its reason, not in swaps; a superset part\'s swap in swaps without a reason', () => {
    const st = ticks(SWAPPED, freshState(SAMPLE.date, SWAPPED), [[SQUAT, null, 0], [PAIR, 1, 0]]);
    const e = entryOf(SWAPPED, st);
    assert.deepEqual(e.lift1, { name: 'Goblet Squat', planned: 'Barbell Back Squat', swapWhy: 'mine', weight: 120, reps: 6, unit: 'lb' });
    assert.deepEqual(e.lift2, { weight: 0, reps: 0, unit: 'lb' }, 'as planned: named by the plan');
    assert.deepEqual(e.exerciseSets, [
      { name: 'Goblet Squat', planned: 'Barbell Back Squat', sets: [{ weight: 120, unit: 'lb', reps: 6, rir: null }] },
      { name: 'Cable External Rotation', planned: 'Band External Rotation', sets: [{ weight: null, unit: null, reps: 15, rir: null }] },
    ]);
    assert.deepEqual(e.swaps, [
      { from: 'Dumbbell Bench Press', to: 'Dumbbell Floor Press', why: 'ledger' },
      { from: 'Band External Rotation', to: 'Cable External Rotation' },
    ]);
    // A lift's swap with no reason: named, no swapWhy.
    const bare: GymSession = { ...SWAPPED, rows: SWAPPED.rows.map((r) => (r.key === SQUAT ? { ...r, swap: null } : r)) };
    assert.deepEqual(entryOf(bare, freshState(SAMPLE.date, bare)).lift1, { name: 'Goblet Squat', planned: 'Barbell Back Squat', weight: 0, reps: 0, unit: 'lb' });
  });

  it('partial ticks: only the ticked sets, as shown; the top set is the heaviest; minutes from the first tick to Send', () => {
    let st = freshState(SAMPLE.date, A);
    st = tickRow(A, st, WARM, min(0));
    st = ticks(A, st, [[SQUAT, null, 0], [SQUAT, null, 1], [PULL, null, 0]]);
    st = editSet(A, st, { key: SQUAT, part: null, i: 1 }, { weight: 125, reps: 5, rir: 1 });
    st = markSent(st, min(47.4));
    const e = entryOf(A, st);
    assert.deepEqual(e.lift1, { weight: 125, reps: 5, unit: 'lb' }, 'the heaviest ticked set');
    assert.deepEqual(e.lift2, { weight: 0, reps: 7, unit: 'lb' }, 'a bodyweight lift: weight 0');
    assert.deepEqual(e.exerciseSets, [
      { name: 'Barbell Back Squat', sets: [{ weight: 120, unit: 'lb', reps: 6, rir: null }, { weight: 125, unit: 'lb', reps: 5, rir: 1 }] },
      { name: 'Pull-up', sets: [{ weight: null, unit: null, reps: 7, rir: null }] },
    ]);
    assert.deepEqual(e.skipped, ['Dumbbell Bench Press', 'Face Pull + Band External Rotation', 'Side Plank', 'Zone 2 finisher']);
    assert.equal(e.skipWhy, undefined);
    assert.equal(e.durationMin, 47);
    assert.equal(e.cardioMin, 0, 'the finisher not done');
    assert.equal(e._say, 'A · 3 sets · 4 skipped');
    assert.deepEqual(setCounts(A, st), { done: 3, total: 15 });
  });

  it('an edit carries to the sets after it that are blank or still as it was, never to a ticked or changed one', () => {
    const blank: GymSession = { ...A, rows: A.rows.map((r) => (r.key === SQUAT ? { ...r, rows: r.rows.map(() => ({ weight: null, reps: null, rir: null })) } : r)) };
    let st = editSet(blank, freshState(SAMPLE.date, blank), { key: SQUAT, part: null, i: 0 }, { weight: 95 });
    st = editSet(blank, st, { key: SQUAT, part: null, i: 0 }, { reps: 8 });
    assert.deepEqual(st.rows[SQUAT]!.sets.map((x) => [x.weight, x.reps]), [[95, 8], [95, 8], [95, 8]], 'typed once, every set filled');
    st = ticks(blank, st, [[SQUAT, null, 1]]);
    st = editSet(blank, st, { key: SQUAT, part: null, i: 2 }, { reps: 6 });
    st = editSet(blank, st, { key: SQUAT, part: null, i: 0 }, { weight: 100 });
    assert.deepEqual(st.rows[SQUAT]!.sets.map((x) => [x.weight, x.reps]), [[100, 8], [95, 8], [95, 6]], 'the ticked set and the changed one stay');
    // The RIR is each set's own.
    st = editSet(blank, st, { key: SQUAT, part: null, i: 0 }, { rir: 2 });
    assert.deepEqual(st.rows[SQUAT]!.sets.map((x) => x.rir), [2, null, null]);
  });

  it("the cardio minutes with the plan's mode when the cardio is done; 0 and no mode when it isn't", () => {
    const done = entryOf(A, tickRow(A, freshState(SAMPLE.date, A), ZONE2, min(0)));
    assert.deepEqual([done.cardioMin, done.cardioMode], [15, 'bike']);
    const not = entryOf(A, freshState(SAMPLE.date, A));
    assert.deepEqual([not.cardioMin, not.cardioMode], [0, undefined]);
    assert.deepEqual(validateInboxEntry({ v: 1, kind: 'session', at: '2026-11-10T19:02:00-05:00', date: SAMPLE.date, session: done }), []);
    assert.ok(validateInboxEntry({ v: 1, kind: 'session', at: '2026-11-10T19:02:00-05:00', date: SAMPLE.date, session: { type: 'A', cardioMode: 'bike' } }).length > 0, 'only with trackingLevel');
  });

  it('the top set: the same weight, then the most reps; unticked sets don\'t count', () => {
    let st = freshState(SAMPLE.date, A);
    st = editSet(A, st, { key: SQUAT, part: null, i: 2 }, { reps: 8 });
    st = editSet(A, st, { key: SQUAT, part: null, i: 1 }, { weight: 140 });
    st = ticks(A, st, [[SQUAT, null, 0], [SQUAT, null, 2]]);
    assert.deepEqual(entryOf(A, st).lift1, { weight: 120, reps: 8, unit: 'lb' });
  });

  it('a superset: each part by its own name, done with any part\'s set ticked; the rest runs after the round', () => {
    let st = freshState(SAMPLE.date, A);
    st = tickSet(A, st, { key: PAIR, part: 0, i: 0 }, min(0));
    assert.equal(st.rest, null, 'not after the first part');
    assert.equal(rowDone(A.rows[4]!, st.rows[PAIR]), true);
    st = tickSet(A, st, { key: PAIR, part: 1, i: 0 }, min(1));
    assert.deepEqual(st.rest, { key: PAIR, until: min(1) + 90_000, seconds: 90 });
    st = tickSet(A, st, { key: PAIR, part: 1, i: 1 }, min(2));
    const e = entryOf(A, st);
    assert.deepEqual(e.exerciseSets, [
      { name: 'Face Pull', sets: [{ weight: 30, unit: 'lb', reps: 12, rir: null }] },
      { name: 'Band External Rotation', sets: [{ weight: null, unit: null, reps: 15, rir: null }, { weight: null, unit: null, reps: 15, rir: null }] },
    ]);
    assert.ok(!e.skipped!.includes('Face Pull + Band External Rotation'));
  });

  it('skipped lines, with a reason and without; a reason cleared by a second tap; an undo brings the ticks back', () => {
    let st = freshState(SAMPLE.date, A);
    st = ticks(A, st, [[PLANK, null, 0]]);
    st = skipRow(st, BENCH, 'equipment');
    st = skipRow(st, PLANK);
    st = skipRow(st, PULL, 'pain');
    st = setWhy(st, PULL, 'pain');
    let e = entryOf(A, st);
    assert.deepEqual(e.skipWhy, { 'Dumbbell Bench Press': 'equipment' });
    assert.ok(e.skipped!.includes('Side Plank') && e.skipped!.includes('Pull-up') && e.skipped!.includes('Dumbbell Bench Press'));
    assert.deepEqual(e.lift2, { weight: 0, reps: 0, unit: 'lb' });
    st = unskipRow(st, PLANK);
    e = entryOf(A, st);
    assert.deepEqual(e.exerciseSets, [{ name: 'Side Plank', sets: [{ weight: null, unit: null, reps: 30, rir: null }] }], 'a timed row: seconds as reps, no weight');
    assert.ok(!e.skipped!.includes('Side Plank'));
  });

  it('a skipped row\'s rest stops; an untick doesn\'t restart it', () => {
    let st = ticks(A, freshState(SAMPLE.date, A), [[SQUAT, null, 0]]);
    assert.deepEqual(st.rest, { key: SQUAT, until: min(0) + 180_000, seconds: 180 });
    st = tickSet(A, st, { key: SQUAT, part: null, i: 0 }, min(1));
    assert.deepEqual(st.rest?.until, min(0) + 180_000);
    assert.equal(skipRow(st, SQUAT).rest, null);
    assert.equal(tickRow(A, freshState(SAMPLE.date, A), WARM, min(0)).rest, null, 'no rest given: none runs');
  });

  it('a set is ticked once it has its reps, and a loaded one its weight; clearing them unticks it', () => {
    let st = freshState(SAMPLE.date, A);
    const ref = { key: BENCH, part: null, i: 0 };
    assert.equal(tickSet(A, st, ref, min(0)), st, 'no weight yet: nothing ticked');
    st = editSet(A, st, ref, { weight: 50 });
    st = tickSet(A, st, ref, min(0));
    assert.equal(st.rows[BENCH]!.sets[0]!.ticked, true);
    assert.equal(st.startedAt, min(0));
    st = editSet(A, st, ref, { reps: null });
    assert.equal(st.rows[BENCH]!.sets[0]!.ticked, false);
  });

  it('cardio: the finisher\'s minutes when it is done; minutes and notes as typed', () => {
    let st = freshState(SAMPLE.date, A);
    st = tickRow(A, st, ZONE2, min(0));
    assert.equal(entryOf(A, st).cardioMin, 15);
    st = setCardio(st, 20.4);
    st = setMinutes(st, 55);
    st = setNotes(st, '  felt strong  ');
    st = markSent(st, min(90));
    const e = entryOf(A, st);
    assert.equal(e.cardioMin, 20);
    assert.equal(e.durationMin, 55, 'typed minutes over the clock');
    assert.equal(e.notes, 'felt strong');
    assert.equal(setMinutes(st, 900).minutes, 600);
    assert.equal(autoMinutes({ ...st, startedAt: min(0) }, min(0.2)), 1, 'at least a minute');
    assert.equal(entryOf(A, setNotes(st, '   ')).notes, undefined);
  });

  it('Express: marked express, no cardio row, its own sets; a short day has no logged lifts', () => {
    let st = ticks(AX, freshState(SAMPLE.date, AX), [[SQUAT, null, 0], [SQUAT, null, 1], [PULL, null, 0]]);
    st = markSent(st, min(25));
    const e = entryOf(AX, st);
    assert.equal(e.express, true);
    assert.equal(e.cardioMin, undefined);
    assert.equal(e.durationMin, 25);
    assert.equal(e._say, 'A Express · 3 sets · 1 skipped');
    let s1 = ticks(S1, freshState(SAMPLE.date, S1), [['1:Chest-to-wall Handstand', null, 0], ['2:Floor Push-up', null, 0]]);
    s1 = tickRow(S1, s1, WARM, min(5));
    const f = entryOf(S1, s1);
    assert.equal(f.lift1, undefined);
    assert.equal(f.express, undefined);
    assert.equal(f.durationMin, undefined, 'not sent yet: no end');
    assert.deepEqual(f.exerciseSets.map((x) => x.name), ['Chest-to-wall Handstand', 'Floor Push-up']);
    assert.equal(f._say, 'S1 · 2 sets');
    assert.equal(entryOf(S1, ticks(S1, freshState(SAMPLE.date, S1), [['2:Floor Push-up', null, 0]]), min(3))._say, 'S1 · 1 set · 2 skipped');
  });

  it('every entry passes the inbox\'s check', () => {
    let st = freshState(SAMPLE.date, A);
    st = tickRow(A, st, WARM, min(0));
    st = ticks(A, st, [[SQUAT, null, 0], [PULL, null, 0], [PAIR, 0, 0], [PAIR, 1, 0], [PLANK, null, 0]]);
    st = tickRow(A, skipRow(st, BENCH, 'time'), ZONE2, min(40));
    const swapped = ticks(SWAPPED, freshState(SAMPLE.date, SWAPPED), [[SQUAT, null, 0], [PAIR, 1, 0], [BENCH, null, 0]]);
    const entries = [entryOf(A, markSent(st, min(50))), entryOf(A, freshState(SAMPLE.date, A)), entryOf(AX, ticks(AX, freshState(SAMPLE.date, AX), [[SQUAT, null, 0]]), min(20)), entryOf(S1, freshState(SAMPLE.date, S1)), entryOf(SWAPPED, swapped, min(30))];
    for (const session of entries) assert.deepEqual(validateInboxEntry({ v: 1, kind: 'session', at: '2026-11-10T19:02:00-05:00', date: SAMPLE.date, session }), [], JSON.stringify(session));
  });
});

describe('the phone\'s storage', () => {
  it('restores a stored state, through JSON, as it was', () => {
    let st = ticks(A, freshState(SAMPLE.date, A), [[SQUAT, null, 0], [PAIR, 1, 1]]);
    st = editSet(A, st, { key: SQUAT, part: null, i: 2 }, { weight: 130, rir: 2 });
    st = setNotes(skipRow(st, BENCH, 'pain'), 'left knee');
    assert.deepEqual(restoreState(SAMPLE.date, A, JSON.parse(JSON.stringify(st))), st);
  });

  it('starts fresh from another day\'s or session\'s state, or from junk', () => {
    const st = ticks(A, freshState(SAMPLE.date, A), [[SQUAT, null, 0]]);
    const fresh = freshState(SAMPLE.date, A);
    assert.deepEqual(restoreState(SAMPLE.date, A, { ...st, date: '2026-11-09' }), fresh);
    assert.deepEqual(restoreState(SAMPLE.date, AX, st), freshState(SAMPLE.date, AX));
    assert.deepEqual(restoreState(SAMPLE.date, A, 'junk'), fresh);
    assert.deepEqual(restoreState(SAMPLE.date, A, null), fresh);
  });

  it('lays a stored state on the link\'s rows: unknown values keep the link\'s, extra sets are dropped', () => {
    const raw = JSON.parse(JSON.stringify(freshState(SAMPLE.date, A))) as { rows: Record<string, { sets: unknown[] }> };
    raw.rows[SQUAT]!.sets = [{ weight: 'x', reps: 9, rir: null, ticked: true }, ...raw.rows[SQUAT]!.sets, { weight: 1, reps: 1, rir: null, ticked: true }];
    raw.rows['9:Gone'] = { sets: [] };
    const st = restoreState(SAMPLE.date, A, raw);
    assert.deepEqual(st.rows[SQUAT]!.sets.map((s) => [s.weight, s.reps, s.ticked]), [[120, 9, true], [120, 6, false], [120, 6, false]]);
    assert.equal(st.rows['9:Gone'], undefined);
  });

  it('starts a row fresh when the link now has another exercise on it (a swap made or undone since)', () => {
    const st = ticks(A, freshState(SAMPLE.date, A), [[SQUAT, null, 0], [SQUAT, null, 1], [PAIR, 1, 0], [PULL, null, 0]]);
    const raw = JSON.parse(JSON.stringify(st)) as unknown;
    const swapped: GymSession = { ...A, rows: A.rows.map((r) => (r.key === SQUAT ? { ...r, name: 'Goblet Squat', planned: 'Barbell Back Squat', swap: 'soreness' as const } : r)) };
    const back = restoreState(SAMPLE.date, swapped, raw);
    assert.ok(back.rows[SQUAT]!.sets.every((x) => !x.ticked), "the back squat's ticks don't land on the goblet squat");
    assert.ok(back.rows[PULL]!.sets[0]!.ticked, 'the other rows keep theirs');
    const pair = A.rows.find((r) => r.key === PAIR)!;
    const partSwap: GymSession = { ...A, rows: A.rows.map((r) => (r.key === PAIR ? { ...r, parts: pair.parts!.map((x, i) => (i === 1 ? { ...x, name: 'Cable External Rotation', planned: x.name } : x)) } : r)) };
    assert.ok(restoreState(SAMPLE.date, partSwap, raw).rows[PAIR]!.parts.flat().every((x) => !x.ticked), "a part's swap starts its row fresh");
    // A state stored before rows had their identity starts fresh too.
    const old = JSON.parse(JSON.stringify(st)) as { rows: Record<string, Record<string, unknown>> };
    for (const r of Object.values(old.rows)) delete r['id'];
    assert.ok(restoreState(SAMPLE.date, A, old).rows[SQUAT]!.sets.every((x) => !x.ticked));
  });

  it('keys progress by date, type and mode, and clears days more than 3 old', () => {
    assert.equal(stateKey('2026-11-10', 'A', 'express'), 'pahlavan-gym:2026-11-10:A:express');
    const keys = ['pahlavan-gym:2026-11-10:A:full', 'pahlavan-gym:2026-11-07:A:full', 'pahlavan-gym:2026-11-06:view', 'pahlavan-gym:junk', 'other:2020-01-01'];
    assert.deepEqual(staleKeys(keys, '2026-11-10'), ['pahlavan-gym:2026-11-06:view', 'pahlavan-gym:junk']);
  });
});
