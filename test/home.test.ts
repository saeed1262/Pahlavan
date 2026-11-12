// Home, the overview tab, on the synthetic vault: the banner (the session,
// what readiness changes, a swap, the week in words), Needs you (three at
// most, in order, the rest counted; the coach and Pahlavan on different
// versions), food and habits, and the progress lead and tiles; a vault with
// no plan; and the plain-words rule (no engine terms or band names in any
// string Home shows).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import { momentAt } from '../src/core/clock.ts';
import { dueToday } from '../src/core/nudges.ts';
import { buildFood, buildHome, buildProgress, buildSession, buildToday, coachStepsOf, trainingToday, yourDay, type Home, type HomeInputs } from '../src/report/index.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const PLAN = 'v/3-Personal/Fitness/plan-data.json';

function home(date: string, edit: (f: Record<string, string>) => void = () => {}, opts: { due?: boolean; coach?: HomeInputs['coach'] } = {}): Home {
  const files = fixtureFiles('v');
  edit(files);
  const io = memoryIo(files, date);
  const read = readVault(io, 'v', { asOf: date });
  const tr = readTracking(io, 'v');
  const today = buildToday(read, date, 'full', 'v');
  const session = buildSession(read.data, date, 'full');
  const due = opts.due === false ? null : dueToday({ now: momentAt(date, '12:15', 0), tracking: tr.tracking, nudges: tr.nudges, body: tr.body, photoFolders: tr.photoFolders, habits: tr.habits, program: read.data.program, training: trainingToday(read.data, date), coach: coachStepsOf(read, date, null).now?.value ?? null }).value;
  const food = buildFood(read, tr, date);
  const day = yourDay(today, { session, due, food, items: tr.tracking?.items ?? [] })?.value ?? null;
  return buildHome({ read, today, session, progress: buildProgress(read, date, 'v'), due, food, day, items: tr.tracking?.items ?? [], ...(opts.coach !== undefined ? { coach: opts.coach } : {}) });
}

/** The coach in the vault against the one Pahlavan carries, for Home's need. */
const OLDER = { direction: 'coach-older', installed: '0.26.0', bundled: '0.27.0' } as const;
const NEWER = { direction: 'coach-newer', installed: '0.28.0', bundled: '0.27.0' } as const;

/** Every string in Home, at any depth. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

describe('Home on a planned day (Fri 10 Apr)', () => {
  const h = home('2026-04-10');

  it('leads with the session, its length and that it is next in the plan', () => {
    assert.deepEqual([h.hero?.kicker, h.hero?.title, h.hero?.sub, h.hero?.state], ['Today · Friday 10 April', 'Full Body B', 'About 60 minutes · 4 exercises · next in your plan', 'planned']);
    assert.equal(h.hero?.ringLine, 'Today’s session finishes the week');
  });

  it('says what readiness changes in plain words, then the swap', () => {
    assert.deepEqual(h.hero?.notes.map((n) => [n.icon, n.lead, n.text]), [
      ['pulse', 'Go a little easier today.', 'Your morning check-in was a bit low, so no record attempts.'],
      ['swap', 'One swap:', 'Single-leg dumbbell RDL instead of Romanian Deadlift.'],
    ]);
  });

  it('lists three things that need the user, most pressing first, and counts the rest', () => {
    assert.deepEqual(h.needs.items.map((n) => [n.id, n.title, n.go]), [
      ['coach', 'Check-in for Sun 5 Apr not saved', 'checkin'],
      ['sunday', 'Weekly check-in on Sunday', 'checkin'],
      ['body-tape', 'Tape measurements due', 'progress-body'],
    ]);
    assert.equal(h.needs.more, 1, 'the unit flag is the fourth');
    assert.deepEqual(h.needs.rest.map((n) => [n.tone, n.go]), [['warn', 'progress-training']]);
    assert.equal(h.needs.items.find((n) => n.id === 'sunday')?.line, 'About 10 minutes. It sets next week’s weights.');
  });

  it('shows the protein target and the habits with the next card', () => {
    assert.deepEqual(h.food, { protein: { grams: 134, line: 'Today’s target.' }, habits: { done: 1, total: 7, line: 'Next: water at 13:02' } });
  });

  it('guides to every other tab: what each is for and where it stands, a dot where something waits', () => {
    assert.deepEqual(h.tabs.map((x) => [x.id, x.label, x.does, x.now, x.tone]), [
      ['today', 'Today', 'Your workout and what’s left today', 'Full Body B · 1 of 7 habits done', null],
      ['progress', 'Progress', 'Strength, weight and body over time', 'One entry to check', 'warn'],
      ['plan', 'Plan', 'Your 24 weeks, each phase, and why', 'Week 6 of 24 · light week in 2 weeks', null],
      ['checkin', 'Check-in', 'Sunday’s questions and the coach’s letter', 'Sun 5 Apr not saved yet', 'due'],
      ['food', 'Food', 'Your eating plan and protein', '134 g protein a day', null],
    ]);
  });

  it('sums progress up in a sentence and three tiles', () => {
    assert.equal(h.progress?.since, '2026-02-23');
    assert.equal(h.progress?.lead, 'You’re getting stronger and your weight is slowly coming down.');
    assert.equal(h.progress?.after, 'One lift has stopped moving; Sunday’s check-in will look at it.');
    const [s, w, c] = h.progress!.tiles;
    assert.deepEqual([s!.big, s!.line], [{ value: '2 of 3', unit: 'lifts up' }, 'Flat DB Bench Press has stopped going up.']);
    assert.ok(s!.spark.length >= 2);
    assert.deepEqual([w!.big, w!.line], [{ value: '83.8', unit: 'kg' }, 'Down about 0.2 kg a week.']);
    assert.ok(w!.spark.length >= 2 && w!.spark.length <= 24, 'thinned to 24 points at most');
    assert.deepEqual([c!.big, c!.line, c!.spark.length], [{ value: '92', unit: '%' }, '11 of 12 lifting days done this cycle.', 4]);
  });
});

describe('Home on other days', () => {
  it('shows a session logged today with no notes, and the week left', () => {
    const h = home('2026-04-08');
    assert.deepEqual([h.hero?.title, h.hero?.sub, h.hero?.state, h.hero?.notes.length, h.hero?.ringLine], ['Full Body A', 'Logged today · 60 minutes', 'logged', 0, '1 more this week']);
    assert.deepEqual(h.needs.items.map((n) => n.id).at(-1), 'units-seated-cable-row');
    assert.equal(h.needs.items.at(-1)?.title, 'Seated Cable Row: 50 or 115?');
    assert.equal(h.needs.items.at(-1)?.go, 'progress-training');
    assert.equal(h.food?.protein?.line, 'Today’s target, ticked.');
  });

  it('on Sunday asks for the morning check-in first and calls the weekly check-in today; a low day before today’s check-in names the day it read', () => {
    const h = home('2026-04-12');
    assert.deepEqual(h.needs.items.map((n) => n.title).slice(0, 2), ['Morning check-in', 'Weekly check-in today']);
    assert.equal(h.needs.items[0]?.go, 'morning');
    assert.equal(h.hero?.ringLine, 'Week done');
    assert.equal(h.hero?.notes[0]?.lead, 'Take it easy today.');
    assert.match(h.hero?.notes[0]?.text ?? '', /^Your last morning check-in, Sat 11 Apr, was low: no hard training/);
    const tab = (id: string) => h.tabs.find((x) => x.id === id);
    assert.deepEqual([tab('today')?.now, tab('today')?.tone], ['Morning check-in open', 'due']);
  });

  it('a sick day ("I’m ill today") says so on Home, not that the check-in was low', () => {
    const ill = (day: string) => (f: Record<string, string>) => {
      const p = Object.keys(f).find((k) => k.endsWith('body-data.json'))!;
      const b = JSON.parse(f[p]!);
      b.days[day] = { ...b.days[day], illness: true };
      f[p] = JSON.stringify(b);
    };
    const h = home('2026-04-12', ill('2026-04-12'));
    assert.equal(h.hero?.notes[0]?.lead, 'Take it easy today.');
    assert.equal(h.hero?.notes[0]?.text, 'You said you’re ill today: no hard training, an easy walk or mobility at most.');
    // Before today's check-in, the latest one stands, and the line names its day.
    assert.equal(home('2026-04-12', ill('2026-04-11')).hero?.notes[0]?.text, 'You said you were ill on Sat 11 Apr: no hard training, an easy walk or mobility at most.');
  });

  it('without the reminders, the morning check-in comes from Your day and the habits part is left out', () => {
    const h = home('2026-04-12', () => {}, { due: false });
    assert.equal(h.needs.items[0]?.id, 'morning');
    assert.equal(h.food?.habits, null);
  });

  it('early in a cycle, before any trend, says how many lifting days are done; with none done, the plain wait line', () => {
    const early = home('2026-04-07', (f) => {
      for (const n of Object.keys(f)) if (/Baseline - /.test(n)) delete f[n];
      f['v/3-Personal/Fitness/Baseline - 2026-03-30.md'] = '# Baseline\n';
    });
    assert.deepEqual([early.progress?.lead, early.progress?.after], ['Early days: 3 of 3 lifting days done so far.', 'The trends show after a few more sessions and weigh-ins.']);
    assert.equal(home('2026-03-05').progress?.lead, 'Your progress shows here after a few logged sessions and weigh-ins.');
  });

  it('the coach and Pahlavan on different versions: update the coach, or update Pahlavan, from the settings', () => {
    const all = (h: Home) => [...h.needs.items, ...h.needs.rest];
    const older = all(home('2026-04-10', () => {}, { coach: OLDER })).find((n) => n.id === 'coach-version');
    assert.deepEqual(older, { id: 'coach-version', icon: 'sync', tone: 'due', title: 'Update the coach', line: 'This Pahlavan carries a newer coach (0.27.0) than the one in this vault (0.26.0). Update it in Pahlavan’s settings, Coach.', go: 'settings' });
    const newer = all(home('2026-04-10', () => {}, { coach: NEWER })).find((n) => n.id === 'coach-version');
    assert.deepEqual(newer, { id: 'coach-version', icon: 'alert', tone: 'warn', title: 'Update Pahlavan', line: 'The coach in this vault (0.28.0) is newer than this Pahlavan’s (0.27.0). Update Pahlavan from Community plugins.', go: 'settings' });
    // After the day's own needs, which keep their order.
    const busy = home('2026-04-10', () => {}, { coach: NEWER });
    assert.deepEqual(all(busy).map((n) => n.id), [...all(home('2026-04-10')).map((n) => n.id), 'coach-version']);
    assert.equal(busy.needs.more, 2);
    // The same version, not set up (the welcome card's step), or not known yet: nothing.
    for (const coach of [{ direction: 'same', installed: '0.27.0', bundled: '0.27.0' } as const, { direction: 'not-set-up', installed: null, bundled: '0.27.0' } as const, null, undefined]) {
      assert.equal(all(home('2026-04-10', () => {}, { coach })).some((n) => n.id === 'coach-version'), false, JSON.stringify(coach));
    }
  });

  it('without a plan has no banner, food or progress (the view shows the welcome)', () => {
    const h = home('2026-04-10', (f) => delete f[PLAN]);
    assert.deepEqual([h.hero, h.food, h.progress, h.tabs], [null, null, null, []]);
  });
});

describe('Home’s words', () => {
  // The engine's terms and the readiness bands' names stay on the tabs with the detail.
  const BANNED = /e1RM|\bRIR\b|[Mm]esocycle|\b(Watch|Low|Normal)\b|[Ll]egend|—/;

  it('never use an engine term, a band name or a long dash, on any fixture day', () => {
    for (const d of ['2026-03-02', '2026-04-05', '2026-04-06', '2026-04-07', '2026-04-08', '2026-04-10', '2026-04-11', '2026-04-12']) {
      for (const due of [true, false]) {
        const bad = strings(home(d, () => {}, { due })).filter((s) => BANNED.test(s));
        assert.deepEqual(bad, [], `${d}${due ? '' : ' without the reminders'}`);
      }
    }
    // The coach's version in plain words: no engine, no file names.
    for (const coach of [OLDER, NEWER]) {
      const h = home('2026-04-10', () => {}, { coach });
      assert.deepEqual(strings(h).filter((s) => BANNED.test(s)), [], coach.direction);
      const need = [...h.needs.items, ...h.needs.rest].find((n) => n.id === 'coach-version')!;
      assert.deepEqual([need.title, need.line].filter((s) => /\bengine\b|VERSION|\.cjs|SKILL/i.test(s)), [], coach.direction);
    }
  });
});
