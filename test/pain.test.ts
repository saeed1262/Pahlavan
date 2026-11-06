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
import { PAIN, painRule, painText, type PainReport } from '../src/core/pain.ts';
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
const rep = (date: string, area: string, severity: number, extra: Partial<PainReport> = {}): PainReport => ({ date, area, severity, exercise: null, source: 'log', session: 'Full Body A', ...extra });

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
    assert.deepEqual(buildReview(read('2026-04-12').data, '2026-04-12').pain, { from: '2026-04-06', to: '2026-04-12', reports: [], worst: null });
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
