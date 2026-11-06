// `engine due` and the quiet hours know the coach step: Due today carries
// the step after the Sunday check-in while it is due or late, or on its
// Sunday while the answers wait (answer first), with its command and its
// reason; the "Ask the coach" card at 18:00 is among the due cards as the
// plugin offers it; and the quiet hours list the 18:00 card when they hold
// it (a user's hours can start earlier), and "Did you train today?" at its
// setting's time. On the synthetic vault: plan week 8 ends phase 1 on Sun
// 26 Apr 2026.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { momentAt } from '../src/core/clock.ts';
import { coachToday, COACH_AT, dueToday, quietHolds, type DueInput } from '../src/core/nudges.ts';
import { run } from '../src/cli/cli.ts';
import { coachStepsOf } from '../src/report/index.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const SUNDAY = '2026-04-26';
const CHECKINS = 'v/3-Personal/Fitness/Coach/checkins.json';
const LETTER = 'v/3-Personal/Fitness/Coach/Letters/2026-04-26.md';
const SETTINGS = 'v/.obsidian/plugins/pahlavan/data.json';
const saved = (f: Record<string, string>) => void (f[CHECKINS] = JSON.stringify({ schemaVersion: 1, checkins: [{ date: SUNDAY, weekStart: '2026-04-20' }] }));
const files = (...edits: ((f: Record<string, string>) => void)[]) => {
  const f = fixtureFiles('v');
  for (const e of edits) e(f);
  return f;
};
const stepOn = (date: string, ...edits: ((f: Record<string, string>) => void)[]) => coachStepsOf(readVault(memoryIo(files(...edits), date), 'v', { asOf: date }), date, null).now?.value ?? null;
const due = (date: string, time: string, ...edits: ((f: Record<string, string>) => void)[]) => {
  const r = run(['due', '--vault', 'v', '--date', date, '--time', time], { ...memoryIo(files(...edits), date), clock: () => ({ minutes: 12 * 60, offsetMinutes: 0 }) });
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout) as Json;
};

describe('Due today: the coach step', () => {
  it('on the Sunday once the answers are saved: due, the command, the card at 18:00, the reason', () => {
    const c = coachToday(stepOn(SUNDAY, saved), SUNDAY, null)!;
    assert.deepEqual([c.state, c.title, c.command, c.at, c.answered], ['due', 'Phase review', '/fitness-coach review', COACH_AT, false]);
    assert.equal(c.line, 'Phase 1 ends today and your answers are saved: the coach reviews the phase and plans the next one.');
    assert.deepEqual([c.reason.rule, c.reason.title], ['coach.ask', 'Ask the coach']);
    assert.equal(c.reason.note, 'Your Sunday answers are saved and no letter is in yet: run /fitness-coach review in Claude Code, in your vault. The Ask the coach card comes at 18:00.');
  });

  it('on its Sunday before the save: answer first, with no card time yet; after the Sunday unsaved: nothing', () => {
    const c = coachToday(stepOn(SUNDAY), SUNDAY, null)!;
    assert.deepEqual([c.state, c.at, c.command], ['answer-first', null, '/fitness-coach review']);
    assert.match(c.reason.note!, /^Your answers for Sun 26 Apr are not saved yet: save them in Check-in, then run \/fitness-coach review in Claude Code\./);
    assert.equal(stepOn('2026-04-28')!.state, 'answer-first', 'the step still waits for the answers on Tuesday');
    assert.equal(coachToday(stepOn('2026-04-28'), '2026-04-28', null), null, 'but Due today lists it on its own Sunday only');
  });

  it('late on the days after, each day; done once a letter is in; an answered card is said so', () => {
    const late = coachToday(stepOn('2026-04-28', saved), '2026-04-28', null)!;
    assert.deepEqual([late.state, late.at], ['late', '18:00']);
    assert.match(late.reason.note!, /^No letter since your answers for Sun 26 Apr: .* each day until a letter is in, or the next Sunday comes\.$/);
    const nudges = { schemaVersion: 1 as const, days: { '2026-04-28': { coach: { how: 'skipped' as const, at: '2026-04-28T18:05:00.000Z' } } }, skipped: {} };
    assert.equal(coachToday(stepOn('2026-04-28', saved), '2026-04-28', nudges)!.answered, true);
    // Done: kept, with no card time, until the next Sunday's step takes over.
    const done = coachToday({ ...stepOn(SUNDAY, saved)!, state: 'done', letter: SUNDAY }, SUNDAY, null)!;
    assert.deepEqual([done.state, done.at, done.letter], ['done', null, SUNDAY]);
    assert.match(done.reason.note!, /^The coach’s letter of Sun 26 Apr is in: the step after your answers for Sun 26 Apr is done, and no card comes\./);
    assert.equal(coachToday(null, SUNDAY, null), null);
  });

  it('dueToday carries it beside the other items', () => {
    const input: DueInput = { now: momentAt(SUNDAY, '10:00', 0), tracking: null, nudges: null, body: null, habits: null, program: null, training: { logged: new Set(), plannedToday: false }, coach: stepOn(SUNDAY, saved) };
    assert.equal(dueToday(input).value.coach!.state, 'due');
    assert.equal(dueToday({ ...input, coach: null }).value.coach, null);
  });
});

describe('engine due: the coach step and its card', () => {
  it('Due today lists the step with its command and reason; the card is due from 18:00, last in the queue', () => {
    const morning = due(SUNDAY, '10:00', saved);
    assert.deepEqual([morning.today.value.coach.state, morning.today.value.coach.command, morning.today.value.coach.reason.rule], ['due', '/fitness-coach review', 'coach.ask']);
    assert.ok(!morning.due.value.cards.some((c: Json) => c.kind === 'coach'), 'no card before 18:00');
    const evening = due(SUNDAY, '18:05', saved);
    const cards = evening.due.value.cards.map((c: Json) => c.key);
    assert.equal(cards.at(-1), 'coach');
    const card = evening.due.value.cards.at(-1);
    assert.deepEqual([card.coach.title, card.coach.command, card.reason.rule], ['Phase review', '/fitness-coach review', 'coach.ask']);
    assert.equal(evening.sources.letter, null);
  });

  it('answer first on the Sunday morning; done once the letter is in (no card), and the sources name it', () => {
    assert.equal(due(SUNDAY, '09:00').today.value.coach.state, 'answer-first');
    const done = due('2026-04-27', '18:30', saved, (f) => (f[LETTER] = '---\ntype: phase-review\ndate: 2026-04-26\n---\n\n# Phase 1 review\n'));
    assert.deepEqual([done.today.value.coach.state, done.today.value.coach.letter, done.today.value.coach.at], ['done', '2026-04-26', null]);
    assert.ok(!done.due.value.cards.some((c: Json) => c.kind === 'coach'));
    assert.equal(done.sources.letter, '3-Personal/Fitness/Coach/Letters/2026-04-26.md');
  });

  it('a weekday with no step pending: nothing', () => {
    assert.equal(due('2026-04-10', '18:30').today.value.coach, null);
  });
});

describe('quiet hours: the 18:00 card', () => {
  const program = readVault(memoryIo(files(), SUNDAY), 'v', { asOf: SUNDAY }).data.program;

  it('held when the hours start before 18:00: in hours past midnight it never shows, and its time is fixed', () => {
    const held = quietHolds({ tracking: null, program }, { from: '17:00', to: '07:00' });
    // The 20:00 "Did you train today?" is held too (see below); Ask the coach comes last, as in the queue.
    assert.deepEqual(held.map((h) => [h.value.item, h.value.card, h.value.name, h.value.spans]), [
      [null, 'train', 'Did you train today?', [{ from: '20:00', to: '20:00', shows: null }]],
      [null, 'coach', 'Ask the coach', [{ from: '18:00', to: '18:00', shows: null }]],
    ]);
    const coach = held.at(-1)!;
    assert.equal(coach.reason.note, 'Pahlavan holds cards from 17:00 to 07:00: this 18:00 card never shows. Its time is fixed, so change quiet hours in Settings to leave 18:00 out of them.');
    assert.deepEqual(coach.reason.inputs, { item: null, card: 'coach', times: '18:00', quiet: { from: '17:00', to: '07:00' } });
  });

  it('daytime hours over 18:00: it waits until they end', () => {
    assert.deepEqual(quietHolds({ tracking: null, program }, { from: '12:00', to: '19:00' }).map((h) => h.value.spans), [[{ from: '18:00', to: '18:00', shows: '19:00' }]]);
  });

  it('not held by the default hours (22:30 to 07:00), and not listed without a plan', () => {
    assert.deepEqual(quietHolds({ tracking: null, program }, { from: '22:30', to: '07:00' }), []);
    assert.deepEqual(quietHolds({ tracking: null, program: null }, { from: '17:00', to: '07:00' }), []);
    // No plan-data.json: the log still dates the weeks, but they hold no sessions, so no coach step and no card.
    const noPlan = readVault(memoryIo(files((f) => delete f['v/3-Personal/Fitness/plan-data.json']), SUNDAY), 'v', { asOf: SUNDAY }).data.program;
    assert.deepEqual(quietHolds({ tracking: null, program: noPlan }, { from: '17:00', to: '07:00' }), []);
  });

  it('due and tracked list it with the user\'s own hours, after the morning check-in and the items', () => {
    const early = (f: Record<string, string>) => (f[SETTINGS] = JSON.stringify({ version: 2, reminders: { on: true, quiet: { on: true, from: '17:00', to: '06:00' } } }));
    const held = due('2026-04-10', '12:15', early).quiet.held;
    assert.deepEqual(held.at(-1).value, { item: null, card: 'coach', name: 'Ask the coach', spans: [{ from: '18:00', to: '18:00', shows: null }] });
    assert.ok(held.slice(0, -1).every((h: Json) => h.value.card !== 'coach'));
    const r = run(['tracked', '--vault', 'v', '--date', '2026-04-10'], { ...memoryIo(files(early), '2026-04-10'), clock: () => ({ minutes: 12 * 60, offsetMinutes: 0 }) });
    assert.ok((JSON.parse(r.stdout) as Json).quiet.held.some((h: Json) => h.value.card === 'coach'));
  });
});

describe('quiet hours: the "Did you train today?" card', () => {
  const program = readVault(memoryIo(files(), SUNDAY), 'v', { asOf: SUNDAY }).data.program;
  const train = (held: ReturnType<typeof quietHolds>) => held.filter((h) => h.value.card === 'train');

  it('held at its 20:00 default when the hours cover it: in hours past midnight it never shows, and its time is a setting', () => {
    const [h, ...rest] = train(quietHolds({ tracking: null, program }, { from: '19:00', to: '07:00' }));
    assert.equal(rest.length, 0);
    assert.deepEqual(h!.value, { item: null, card: 'train', name: 'Did you train today?', spans: [{ from: '20:00', to: '20:00', shows: null }] });
    assert.deepEqual([h!.reason.rule, h!.reason.inputs], ['nudges.quiet', { item: null, card: 'train', times: '20:00', quiet: { from: '19:00', to: '07:00' } }]);
    assert.equal(h!.reason.note, 'Pahlavan holds cards from 19:00 to 07:00: this 20:00 card never shows. Its time is a setting: move it before 19:00 under "Did you train today?" in Settings, or change quiet hours there.');
  });

  it('daytime hours over it: it waits until they end (the card asks until midnight)', () => {
    const [h] = train(quietHolds({ tracking: null, program }, { from: '19:30', to: '21:00' }));
    assert.deepEqual(h!.value.spans, [{ from: '20:00', to: '20:00', shows: '21:00' }]);
    assert.match(h!.reason.note!, /this 20:00 card waits until 21:00\. Its time is a setting: move it to 21:00 or later under "Did you train today\?" in Settings/);
  });

  it('at the setting\'s time and only while it is on; not by the default hours at 20:00, and not without a plan', () => {
    const late = { didYouTrain: { on: true, at: '22:45' } };
    assert.deepEqual(train(quietHolds({ tracking: null, program, settings: late }, { from: '22:30', to: '07:00' })).map((h) => h.value.spans), [[{ from: '22:45', to: '22:45', shows: null }]]);
    assert.deepEqual(train(quietHolds({ tracking: null, program, settings: { didYouTrain: { on: false, at: '22:45' } } }, { from: '22:30', to: '07:00' })), []);
    assert.deepEqual(train(quietHolds({ tracking: null, program }, { from: '22:30', to: '07:00' })), []);
    assert.deepEqual(quietHolds({ tracking: null, program: null, settings: late }, { from: '22:30', to: '07:00' }), []);
  });

  it('due and tracked read the setting from the plugin\'s data.json: listed before Ask the coach, the card at its time; off, not listed', () => {
    const own = (reminders: object) => (f: Record<string, string>) => (f[SETTINGS] = JSON.stringify({ version: 2, reminders: { on: true, quiet: { on: true, from: '17:00', to: '07:00' }, ...reminders } }));
    const d = due('2026-04-10', '12:15', own({ didYouTrainAt: '19:30' }));
    assert.deepEqual(d.quiet.held.slice(-2).map((h: Json) => h.value.card), ['train', 'coach']);
    const t = d.quiet.held.find((h: Json) => h.value.card === 'train');
    assert.deepEqual([t.value.spans, t.reason.inputs.times], [[{ from: '19:30', to: '19:30', shows: null }], '19:30']);
    assert.deepEqual([d.today.value.train.on, d.today.value.train.at], [true, '19:30'], 'the card in due at the setting\'s time too');
    const r = run(['tracked', '--vault', 'v', '--date', '2026-04-10'], { ...memoryIo(files(own({ didYouTrainAt: '19:30' })), '2026-04-10'), clock: () => ({ minutes: 12 * 60, offsetMinutes: 0 }) });
    assert.ok((JSON.parse(r.stdout) as Json).quiet.held.some((h: Json) => h.value.card === 'train' && h.value.spans[0].from === '19:30'));
    assert.ok(!due('2026-04-10', '12:15', own({ didYouTrain: false })).quiet.held.some((h: Json) => h.value.card === 'train'));
  });
});
