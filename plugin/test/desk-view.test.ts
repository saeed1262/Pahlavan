// Due today's stand-ups line with the minutes stood at the desk ("30 of
// them at the desk", only when "Standing now" logged any) and the Plan's
// Desk breaks card on the plan's own times (plan-data's deskTiming: the
// stats, a dot per break, the day line widened for a window outside 08:00 to
// 18:00), drawn in Node with the small fake DOM on the synthetic vault.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { readTracking } from '../../src/adapters/vault/tracking-read.ts';
import { momentAt } from '../../src/core/clock.ts';
import { buildDeskCard, buildHabitsScreen } from '../../src/report/habits-screen.ts';
import { buildDue } from '../../src/report/tracking.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { deskCard, dayLine } from '../src/ui/desk-card.ts';
import { dueTodayCard, standCount } from '../src/ui/due-today.ts';
import { measureChart, todayCard } from '../src/ui/habits.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const DATE = '2026-04-10';
const TRACKING = 'v/3-Personal/Fitness/Coach/tracking.json';
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const files = (edit: (f: Record<string, string>) => void = () => {}) => {
  const f = fixtureFiles('v');
  edit(f);
  return f;
};
const edit = (f: Record<string, string>, path: string, fn: (doc: Record<string, any>) => void) => {
  const doc = JSON.parse(f[path]!);
  fn(doc);
  f[path] = JSON.stringify(doc);
};

function standRow(f: Record<string, string>, readable: boolean | null = true, stand: readonly Record<string, unknown>[] = []): FakeElement {
  const io = memoryIo(f, DATE);
  const read = readVault(io, 'v', { asOf: DATE });
  const tr = readTracking(io, 'v');
  const due = buildDue(read.data, tr, momentAt(DATE, '12:15', 0)).today.value;
  return dueTodayCard({
    due,
    items: tr.tracking!.items,
    activity: { readable, why: null },
    stand: stand as never,
    sitting: null,
    standing: { on: false, since: null },
    sundayDone: false,
    canWrite: true,
    busy: new Set(),
    onTick() {},
    onAdd() {},
    onOpen() {},
    onStanding() {},
    onHabits() {},
  }) as unknown as FakeElement;
}

function standLine(f: Record<string, string>, readable: boolean | null = true): string {
  const el = standRow(f, readable);
  const sub = el.querySelectorAll('.pv-due-sub').map(text).find((t) => /min standing/.test(t));
  assert.ok(sub, 'the stand-ups row is drawn');
  return sub!;
}

function card(f: Record<string, string>): FakeElement {
  const io = memoryIo(f, DATE);
  return deskCard({ model: buildDeskCard(readVault(io, 'v', { asOf: DATE }), readTracking(io, 'v'), DATE), onChange() {} }) as unknown as FakeElement;
}

describe('Due today: the stand-ups line', () => {
  it('names the minutes stood at the desk, only when there are some', () => {
    assert.equal(standLine(files()), '4 stand-ups so far, 80 of 120 min standing');
    const desk = files((f) => edit(f, TRACKING, (t) => (t.days[DATE]['stand-ups'].deskMinutes = 40)));
    assert.equal(standLine(desk), '4 stand-ups so far, 80 of 120 min standing, 40 of them at the desk');
    assert.equal(standLine(desk, false), '4 stand-ups so far, 80 of 120 min standing, 40 of them at the desk', 'also when activity cannot be read here');
  });

  it('past the target, the minutes come first and the target after', () => {
    const over = files((f) => edit(f, TRACKING, (t) => Object.assign(t.days[DATE]['stand-ups'], { minutes: 225, count: 15, deskMinutes: 210 })));
    assert.equal(standLine(over), '15 stand-ups so far, 225 min standing (target 120), 210 of them at the desk');
    const exactly = files((f) => edit(f, TRACKING, (t) => (t.days[DATE]['stand-ups'].minutes = 120)));
    assert.equal(standLine(exactly), '4 stand-ups so far, 120 min standing (target 120)');
    assert.deepEqual([standCount(1), standCount(0)], ['1 stand-up so far', '0 stand-ups so far'], 'the count is named, one in the singular');
  });
});

describe('Due today: the sitting stretch bar under the stand-ups', () => {
  const live = (inHours: boolean) => [{ id: 'stand-ups', name: 'Stand-ups', phase: 'sitting', satMinutes: inHours ? 20 : 0, sitLeft: null, standLeft: null, snoozeAvailable: false, inHours, deskLeft: null }];
  it('shows while sitting counts, and not outside the item\'s hours, as the line says', () => {
    const inside = standRow(files(), true, live(true));
    assert.equal(inside.querySelectorAll('.pv-sit-bar').length, 1);
    assert.ok(inside.querySelectorAll('.pv-due-sub').map(text).some((t) => /sitting 20 of \d+ min now/.test(t)));
    const outside = standRow(files(), true, live(false));
    assert.equal(outside.querySelectorAll('.pv-sit-bar').length, 0, 'no empty bar under the minutes stood');
    assert.ok(outside.querySelectorAll('.pv-due-sub').map(text).some((t) => /outside its hours/.test(t)));
  });
});

describe('Habits: the stand-ups and desk-breaks charts', () => {
  const rows = (f: Record<string, string>) => {
    const io = memoryIo(f, DATE);
    return buildHabitsScreen(readVault(io, 'v', { asOf: DATE }), readTracking(io, 'v'), DATE).items;
  };
  const tips = (el: FakeElement) => el.querySelectorAll('.pv-ms-hit').map((x) => x.getAttribute('data-tip') ?? '');

  it('stand-ups: a bar a day for 4 weeks against the target, the desk minutes their own part, the whole column the hover target', () => {
    const desk = rows(files((f) => edit(f, TRACKING, (t) => (t.days['2026-04-08']['stand-ups'].deskMinutes = 60)))).find((x) => x.id === 'stand-ups')!;
    const el = measureChart(desk, 560, 120) as unknown as FakeElement;
    assert.equal(el.querySelectorAll('.pv-ms-hit').length, 28);
    assert.equal(el.querySelectorAll('.pv-ms-desk').length, 1, 'one day with desk minutes');
    assert.ok(tips(el).some((t) => /140 min standing \(target 120\)/.test(t) && /7 stand-ups, 60 min at the desk/.test(t)));
    assert.ok(tips(el).some((t) => /80 min standing so far \(target 120\)/.test(t)), 'today, so far');
    assert.match(text(el.querySelector('.pv-sit-note')!), /at the desk.*away from it.*120 min target/);
    const none = measureChart(rows(files()).find((x) => x.id === 'stand-ups')!, 560, 120) as unknown as FakeElement;
    assert.equal(none.querySelectorAll('.pv-ms-desk').length, 0);
    assert.doesNotMatch(text(none.querySelector('.pv-sit-note')!), /at the desk/, 'no desk minutes: no desk key');
  });

  it('desk breaks: the breaks done a day against the ones planned', () => {
    const el = measureChart(rows(files()).find((x) => x.id === 'desk-breaks')!, 560, 120) as unknown as FakeElement;
    assert.ok(el.querySelectorAll('.pv-ms-col').length > 0);
    assert.equal(el.querySelectorAll('.pv-ms-desk').length + el.querySelectorAll('.pv-ms-away').length, 0);
    assert.ok(tips(el).some((t) => /^.*\|4 of \d+ breaks/.test(t)));
    assert.match(text(el.querySelector('.pv-sit-note')!), /breaks done.*planned/);
  });
});

describe('the Plan\'s Desk breaks card on the plan\'s times', () => {
  it('a 9-to-5 deskTiming: every 90 min, 09:00 to 17:00, six breaks on the day line', () => {
    const el = card(files((f) => edit(f, PLAN, (p) => (p['deskTiming'] = { every: 90, from: '09:00', to: '17:00' }))));
    const stats = el.querySelectorAll('.pv-desk-stats b').map(text);
    assert.deepEqual(stats, ['Every 90 min', '09:00 to 17:00', '6 a day']);
    assert.equal(el.querySelectorAll('.pv-desk-dot').length, 6 + 1, 'six breaks and the key\'s dot');
    assert.match(text(el), /The routine and its times change with the plan/);
  });

  it('the day line keeps 08:00 to 18:00, and widens by whole 2 hours for a window outside it', () => {
    const axis = (from: string, to: string) => (dayLine(['10:00'], from, to, 5) as unknown as FakeElement).querySelectorAll('.pv-ax').map(text);
    assert.deepEqual(axis('10:00', '15:00'), ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00']);
    assert.deepEqual(axis('07:00', '19:30'), ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00']);
    const line = dayLine(['07:00', '19:00'], '07:00', '19:30', 5, 360) as unknown as FakeElement;
    const xs = line.querySelectorAll('.pv-desk-dot').map((c) => Number(c.getAttribute('cx')));
    assert.ok(xs.every((x) => x >= 10 && x <= 350), `every break inside the line: ${xs.join(', ')}`);
  });
});

describe('Habits\' Today\'s reminders: a desk-break item that follows the plan', () => {
  it('runs to the plan\'s end, not the item\'s own stale one', () => {
    // The item keeps 10:00 to 15:00 of its own; the plan's deskTiming runs to 16:30.
    const f = files((x) => edit(x, PLAN, (p) => (p['deskTiming'] = { every: 90, from: '10:00', to: '16:30' })));
    const io = memoryIo(f, DATE);
    const read = readVault(io, 'v', { asOf: DATE });
    const tr = readTracking(io, 'v');
    const model = buildHabitsScreen(read, tr, DATE);
    assert.equal(model.items.find((x) => x.id === 'desk-breaks')!.when, '10:00 to 16:30, from your plan');
    const due = buildDue(read.data, tr, momentAt(DATE, '12:15', 0)).today.value;
    const el = todayCard({ model, due, ui: {} as never, canWrite: true, onChange() {}, onSave() {}, onCancel() {}, onEdit() {}, onAdd() {}, onPause() {}, onResume() {}, onRemove() {}, onAccept() {}, onDismiss() {}, onBring() {}, onBringLater() {}, onBringNever() {}, onAmount() {} }) as unknown as FakeElement;
    const sub = el.querySelectorAll('.pv-slot-sub').map(text).find((t) => /^Every 90 min to /.test(t));
    assert.equal(sub, 'Every 90 min to 16:30 · 2 of 5');
  });
});
