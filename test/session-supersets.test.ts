// Today's rows carry the plan's rest, its supersets and its form cues: the
// cue is the note before "Why:" without what the row shows elsewhere (the
// RIR and progression sentences in the target line, the superset sentence
// in the pair marker, a temporary change in the reasons); a pair's two rows
// are numbered as the month plan numbers them (4a, 4b) and name each other.
// The session command prints the same fields.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { run } from '../src/cli/cli.ts';
import { noteCue, numberRows, restOf } from '../src/core/plan-data.ts';
import { buildSession } from '../src/report/index.ts';
import { applySupersets } from './fixtures/supersets.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const DATE = '2026-04-10'; // the rotation suggests B
const files = () => {
  const f = fixtureFiles('v');
  applySupersets(f, 'v');
  return f;
};
const read = readVault(memoryIo(files(), DATE), 'v', { asOf: DATE });

describe('the form cue in a plan note', () => {
  it('drops the RIR, the progression rule, the superset sentence and the Why', () => {
    assert.equal(noteCue('Superset with Leg extension: a set of each, then rest. RIR 1. Full range: lower over 2–3 s into the bottom stretch (knee fully bent) and control it there; no pause at the top. Double progression: at the top of the range on every set, the next step up. Why: the stretched bottom builds more than the top; supersetting keeps 90 s rest.'),
      'Full range: lower over 2–3 s into the bottom stretch (knee fully bent) and control it there; no pause at the top.');
    assert.equal(noteCue('Superset with Face Pull: a set of each (both legs), then rest. RIR 2. Dumbbells. Double progression: at the top of the range on every set, the next step up. Why: single-leg squats from week 1.'), 'Dumbbells.');
    assert.equal(noteCue('RIR 1. Chest down on an incline bench. Double progression: at the top of the range on every set, 5 lb more per hand. Why: rear delts.'), 'Chest down on an incline bench.');
    assert.equal(noteCue('RIR 2. Linear: add one step each session every rep is made (one step at most). Barbell. Why: the heavy hinge.'), 'Barbell.');
  });

  it('nothing left is no cue: an RIR, a progression and a Why only', () => {
    assert.equal(noteCue('RIR 2. Linear: add one step each session every rep is made (one step at most). Why: the main quad builder; heavy day.'), null);
    assert.equal(noteCue('Superset with Leg extension: a set of each, then rest. RIR 1. Double progression: at the top of the range on every set, the next step up. Why: rear delts.'), null);
    assert.equal(noteCue('RIR 2. Why: the lighter day’s press.'), null);
    assert.equal(noteCue(''), null);
    assert.equal(noteCue(undefined), null);
  });

  it('an RIR range goes; a cue that names its own load step stays', () => {
    assert.equal(noteCue('RIR 1–2. Strict, full hang; at 3 × 8, add 5–10 lb. Why: ladder level 6.'), 'Strict, full hang; at 3 × 8, add 5–10 lb.');
    assert.equal(noteCue('RIR 1. A 1–2 s pause in the stretch at the bottom, heels as low as they go. Double progression: at the top of the range on every set, the next step up. Why: calves.'), 'A 1–2 s pause in the stretch at the bottom, heels as low as they go.');
  });

  it('a temporary change and what it replaces go (the reasons say them); a note without a Why keeps its cue', () => {
    assert.equal(noteCue('until 2026-04-19: knee niggle, easing; the back squat returns after it. Replaces Barbell Back Squat. RIR 2. Elbows inside the knees.'), 'Elbows inside the knees.');
    assert.equal(noteCue('Hips high.'), 'Hips high.');
    assert.equal(noteCue('Easy: you can talk in full sentences. Why: cardio minutes toward the goal.'), 'Easy: you can talk in full sentences.');
  });

  it('what follows "Why:" stays behind the Why, even a sentence of its own', () => {
    assert.equal(noteCue('4 × 4 min hard, 3 min easy between, warm-up and cool-down easy. Why: you chose intervals. Week 1 (calibration): 22 min easy instead.'), '4 × 4 min hard, 3 min easy between, warm-up and cool-down easy.');
  });

  it('the generator’s own progression sentences go; a decimal does not split a sentence', () => {
    assert.equal(noteCue('Ladder: the top of the range on every set, then a harder variation.'), null);
    assert.equal(noteCue('Weekly wave: RIR 3, 2, 1, then the deload. Pause 1.5 s at the bottom.'), 'Pause 1.5 s at the bottom.');
  });
});

describe('the rest and the row numbers', () => {
  it('the rest as written; "—" or none is no rest', () => {
    assert.equal(restOf({ rest: '2–3 min' }), '2–3 min');
    assert.equal(restOf({ rest: ' 90 s after each pair ' }), '90 s after each pair');
    assert.equal(restOf({ rest: '—' }), null);
    assert.equal(restOf({ rest: '' }), null);
    assert.equal(restOf({}), null);
    assert.equal(restOf(undefined), null);
  });

  it('numbers rows as the month plan does: a pair is 4a and 4b, the next row 5', () => {
    const nums = (p: boolean[]) => numberRows(p).map((r) => r.num);
    assert.deepEqual(nums([false, false, false, false, true]), ['1', '2', '3', '4a', '4b']);
    assert.deepEqual(nums([false, false, true, false]), ['1', '2a', '2b', '3']);
    assert.deepEqual(nums([false, true, false, true]), ['1a', '1b', '2a', '2b']);
    assert.deepEqual(nums([]), []);
    // The first row has nothing before it to pair with.
    assert.deepEqual(nums([true, false]), ['1', '2']);
    // Three in a row, as the generator's numbered(): 4a, 4b, 4b.
    assert.deepEqual(nums([false, false, false, false, true, true]), ['1', '2', '3', '4a', '4b', '4b']);
    assert.deepEqual(numberRows([false, false, true]).map((r) => [r.group, r.part]), [[1, null], [2, 'a'], [2, 'b']]);
  });
});

describe('today’s session rows', () => {
  it('Full: each row’s number, rest and cue; the pair names each other; a swap keeps the rest, not the cue', () => {
    const s = buildSession(read.data, DATE, 'full');
    assert.equal(s.session!.type, 'B');
    assert.deepEqual(s.items.map((i) => i.num), ['1', '2', '3a', '3b']);
    assert.deepEqual(s.items.map((i) => i.rest), ['2 min', '90 s', '90 s after each pair', '90 s after each pair']);
    const [rdl, row, bss, plank] = s.items;
    // The Ledger swaps the Romanian deadlift: its cue is the barbell lift's, so the swap has none.
    assert.equal(rdl!.replaces!.name, 'Romanian Deadlift');
    assert.equal(rdl!.cue, undefined);
    assert.equal(row!.cue, 'Chest up, pull to the lower ribs.');
    assert.equal(row!.pair, undefined);
    assert.deepEqual(bss!.pair, { group: 3, label: '3a', with: { exercise: plank!.exercise, name: 'Side Plank' } });
    assert.deepEqual(plank!.pair, { group: 3, label: '3b', with: { exercise: bss!.exercise, name: 'Bulgarian Split Squat' } });
    assert.equal(bss!.cue, 'Dumbbells.');
    assert.equal(plank!.cue, undefined, 'an RIR and a Why only: no cue');
    // The superset sentence stays out of the cue and the Why stays behind the Why.
    assert.equal(bss!.planWhy!.text, 'single-leg work while the balance holds are short.');
  });

  it('A by pick: the temporary change’s cue without its until and Replaces; Express drops the pair', () => {
    const a = buildSession(read.data, DATE, 'full', { type: 'A' });
    assert.deepEqual(a.items.map((i) => [i.num, i.name, i.cue ?? null]), [
      ['1', 'Goblet Squat', 'Elbows inside the knees.'],
      ['2', 'Flat DB Bench Press', 'Lower over 2 s to a light touch on the chest.'],
      ['3a', 'Face Pull', null],
      ['3b', 'Band External Rotation', 'Elbow at your side, a rolled towel under it.'],
    ]);
    // Express keeps the two main lifts; the face pull is its finisher, so no row is paired.
    const e = buildSession(read.data, DATE, 'express', { type: 'A' });
    assert.deepEqual(e.items.map((i) => [i.num, i.pair ?? null]), [['1', null], ['2', null]]);
    assert.equal(e.items[0]!.rest, '2 min');
  });

  it('Hotel: a swapped pair stays a pair with the plan’s rest, the swaps without the planned cues', () => {
    const h = buildSession(read.data, DATE, 'hotel', { type: 'A' });
    const p = h.items.filter((i) => i.pair);
    assert.deepEqual(p.map((i) => i.num), ['3a', '3b']);
    assert.ok(p.every((i) => i.rest === '90 s after each pair'));
    for (const i of h.items) if (i.replaces) assert.equal(i.cue, undefined, i.name);
    assert.equal(p[0]!.pair!.with.name, p[1]!.name);
  });

  it('the fixture as it was: its pair numbered from plan-data’s `pair` alone; a rest of "—" is none', () => {
    const plain = readVault(memoryIo(fixtureFiles('v'), DATE), 'v', { asOf: DATE });
    const a = buildSession(plain.data, DATE, 'full', { type: 'A' });
    assert.deepEqual(a.items.map((i) => i.num), ['1', '2', '3a', '3b']);
    assert.equal(a.items[2]!.rest, undefined);
    assert.equal(a.items[3]!.rest, '45 s');
    assert.equal(a.items[2]!.cue, 'Light.');
    const b = buildSession(plain.data, DATE, 'full');
    assert.deepEqual(b.items.map((i) => i.num), ['1', '2', '3', '4']);
    assert.ok(b.items.every((i) => !i.pair));
  });

  it('the session command prints the same fields', () => {
    const r = run(['session', '--vault', 'v', '--date', DATE, '--type', 'A'], memoryIo(files(), DATE));
    assert.equal(r.code, 0);
    const items = (JSON.parse(r.stdout) as { items: { num: string; rest?: string; pair?: { label: string; with: { name: string } }; cue?: string }[] }).items;
    assert.deepEqual(items.map((i) => [i.num, i.rest ?? null, i.pair?.with.name ?? null]), [
      ['1', '2 min', null],
      ['2', '2 min', null],
      ['3a', '90 s after each pair', 'Band External Rotation'],
      ['3b', '90 s after each pair', 'Face Pull'],
    ]);
    assert.equal(items[3]!.cue, 'Elbow at your side, a rolled towel under it.');
  });
});
