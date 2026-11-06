// The 0.12.0 screens, drawn in Node with the small fake DOM on the
// synthetic vault: a short day's planned minutes on the Plan's panel and on
// Today, flagged when they run over the profile's short day, and the Sunday
// check-in's Pain question showing what the week's logs already say.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { checkinWeek } from '../../src/report/banners.ts';
import { buildCheckin, buildPlan, buildToday } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { refreshCheckinState, renderCheckin, type CheckinContext } from '../src/ui/checkin.ts';
import { renderPlan } from '../src/ui/plan.ts';
import { renderToday, type TodayContext } from '../src/ui/today.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const DATE = '2026-04-10';
const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';
const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
const read = (date: string, edit?: (f: Record<string, string>) => void) => {
  const f = fixtureFiles('v');
  edit?.(f);
  return readVault(memoryIo(f, date), 'v', { asOf: date });
};
/** Two short days of 10 minutes: the synthetic S1 (about 15) runs 5 over. */
const tight = (f: Record<string, string>) => {
  const p = JSON.parse(f[PROFILE]!);
  p.availability = { ...p.availability, shortSessions: { days: 2, minutes: 10 } };
  f[PROFILE] = JSON.stringify(p);
};

describe('the Plan: a short day’s minutes', () => {
  const panels = (edit?: (f: Record<string, string>) => void) => {
    const root = new FakeElement('div');
    renderPlan(root as unknown as HTMLElement, buildPlan(read(DATE, edit), DATE), { view: 'week', tables: new Set(), onView: () => {}, onTable: () => {}, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, weekTarget: null } });
    return root.querySelectorAll('.pv-tpl').map((el) => ({ el, head: el.querySelector('.pv-tpl-head')! }));
  };

  it('each short day’s panel says its minutes as planned; a lifting day’s says none', () => {
    const p = panels();
    const short = p.filter((x) => /^S/.test(text(x.head.querySelector('.pv-tpl-badge')!)));
    assert.deepEqual(short.map((x) => text(x.head.querySelector('.pv-tpl-min')!)), ['about 15 min', 'about 12 min']);
    assert.match(short[0]!.head.querySelector('.pv-tpl-min')!.getAttribute('data-tip')!, /^Session length\|About 15 min: a 1-min warm-up/);
    assert.ok(p.filter((x) => !short.includes(x)).every((x) => x.head.querySelector('.pv-tpl-min') === null));
    assert.equal(p.flatMap((x) => x.head.querySelectorAll('.pv-tag')).length, 0, 'nothing over a 60-minute day');
  });

  it('over the profile’s short day: the minutes over, with the time check’s reason', () => {
    const s1 = panels(tight).find((x) => text(x.head.querySelector('.pv-tpl-badge')!) === 'S1')!;
    const tag = s1.head.querySelector('.pv-tag.is-warn')!;
    assert.equal(text(tag), '5 min over');
    assert.equal(tag.getAttribute('data-rule'), 'time.check');
    assert.match(tag.getAttribute('data-tip')!, /^Over your 10-minute short day\|S1 \(Short 1 · Skills\) takes about 15 min, 5 min over your 10-minute short days/);
    assert.doesNotMatch(text(s1.head), /—/);
  });
});

describe('Today: a short day’s minutes', () => {
  const meta = (edit?: (f: Record<string, string>) => void) => {
    const m = buildToday(read(DATE, edit), DATE, 'full', 'v', { type: 'S1' });
    const ctx: TodayContext = { mode: 'full', session: m.session, phase: { id: 'workday', isfahan: false }, open: new Set(), pick: 'S1', onMode: () => {}, onPick: () => {}, onToggleWhy: () => {}, onLog: () => {}, onEditSession: () => {} };
    const root = new FakeElement('div');
    renderToday(root as unknown as HTMLElement, m, ctx);
    return root.querySelector('.pv-session-meta')!;
  };

  it('says about how long, and how far over the short day when it runs over', () => {
    assert.match(text(meta()), /about 15 min · planned effort/);
    const over = meta(tight);
    assert.match(text(over), /about 15 min, 5 over your 10-minute short day · planned effort/);
    assert.match(over.getAttribute('data-tip')!, /\|S1 \(Short 1 · Skills\) takes about 15 min, 5 min over/);
  });
});

describe('the Sunday check-in: Pain', () => {
  it('the question shows what the week’s logs say', () => {
    const SUNDAY = '2026-04-12';
    const r = read(SUNDAY, (f) => {
      const log = JSON.parse(f[LOG]!);
      for (const s of log.sessions) if (s.date === '2026-04-08') s.pain = [{ area: 'Knee', severity: 4, exercise: 'Goblet Squat' }];
      f[LOG] = JSON.stringify(log);
    });
    const c = buildCheckin(r, SUNDAY, null);
    const st = refreshCheckinState(null, c);
    const ctx: CheckinContext = { canWrite: true, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, planWeek: 6, phaseNo: 1, week: checkinWeek(r, SUNDAY), tape: null }, onChange: () => {}, onSaveMorning: () => {}, onSaveSunday: () => {} };
    const root = new FakeElement('div');
    renderCheckin(root as unknown as HTMLElement, c, st, ctx);
    const q = root.querySelectorAll('.pv-q').find((x) => /Any pain or niggle\?/.test(text(x)))!;
    assert.equal(text(q.querySelector('.pv-q-known')!), 'Logged: knee 4 of 10 during Goblet Squat, Wed.');
  });
});
