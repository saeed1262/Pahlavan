import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays } from '../src/core/dates.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { READINESS, readinessActions, readinessBand, readinessBaseline, readinessHrv, readinessInputs, readinessKey, readinessOn, readinessSeries } from '../src/core/readiness.ts';
import type { DailyCheckin } from '../src/core/schema.ts';
import { buildReview } from '../src/report/review.ts';
import { approx, days, fixtureFiles, memoryIo } from './helpers.ts';

/** n alternating days: sleep 7/8, quality and energy 3/4, RHR 55/57, soreness 2/3. */
const alternating = (start: string, n: number): DailyCheckin[] =>
  days(start, Array.from({ length: n }, (_, i) => (i % 2 ? { sleepH: 8, sleepQ: 4, energy: 4, rhr: 57, soreness: 3 } : { sleepH: 7, sleepQ: 3, energy: 3, rhr: 55, soreness: 2 })));

const steady = (start: string, n: number, v: Omit<DailyCheckin, 'date'> = { sleepH: 7, sleepQ: 3, energy: 3, rhr: 56, soreness: 2 }) =>
  days(start, Array.from({ length: n }, () => ({ ...v })));

const action = (rs: ReturnType<typeof readinessActions>, id: string) => rs.find((r) => r.value.action === id)!;

describe('readiness score', () => {
  it('returns nothing for no check-ins', () => {
    assert.deepEqual(readinessSeries([], '2026-03-28'), []);
    const acts = readinessActions([], '2026-03-28');
    assert.equal(acts.length, 4);
    assert.ok(acts.every((a) => !a.value.active));
    assert.match(acts[0]!.reason.note ?? '', /No check-ins/);
  });

  it('leaves a day unscored with 13 baseline entries and scores it with 14', () => {
    const d13 = [...alternating('2026-03-01', 13), { date: '2026-03-14', sleepH: 8, sleepQ: 4, energy: 4, rhr: 55, soreness: 2 }];
    const row13 = readinessSeries(d13, '2026-03-14').at(-1)!;
    assert.equal(row13.r, null);
    assert.equal(row13.band, 'unscored');
    assert.equal(row13.signals, 0);

    const d14 = [...alternating('2026-03-01', 14), { date: '2026-03-15', sleepH: 8.5, sleepQ: 4, energy: 4, rhr: 55, soreness: 2 }];
    const row = readinessSeries(d14, '2026-03-15').at(-1)!;
    assert.equal(row.signals, 5);
    const sd = Math.sqrt((14 * 0.25) / 13); // alternating values: deviations of +-0.5
    approx(row.z.sleepH, 1 / sd);
    approx(row.z.sleepQ, 0.5 / Math.max(sd, 0.5));
    approx(row.z.rhr, -(55 - 56) / Math.max(Math.sqrt(14 / 13), 2)); // sd of 55/57 is ~1.04, floored at 2
    approx(row.z.soreness, -(2 - 2.5) / sd);
    approx(row.r, (1 / sd + 0.5 / sd + 0.5 / sd + 0.5 + 0.5 / sd) / 5);
    approx(row.s, row.r!);
  });

  it('floors the sd and clips z at +-2.5', () => {
    const d = [...steady('2026-03-01', 20), { date: '2026-03-21', sleepH: 8, sleepQ: 5, energy: 3, rhr: 56, soreness: 2 }];
    const row = readinessSeries(d, '2026-03-21').at(-1)!;
    approx(row.z.sleepH, 2); // (8 - 7) / floor 0.5
    approx(row.z.sleepQ, 2.5); // (5 - 3) / 0.5 = 4, clipped
    approx(row.z.energy, 0);
  });

  it('signs RHR and soreness so that higher is worse', () => {
    const d = [...steady('2026-03-01', 20), { date: '2026-03-21', sleepH: 7, sleepQ: 3, energy: 3, rhr: 60, soreness: 3 }];
    const row = readinessSeries(d, '2026-03-21').at(-1)!;
    approx(row.z.rhr, -2); // (60 - 56) / floor 2
    approx(row.z.soreness, -2);
  });

  it('needs 3 scored signals for a daily score', () => {
    const d = [...days('2026-03-01', Array.from({ length: 20 }, () => ({ sleepH: 7, energy: 3 }))), { date: '2026-03-21', sleepH: 6, energy: 2 }];
    const row = readinessSeries(d, '2026-03-21').at(-1)!;
    assert.equal(row.signals, 2);
    assert.equal(row.r, null);
  });

  it('uses only the 28 days before the day as its baseline', () => {
    // 14 entries 29-42 days back do not count.
    const old = steady('2026-01-01', 14);
    const row = readinessSeries([...old, { date: '2026-02-12', sleepH: 7, sleepQ: 3, energy: 3, rhr: 56, soreness: 2 }], '2026-02-12').at(-1)!;
    assert.equal(row.signals, 0);
  });

  it('smooths with alpha 0.5 and restarts after a gap of more than 3 days', () => {
    const base = steady('2026-03-01', 20);
    const good = { sleepH: 8, sleepQ: 3, energy: 3, rhr: 56, soreness: 2 }; // R = (8 - 7) / 0.5 / 5 = 0.4
    const bad = { sleepH: 6, sleepQ: 3, energy: 3, rhr: 56, soreness: 2 };
    const next = readinessSeries([...base, { date: '2026-03-21', ...good }, { date: '2026-03-22', ...bad }], '2026-03-22');
    const [r1, s1, r2] = [next.at(-2)!.r!, next.at(-2)!.s!, next.at(-1)!.r!];
    approx(r1, 0.4);
    approx(s1, 0.2); // the steady days before score 0
    assert.ok(r2 < 0);
    approx(next.at(-1)!.s, 0.5 * r2 + 0.5 * s1);

    const gap3 = readinessSeries([...base, { date: '2026-03-21', ...good }, { date: '2026-03-24', ...bad }], '2026-03-24');
    approx(gap3.at(-1)!.s, 0.5 * gap3.at(-1)!.r! + 0.5 * 0.2); // 3 days: still smoothed

    const gap4 = readinessSeries([...base, { date: '2026-03-21', ...good }, { date: '2026-03-25', ...bad }], '2026-03-25');
    approx(gap4.at(-1)!.s, gap4.at(-1)!.r!); // 4 days: restarts from R
    assert.notEqual(gap4.at(-1)!.r, null);
  });

  it('bands the smoothed score', () => {
    assert.equal(readinessBand(0.5), 'good');
    assert.equal(readinessBand(0.49), 'normal');
    assert.equal(readinessBand(-0.5), 'watch');
    assert.equal(readinessBand(-0.99), 'watch');
    assert.equal(readinessBand(-1), 'low');
  });

  it('reports an unscored day for a date with no check-in', () => {
    const r = readinessOn(steady('2026-03-01', 20), '2026-03-25');
    assert.equal(r.value.band, 'unscored');
    assert.match(r.reason.note ?? '', /No check-in that day/);
  });
});

describe('readiness actions', () => {
  const base = steady('2026-02-01', 30); // through 2026-03-02

  it('raises the RHR flag only on two days running at baseline + 7', () => {
    const both = [...base, { date: '2026-03-03', rhr: 64 }, { date: '2026-03-04', rhr: 64 }];
    assert.equal(action(readinessActions(both, '2026-03-04'), 'no-hard-training').value.active, true);
    const one = [...base, { date: '2026-03-03', rhr: 56 }, { date: '2026-03-04', rhr: 64 }];
    assert.equal(action(readinessActions(one, '2026-03-04'), 'no-hard-training').value.active, false);
    const missing = [...base, { date: '2026-03-04', rhr: 70 }];
    assert.equal(action(readinessActions(missing, '2026-03-04'), 'no-hard-training').value.active, false);
    // Yesterday's 64 is part of today's baseline: 63 today is under 56.3 + 7.
    const edge = [...base, { date: '2026-03-03', rhr: 64 }, { date: '2026-03-04', rhr: 63 }];
    assert.equal(action(readinessActions(edge, '2026-03-04'), 'no-hard-training').value.active, false);
  });

  it('blocks hard training on reported illness', () => {
    const d = [...base, { date: '2026-03-03', illness: true }];
    const a = action(readinessActions(d, '2026-03-03'), 'no-hard-training');
    assert.equal(a.value.active, true);
    assert.match(a.reason.note ?? '', /Illness/);
  });

  it('blocks tests after under 6 h of sleep, only from today\'s check-in', () => {
    const d = [...base, { date: '2026-03-03', sleepH: 5.9 }];
    assert.equal(action(readinessActions(d, '2026-03-03'), 'no-tests').value.active, true);
    const later = action(readinessActions(d, '2026-03-04'), 'no-tests');
    assert.equal(later.value.active, false);
    assert.match(later.reason.note ?? '', /only from today/);
    const six = [...base, { date: '2026-03-03', sleepH: 6 }];
    assert.equal(action(readinessActions(six, '2026-03-03'), 'no-tests').value.active, false);
  });

  it('trims on a low smoothed score and offers an early deload after 5 low days with a falling e1RM', () => {
    const awful = { sleepH: 4, sleepQ: 1, energy: 1, rhr: 66, soreness: 5 };
    const d = [...base, ...Array.from({ length: 5 }, (_, i) => ({ date: addDays('2026-03-03', i), ...awful }))];
    const today = '2026-03-07';
    const acts = readinessActions(d, today, { e1rmFalling: true });
    assert.equal(action(acts, 'trim').value.active, true);
    const early = action(acts, 'early-deload');
    assert.equal(early.value.active, true);
    assert.equal(early.reason.inputs['lowRun'], 5);
    assert.equal(action(readinessActions(d, today, { e1rmFalling: false }), 'early-deload').value.active, false);
    const unknown = action(readinessActions(d, today), 'early-deload');
    assert.equal(unknown.value.active, false);
    assert.match(unknown.reason.note ?? '', /e1RM trend decides/);
    // Four low days are not enough.
    assert.equal(action(readinessActions(d, '2026-03-06', { e1rmFalling: true }), 'early-deload').value.active, false);
  });

  it('reads the latest check-in on or before today and says when it is stale', () => {
    const acts = readinessActions(base, '2026-03-10');
    assert.equal(acts[0]!.reason.inputs['asOf'], '2026-03-02');
    assert.match(acts[0]!.reason.note ?? '', /8 day\(s\) before/);
  });

  it('ignores days that hold only a training or protein tick, steps or floors', () => {
    const ticks: DailyCheckin[] = [
      { date: '2026-03-08', trained: true, protein: true },
      { date: '2026-03-09', steps: 9000, floors: 4 },
    ];
    const acts = readinessActions([...base, ...ticks], '2026-03-10');
    assert.equal(acts[0]!.reason.inputs['asOf'], '2026-03-02');
    assert.deepEqual(readinessSeries([...base, ...ticks], '2026-03-10').map((r) => r.date), readinessSeries(base, '2026-03-10').map((r) => r.date));
    assert.equal(readinessSeries([{ date: '2026-03-08', illness: true }], '2026-03-08').length, 1);
  });
});

describe('readinessKey', () => {
  it('explains the score in a line and says what each band does to the session; only low changes it', () => {
    const k = readinessKey();
    assert.equal(k.reason.rule, 'readiness.key');
    assert.match(k.value.how, /with your own baseline from this cycle’s mornings, where 0 is your usual\. The needle is their average, smoothed over 3 days\.$/);
    assert.deepEqual(k.value.bands.map((b) => [b.label, b.effect]), [
      ['Good', 'Train as planned'], ['Normal', 'Train as planned'], ['Watch', 'Train as planned'], ['Low', 'One set fewer per exercise and RIR +1'],
    ]);
    assert.ok(!JSON.stringify(k).includes('\u2014'), 'no em-dash');
  });

  it('the band edges are the ones the score is banded by', () => {
    for (const b of readinessKey().value.bands) {
      if (b.from !== null && b.to !== null) assert.equal(readinessBand((b.from + b.to) / 2), b.band);
      if (b.from === null) assert.equal(readinessBand(b.to!), b.band, 'low includes its upper edge');
      if (b.to === null) assert.equal(readinessBand(b.from!), b.band, 'good includes its lower edge');
    }
  });

  it('the plan\'s low-day rule: its amounts, or none (trim never active)', () => {
    const lowDay = steady('2026-03-01', 20).concat(days('2026-03-21', [{ sleepH: 4, sleepQ: 1, energy: 1, rhr: 70, soreness: 5 }]));
    const from = { kind: 'plan' as const, path: 'rules.readiness', text: "The plan's rule: x." };
    const two = action(readinessActions(lowDay, '2026-03-21', { low: { sets: -2, rir: 2 }, from }), 'trim');
    assert.equal(two.value.active, true);
    assert.match(two.reason.note ?? '', /^The plan's rule: x\. Readiness is low: 2 sets fewer per exercise and RIR \+2/);
    const none = action(readinessActions(lowDay, '2026-03-21', { low: null }), 'trim');
    assert.equal(none.value.active, false);
    assert.match(none.reason.note ?? '', /leaves the session as planned/);
    assert.equal(readinessKey(null).value.bands.find((b) => b.band === 'low')!.effect, 'Train as planned (the plan’s rule)');
    assert.equal(readinessKey({ sets: 0, rir: 2 }).value.bands.find((b) => b.band === 'low')!.effect, 'RIR +2');
  });

  it('the low band says what the trim action does', () => {
    const low = readinessKey().value.bands.find((b) => b.band === 'low')!;
    const trim = action(readinessActions(steady('2026-03-01', 20).concat(days('2026-03-21', [{ sleepH: 4, sleepQ: 1, energy: 1, rhr: 70, soreness: 5 }])), '2026-03-21'), 'trim');
    assert.equal(trim.value.active, true);
    assert.ok(trim.reason.note!.toLowerCase().includes(low.effect.toLowerCase()), trim.reason.note);
  });
});

describe('readiness from the cycle’s mornings only', () => {
  // 30 steady mornings before the cycle, then a reset on 1 April: the cycle's mornings alternate.
  const before = steady('2026-03-02', 30);
  const cycle = alternating('2026-04-01', 16);
  const daily = [...before, ...cycle];
  const since = '2026-04-01';

  it('builds the baseline again: no score until 14 morning check-ins in the cycle, then the 15th is scored', () => {
    const series = readinessSeries(daily, '2026-04-16', { since });
    assert.ok(series.every((d) => d.date >= since), 'nothing from before the cycle');
    assert.deepEqual(series.filter((d) => d.r !== null).map((d) => d.date), ['2026-04-15', '2026-04-16']);
    // Every morning on record would have scored from the first day of the cycle.
    assert.equal(readinessSeries(daily, '2026-04-01').at(-1)!.band !== 'unscored', true);
  });

  it('says how far the baseline is: n of 14, train as planned; 14 of 14 scores from the next check-in', () => {
    const b5 = readinessBaseline(daily, '2026-04-05', { since });
    assert.deepEqual([b5.value.mornings, b5.value.needed, b5.value.building], [5, 14, true]);
    assert.equal(b5.reason.rule, 'readiness.baseline');
    assert.equal(b5.reason.note, 'Building your baseline: 5 of 14 morning check-ins this cycle; train as planned meanwhile.');
    assert.equal(readinessBaseline(daily, '2026-04-14', { since }).reason.note, 'Building your baseline: 14 of 14 morning check-ins this cycle; train as planned. Scored from your next check-in.');
    const b15 = readinessBaseline(daily, '2026-04-15', { since });
    assert.deepEqual([b15.value.mornings, b15.value.building], [15, false]);
    assert.match(b15.reason.note!, /^The baseline is this cycle's mornings \(since Wed 1 Apr\)/);
    assert.equal(readinessOn(daily, '2026-04-05', { since }).reason.note, 'Building your baseline: 5 of 14 morning check-ins this cycle; train as planned meanwhile.');
  });

  it('changes nothing while building: no trim, even on a bad morning; the safety rules stay on', () => {
    const bad = [...before, ...alternating('2026-04-01', 5), ...days('2026-04-06', [{ sleepH: 4.5, sleepQ: 1, energy: 1, rhr: 75, soreness: 5 }])];
    const all = readinessActions(bad, '2026-04-06');
    assert.equal(action(all, 'trim').value.active, true, 'against every morning, this one is low');
    const acts = readinessActions(bad, '2026-04-06', { since });
    assert.equal(action(acts, 'trim').value.active, false);
    assert.match(action(acts, 'trim').reason.note!, /^Building your baseline: 6 of 14/);
    assert.equal(action(acts, 'no-tests').value.active, true, 'under 6 h of sleep: still no tests');
  });

  it('the inputs’ usual range is the cycle’s mornings', () => {
    const inputs = readinessInputs(daily, '2026-04-16', { since });
    assert.equal(inputs.find((x) => x.signal === 'sleepH')!.days, 15);
    assert.equal(readinessInputs(daily, '2026-04-16').find((x) => x.signal === 'sleepH')!.days, 28);
  });
});

describe('HRV: scored on its log, and a note when it is low two mornings running', () => {
  // 30 steady mornings with HRV 60 ms (through 2 March): its ln-sd is 0, so the 0.1 floor applies.
  const withHrv = steady('2026-02-01', 30, { sleepH: 7, sleepQ: 3, energy: 3, rhr: 56, soreness: 2, hrv: 60 });
  const flag = (d: DailyCheckin[], date: string) => readinessSeries(d, date).at(-1)!.hrvFlag;
  const noHard = (d: DailyCheckin[], date: string) => action(readinessActions(d, date), 'no-hard-training');
  const normal = { sleepH: 7, sleepQ: 3, energy: 3, rhr: 56, soreness: 2 };

  it('scores ln(HRV) against the ln baseline, with an sd floor of 0.1 on that scale', () => {
    const row = readinessSeries([...withHrv, { date: '2026-03-03', ...normal, hrv: 66 }], '2026-03-03').at(-1)!;
    approx(row.z.hrv, Math.log(66 / 60) / READINESS.hrvFloorLn);
    assert.equal(row.signals, 6);
    const low = readinessSeries([...withHrv, { date: '2026-03-03', ...normal, hrv: 30 }], '2026-03-03').at(-1)!;
    approx(low.z.hrv, -READINESS.clip); // ln(0.5) / 0.1 is about -6.9, clipped
    // The inputs give HRV in ms: the geometric mean, and the usual range as the mean times or divided by e^sd.
    const x = readinessInputs([...withHrv, { date: '2026-03-03', ...normal, hrv: 66 }], '2026-03-03').find((i) => i.signal === 'hrv')!;
    approx(x.mean, 60);
    approx(x.sd, 0.1);
    approx(x.range![0], 60 * Math.exp(-0.1));
    approx(x.range![1], 60 * Math.exp(0.1));
    assert.equal(x.value, 66);
  });

  it('leaves HRV out of the inputs for someone who never sends it', () => {
    const inputs = readinessInputs(steady('2026-03-01', 20), '2026-03-20');
    assert.deepEqual(inputs.map((x) => x.signal), ['sleepH', 'sleepQ', 'energy', 'rhr', 'soreness']);
  });

  it('two mornings 20% or more under the baseline: a note only, no hard-training stop', () => {
    // Yesterday's HRV is part of today's baseline (as the RHR flag has it): 46 and 45 against about 59 ms.
    const d = [...withHrv, { date: '2026-03-03', ...normal, hrv: 46 }, { date: '2026-03-04', ...normal, hrv: 45 }];
    assert.equal(flag(d, '2026-03-04'), true);
    // Exactly 20% under the geometric mean counts.
    const edge = 0.8 * Math.exp((27 * Math.log(60) + Math.log(40)) / 28);
    assert.equal(flag([...withHrv, { date: '2026-03-03', ...normal, hrv: 40 }, { date: '2026-03-04', ...normal, hrv: edge }], '2026-03-04'), true);
    assert.equal(flag([...withHrv, { date: '2026-03-03', ...normal, hrv: 40 }, { date: '2026-03-04', ...normal, hrv: edge + 0.01 }], '2026-03-04'), false);
    const a = noHard(d, '2026-03-04');
    assert.equal(a.value.active, false);
    assert.equal(a.reason.inputs['hrvFlag'], true);
    assert.match(a.reason.note ?? '', /HRV 20% or more under its 28-day baseline two mornings running: a note only/);
    const h = readinessHrv(d, '2026-03-04');
    assert.deepEqual([h.value.flag, h.value.value, h.value.dayBefore, h.value.days, h.value.building], [true, 45, 46, 28, false]);
    approx(h.value.usual, Math.exp((27 * Math.log(60) + Math.log(46)) / 28));
    approx(h.value.limit, 0.8 * h.value.usual!);
    assert.equal(h.reason.rule, 'readiness.hrv-flag');
    assert.match(h.reason.note ?? '', /^HRV 46 ms and 45 ms, 20% or more under your usual 59 ms two mornings running: a note only\./);
    assert.match(readinessOn(d, '2026-03-04').reason.note ?? '', /HRV 20% or more under your usual two mornings running: a note on its own\./);
    assert.ok(!JSON.stringify([a, h]).includes('\u2014'), 'no em-dash');
  });

  it('needs both mornings: one low morning, or one only 19% under, gives no note', () => {
    assert.equal(flag([...withHrv, { date: '2026-03-03', ...normal, hrv: 60 }, { date: '2026-03-04', ...normal, hrv: 40 }], '2026-03-04'), false);
    assert.equal(flag([...withHrv, { date: '2026-03-04', ...normal, hrv: 40 }], '2026-03-04'), false, 'no HRV the day before');
    assert.equal(flag([...withHrv, { date: '2026-03-03', ...normal, hrv: 49 }, { date: '2026-03-04', ...normal, hrv: 40 }], '2026-03-04'), false, 'the day before is 18% under');
  });

  it('with the resting-HR flag as well: no hard training, and the note names both', () => {
    const d = [...withHrv, { date: '2026-03-03', ...normal, rhr: 64, hrv: 45 }, { date: '2026-03-04', ...normal, rhr: 64, hrv: 45 }];
    const a = noHard(d, '2026-03-04');
    assert.equal(a.value.active, true);
    assert.deepEqual([a.reason.inputs['rhrFlag'], a.reason.inputs['hrvFlag']], [true, true]);
    assert.match(a.reason.note ?? '', /^Resting HR 7\+ bpm .* HRV 20% or more under its baseline two mornings running too\./);
    assert.match(readinessHrv(d, '2026-03-04').reason.note ?? '', /with the resting-HR flag as well: no hard training\.$/);
  });

  it('with a low score as well: no hard training, the reason says HRV and the score', () => {
    const awful = { sleepH: 4, sleepQ: 1, energy: 1, rhr: 56, soreness: 5, hrv: 40 };
    const d = [...withHrv, { date: '2026-03-03', ...awful }, { date: '2026-03-04', ...awful }];
    const row = readinessSeries(d, '2026-03-04').at(-1)!;
    assert.deepEqual([row.band, row.rhrFlag, row.hrvFlag], ['low', false, true]);
    const a = noHard(d, '2026-03-04');
    assert.equal(a.value.active, true);
    assert.equal(a.reason.inputs['band'], 'low');
    assert.match(a.reason.note ?? '', /HRV 20% or more under its 28-day baseline two mornings running, with a low score: no hard training/);
    // The same low score without the HRV note trims, but does not stop hard training.
    const noHrv = [...withHrv, { date: '2026-03-03', ...awful, hrv: 60 }, { date: '2026-03-04', ...awful, hrv: 60 }];
    assert.equal(readinessSeries(noHrv, '2026-03-04').at(-1)!.band, 'low');
    assert.equal(noHard(noHrv, '2026-03-04').value.active, false);
  });

  it('under 14 HRV mornings in the baseline: no note, "building"', () => {
    // 30 mornings, HRV only on the last 13 of them.
    const d = [...steady('2026-02-01', 17), ...steady('2026-02-18', 13, { ...normal, hrv: 60 }), { date: '2026-03-03', ...normal, hrv: 40 }, { date: '2026-03-04', ...normal, hrv: 40 }];
    const h = readinessHrv(d, '2026-03-03');
    assert.deepEqual([h.value.flag, h.value.days, h.value.building, h.value.usual], [false, 13, true, null]);
    assert.match(h.reason.note ?? '', /^HRV baseline building: 13 of 14 mornings with HRV in the previous 28 days; no HRV note until then\.$/);
    assert.equal(flag(d, '2026-03-03'), false);
    // The next morning has 14 (the 3rd's own 40 among them) and both mornings are under the line.
    assert.equal(readinessHrv(d, '2026-03-04').value.building, false);
    assert.equal(flag(d, '2026-03-04'), true);
  });

  it('no HRV that morning: no note, and nothing for someone who never sends it', () => {
    const h = readinessHrv([...withHrv, { date: '2026-03-03', ...normal }], '2026-03-03');
    assert.equal(h.value.flag, false);
    assert.match(h.reason.note ?? '', /^No HRV on the latest check-in/);
    assert.equal(readinessHrv(steady('2026-03-01', 20), '2026-03-20').value.value, null);
  });

  it('a watch-only morning (sleep hours, resting HR, HRV, no card answer) is not scored', () => {
    const d = [...withHrv, { date: '2026-03-03', sleepH: 7.5, rhr: 55, hrv: 62 }];
    const row = readinessSeries(d, '2026-03-03').at(-1)!;
    assert.equal(row.signals, 3);
    assert.equal(row.r, null);
    assert.equal(row.band, 'unscored');
    assert.match(readinessOn(d, '2026-03-03').reason.note ?? '', /^Not scored: watch numbers alone never score a morning/);
    // One card answer is enough.
    const one = readinessSeries([...withHrv, { date: '2026-03-03', sleepH: 7.5, rhr: 55, hrv: 62, energy: 4 }], '2026-03-03').at(-1)!;
    assert.equal(one.signals, 4);
    assert.notEqual(one.r, null);
  });
});

describe('illness from body-data.json', () => {
  const BODY = 'v/3-Personal/Fitness/body-data.json';
  const DATE = '2026-04-10';
  const withIll = (v: unknown) => {
    const files = fixtureFiles('v');
    const body = JSON.parse(files[BODY]!);
    body.days[DATE] = { ...body.days[DATE], illness: v };
    files[BODY] = JSON.stringify(body);
    return readVault(memoryIo(files, DATE), 'v', { asOf: DATE });
  };

  it('a sick day in the file is read, and stops hard training', () => {
    const read = withIll(true);
    assert.equal(read.data.checkins.daily.find((d) => d.date === DATE)!.illness, true);
    const a = action(readinessActions(read.data.checkins.daily, DATE), 'no-hard-training');
    assert.equal(a.value.active, true);
    assert.match(a.reason.note ?? '', /Illness reported: no hard training\./);
    // The review, as Today reads it.
    const review = buildReview(read.data, DATE);
    assert.equal(review.readiness.actions.find((x) => x.value.action === 'no-hard-training')!.value.active, true);
    assert.ok(review.readiness.last14.at(-1)!.flags.includes('illness'));
    assert.ok(!read.data.warnings.some((w) => /illness/.test(JSON.stringify(w))), 'no unknown-field note for illness');
  });

  it('a value that is not a yes or a no is left out with a note', () => {
    const read = withIll('yes');
    assert.equal(read.data.checkins.daily.find((d) => d.date === DATE)!.illness, undefined);
    assert.ok(read.data.warnings.some((w) => JSON.stringify(w).includes(`${DATE} illness: \\"yes\\"`)), JSON.stringify(read.data.warnings));
  });
});
