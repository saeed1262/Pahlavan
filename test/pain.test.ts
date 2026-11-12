// Pain notes read back: the Log panel saves a session's pain ({area,
// severity, exercise?}) and the Sunday check-in its joint aches; the engine
// now reads the log's, applies the skill's pain rule (adhoc.md: up to 3 of
// 10 that settles by the next day is fine; more, or lingering, change the
// exercise; persisting about 2 weeks or getting worse, see a professional),
// tags each report with where it came from, and says so in `review`, the
// Sunday check-in's Pain question and, for one over 3 of 10 in the last
// week, once in the warnings (Today's Data notes, the review's warnings).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { run } from '../src/cli/cli.ts';
import { PAIN, painRule, painText, painTrend, type PainReport } from '../src/core/pain.ts';
import { validateSession } from '../src/core/validate.ts';
import { buildCheckin, buildReview, buildTemplate, buildToday, painReports, painWarning } from '../src/report/index.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
const CHECKINS = 'v/3-Personal/Fitness/Coach/checkins.json';
/** Pain on the synthetic log's sessions, by date. */
const withPain = (pains: Record<string, unknown>) => (f: Record<string, string>) => {
  const log = JSON.parse(f[LOG]!);
  for (const s of log.sessions) if (pains[s.date] !== undefined) s.pain = pains[s.date];
  f[LOG] = JSON.stringify(log);
};
const read = (date: string, ...edits: ((f: Record<string, string>) => void)[]) => {
  const f = fixtureFiles('v');
  for (const e of edits) e(f);
  return readVault(memoryIo(f, date), 'v', { asOf: date });
};
const WEEK = withPain({ '2026-04-06': [{ area: 'Lower back', severity: 2, exercise: 'Romanian Deadlift' }], '2026-04-08': [{ area: 'Knee', severity: 4, exercise: 'Goblet Squat' }] });
const rep = (date: string, area: string, severity: number | null, extra: Partial<PainReport> = {}): PainReport => ({ date, area, severity, exercise: null, source: 'log', session: 'Full Body A', ...extra });

describe('the pain rule', () => {
  it('up to 3 of 10, settled by the next day: fine; over 3: change the exercise; each tagged with where it came from', () => {
    const [fine, swap] = painRule([rep('2026-04-06', 'Lower back', 2), rep('2026-04-08', 'Knee', 4, { exercise: 'Goblet Squat' })], '2026-04-06', '2026-04-12');
    assert.deepEqual([fine!.value.verdict, swap!.value.verdict], ['fine', 'swap']);
    assert.deepEqual([fine!.reason.rule, fine!.reason.title, fine!.reason.threshold], ['pain.rule', 'The pain rule', { fine: PAIN.fine, persistDays: PAIN.persistDays }]);
    assert.equal(fine!.reason.note, 'Lower back 2 of 10 (the log, Mon 6 Apr, Full Body A): up to 3 of 10 and settled by the next day, as far as the log and the check-in say, so fine: carry on and note it. Describe it; never diagnose it.');
    assert.equal(swap!.reason.note, 'Knee 4 of 10 during Goblet Squat (the log, Wed 8 Apr, Full Body A): over 3 of 10, so change the load, the range or the exercise (a pain-free variant) and keep training everything else; a Ledger entry. Describe it; never diagnose it.');
  });

  it('still there the next day (the next day’s log, or the check-in says it lingered): change the exercise', () => {
    const next = painRule([rep('2026-04-07', 'knee', 2), rep('2026-04-08', 'Knee', 2)], '2026-04-07', '2026-04-08');
    assert.deepEqual(next.map((r) => [r.value.date, r.value.lingered, r.value.verdict]), [['2026-04-07', true, 'swap'], ['2026-04-08', false, 'fine']]);
    const said = painRule([rep('2026-04-08', 'Knee', 2), rep('2026-04-12', 'knee', 2, { source: 'checkin', session: null, lingered: true })], '2026-04-06', '2026-04-12');
    assert.deepEqual(said.map((r) => [r.value.source, r.value.lingered, r.value.verdict]), [['log', true, 'swap'], ['checkin', true, 'swap']]);
    assert.match(said[1]!.reason.note!, /^Knee 2 of 10 \(the Sunday check-in of Sun 12 Apr\): still there the next day/);
  });

  it('persisting about 2 weeks, or getting worse over 3 of 10: see a professional', () => {
    const long = painRule([rep('2026-03-25', 'Shoulder', 2), rep('2026-04-08', 'Left shoulder', 2)], '2026-04-06', '2026-04-12');
    assert.deepEqual([long[0]!.value.persisting, long[0]!.value.since, long[0]!.value.verdict], [true, '2026-03-25', 'professional']);
    const worse = painRule([rep('2026-04-01', 'Elbow', 3), rep('2026-04-08', 'Elbow', 5)], '2026-04-06', '2026-04-12');
    assert.deepEqual([worse[0]!.value.worse, worse[0]!.value.verdict], [true, 'professional']);
    assert.match(worse[0]!.reason.note!, /worse than the 3 of 10 on Wed 1 Apr, so see a professional/);
    // Older than the look-back: a new report.
    assert.equal(painRule([rep('2026-02-01', 'Elbow', 3), rep('2026-04-08', 'Elbow', 2)], '2026-04-06', '2026-04-12')[0]!.value.verdict, 'fine');
  });

  it('a report in words', () => {
    assert.equal(painText({ area: 'Lower back', severity: 3, exercise: null }), 'lower back 3 of 10');
    assert.equal(painText({ area: 'Knee', severity: 4, exercise: 'Barbell Back Squat' }), 'knee 4 of 10 during Barbell Back Squat');
  });
});

describe('the log’s pain, read back', () => {
  it('the adapter reads each session’s pain; a malformed one is left out with a warning', () => {
    const r = read('2026-04-12', withPain({ '2026-04-08': [{ area: 'Knee', severity: 4, exercise: 'Goblet Squat' }, { area: '', severity: 3 }, { area: 'Hip', severity: 11 }] }));
    assert.deepEqual(r.data.sessions.find((s) => s.date === '2026-04-08')!.pain, [{ area: 'Knee', severity: 4, exercise: 'Goblet Squat' }]);
    const w = r.data.warnings.find((x) => x.code === 'bad-pain')!;
    assert.equal(w.items!.length, 2);
    assert.deepEqual(validateSession({ ...r.data.sessions.find((s) => s.date === '2026-04-08')! }), []);
    assert.ok(validateSession({ id: 'x', date: '2026-04-08', trackingLevel: 'light', exercises: [], pain: [{ area: 'Knee', severity: 12 }] }).length > 0);
  });

  it('review: the week’s pain from the log and the check-in, with the rule, and the worst verdict', () => {
    const checkins = (f: Record<string, string>) => void (f[CHECKINS] = JSON.stringify({ schemaVersion: 1, checkins: [{ date: '2026-04-12', weekStart: '2026-04-06', jointAches: [{ area: 'knee', severity: 3, lingered: true }] }] }));
    const p = buildReview(read('2026-04-12', WEEK, checkins).data, '2026-04-12').pain;
    assert.deepEqual([p.from, p.to, p.worst], ['2026-04-06', '2026-04-12', 'swap']);
    assert.deepEqual(p.reports.map((r) => [r.value.date, r.value.source, r.value.area, r.value.severity, r.value.session, r.value.verdict]), [
      ['2026-04-06', 'log', 'Lower back', 2, 'Full Body B', 'fine'],
      ['2026-04-08', 'log', 'Knee', 4, 'Full Body A', 'swap'],
      ['2026-04-12', 'checkin', 'knee', 3, null, 'swap'],
    ]);
    const { byExercise, ...week } = buildReview(read('2026-04-12').data, '2026-04-12').pain;
    assert.deepEqual(week, { from: '2026-04-06', to: '2026-04-12', reports: [], worst: null });
    assert.deepEqual(byExercise.value, []);
  });

  it('every report up to the date, tagged with its source', () => {
    assert.deepEqual(painReports(read('2026-04-12', WEEK).data, '2026-04-07').map((r) => [r.date, r.source]), [['2026-04-06', 'log']]);
  });
});

describe('a pain over 3 of 10 in the last week: one warning', () => {
  it('in the warnings of review and Today’s Data notes, once for all of them; not for 3 or less, nor older', () => {
    const two = withPain({ '2026-04-06': [{ area: 'Lower back', severity: 5 }], '2026-04-08': [{ area: 'Knee', severity: 4, exercise: 'Goblet Squat' }] });
    const w = painWarning(read('2026-04-10', two).data, '2026-04-10')!;
    assert.deepEqual([w.code, w.items], ['pain', ['2026-04-06 Lower back', '2026-04-08 Knee']]);
    assert.equal(w.message, 'Pain over 3 of 10 in the last week: lower back 5 of 10, Mon 6 Apr; knee 4 of 10 during Goblet Squat, Wed 8 Apr. The pain rule: change the load, the range or the exercise, and keep training everything else. Tell the coach, for the Ledger.');
    assert.equal(painWarning(read('2026-04-10', withPain({ '2026-04-08': [{ area: 'Knee', severity: 3 }] })).data, '2026-04-10'), null);
    assert.equal(painWarning(read('2026-04-16', WEEK).data, '2026-04-16'), null, 'the 8th is more than a week back');
    const today = buildToday(read('2026-04-10', two), '2026-04-10', 'full', 'v');
    assert.equal(today.warnings.filter((x) => x.code === 'pain').length, 1);
    const f = fixtureFiles('v');
    two(f);
    const out = JSON.parse(run(['review', '--vault', 'v', '--date', '2026-04-10'], memoryIo(f, '2026-04-10')).stdout) as Json;
    assert.deepEqual(out.warnings.filter((x: Json) => x.code === 'pain'), [w]);
    assert.equal(out.pain.reports.length, 2);
  });
});

describe('the Sunday check-in’s Pain question', () => {
  it('shows what the week’s logs already say, as the other questions show theirs', () => {
    const t = buildTemplate(read('2026-04-12', WEEK).data, '2026-04-12', null);
    const q = t.ask.find((a) => a.topic === 'pain')! as { known: Json | null };
    assert.equal(q.known!['line'], 'Logged: lower back 2 of 10 during Romanian Deadlift, Mon; knee 4 of 10 during Goblet Squat, Wed.');
    assert.deepEqual(q.known!['logged'].map((p: Json) => [p.date, p.verdict]), [['2026-04-06', 'fine'], ['2026-04-08', 'swap']]);
    assert.equal((buildTemplate(read('2026-04-12').data, '2026-04-12', null).ask.find((a) => a.topic === 'pain') as { known: unknown }).known, null, 'nothing logged, nothing before: no known line');
    // The Check-in screen's open question carries it.
    const c = buildCheckin(read('2026-04-12', WEEK), '2026-04-12', null);
    assert.equal((c.sunday!.template.ask.find((a) => a.topic === 'pain') as { known: Json }).known['line'], q.known!['line']);
  });
});

describe('a severity not given', () => {
  it('is never read as 3 or 0: the rule says to ask how bad it was, unless it lingered or persisted', () => {
    const [r] = painRule([rep('2026-04-08', 'Knee', null, { exercise: 'Goblet Squat' })], '2026-04-06', '2026-04-12');
    assert.deepEqual([r!.value.severity, r!.value.verdict, r!.value.worse], [null, 'ask', false]);
    assert.equal(r!.reason.note, 'Knee (severity not given) during Goblet Squat (the log, Wed 8 Apr, Full Body A): no severity given, and nothing says it lingered, so ask how bad it was: over 3 of 10 is the rule\'s change of load, range or exercise. Describe it; never diagnose it.');
    assert.equal(painText({ area: 'Knee', severity: null, exercise: null }), 'knee (severity not given)');
    // Lingering or persisting still decide; a report without a severity is never worse, and never the one a later report is worse than.
    const next = painRule([rep('2026-04-07', 'Knee', null), rep('2026-04-08', 'Knee', 2)], '2026-04-07', '2026-04-08');
    assert.deepEqual(next.map((x) => x.value.verdict), ['swap', 'fine']);
    const worse = painRule([rep('2026-04-01', 'Elbow', 3), rep('2026-04-05', 'Elbow', null), rep('2026-04-08', 'Elbow', 5)], '2026-04-06', '2026-04-12');
    assert.deepEqual([worse[0]!.value.worse, worse[0]!.value.verdict], [true, 'professional']);
    assert.match(worse[0]!.reason.note!, /worse than the 3 of 10 on Wed 1 Apr/);
  });

  it('the Log panel saves a pain without one; the adapter, the validator and the review read it as not given, with no warning', () => {
    const r = read('2026-04-12', withPain({ '2026-04-08': [{ area: 'Knee', exercise: 'Goblet Squat' }] }));
    const s = r.data.sessions.find((x) => x.date === '2026-04-08')!;
    assert.deepEqual(s.pain, [{ area: 'Knee', exercise: 'Goblet Squat' }]);
    assert.deepEqual(validateSession(s), []);
    assert.equal(r.data.warnings.find((w) => w.code === 'bad-pain'), undefined);
    const p = buildReview(r.data, '2026-04-12').pain;
    assert.deepEqual([p.reports[0]!.value.severity, p.reports[0]!.value.verdict, p.worst], [null, 'ask', 'ask']);
    assert.equal(painWarning(r.data, '2026-04-12'), null, 'not a pain over 3 of 10');
  });
});

describe('painTrend: the cycle’s pain by exercise', () => {
  it('2 of 10 then 4 of 10 on one exercise is rising, with the worst verdict, the first and last day, the highest and the latest', () => {
    const t = painTrend([rep('2026-04-01', 'Knee', 2, { exercise: 'Goblet Squat' }), rep('2026-04-08', 'knee', 4, { exercise: 'Goblet Squat' })], '2026-03-30', '2026-04-12');
    assert.equal(t.value.length, 1);
    const g = t.value[0]!;
    assert.deepEqual([g.key, g.exercise, g.count, g.first, g.last, g.max, g.latest, g.direction, g.verdict, g.notGiven, g.painSkips], ['goblet-squat', { id: 'goblet-squat', name: 'Goblet Squat' }, 2, '2026-04-01', '2026-04-08', 4, { date: '2026-04-08', severity: 4 }, 'rising', 'professional', 0, 0]);
    assert.deepEqual([g.area, g.areas], ['knee', ['knee']]);
    assert.deepEqual([t.reason.rule, t.reason.title], ['pain.trend', 'Pain by exercise']);
    assert.equal(t.reason.note, 'Pain since Mon 30 Mar by exercise (by area where none is named): Goblet Squat: 2 reports (2 then 4 of 10), rising, the rule: professional.');
    const down = painTrend([rep('2026-04-01', 'Knee', 4, { exercise: 'Goblet Squat' }), rep('2026-04-08', 'Knee', 2, { exercise: 'Goblet Squat' })], '2026-03-30', '2026-04-12').value[0]!;
    const same = painTrend([rep('2026-04-01', 'Knee', 2, { exercise: 'Goblet Squat' }), rep('2026-04-08', 'Knee', 2, { exercise: 'Goblet Squat' })], '2026-03-30', '2026-04-12').value[0]!;
    assert.deepEqual([down.direction, same.direction], ['falling', 'steady']);
  });

  it('a missing severity counts as a report, shown as not given, and is left out of the highest and the direction', () => {
    const t = painTrend([rep('2026-04-01', 'Knee', 2, { exercise: 'Goblet Squat' }), rep('2026-04-08', 'Knee', null, { exercise: 'Goblet Squat' })], '2026-03-30', '2026-04-12');
    const g = t.value[0]!;
    assert.deepEqual([g.count, g.max, g.latest, g.direction, g.notGiven, g.verdict], [2, 2, { date: '2026-04-08', severity: null }, 'single', 1, 'ask']);
    assert.equal(t.reason.note, 'Pain since Mon 30 Mar by exercise (by area where none is named): Goblet Squat: 2 reports (2 then not given of 10), the rule: ask. A severity not given is left out of the highest and the direction: ask how bad it was.');
  });

  it('reports with no exercise, the check-in’s joint aches among them, go to their area’s group; an area named inside another joins it', () => {
    const t = painTrend([
      rep('2026-04-05', 'Left knee', 3, { source: 'checkin', session: null }),
      rep('2026-04-08', 'knee', 5),
      rep('2026-04-09', 'Shoulder', 2, { exercise: 'Face Pull' }),
    ], '2026-03-30', '2026-04-12');
    assert.deepEqual(t.value.map((g) => [g.key, g.exercise?.id ?? null, g.count, g.areas, g.direction]), [
      ['area:left knee', null, 2, ['left knee', 'knee'], 'rising'],
      ['face-pull', 'face-pull', 1, ['shoulder'], 'single'],
    ]);
    assert.deepEqual(t.value[0]!.reports.map((x) => x.source), ['checkin', 'log']);
    // Outside the span: left out.
    assert.deepEqual(painTrend([rep('2026-03-01', 'Knee', 4)], '2026-03-30', '2026-04-12').value, []);
  });

  it('review’s pain.byExercise: the cycle’s reports by exercise, a name matched to its exercise, with the skips for pain', () => {
    const files = withPain({
      '2026-03-30': [{ area: 'Shoulder', severity: 2, exercise: 'face pull' }],
      '2026-04-08': [{ area: 'Shoulder', exercise: 'Face Pull' }],
    });
    const skip = (f: Record<string, string>) => {
      const log = JSON.parse(f[LOG]!);
      for (const s of log.sessions) if (s.date === '2026-04-08') s.checklist = { done: 3, total: 4, skipped: ['Face Pull + Band External Rotation'], why: { 'Face Pull + Band External Rotation': 'pain' } };
      f[LOG] = JSON.stringify(log);
    };
    const r = buildReview(read('2026-04-12', files, skip).data, '2026-04-12');
    const b = r.pain.byExercise;
    assert.equal(b.reason.inputs['from'], '2026-02-23', 'the cycle start');
    assert.deepEqual(b.value.map((g) => [g.key, g.exercise?.name ?? null, g.count, g.max, g.notGiven, g.painSkips, g.verdict]), [
      ['face-pull', 'Face Pull', 2, 2, 1, 1, 'ask'],
      ['band-external-rotation', 'Band External Rotation', 0, null, 0, 1, null],
    ]);
    // The week's own pain and the skips stay as they were.
    assert.deepEqual(r.pain.reports.map((x) => x.value.date), ['2026-04-08']);
    assert.equal(r.skips.value.lines, 2);
  });
});
