// What is due now: every reminder kind (stand-ups, the morning check-in and
// the tape, habit slots, "after the session", "Did you train?", amounts,
// desk breaks, sitting time, photos, tests), in order, each with its Why,
// skip and snooze; snoozes and answers from either Mac; quiet hours; the
// answers' writes; and the Due today summary. Made-up inputs over the
// fixture's tracking file, in UTC (offset 0).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { momentAt } from '../src/core/clock.ts';
import { answerCard, cardSettled, dueNow, dueToday, inQuiet, nextRepeat, quietHolds, snoozeUntil, type DueCard, type DueInput } from '../src/core/nudges.ts';
import { explain } from '../src/core/reason.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import type { NudgeState, Tracking } from '../src/core/schema.ts';
import { summarizeDay } from '../src/core/sitting.ts';
import { STAND_FRESH } from '../src/core/standup.ts';
import { habitsView } from '../src/core/tracking.ts';
import { fsIo, VAULT } from './helpers.ts';

const COACH = join(VAULT, '3-Personal/Fitness/Coach');
const TRACKING = JSON.parse(readFileSync(join(COACH, 'tracking.json'), 'utf8')) as Tracking;
const NUDGES = JSON.parse(readFileSync(join(COACH, 'nudges.json'), 'utf8')) as NudgeState;
const BODY = JSON.parse(readFileSync(join(VAULT, '3-Personal/Fitness/body-data.json'), 'utf8'));
const HABITS = habitsView(JSON.parse(readFileSync(join(VAULT, '5-System/Data/habits-data.json'), 'utf8')));
const program = readVault(fsIo, VAULT, { asOf: '2026-04-12' }).data.program;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const ms = (iso: string) => Date.parse(iso);

function input(date: string, time: string, over: Partial<DueInput> = {}): DueInput {
  const sittingToday = summarizeDay(date, [{ start: ms(`${date}T08:05:00Z`), end: ms(`${date}T10:50:00Z`) }], 'pahlavan');
  return {
    now: momentAt(date, time),
    tracking: TRACKING,
    nudges: NUDGES,
    body: BODY,
    photoFolders: [],
    habits: HABITS,
    program,
    training: { logged: new Set(['2026-04-06', '2026-04-08', '2026-04-10']), plannedToday: true },
    sitting: { today: sittingToday, current: null },
    ...over,
  };
}
const keys = (i: DueInput) => dueNow(i).value.cards.map((c) => c.key);

describe('due now, on the fixture\'s Friday', () => {
  it('at 12:15: the tape (overdue since Sunday, the morning is in) and the after-the-session shake', () => {
    const r = dueNow(input('2026-04-10', '12:15'));
    assert.deepEqual(r.value.cards.map((c) => c.key), ['tape', 'slot:after-log']);
    const [tape, shake] = r.value.cards;
    assert.deepEqual([tape!.kind, tape!.occurrence, tape!.skipPeriod, tape!.later], ['tape', '2026-03-29', { key: 'tape:2026-03-29', next: '2026-04-12' }, true]);
    assert.equal(tape!.reason.rule, 'plan.calendar.tape');
    assert.deepEqual([shake!.kind, shake!.items], ['habits', ['shake']]);
    assert.match(shake!.reason.note!, /share one card.*Protein shake, added by you/);
  });

  it('water every 2 hours from the last glass; the desk break 90 minutes after the last one', () => {
    assert.deepEqual(keys(input('2026-04-10', '13:00')), ['tape', 'slot:after-log']);
    const r = dueNow(input('2026-04-10', '13:05'));
    assert.deepEqual(r.value.cards.map((c) => c.key), ['tape', 'slot:after-log', 'amount:water', 'desk:desk-breaks']);
    const water = r.value.cards[2]!;
    assert.deepEqual([water.at, water.late, water.skip, water.snooze], [13 * 60 + 2, 3, 'no-more-today', { minutes: [30, 60, 120], default: 60 }]);
    assert.match(water.reason.note!, /Every 2 hours from 09:00 to 21:00 until the day's 2500 mL.*suggested by your coach: from your eating plan.*1250 of 2500 mL/);
    const desk = r.value.cards[3]!;
    assert.deepEqual([desk.at, desk.break], [13 * 60 + 1, { n: 3, of: 4, next: '14:31' }]);
    assert.equal(desk.reason.rule, 'plan.desk-breaks');
  });

  it('the evening slots share a card each; paused items never come', () => {
    const r = dueNow(input('2026-04-10', '21:35'));
    const slots = r.value.cards.filter((c) => c.kind === 'habits');
    // In time order; the after-the-session card is due from now (no log time given).
    assert.deepEqual(slots.map((c) => [c.key, c.items]), [['slot:20:00', ['protein']], ['slot:21:30', ['magnesium', 'flossing']], ['slot:after-log', ['shake']]]);
    assert.ok(!r.value.cards.some((c) => c.items.includes('fish-oil')));
    assert.ok(!r.value.cards.some((c) => c.kind === 'train'), 'a session is logged today');
  });

  it('a slot answered on either Mac, or snoozed until later, stays quiet', () => {
    const n = clone(NUDGES);
    n.days['2026-04-10']!['slot:after-log'] = { how: 'done', at: '2026-04-10T12:00:00.000Z', by: 'Home Mac' };
    n.days['2026-04-10']!['tape'] = { snoozedUntil: '2026-04-10T12:45:00.000Z' };
    assert.deepEqual(keys(input('2026-04-10', '12:15', { nudges: n })), []);
    assert.deepEqual(keys(input('2026-04-10', '12:46', { nudges: n })), ['tape']);
  });

  it('a stand-up that is due comes first; it can\'t be closed or skipped, and snoozes once', () => {
    const due = { ...STAND_FRESH, phase: 'due' as const, satMs: 30 * 60000 };
    const r = dueNow(input('2026-04-10', '12:15', { stand: { 'stand-ups': due } }));
    const c = r.value.cards[0]!;
    assert.deepEqual([c.key, c.closable, c.skip, c.snooze], ['standup:stand-ups', false, null, { minutes: [5, 10], default: 10 }]);
    assert.match(c.reason.note!, /After 30 minutes of active sitting, stand for 20. It can't be closed/);
    assert.equal(dueNow(input('2026-04-10', '12:15', { stand: { 'stand-ups': { ...due, snoozeUsed: true } } })).value.cards[0]!.snooze, null);
    assert.ok(!keys(input('2026-04-10', '18:00', { stand: { 'stand-ups': due } })).includes('standup:stand-ups'), 'outside its hours');
    assert.ok(!keys(input('2026-04-11', '12:00', { stand: { 'stand-ups': due } })).includes('standup:stand-ups'), 'not on a Saturday');
  });

  it('sitting: a card at 5 h 30 of sitting, and one per stretch that reaches 45 minutes', () => {
    const long = summarizeDay('2026-04-10', [{ start: ms('2026-04-10T07:00:00Z'), end: ms('2026-04-10T12:40:00Z') }], 'pahlavan');
    const r = dueNow(input('2026-04-10', '12:45', { sitting: { today: long, current: { start: ms('2026-04-10T12:00:00Z'), minutes: 45 } } }));
    const sit = r.value.cards.filter((c) => c.kind === 'sitting');
    assert.deepEqual(sit.map((c) => c.key), ['sitting:sitting', 'sitting:sitting:stretch']);
    assert.match(sit[0]!.reason.note!, /5 h 40 of your 6 h limit today/);
    assert.equal(sit[1]!.stretch, '2026-04-10T12:00:00.000Z');
    const n = clone(NUDGES);
    n.days['2026-04-10']!['sitting:sitting:stretch'] = { how: 'done', for: '2026-04-10T12:00:00.000Z' };
    const again = dueNow(input('2026-04-10', '12:50', { nudges: n, sitting: { today: long, current: { start: ms('2026-04-10T12:00:00Z'), minutes: 50 } } }));
    assert.ok(!again.value.cards.some((c) => c.key === 'sitting:sitting:stretch'), 'answered for this stretch');
    const next = dueNow(input('2026-04-10', '14:00', { nudges: n, sitting: { today: long, current: { start: ms('2026-04-10T13:10:00Z'), minutes: 50 } } }));
    assert.ok(next.value.cards.some((c) => c.key === 'sitting:sitting:stretch'), 'a new stretch asks again');
  });

  it('quiet hours hold everything, across midnight too', () => {
    const r = dueNow(input('2026-04-10', '22:45', { settings: { quiet: { from: '22:30', to: '07:00' } } }));
    assert.deepEqual(r.value, { cards: [], quiet: true });
    assert.equal(r.reason.rule, 'nudges.quiet');
    assert.equal(inQuiet({ from: '22:30', to: '07:00' }, 6 * 60), true);
    assert.equal(inQuiet({ from: '12:00', to: '13:00' }, 13 * 60), false);
  });
});

describe('quiet hours: the reminders they hold', () => {
  const QUIET = { from: '22:30', to: '07:00' };
  // Made-up times on the fixture's items: a late tick, an early supplement, water and stand-ups into the night.
  const late = (): Tracking => {
    const t = clone(TRACKING);
    const item = (id: string) => t.items.find((x) => x.id === id)!;
    item('flossing').reminder = { at: '23:30' };
    item('creatine').reminder = { at: '06:30' };
    item('water').reminder = { every: 120, from: '06:00', to: '23:00' };
    item('stand-ups').standup!.hours = ['09:00', '23:00'];
    t.morning = { on: true, at: '06:30' };
    return t;
  };

  it('a card due after they start never shows; one due before they end waits; each with its reason', () => {
    const held = quietHolds({ tracking: late(), program }, QUIET);
    assert.deepEqual(held.map((h) => [h.value.item, h.value.spans]), [
      [null, [{ from: '06:30', to: '06:30', shows: '07:00' }]],
      ['creatine', [{ from: '06:30', to: '06:30', shows: '07:00' }]],
      ['flossing', [{ from: '23:30', to: '23:30', shows: null }]],
      ['water', [{ from: '06:00', to: '06:59', shows: '07:00' }, { from: '22:30', to: '23:00', shows: null }]],
      ['stand-ups', [{ from: '22:30', to: '23:00', shows: null }]],
    ]);
    const flossing = held[2]!;
    assert.deepEqual([flossing.reason.rule, flossing.reason.title, flossing.reason.inputs], ['nudges.quiet', 'Quiet hours', { item: 'flossing', times: '23:30', quiet: QUIET }]);
    assert.equal(flossing.reason.note, 'Pahlavan holds cards from 22:30 to 07:00: this 23:30 card never shows; move it before 22:30, or change quiet hours in Settings.');
    assert.equal(held[1]!.reason.note, 'Pahlavan holds cards from 22:30 to 07:00: this 06:30 card waits until 07:00; move it to 07:00 or later, or change quiet hours in Settings.');
    assert.equal(held[3]!.reason.note, 'Pahlavan holds cards from 22:30 to 07:00: its cards from 06:00 to 06:59 wait until 07:00; its cards from 22:30 to 23:00 never show; start its hours at 07:00 or later and end its hours by 22:30, or change quiet hours in Settings.');
  });

  it('agrees with dueNow: the 23:30 card is held that night and is not due the next morning; the 06:30 one shows at 07:00', () => {
    const t = late();
    assert.deepEqual(dueNow(input('2026-04-10', '23:30', { tracking: t, settings: { quiet: QUIET } })).value, { cards: [], quiet: true });
    assert.deepEqual(keys(input('2026-04-11', '06:55', { tracking: t, settings: { quiet: QUIET } })), []);
    const morning = keys(input('2026-04-11', '07:05', { tracking: t, settings: { quiet: QUIET } }));
    assert.ok(morning.includes('slot:06:30'), morning.join());
    assert.ok(!morning.includes('slot:23:30'), morning.join());
  });

  it('the morning card stops at 21:00, so hours that end later hold it for good; desk breaks by their hours; sitting and "after the session" never', () => {
    const t = late();
    t.morning = { on: true, at: '20:30' };
    const held = quietHolds({ tracking: t, program }, { from: '20:00', to: '21:30' });
    // The last row is "Did you train today?" at its 20:00 default (it asks until midnight, so it waits).
    assert.deepEqual(held.map((h) => [h.value.item, h.value.spans]), [[null, [{ from: '20:30', to: '20:30', shows: null }]], ['protein', [{ from: '20:00', to: '20:00', shows: '21:30' }]], ['water', [{ from: '20:00', to: '21:29', shows: '21:30' }]], ['stand-ups', [{ from: '20:00', to: '21:29', shows: '21:30' }]], [null, [{ from: '20:00', to: '20:00', shows: '21:30' }]]]);
    assert.equal(held.at(-1)!.value.card, 'train');
    assert.match(held[0]!.reason.note!, /this 20:30 card never shows; move it before 20:00/);
    // The plan's breaks run 10:00 to 15:00, 5 minutes each: the last can start at 14:55.
    assert.deepEqual(quietHolds({ tracking: t, program }, { from: '14:00', to: '16:00' }).find((h) => h.value.item === 'desk-breaks')!.value.spans, [{ from: '14:00', to: '14:55', shows: '16:00' }]);
    const allDay = quietHolds({ tracking: t, program }, { from: '00:00', to: '23:59' });
    for (const id of ['shake', 'sitting']) assert.ok(!allDay.some((h) => h.value.item === id), id);
  });

  it('nothing is held with quiet hours off, or on the fixture\'s own times', () => {
    assert.deepEqual(quietHolds({ tracking: late(), program }, null), []);
    assert.deepEqual(quietHolds({ tracking: TRACKING, program }, QUIET), []);
  });
});

describe('due now: the morning, photos, tests and "Did you train?"', () => {
  const dayBody = (date: string, extra: object = {}) => ({ ...BODY, days: { ...BODY.days, [date]: { weight: 83, ...extra } } });

  it('the morning card from its time; the tape joins it on a tape day, with "Skip this tape day"', () => {
    const date = '2026-04-12'; // Sunday, a tape day
    const body = { ...BODY, days: Object.fromEntries(Object.entries(BODY.days).filter(([d]) => d < date)) };
    assert.deepEqual(keys(input(date, '07:29', { body })), []);
    const r = dueNow(input(date, '07:31', { body }));
    const m = r.value.cards[0]!;
    assert.deepEqual([m.key, m.tape, m.occurrence, m.skipPeriod, m.snooze!.tomorrow], ['morning', true, '2026-04-12', { key: 'tape:2026-04-12', next: '2026-04-26' }, true]);
    assert.match(m.reason.note!, /Daily at 07:30.*Tape day: every second Sunday/);
    assert.deepEqual(keys(input(date, '07:31', { body: dayBody(date, { checkedAt: '2026-04-12T07:20:00Z' }) })), ['tape']);
    assert.ok(!keys(input(date, '21:00', { body })).includes('morning'), 'the morning card stops at 21:00');
  });

  it('photo day and the tests once the morning is in; "Not today" and skipping the occurrence', () => {
    const date = '2026-04-26'; // the deload week's Sunday: tape and photos
    const r = dueNow(input(date, '10:00', { body: dayBody(date, { checkedAt: '2026-04-26T07:40:00Z' }), training: { logged: new Set([date]), plannedToday: true } }));
    const p = r.value.cards.find((c) => c.kind === 'photos')!;
    assert.deepEqual([p.occurrence, p.skipPeriod, p.later], ['2026-04-26', { key: 'photos:2026-04-26', next: '2026-05-24' }, true]);
    const n = clone(NUDGES);
    n.days[date] = { photos: { how: 'later', at: '2026-04-26T10:01:00.000Z' } };
    assert.ok(!keys(input(date, '11:00', { nudges: n, body: dayBody(date, { checkedAt: 'x' }) })).includes('photos'));
    n.skipped!['photos:2026-04-26'] = '2026-04-26T10:01:00.000Z';
    delete n.days[date];
    assert.ok(!keys(input('2026-04-27', '10:00', { nudges: n, body: dayBody('2026-04-27', { checkedAt: 'x' }) })).includes('photos'));
    const tests = dueNow(input('2026-04-25', '10:00', { body: dayBody('2026-04-25', { checkedAt: 'x' }) })).value.cards.find((c) => c.kind === 'tests')!;
    assert.deepEqual([tests.occurrence, tests.skipPeriod!.next], ['2026-04-25', '2026-06-20']);
  });

  it('"Did you train today?" at its time when the plan had a session and nothing is logged, ticked or marked rest', () => {
    const t = { logged: new Set(['2026-04-08']), plannedToday: true };
    const n = clone(NUDGES);
    delete n.days['2026-04-09'];
    const r = dueNow(input('2026-04-09', '20:01', { training: t, nudges: n }));
    const c = r.value.cards.find((x) => x.kind === 'train')!;
    assert.deepEqual([c.at, c.skip, c.snooze], [1200, null, { minutes: [30, 60], default: 30, tomorrow: true }]);
    assert.match(c.reason.note!, /Nothing logged by 20:00 on a day the plan had a session/);
    for (const over of [{ workoutTicked: true }, { restMarked: true }, { plannedToday: false }]) assert.ok(!keys(input('2026-04-09', '20:01', { training: { ...t, ...over }, nudges: n })).includes('train'));
    assert.ok(!keys(input('2026-04-09', '20:01', { training: t })).includes('train'), 'answered on 9 Apr in the fixture');
    assert.ok(!keys(input('2026-04-09', '20:01', { training: t, nudges: n, settings: { didYouTrain: { on: false, at: '20:00' } } })).includes('train'));
  });

  it('nothing tracked: only "Did you train?" can come', () => {
    const r = dueNow(input('2026-04-09', '20:30', { tracking: null, nudges: null, training: { logged: new Set(), plannedToday: true } }));
    assert.deepEqual(r.value.cards.map((c) => c.key), ['train']);
  });
});

describe('answers and snoozes', () => {
  const card = { key: 'slot:09:00', kind: 'habits' as const, date: '2026-04-10' };
  const now = ms('2026-04-10T09:10:00Z');

  it('Done, Skip today and Not today write the answer; a repeating card\'s Done only moves its clock', () => {
    assert.deepEqual(answerCard(card, 'done', now, { by: 'Work Mac' }), [{ date: '2026-04-10', key: 'slot:09:00', set: { how: 'done', at: '2026-04-10T09:10:00.000Z', by: 'Work Mac' } }]);
    assert.deepEqual(answerCard(card, 'skip', now)[0], { date: '2026-04-10', key: 'slot:09:00', set: { how: 'skipped', at: '2026-04-10T09:10:00.000Z' } });
    assert.deepEqual(answerCard({ ...card, key: 'desk:desk-breaks', kind: 'desk' }, 'done', now), [{ date: '2026-04-10', key: 'desk:desk-breaks', set: { lastAt: '2026-04-10T09:10:00.000Z' } }]);
    assert.deepEqual(answerCard({ ...card, key: 'train', kind: 'train' }, 'rest', now)[0]!, { date: '2026-04-10', key: 'train', set: { how: 'rest', at: '2026-04-10T09:10:00.000Z' } });
  });

  it('closing is a snooze; the stand-up\'s snooze is the count\'s own; a periodic skip names the occurrence', () => {
    assert.deepEqual(answerCard(card, 'close', now), [{ date: '2026-04-10', key: 'slot:09:00', set: { snoozedUntil: '2026-04-10T09:40:00.000Z' } }]);
    assert.deepEqual(answerCard({ ...card, key: 'standup:stand-ups', kind: 'standup' }, 'snooze', now), []);
    const tape = { key: 'tape', kind: 'tape' as const, date: '2026-04-10', skipPeriod: { key: 'tape:2026-03-29', next: '2026-04-12' } };
    assert.deepEqual(answerCard(tape, 'skip-period', now), [{ skip: 'tape:2026-03-29', at: '2026-04-10T09:10:00.000Z' }, { date: '2026-04-10', key: 'tape', set: { how: 'skipped', at: '2026-04-10T09:10:00.000Z' } }]);
    const stretch = { key: 'sitting:sitting:stretch', kind: 'sitting' as const, date: '2026-04-10', stretch: '2026-04-10T08:00:00.000Z' };
    assert.deepEqual(answerCard(stretch, 'done', now), [{ date: '2026-04-10', key: 'sitting:sitting:stretch', set: { how: 'done', at: '2026-04-10T09:10:00.000Z', for: '2026-04-10T08:00:00.000Z' } }]);
  });

  it('snooze choices: minutes, this evening, tomorrow morning at the check-in\'s time', () => {
    const m = momentAt('2026-04-10', '12:15');
    assert.equal(snoozeUntil(30, m), m.ms + 30 * 60000);
    assert.equal(snoozeUntil('evening', m), ms('2026-04-10T18:00:00Z'));
    assert.equal(snoozeUntil('tomorrow', m, { morning: '07:30' }), ms('2026-04-11T07:30:00Z'));
  });

  it('a repeating card\'s next time: the start, then N minutes after the last; none past the end', () => {
    const m = momentAt('2026-04-10', '12:15');
    assert.equal(nextRepeat(m, '09:00', '21:00', 120, [null]), 540);
    assert.equal(nextRepeat(m, '09:00', '21:00', 120, [ms('2026-04-10T11:02:00Z'), ms('2026-04-10T10:00:00Z')]), 782);
    assert.equal(nextRepeat(m, '09:00', '21:00', 120, [ms('2026-04-09T23:00:00Z')]), 540, 'yesterday\'s does not count');
    assert.equal(nextRepeat(m, '09:00', '12:00', 120, [ms('2026-04-10T11:02:00Z')]), null);
  });
});

describe('an open card the data answers', () => {
  const card = (key: string, kind: DueCard['kind'], date: string, items: string[] = []): DueCard => ({ key, kind, date, items, at: 0, late: 0, closable: true, skip: 'today', snooze: null, reason: explain(true, 'x', {}).reason });

  it('"Did you train?": a session logged for its day, the Workout habit, a rest or missed mark, the Sunday check-in', () => {
    const c = card('train', 'train', '2026-04-09');
    const t = (over: Partial<DueInput['training']>) => input('2026-04-09', '20:30', { training: { logged: new Set(['2026-04-08']), plannedToday: true, ...over } });
    assert.equal(cardSettled(c, t({})), null);
    assert.equal(cardSettled(c, t({ logged: new Set(['2026-04-09']) })), 'Thu 9 Apr has a session logged');
    assert.match(cardSettled(c, t({ workoutTicked: true }))!, /Workout habit/);
    assert.equal(cardSettled(c, t({ restMarked: true })), 'Thu 9 Apr is marked rest');
    assert.match(cardSettled(c, t({ confirmedTrained: true }))!, /Sunday check-in/);
  });

  it('water at its target, the morning in, the letter in; never by the clock, never the Mac’s own counts', () => {
    const water = card('amount:water', 'amount', '2026-04-10', ['water']);
    assert.equal(cardSettled(water, input('2026-04-10', '22:00')), null, 'past its hours but under target: it stays');
    const tracking = clone(TRACKING);
    tracking.days['2026-04-10']!['water']!.amount = 2500;
    assert.equal(cardSettled(water, input('2026-04-10', '15:00', { tracking })), 'Water has reached its target');
    const morning = card('morning', 'morning', '2026-04-13');
    assert.equal(cardSettled(morning, input('2026-04-13', '08:00', { body: { days: {} } })), null);
    assert.equal(cardSettled(morning, input('2026-04-13', '08:00', { body: { days: { '2026-04-13': { checkedAt: '2026-04-13T08:10:00.000Z' } } } })), 'the morning check-in is in');
    const coach = card('coach', 'coach', '2026-04-12');
    const step = (state: 'due' | 'done') => ({ state } as unknown as NonNullable<DueInput['coach']>);
    assert.equal(cardSettled(coach, input('2026-04-12', '18:30', { coach: step('due') })), null);
    assert.equal(cardSettled(coach, input('2026-04-12', '18:30', { coach: step('done') })), 'the coach’s letter is in');
    assert.equal(cardSettled(card('standup:stand-ups', 'standup', '2026-04-10', ['stand-ups']), input('2026-04-10', '12:15')), null);
  });
});

describe('Due today', () => {
  it('at 12:15 on the Friday: what is done, what comes next, the body record', () => {
    const t = dueToday(input('2026-04-10', '12:15', { stand: { 'stand-ups': { ...STAND_FRESH, satMs: 12 * 60000 } } })).value;
    assert.deepEqual(t.morning, { on: true, at: '07:30', done: true, checkedAt: '2026-04-10T07:10:00.000Z' });
    assert.deepEqual(t.habits.slots.map((s) => [s.key, s.items.map((i) => [i.id, i.done, i.later])]), [
      ['09:00', [['creatine', true, false], ['multivitamin', false, false]]],
      ['after-log', [['shake', false, false]]],
      ['20:00', [['protein', false, true]]],
      ['21:30', [['magnesium', false, true], ['flossing', false, true]]],
    ]);
    assert.deepEqual([t.habits.done, t.habits.total], [1, 6]);
    assert.deepEqual(t.amounts, [{ id: 'water', name: 'Water', value: 1250, target: 2500, unit: 'mL', met: false, next: '13:02' }]);
    assert.deepEqual(t.standups, [{ id: 'stand-ups', name: 'Stand-ups', minutes: 80, desk: 0, target: 120, count: 4, sitting: 12, sitMinutes: 30, phase: 'sitting' }]);
    assert.deepEqual(t.sitting, [{ id: 'sitting', name: 'Sitting time', minutes: 165, longest: 165, limit: 360, stretchMax: 45, overLimit: false, overStretch: true }]);
    assert.deepEqual(t.desk, [{ id: 'desk-breaks', name: 'Desk breaks', done: 2, total: 4, times: ['10:00', '11:30', '13:00', '14:30'], next: '13:01' }]);
    assert.deepEqual(t.body.map((b) => [b.part, b.due, b.nextDate, b.inDays]), [['tape', true, '2026-03-29', -12], ['tests', false, '2026-04-25', 15], ['photos', false, '2026-04-26', 16]]);
    assert.equal(t.train.needed, false);
  });

  it('stand-ups: the minutes stood at the desk ("Standing now"), part of the day\'s minutes', () => {
    const tracking = JSON.parse(JSON.stringify(TRACKING)) as Tracking;
    tracking.days['2026-04-10']!['stand-ups']!.deskMinutes = 40;
    const s = dueToday(input('2026-04-10', '12:15', { tracking })).value.standups[0]!;
    assert.deepEqual([s.minutes, s.desk, s.count, s.target], [80, 40, 4, 120]);
  });
});
