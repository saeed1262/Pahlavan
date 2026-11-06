// Your day and Your routine drawn in Node with the small fake DOM on the
// synthetic vault: the strip under the banner (its section id for At a
// glance and its fold, the kicker and the count, each step's state, status
// word, name, line and its one action wired to the view's callbacks, the
// Sunday step's command with Copy), and the ? menu's Your routine (next to
// When to talk to the coach, built when it opens, each group with its rows
// of time, what and where, Got it).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { readTracking } from '../../src/adapters/vault/tracking-read.ts';
import { momentAt } from '../../src/core/clock.ts';
import { dueToday } from '../../src/core/nudges.ts';
import { buildFood, buildRoutine, buildSession, buildToday, coachStepsOf, trainingToday, yourDay } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { helpMenu } from '../src/ui/help.ts';
import { renderToday, type TodayContext } from '../src/ui/today.ts';
import { yourDayStrip, type YourDayContext } from '../src/ui/your-day.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const click = (el: FakeElement | null) => {
  assert.ok(el, 'drawn');
  for (const fn of el!.listeners.get('click') ?? []) fn({ target: el });
};
const CHECKINS = 'v/3-Personal/Fitness/Coach/checkins.json';

function model(date: string, edit: (f: Record<string, string>) => void = () => {}) {
  const files = fixtureFiles('v');
  edit(files);
  const io = memoryIo(files, date);
  const read = readVault(io, 'v', { asOf: date });
  const tr = readTracking(io, 'v');
  const m = buildToday(read, date, 'full', 'v');
  const session = buildSession(read.data, date, 'full');
  const due = dueToday({ now: momentAt(date, '12:15', 0), tracking: tr.tracking, nudges: tr.nudges, body: tr.body, photoFolders: tr.photoFolders, habits: tr.habits, program: read.data.program, training: trainingToday(read.data, date), coach: coachStepsOf(read, date, null).now?.value ?? null }).value;
  return { read, tr, m, session, day: yourDay(m, { session, due, food: buildFood(read, tr, date), items: tr.tracking?.items ?? [], clock: (ms) => new Date(ms).toISOString().slice(11, 16) })! };
}

function strip(date: string, edit?: (f: Record<string, string>) => void) {
  const calls: string[] = [];
  const ctx: YourDayContext = {
    day: model(date, edit).day,
    onMorning: () => void calls.push('morning'),
    onLog: () => void calls.push('log'),
    onDue: () => void calls.push('due'),
    onFood: () => void calls.push('food'),
    onCheckin: () => void calls.push('checkin'),
    onCopyCommand: (t) => void calls.push(`copy ${t}`),
  };
  return { el: yourDayStrip(ctx) as unknown as FakeElement, calls };
}

describe('Your day on Today', () => {
  it('the strip: its section for At a glance and the fold, the kicker and the count, each step with its state', () => {
    const { el } = strip('2026-04-10');
    assert.deepEqual([el.getAttribute('data-sec'), el.getAttribute('data-live'), el.getAttribute('data-rule')], ['yourday', 'yourday', 'day.steps']);
    assert.equal(text(el.querySelector('.pv-yd-head .pv-kicker')!), 'Your day · Fri 10 Apr');
    assert.equal(text(el.querySelector('.pv-yd-count')!), '2 of 4 done');
    const steps = el.querySelectorAll('.pv-yd-step');
    assert.deepEqual(steps.map((s) => [s.getAttribute('data-step'), s.getAttribute('data-state')]), [['morning', 'done'], ['session', 'done'], ['habits', 'next'], ['food', 'open']]);
    assert.ok(steps[2]!.classList.contains('is-next'), 'the next step has its class (the accent border)');
    assert.deepEqual(steps.map((s) => text(s.querySelector('.pv-yd-word')!)), ['Done 07:10', 'Done', 'Next', 'Open']);
    assert.deepEqual(steps.map((s) => text(s.querySelector('.pv-yd-name')!)), ['Morning check-in', 'Session', 'Habits: 1 of 7', 'Food']);
    assert.equal(text(steps[0]!.querySelector('.pv-yd-line')!), 'Readiness Watch');
    assert.ok(steps[0]!.querySelector('.pv-yd-word svg'), 'a done step’s word has its check');
    assert.equal(steps[0]!.querySelector('.pv-yd-foot'), null, 'no action once done');
    for (const s of steps) assert.ok(s.getAttribute('data-rule'), 'each step keeps its rule on the element, never in the text');
    assert.doesNotMatch(text(el), /—|day\.[a-z]/);
  });

  it('each action calls the view: Log session, the morning card, Due today, the Food tab, the Check-in tab, Copy', () => {
    const open = strip('2026-04-10', (f) => {
      const log = JSON.parse(f['v/3-Personal/Fitness/fitness-log-data.json']!);
      log.sessions = log.sessions.filter((s: { date: string }) => s.date !== '2026-04-10');
      f['v/3-Personal/Fitness/fitness-log-data.json'] = JSON.stringify(log);
      const body = JSON.parse(f['v/3-Personal/Fitness/body-data.json']!);
      // Not in yet: no checkedAt and none of the card's own questions answered.
      for (const k of ['checkedAt', 'energy', 'soreness', 'sleepQ']) delete body.days['2026-04-10'][k];
      f['v/3-Personal/Fitness/body-data.json'] = JSON.stringify(body);
      const n = JSON.parse(f['v/3-Personal/Fitness/Coach/nudges.json']!);
      delete n.days['2026-04-10'].morning;
      f['v/3-Personal/Fitness/Coach/nudges.json'] = JSON.stringify(n);
    });
    for (const k of ['yd-morning', 'yd-session', 'yd-habits', 'yd-food']) click(open.el.querySelector(`[data-k="${k}"]`));
    assert.deepEqual(open.calls, ['morning', 'log', 'due', 'food']);
    assert.equal(text(open.el.querySelector('[data-k="yd-session"]')!), 'Log session');
    // The Sunday step: answer first, then the command with Copy once the answers are saved.
    const sun = strip('2026-04-12');
    click(sun.el.querySelector('[data-k="yd-sunday"]'));
    assert.deepEqual(sun.calls, ['checkin']);
    const saved = strip('2026-04-12', (f) => void (f[CHECKINS] = JSON.stringify({ schemaVersion: 1, checkins: [{ date: '2026-04-12', weekStart: '2026-04-06' }] })));
    const step = saved.el.querySelector('[data-step="sunday"]')!;
    assert.equal(text(step.querySelector('.pv-cmd code')!), '/fitness-coach checkin');
    click(step.querySelector('.pv-cmd-copy'));
    assert.deepEqual(saved.calls, ['copy /fitness-coach checkin']);
  });

  it('on the screen: right under the banner, before the welcome card and the notes', () => {
    const { m, session, day } = model('2026-04-10');
    const el = yourDayStrip({ day, onMorning() {}, onLog() {}, onDue() {}, onFood() {}, onCheckin() {} });
    const ctx: TodayContext = { mode: 'full', session, phase: { id: 'workday', isfahan: false }, open: new Set(), pick: null, onMode() {}, onPick() {}, onToggleWhy() {}, onLog() {}, onEditSession() {}, yourDay: el };
    const root = new FakeElement('div');
    renderToday(root as unknown as HTMLElement, m, ctx);
    const kids = root.children;
    assert.ok(kids[0]!.classList.contains('pv-hero'));
    assert.equal(kids[1]!.getAttribute('data-sec'), 'yourday');
  });
});

describe('Your routine in the ? menu', () => {
  const routineOf = () => {
    const { read, tr } = model('2026-04-10');
    return buildRoutine(read, tr, '2026-04-10');
  };

  it('next to When to talk to the coach; built when it opens; its groups and rows of time, what and where; Got it closes', () => {
    let built = 0;
    const m = helpMenu({ onGuide() {}, onTips() {}, routine: () => (built++, routineOf()) }) as unknown as FakeElement;
    assert.deepEqual(m.querySelectorAll('.pv-menu-item').map(text), ['User guide', 'Show the tips again', 'When to talk to the coach', 'Your routine']);
    assert.equal(built, 0, 'nothing built before it opens');
    click(m.querySelector('[data-k="help"]'));
    click(m.querySelector('[data-k="help-routine"]'));
    assert.ok(m.classList.contains('is-routine') && !m.classList.contains('is-open') && !m.classList.contains('is-coach'), 'the panel in place of the menu');
    assert.equal(built, 1);
    const panel = m.querySelector('[data-help="routine"]')!;
    assert.equal(text(panel.querySelector('.pv-kicker')!), 'Your routine');
    assert.match(text(panel), /About five minutes a day in Pahlavan, plus the session\./);
    assert.deepEqual(panel.querySelectorAll('.pv-hc-h').map(text), ['Every day', 'Sundays', 'Every four weeks']);
    const daily = panel.querySelector('[data-group="daily"]')!.querySelectorAll('li');
    assert.deepEqual([text(daily[0]!.querySelector('.pv-hr-time')!), text(daily[0]!.querySelector('.pv-hr-where')!)], ['07:30', 'Card']);
    assert.equal(text(daily[2]!.querySelector('.pv-hr-what')!), 'Creatine 5 g, multivitamin 1 tablet');
    const sunday = panel.querySelector('[data-group="sunday"]')!.querySelectorAll('li');
    assert.equal(text(sunday[0]!.querySelector('code')!), '/fitness-coach checkin');
    assert.equal(text(sunday[0]!.querySelector('.pv-hr-where')!), 'Check-in');
    const weeks = panel.querySelector('[data-group="weeks"]')!.querySelectorAll('li');
    assert.equal(text(weeks[0]!.querySelector('.pv-hr-what')!), 'Lighter sessions; on its Sunday the photos, then /fitness-coach review. Next: Mon 20 Apr to Sun 26 Apr');
    for (const li of panel.querySelectorAll('li')) assert.match(li.getAttribute('data-rule') ?? '', /^routine\./);
    assert.doesNotMatch(text(panel), /—|routine\.[a-z]/);
    click(panel.querySelector('[data-k="help-routine-close"]'));
    assert.ok(!m.classList.contains('is-routine'), 'Got it closes it');
    // Opened again, it is built again from the files as they are now.
    click(m.querySelector('[data-k="help"]'));
    click(m.querySelector('[data-k="help-routine"]'));
    assert.equal(built, 2);
    assert.equal(m.querySelectorAll('[data-help="routine"]').length, 1, 'one panel, replaced');
  });

  it('without the files read yet: a calm line; without a routine to give, no item', () => {
    const m = helpMenu({ onGuide() {}, onTips() {}, routine: () => null }) as unknown as FakeElement;
    click(m.querySelector('[data-k="help"]'));
    click(m.querySelector('[data-k="help-routine"]'));
    assert.match(text(m.querySelector('[data-help="routine"]')!), /Reading your files/);
    const none = helpMenu({ onGuide() {}, onTips() {} }) as unknown as FakeElement;
    assert.equal(none.querySelector('[data-k="help-routine"]'), null);
  });
});
