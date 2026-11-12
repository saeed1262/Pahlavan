// When to talk to the coach: each plan Sunday's coach step (the week's
// letter, a light week's mesocycle review, a phase end's phase review, the
// plan's last week also planning the next cycle), where today stands on the
// latest (answer first, due, late, done; a letter dated the Saturday before
// is not that Sunday's), the next steps, the wiring into Today, Check-in and
// the Plan, and the "Ask the coach" card's rule. On the synthetic vault
// (plan weeks from Mon 2 Mar 2026, light weeks 4, 8, ..., phases ending at
// weeks 8, 16 and 24).

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { momentAt } from '../src/core/clock.ts';
import { COACH_COMMANDS, coachSteps, NEXT_STEPS, planSteps, type CoachInput, type CoachNow } from '../src/core/coach-steps.ts';
import { answerCard, COACH_AT, dueNow, type DueInput } from '../src/core/nudges.ts';
import { validateNudges } from '../src/core/validate.ts';
import { buildCheckin, buildPlan, buildToday, coachStepsOf, sundayStatus } from '../src/report/index.ts';
import { fixtureFiles, memoryIo, ROOT } from './helpers.ts';

const CHECKINS = 'v/3-Personal/Fitness/Coach/checkins.json';
const LETTERS = '3-Personal/Fitness/Coach/Letters';
const read = (date: string, edit: (f: Record<string, string>) => void = () => {}) => {
  const files = fixtureFiles('v');
  edit(files);
  return readVault(memoryIo(files, date), 'v', { asOf: date });
};
/** Sunday check-ins saved for these Sundays. */
const saved = (...sundays: string[]) => (f: Record<string, string>) => void (f[CHECKINS] = JSON.stringify({ schemaVersion: 1, checkins: sundays.map((d) => ({ date: d, weekStart: new Date(Date.parse(`${d}T00:00:00Z`) - 6 * 864e5).toISOString().slice(0, 10) })) }));
const letter = (date: string, type = 'coach-letter') => ({ path: `${LETTERS}/${date}.md`, text: `---\ntype: ${type}\ndate: ${date}\n---\n\n# Letter\n\n## What happened\nA week.\n` });

const PROGRAM = read('2026-04-12').data.program;
const at = (date: string, sunday: CoachInput['sunday'], l: CoachInput['letter'] = null) => coachSteps({ program: PROGRAM, planWeeks: 24, date, sunday, letter: l });

describe('each plan Sunday’s coach step', () => {
  const steps = planSteps(PROGRAM, 24).map((s) => s.value);

  it('the week’s letter every Sunday, the mesocycle review on a light week’s, the phase review at a phase’s end', () => {
    assert.equal(steps.length, 24);
    const by = (kind: string) => steps.filter((s) => s.kind === kind).map((s) => s.week);
    assert.deepEqual(by('mesocycle-review'), [4, 12, 20]);
    assert.deepEqual(by('phase-review'), [8, 16, 24]);
    assert.equal(by('letter').length, 18);
    assert.deepEqual(steps.slice(0, 4).map((s) => [s.date, s.title]), [['2026-03-08', 'The week’s letter'], ['2026-03-15', 'The week’s letter'], ['2026-03-22', 'The week’s letter'], ['2026-03-29', 'Mesocycle review']]);
  });

  it('each step’s command comes from the one constant: the letter after the check-in, a review otherwise', () => {
    for (const s of steps) assert.equal(s.command, s.kind === 'letter' ? COACH_COMMANDS.checkin : COACH_COMMANDS.review);
    assert.deepEqual(COACH_COMMANDS, { ask: '/fitness-coach', intake: '/fitness-coach intake', plan: '/fitness-coach plan', planWhy: '/fitness-coach plan why', checkin: '/fitness-coach checkin', review: '/fitness-coach review' });
  });

  it('the mesocycle review writes next month’s plan; the plan’s last week also plans the next cycle', () => {
    const w = (n: number) => steps.find((s) => s.week === n)!;
    assert.equal(w(4).does, 'reviews the month and writes next month’s plan');
    assert.deepEqual([w(8).does, w(8).nextCycle], ['reviews the phase and plans the next one', false]);
    assert.deepEqual([w(24).date, w(24).does, w(24).nextCycle], ['2026-08-16', 'reviews the phase and plans the next cycle', true]);
    // Without the plan's length, its last week is the macrocycle's.
    assert.equal(planSteps(PROGRAM).at(-1)!.value.nextCycle, true);
    assert.equal(planSteps(PROGRAM, 16).find((s) => s.value.week === 16)!.value.nextCycle, true, 'a 16-week plan ends at week 16');
  });

  it('every step explains itself, with the command, in plain words', () => {
    for (const s of planSteps(PROGRAM, 24)) {
      assert.equal(s.reason.rule, 'coach.step');
      assert.equal(s.reason.title, 'Ask the coach');
      assert.ok(s.reason.note!.includes(s.value.command), s.reason.note);
      assert.doesNotMatch(s.reason.note!, /—|deload/i);
    }
    assert.match(planSteps(PROGRAM, 24)[3]!.reason.note!, /^Plan week 4 is a light week: its Sunday closes the month/);
  });
});

describe('where today stands', () => {
  const now = (r: ReturnType<typeof at>) => r.now!.value;

  it('answer first: that Sunday’s answers not saved yet, on the Sunday and after it', () => {
    const sun = now(at('2026-04-12', { date: '2026-04-12', status: 'open' }));
    assert.deepEqual([sun.state, sun.kind, sun.command], ['answer-first', 'letter', '/fitness-coach checkin']);
    assert.equal(sun.line, 'Save your answers, then ask the coach: it writes the week’s letter.');
    const tue = now(at('2026-04-14', { date: '2026-04-12', status: 'late' }));
    assert.equal(tue.state, 'answer-first');
    assert.equal(tue.line, 'Save your answers for Sun 12 Apr, then ask the coach: it writes the week’s letter.');
  });

  it('due: saved, on the Sunday, no letter dated on or after it', () => {
    const r = at('2026-04-12', { date: '2026-04-12', status: 'edit' });
    assert.deepEqual([now(r).state, now(r).line], ['due', 'Your answers are saved: the coach writes the week’s letter.']);
    assert.equal(r.now!.reason.rule, 'coach.now');
    assert.match(r.now!.reason.note!, /\/fitness-coach checkin/);
  });

  it('late: after the Sunday, still no letter, until the next Sunday’s step takes over', () => {
    for (const d of ['2026-04-13', '2026-04-18']) {
      const n = now(at(d, { date: '2026-04-12', status: 'saved' }));
      assert.equal(n.state, 'late', d);
      assert.equal(n.line, 'Your answers for Sun 12 Apr are saved, but no letter is in yet: the coach writes the week’s letter.');
    }
    // The next Sunday: its own step, not saved yet.
    assert.deepEqual([now(at('2026-04-19', { date: '2026-04-19', status: 'open' })).state, now(at('2026-04-19', { date: '2026-04-19', status: 'open' })).date], ['answer-first', '2026-04-19']);
  });

  it('done: a letter dated on or after that Sunday; one dated the Saturday before is last week’s', () => {
    const sun = { date: '2026-04-12', status: 'edit' as const };
    assert.equal(now(at('2026-04-12', sun, { date: '2026-04-11', kind: 'coach-letter' })).state, 'due', 'Saturday’s letter is not this Sunday’s');
    const done = now(at('2026-04-12', sun, { date: '2026-04-12', kind: 'coach-letter' }));
    assert.deepEqual([done.state, done.letter, done.line], ['done', '2026-04-12', 'The coach’s letter of Sun 12 Apr is in.']);
    assert.equal(now(at('2026-04-15', { date: '2026-04-12', status: 'saved' }, { date: '2026-04-13', kind: 'coach-letter' })).state, 'done', 'a letter the day after counts');
    // A letter done in Claude Code with the questions there (nothing saved in Pahlavan) is done too.
    assert.equal(now(at('2026-04-12', { date: '2026-04-12', status: 'open' }, { date: '2026-04-12', kind: 'coach-letter' })).state, 'done');
  });

  it('a light week’s Sunday: the mesocycle review, /fitness-coach review', () => {
    const n = now(at('2026-03-29', { date: '2026-03-29', status: 'edit' }));
    assert.deepEqual([n.kind, n.title, n.command, n.week], ['mesocycle-review', 'Mesocycle review', '/fitness-coach review', 4]);
    assert.equal(n.line, 'The light week ends today and your answers are saved: the coach reviews the month and writes next month’s plan.');
  });

  it('a phase end: the phase review in its place; at the plan’s last week it plans the next cycle', () => {
    const p = now(at('2026-04-26', { date: '2026-04-26', status: 'edit' }));
    assert.deepEqual([p.kind, p.title, p.command, p.week, p.phase], ['phase-review', 'Phase review', '/fitness-coach review', 8, 1]);
    assert.equal(p.line, 'Phase 1 ends today and your answers are saved: the coach reviews the phase and plans the next one.');
    const last = now(at('2026-08-16', { date: '2026-08-16', status: 'edit' }));
    assert.deepEqual([last.kind, last.week, last.nextCycle], ['phase-review', 24, true]);
    assert.equal(last.line, 'The plan ends today and your answers are saved: the coach reviews the phase and plans the next cycle.');
    assert.equal(now(at('2026-08-18', { date: '2026-08-16', status: 'saved' })).line, 'Your answers for Sun 16 Aug are saved, but no letter is in yet: the coach reviews the phase and plans the next cycle.');
  });

  it('the next steps, a Sunday each, with their dates', () => {
    const r = at('2026-04-15', { date: '2026-04-12', status: 'saved' });
    assert.equal(r.next.length, NEXT_STEPS);
    assert.deepEqual(r.next.map((s) => [s.value.date, s.value.kind]), [['2026-04-19', 'letter'], ['2026-04-26', 'phase-review'], ['2026-05-03', 'letter']]);
    assert.ok(r.next.every((s) => s.reason.rule === 'coach.step'));
  });

  it('a Sunday outside the plan’s weeks is the week’s letter; with no check-in to ask there is no step now', () => {
    const out = now(at('2026-08-23', { date: '2026-08-23', status: 'edit' }));
    assert.deepEqual([out.kind, out.week, out.command], ['letter', null, '/fitness-coach checkin']);
    const none = at('2026-04-15', null);
    assert.equal(none.now, null);
    assert.deepEqual(none.next.map((s) => s.value.date), ['2026-04-19', '2026-04-26', '2026-05-03'], 'the next ones still have their dates');
  });
});

describe('the coach steps from the files', () => {
  it('Check-in’s status and the newest letter: answer first, due, done', () => {
    assert.equal(coachStepsOf(read('2026-04-12'), '2026-04-12', null).now!.value.state, 'answer-first');
    const r = read('2026-04-12', saved('2026-04-12'));
    assert.deepEqual(sundayStatus(r, '2026-04-12')?.status, 'edit');
    assert.equal(coachStepsOf(r, '2026-04-12', null).now!.value.state, 'due');
    assert.equal(coachStepsOf(r, '2026-04-12', letter('2026-04-05')).now!.value.state, 'due', 'last week’s letter');
    assert.equal(coachStepsOf(r, '2026-04-12', letter('2026-04-12')).now!.value.state, 'done');
    assert.equal(coachStepsOf(read('2026-04-14', saved('2026-04-12')), '2026-04-14', null).now!.value.state, 'late');
  });

  it('the letter’s date from its frontmatter, else its file name; one from before the cycle start is not this cycle’s', () => {
    const r = read('2026-04-12', saved('2026-04-12'));
    assert.equal(coachStepsOf(r, '2026-04-12', { path: `${LETTERS}/2026-04-12.md`, text: '# A letter without frontmatter\n' }).now!.value.state, 'done');
    const old = coachStepsOf(r, '2026-04-12', letter('2026-02-15'));
    assert.equal(old.now!.value.letter, null, 'the cycle began on 23 Feb');
  });

  it('no plan: no step; a week before the cycle: none now', () => {
    const noPlan = read('2026-04-12', (f) => void delete f['v/3-Personal/Fitness/plan-data.json']);
    assert.deepEqual(coachStepsOf(noPlan, '2026-04-12', null), { now: null, next: [] });
    assert.equal(coachStepsOf(read('2026-02-24'), '2026-02-24', null).now, null, 'Sun 22 Feb is before the cycle start');
  });

  it('Today, Check-in and the Plan carry it; the Plan’s Sundays in Coming up name it', () => {
    const r = read('2026-04-12', saved('2026-04-12'));
    assert.equal(buildToday(r, '2026-04-12', 'full', 'v', {}, { letter: null }).coach.now!.value.state, 'due');
    assert.equal(buildToday(r, '2026-04-12', 'full', 'v').coach.now!.value.state, 'due', 'no letter given: none read');
    assert.equal(buildCheckin(r, '2026-04-12', letter('2026-04-12')).coach.now!.value.state, 'done');
    const plan = buildPlan(read('2026-04-10'), '2026-04-10', {}, 'v') as Extract<ReturnType<typeof buildPlan>, { templates: unknown }>;
    assert.equal(plan.coach.steps.length, 24);
    assert.equal(plan.coach.now!.value.date, '2026-04-05');
    const sundays = plan.upcoming.filter((u) => u.kind === 'checkin' || u.kind === 'phase-review').map((u) => [u.date, u.kind, (u as { coach?: { kind: string } }).coach?.kind]);
    assert.deepEqual(sundays, [['2026-04-12', 'checkin', 'letter'], ['2026-04-19', 'checkin', 'letter'], ['2026-04-26', 'checkin', 'phase-review'], ['2026-04-26', 'phase-review', 'phase-review']]);
    assert.equal((plan.upcoming.find((u) => u.kind === 'tape') as { coach?: unknown }).coach, undefined, 'only the Sundays’ check-ins and reviews');
  });

  it('the commands are spelled in one place: no other source file has them', () => {
    const dirs = [join(ROOT, 'src'), join(ROOT, 'plugin', 'src')];
    const found: string[] = [];
    for (const dir of dirs) {
      for (const f of readdirSync(dir, { recursive: true }) as string[]) {
        const p = join(dir, f);
        if (!p.endsWith('.ts') || !statSync(p).isFile() || p.endsWith(join('core', 'coach-steps.ts'))) continue;
        if (/\/fitness-coach (?:checkin|review)\b/.test(readFileSync(p, 'utf8'))) found.push(p.slice(ROOT.length + 1));
      }
    }
    assert.deepEqual(found, []);
  });
});

describe('the "Ask the coach" card’s rule', () => {
  const step = (state: CoachNow['state'], sunday = '2026-04-12') => coachSteps({ program: PROGRAM, planWeeks: 24, date: sunday, sunday: { date: sunday, status: state === 'answer-first' ? 'open' : 'edit' }, letter: state === 'done' ? { date: sunday, kind: 'coach-letter' } : null }).now!.value;
  const input = (date: string, time: string, coach: CoachNow | null, extra: Partial<DueInput> = {}): DueInput => ({
    now: momentAt(date, time, 0), tracking: null, nudges: null, body: null, habits: null, program: null,
    training: { logged: new Set(), plannedToday: false }, settings: { quiet: { from: '22:30', to: '07:00' } }, coach, ...extra,
  });
  const cards = (i: DueInput) => dueNow(i).value.cards.filter((c) => c.kind === 'coach');

  it('on the step’s Sunday from 18:00 once the answers are saved and no letter is in', () => {
    assert.equal(COACH_AT, '18:00');
    assert.deepEqual(cards(input('2026-04-12', '17:55', step('due'))), [], 'before its time');
    const [c] = cards(input('2026-04-12', '18:05', step('due')));
    assert.ok(c);
    assert.deepEqual([c!.key, c!.date, c!.at, c!.late, c!.closable, c!.skip, c!.occurrence], ['coach', '2026-04-12', 18 * 60, 5, true, 'today', '2026-04-12']);
    assert.deepEqual([c!.coach!.title, c!.coach!.command, c!.coach!.state], ['The week’s letter', '/fitness-coach checkin', 'due']);
    assert.ok(c!.snooze!.minutes.includes(30) && !c!.snooze!.evening, 'the usual snoozes; no "This evening" at 18:00 or later');
    assert.equal(c!.reason.rule, 'coach.ask');
    assert.match(c!.reason.note!, /run \/fitness-coach checkin in Claude Code, in your vault\. This card comes at 18:00 on the Sunday, then once a day/);
  });

  it('not while the answers wait, nor once the letter is in, nor in the quiet hours', () => {
    assert.deepEqual(cards(input('2026-04-12', '19:00', step('answer-first'))), []);
    assert.deepEqual(cards(input('2026-04-12', '19:00', step('done'))), []);
    assert.deepEqual(cards(input('2026-04-12', '19:00', null)), []);
    assert.equal(dueNow(input('2026-04-12', '23:00', step('due'))).value.quiet, true);
  });

  it('late: again on each later day, once a day; an answer or a snooze holds it that day only', () => {
    const late = coachSteps({ program: PROGRAM, planWeeks: 24, date: '2026-04-14', sunday: { date: '2026-04-12', status: 'saved' }, letter: null }).now!.value;
    assert.equal(late.state, 'late');
    const [c] = cards(input('2026-04-14', '18:30', late));
    assert.deepEqual([c!.date, c!.occurrence, c!.coach!.state], ['2026-04-14', '2026-04-12', 'late']);
    const ok = answerCard(c!, 'done', momentAt('2026-04-14', '18:31', 0).ms, { by: 'Home Mac' });
    assert.deepEqual(ok.map((x) => 'key' in x && [x.date, x.key, x.set.how]), [['2026-04-14', 'coach', 'done']]);
    const nudges = { schemaVersion: 1 as const, days: { '2026-04-14': { coach: { how: 'done' as const, at: '2026-04-14T18:31:00.000Z' } } } };
    assert.deepEqual(cards(input('2026-04-14', '20:00', late, { nudges })), [], 'answered today');
    assert.equal(cards(input('2026-04-15', '18:00', late, { nudges })).length, 1, 'the next day, again');
    const snoozed = { schemaVersion: 1 as const, days: { '2026-04-14': { coach: { snoozedUntil: '2026-04-14T19:00:00.000Z' } } } };
    assert.deepEqual(cards(input('2026-04-14', '18:40', late, { nudges: snoozed })), []);
    assert.equal(cards(input('2026-04-14', '19:01', late, { nudges: snoozed })).length, 1);
  });

  it('a review names its own command; the answer is a known key in Coach/nudges.json', () => {
    const [c] = cards(input('2026-04-26', '18:00', step('due', '2026-04-26')));
    assert.deepEqual([c!.coach!.kind, c!.coach!.command], ['phase-review', '/fitness-coach review']);
    assert.deepEqual(validateNudges({ schemaVersion: 1, days: { '2026-04-26': { coach: { how: 'done', at: '2026-04-26T18:00:00.000Z', by: 'Home Mac' } } } }), []);
  });
});
