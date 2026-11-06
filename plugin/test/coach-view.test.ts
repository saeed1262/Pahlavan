// "Ask the coach" on the screens and the card, drawn in Node with the small
// fake DOM on the synthetic vault (plan week 8 ends phase 1 on Sun 26 Apr):
// the reminder card's view (the step, the command with Copy, OK), Today's
// card while the step is due or still to do, Due today's Sunday line while
// the answers wait, the Sunday check-in's line before and after the save
// (and once the letter is in), and the Plan's Coming up and calendar naming
// each Sunday's step and command.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { momentAt } from '../../src/core/clock.ts';
import { dueNow, type DueToday } from '../../src/core/nudges.ts';
import { checkinWeek } from '../../src/report/banners.ts';
import { buildCheckin, buildPlan, buildToday, coachStepsOf } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { cardView } from '../src/reminders/card-model.ts';
import type { CardAnswer } from '../src/reminders/machine.ts';
import { CardController } from '../src/ui/cards.ts';
import { refreshCheckinState, renderCheckin, type CheckinContext } from '../src/ui/checkin.ts';
import { dueTodayCard } from '../src/ui/due-today.ts';
import { renderPlan } from '../src/ui/plan.ts';
import { renderToday, type TodayContext } from '../src/ui/today.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const SUNDAY = '2026-04-26';
const CHECKINS = 'v/3-Personal/Fitness/Coach/checkins.json';
const read = (date: string, saved = true) => {
  const files = fixtureFiles('v');
  if (saved) files[CHECKINS] = JSON.stringify({ schemaVersion: 1, checkins: [{ date: SUNDAY, weekStart: '2026-04-20' }] });
  return readVault(memoryIo(files, date), 'v', { asOf: date });
};
const LETTER = { path: '3-Personal/Fitness/Coach/Letters/2026-04-26.md', text: '---\ntype: phase-review\ndate: 2026-04-26\n---\n\n# Phase 1 review\n' };
const click = (el: FakeElement | null) => {
  assert.ok(el, 'drawn');
  for (const fn of el!.listeners.get('click') ?? []) fn({ target: el });
};
const NO_EMDASH = /—/;

/** The coach card as the machine shows it: dueNow on the step, then its view. */
function coachCard(date: string, time: string) {
  const r = read(date);
  const now = momentAt(date, time, 0);
  const coach = coachStepsOf(r, date, null).now!.value;
  const c = dueNow({ now, tracking: null, nudges: null, body: null, habits: null, program: null, training: { logged: new Set(), plannedToday: false }, coach }).value.cards.find((x) => x.kind === 'coach');
  assert.ok(c, 'the coach card is due');
  return { card: c!, view: cardView(c!, { now, tracking: null, habits: null, body: null, program: null }) };
}

describe('the "Ask the coach" card', () => {
  it('on the Sunday: the step as its title, why now, the command; the notification names the command', () => {
    const { view } = coachCard(SUNDAY, '18:10');
    assert.deepEqual([view.kind, view.icon, view.kicker, view.title, view.sub, view.primary], ['coach', 'mail', 'Ask the coach', 'Phase review', 'Sunday 26 April · your answers are saved', 'OK']);
    assert.deepEqual(view.body, { kind: 'coach', lead: 'Phase 1 ends today and your answers are saved: the coach reviews the phase and plans the next one.', command: '/fitness-coach review' });
    assert.deepEqual(view.notify, { title: 'Ask the coach: Phase review', body: 'Run /fitness-coach review in Claude Code' });
    assert.deepEqual([view.skip, view.closable, view.snooze!.map((e) => e.label)], [{ label: 'Skip today', action: 'skip' }, true, ['10 minutes', '30 minutes', '1 hour', '2 hours']]);
    assert.equal(view.why.rule, 'coach.ask');
    assert.doesNotMatch(JSON.stringify({ k: view.kicker, t: view.title, s: view.sub, b: view.body, n: view.notify, w: view.why.note }), NO_EMDASH);
    assert.doesNotMatch(view.why.note, /coach\.[a-z]/, 'no rule id in the Why line');
  });

  it('on a later day it says the step is still to do, for which Sunday', () => {
    const { view } = coachCard('2026-04-29', '18:00');
    assert.equal(view.kicker, 'Ask the coach · still to do');
    assert.equal(view.sub, 'For the check-in of Sun 26 Apr · no letter yet');
    assert.ok(view.body.kind === 'coach' && /^Your answers for Sun 26 Apr are saved, but no letter is in yet/.test(view.body.lead));
  });

  it('drawn: the command in a code chip with Copy, which keeps the card; OK answers it', async () => {
    const { view } = coachCard(SUNDAY, '18:10');
    const sent: CardAnswer[] = [];
    const ctl = new CardController(view, { answer: async (a) => void sent.push(a), close: () => {} });
    const el = ctl.el as unknown as FakeElement;
    assert.equal(text(el.querySelector('.pv-nv-cmd code')!), '/fitness-coach review');
    click(el.querySelector('.pv-nv-cmd button'));
    click(el.querySelector('.pv-nv-foot .pv-btn-primary'));
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(sent, [{ do: 'copy', text: '/fitness-coach review' }, { do: 'save', payload: { kind: 'coach' } }]);
    assert.match(text(el), /OK hides this card for today; Copy keeps it open\./);
  });
});

describe('Today', () => {
  const draw = (date: string, o: { saved?: boolean; letter?: typeof LETTER | null } = {}) => {
    const m = buildToday(read(date, o.saved ?? true), date, 'full', 'v', {}, { letter: o.letter ?? null });
    const copied: string[] = [];
    const ctx: TodayContext = { mode: 'full', session: m.session, phase: { id: 'workday', isfahan: false }, open: new Set(), pick: null, onMode: () => {}, onPick: () => {}, onToggleWhy: () => {}, onLog: () => {}, onEditSession: () => {}, onCopyCommand: (t) => void copied.push(t) };
    const root = new FakeElement('div');
    renderToday(root as unknown as HTMLElement, m, ctx);
    return { root, copied, m };
  };

  it('"Ask the coach" in the side column while the step is due: its title, why, the command and Copy', () => {
    const { root, copied } = draw(SUNDAY);
    const card = root.querySelector('.pv-today-side [data-card="coach"]')!;
    assert.ok(card, 'drawn');
    assert.equal(card.getAttribute('data-sec'), 'coach');
    assert.equal(text(card.querySelector('.pv-card-title')!), 'Phase review');
    assert.equal(text(card.querySelector('.pv-coach-why')!), 'Phase 1 ends today and your answers are saved: the coach reviews the phase and plans the next one.');
    assert.equal(text(card.querySelector('.pv-cmd code')!), '/fitness-coach review');
    click(card.querySelector('.pv-cmd-copy'));
    assert.deepEqual(copied, ['/fitness-coach review']);
    assert.doesNotMatch(text(card), NO_EMDASH);
  });

  it('still to do on the days after; gone once the letter is in, and while the answers wait', () => {
    assert.match(text(draw('2026-04-28').root.querySelector('[data-card="coach"]')!), /Still to do since Sun 26 Apr: no letter yet/);
    assert.equal(draw(SUNDAY, { letter: LETTER }).root.querySelector('[data-card="coach"]'), null);
    assert.equal(draw(SUNDAY, { saved: false }).root.querySelector('[data-card="coach"]'), null);
  });

  it('Due today’s Sunday line, while the answers wait, says the coach step that follows', () => {
    const { m } = draw(SUNDAY, { saved: false });
    const c = m.coach.now!.value;
    assert.equal(c.state, 'answer-first');
    const due: DueToday = { date: SUNDAY, now: '10:00', morning: { on: false, at: null, done: true, checkedAt: null }, habits: { slots: [], done: 0, total: 0 }, amounts: [], standups: [], sitting: [], desk: [], body: [], train: { on: false, at: '20:00', needed: false }, coach: null };
    const ctx = { due, items: [], activity: { readable: true, why: null }, stand: [], sitting: null, standing: { on: false, since: null }, sundayDone: false, canWrite: true, busy: new Set<string>(), onTick: () => {}, onAdd: () => {}, onOpen: () => {}, onStanding: () => {}, onHabits: () => {} };
    const line = (dueTodayCard({ ...ctx, coachFirst: { line: c.line, command: c.command } }) as unknown as FakeElement).querySelector('[data-coach="answer-first"]')!;
    assert.equal(text(line), 'Save your answers, then ask the coach: it reviews the phase and plans the next one. /fitness-coach review');
    assert.equal(line.querySelector('.pv-cmd-copy'), null, 'no Copy before the save');
    assert.equal((dueTodayCard({ ...ctx, coachFirst: null }) as unknown as FakeElement).querySelector('[data-coach]'), null);
  });
});

describe('the Sunday check-in', () => {
  const draw = (date: string, o: { saved?: boolean; letter?: typeof LETTER | null } = {}) => {
    const r = read(date, o.saved ?? true);
    const c = buildCheckin(r, date, o.letter ?? null);
    const st = refreshCheckinState(null, c);
    const copied: string[] = [];
    const ctx: CheckinContext = { canWrite: true, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, planWeek: 8, phaseNo: 1, week: checkinWeek(r, date), tape: null }, onChange: () => {}, onSaveMorning: () => {}, onSaveSunday: () => {}, onCopy: (t) => void copied.push(t) };
    const root = new FakeElement('div');
    renderCheckin(root as unknown as HTMLElement, c, st, ctx);
    return { line: root.querySelector('[data-card="sunday"] .pv-coach-next'), copied };
  };

  it('before the save: save your answers, then ask the coach, with the command and no Copy', () => {
    const { line } = draw(SUNDAY, { saved: false });
    assert.equal(text(line!), 'Save your answers, then ask the coach: /fitness-coach review');
    assert.equal(line!.querySelector('.pv-cmd-copy'), null);
  });

  it('after the save: Next, ask the coach, with the command and Copy; on later days the saved view says it too', () => {
    const { line, copied } = draw(SUNDAY);
    assert.equal(line!.getAttribute('data-coach'), 'due');
    assert.match(text(line!), /^Next: ask the coach for the phase review\. \/fitness-coach reviewCopy$/);
    click(line!.querySelector('.pv-cmd-copy'));
    assert.deepEqual(copied, ['/fitness-coach review']);
    assert.match(text(draw('2026-04-28').line!), /^Next: ask the coach for the phase review\./);
  });

  it('once the letter is in, it says so', () => {
    assert.equal(text(draw(SUNDAY, { letter: LETTER }).line!), 'The coach’s letter of Sun 26 Apr is in.');
  });
});

describe('the Plan', () => {
  const draw = (date: string) => {
    const root = new FakeElement('div');
    renderPlan(root as unknown as HTMLElement, buildPlan(read(date, false), date, {}, 'v'), { view: 'week', tables: new Set(), onView: () => {}, onTable: () => {}, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, weekTarget: null } });
    return root;
  };

  it('Coming up: each Sunday’s check-in names the coach step after it and its command', () => {
    const items = draw('2026-04-10').querySelectorAll('[data-sec="upcoming"] .pv-up-item').map(text);
    // The title and the line under it, as the fake DOM joins them.
    assert.ok(items.includes('Sunday check-inThen the week’s letter: /fitness-coach checkin'), items.join(' | '));
    const end = draw('2026-04-20').querySelectorAll('[data-sec="upcoming"] .pv-up-item').map(text);
    assert.ok(end.includes('Sunday check-inThen the phase review: /fitness-coach review'), end.join(' | '));
    assert.ok(end.includes('Phase reviewThe phase ends; the next one is planned'));
  });

  it('the calendar: each week’s Sunday step in its tip, the reviews in the table’s events', () => {
    const root = draw('2026-04-10');
    const tips = root.querySelectorAll('.pv-tl-week').map((w) => w.getAttribute('data-tip') ?? '');
    assert.match(tips[3]!, /Sunday: Mesocycle review · \/fitness-coach review$/);
    assert.match(tips[5]!, /Sunday: The week’s letter · \/fitness-coach checkin$/);
    const rows = root.querySelectorAll('[data-sec="timeline"] tbody tr').map(text);
    assert.match(rows[3]!, /Mesocycle review · \/fitness-coach review/);
    assert.match(rows[7]!, /Phase review · \/fitness-coach review/);
    assert.doesNotMatch(rows[5]!, /fitness-coach/, 'the weekly letter is every Sunday: not listed');
  });
});
