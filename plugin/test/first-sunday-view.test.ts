// The first Sunday check-in's screens (0.14.0), drawn in Node with the small
// fake DOM on the synthetic vault: Today's week strip on a day the check-in
// says was trained, the Sunday protein question with today's evening tick
// still ahead, the questions a saved record answers, and the coach step once
// its letter is in (Due today has no coach line; Your day says done).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { readTracking } from '../../src/adapters/vault/tracking-read.ts';
import { momentAt } from '../../src/core/clock.ts';
import { checkinWeek } from '../../src/report/banners.ts';
import { buildCheckin, buildDue, buildSession, buildToday, yourDay } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { refreshCheckinState, renderCheckin, type CheckinContext } from '../src/ui/checkin.ts';
import { dueTodayCard } from '../src/ui/due-today.ts';
import { renderToday, type TodayContext } from '../src/ui/today.ts';
import { yourDayStrip } from '../src/ui/your-day.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const SUNDAY = '2026-04-12';
const FIT = 'v/3-Personal/Fitness';
const CHECKINS = `${FIT}/Coach/checkins.json`;
type Files = Record<string, string>;
const vault = (date: string, edit?: (f: Files) => void) => {
  const f = fixtureFiles('v');
  edit?.(f);
  const io = memoryIo(f, date);
  return { read: readVault(io, 'v', { asOf: date }), tr: readTracking(io, 'v') };
};
const record = (r: Record<string, unknown>) => (f: Files) => void (f[CHECKINS] = JSON.stringify({ schemaVersion: 1, checkins: [r] }));

describe('Today’s strip: a day the Sunday check-in says was trained', () => {
  it('reads "Trained, not logged" with its why, not "No entry"', () => {
    const { read } = vault(SUNDAY, record({ date: SUNDAY, weekStart: '2026-04-06', confirmedUnlogged: [{ date: SUNDAY, type: 'S3' }] }));
    const m = buildToday(read, SUNDAY, 'full', 'v');
    const ctx: TodayContext = { mode: 'full', session: m.session, phase: { id: 'workday', isfahan: false }, open: new Set(), pick: null, onMode: () => {}, onPick: () => {}, onToggleWhy: () => {}, onLog: () => {}, onEditSession: () => {} };
    const root = new FakeElement('div');
    renderToday(root as unknown as HTMLElement, m, ctx);
    const cell = root.querySelectorAll('.pv-day').at(-1)!;
    assert.equal(text(cell.querySelector('.pv-day-what')!), 'Trained, not logged');
    assert.match(cell.getAttribute('data-tip')!, /Your Sunday check-in says you trained\. No session is logged yet\./);
    assert.ok(cell.querySelector('.pv-day-mark.is-unlogged'));
  });
});

describe('the Sunday check-in: protein, and a saved record', () => {
  const draw = (minutes: number, edit?: (f: Files) => void) => {
    const { read, tr } = vault(SUNDAY, edit);
    const c = buildCheckin(read, SUNDAY, null, { minutes, tracking: tr });
    const st = refreshCheckinState(null, c);
    const ctx: CheckinContext = { canWrite: true, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, planWeek: 6, phaseNo: 1, week: checkinWeek(read, SUNDAY), tape: null }, onChange: () => {}, onSaveMorning: () => {}, onSaveSunday: () => {} };
    const root = new FakeElement('div');
    renderCheckin(root as unknown as HTMLElement, c, st, ctx);
    return root;
  };
  const protein = (root: FakeElement) => root.querySelectorAll('.pv-q').find((x) => /reach about/.test(text(x)))!;

  it('before the Sunday’s tick: the days before today, one pill a day, and the tick still counts', () => {
    const q = protein(draw(18 * 60 + 30));
    assert.match(text(q.querySelector('.pv-q-title')!), /^You ticked protein on 4 days\. On how many of the other 2 before today did you reach about 134 g\?$/);
    assert.deepEqual(q.querySelectorAll('.pv-pill').map(text), ['0', '1', '2']);
    assert.equal(text(q.querySelector('.pv-q-known')!), '4 protein ticks this week. Today’s tick at 20:00 still counts when it comes.');
    assert.doesNotMatch(text(q), /—/);
  });

  it('after it: the 3 unticked days, 0 to 3', () => {
    const q = protein(draw(21 * 60));
    assert.match(text(q.querySelector('.pv-q-title')!), /On how many of the other 3 did you reach about 134 g\?$/);
    assert.deepEqual(q.querySelectorAll('.pv-pill').map(text), ['0', '1', '2', '3']);
  });

  it('a saved record: its answered questions are still there to edit, with their answers marked', () => {
    const root = draw(21 * 60, record({ date: SUNDAY, weekStart: '2026-04-06', effort: 7, proteinExtra: 2 }));
    const effort = root.querySelectorAll('.pv-q').find((x) => /How hard did the week/.test(text(x)))!;
    assert.ok(effort.querySelectorAll('.pv-pill').some((p) => /is-on/.test(p.className) && /Solid/.test(text(p))));
    const q = protein(root);
    assert.ok(q.querySelectorAll('.pv-pill').some((p) => /is-on/.test(p.className) && text(p) === '2'));
  });
});

describe('the coach step once its letter is in', () => {
  const LETTER = { path: `${FIT}/Coach/Letters/${SUNDAY}.md`, text: `---\ntype: coach-letter\ndate: ${SUNDAY}\nfocus: Protein at breakfast\n---\n\n# Week 6 letter\n` };
  const saved = record({ date: SUNDAY, weekStart: '2026-04-06', effort: 7 });

  it('Due today, with the done step, draws no coach line; Your day says the letter is in', () => {
    const { read, tr } = vault(SUNDAY, (f) => {
      saved(f);
      f[LETTER.path] = LETTER.text;
    });
    const due = buildDue(read.data, tr, momentAt(SUNDAY, '21:00', 0), { coach: buildCheckin(read, SUNDAY, LETTER).coach.now?.value ?? null }).today.value;
    assert.equal(due.coach?.state, 'done');
    const ctx = { due, items: tr.tracking?.items ?? [], activity: { readable: true, why: null }, stand: [], sitting: null, standing: { on: false, since: null }, sundayDone: true, canWrite: true, busy: new Set<string>(), onTick: () => {}, onAdd: () => {}, onOpen: () => {}, onStanding: () => {}, onHabits: () => {}, coachFirst: null };
    const card = dueTodayCard(ctx) as unknown as FakeElement;
    assert.equal(card.querySelector('[data-coach]'), null);
    const m = buildToday(read, SUNDAY, 'full', 'v', {}, { letter: LETTER });
    const day = yourDay(m, { session: buildSession(read.data, SUNDAY, 'full'), due, food: null, items: tr.tracking?.items ?? [] })!;
    const sunday = day.value.steps.find((s) => s.id === 'sunday')!;
    assert.deepEqual([sunday.state, sunday.line], ['done', 'The coach’s letter of Sun 12 Apr is in.']);
    const strip = yourDayStrip({ day, onMorning: () => {}, onLog: () => {}, onDue: () => {}, onFood: () => {}, onCheckin: () => {} }) as unknown as FakeElement;
    assert.match(text(strip.querySelector('[data-step="sunday"]')!), /Done/);
  });
});
