// The reminder machinery end to end on an in-memory copy of the synthetic
// vault, with a fake Mac (clock, idle seconds, focus), a fake card UI and a
// fake obsidian-git: the tick's gating, the queue order, snooze, skip and
// close, an answer the other Mac gave (the same: quiet; another: kept),
// pull before showing and sync after saving, the notification, what each
// card's Save writes, the stand-up round, a desk break ending the sitting
// stretch, "Standing now", the cards opened by hand, and "Ask the coach"
// (the step after a saved Sunday check-in while no letter is in).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixedOffsetClock, momentAt } from '../../src/core/clock.ts';
import { habitCheckinKey } from '../../src/core/tracking.ts';
import { CheckinWriter } from '../src/checkin-writer.ts';
import type { CardView } from '../src/reminders/card-model.ts';
import { ACTIVITY_UNAVAILABLE, CHAIN_MS, IDLE_FAILS_OFF, Reminders, type CardActions, type CardAnswer } from '../src/reminders/machine.ts';
import { GitSync, SYNC_DELAY_MS } from '../src/reminders/sync.ts';
import { defaultPluginData, type PluginData, type Section } from '../src/settings.ts';
import { memVault, type MemVault } from './mem-vault.ts';

const COACH = '3-Personal/Fitness/Coach';
const NUDGES = `${COACH}/nudges.json`;
const TRACKING = `${COACH}/tracking.json`;
const SITTING = `${COACH}/sitting.json`;
const BODY = '3-Personal/Fitness/body-data.json';
const HABITS = '5-System/Data/habits-data.json';
const MIN = 60_000;

interface Rec {
  view: CardView;
  actions: CardActions;
  closed: boolean;
  msgs: string[];
  dirty: boolean;
  userClose(): void;
  answer(a: CardAnswer): Promise<void>;
}

function harness(o: { date?: string; at?: string; mutate?: (v: MemVault) => void; settings?: (d: PluginData) => void; idle?: number | null; focused?: boolean; remindHere?: boolean; git?: Record<string, unknown> | null } = {}) {
  const v = memVault();
  o.mutate?.(v);
  const clock = fixedOffsetClock(0);
  const s = {
    now: momentAt(o.date ?? '2026-04-10', o.at ?? '20:05', 0).ms,
    idle: (o.idle === undefined ? 3 : o.idle) as number | null,
    focused: o.focused ?? true,
    remindHere: o.remindHere ?? true,
  };
  const data = defaultPluginData({ gitSynced: true });
  o.settings?.(data);
  const cards: Rec[] = [];
  const notices: string[] = [];
  const mac: { title: string; body: string }[] = [];
  const timers: { fn: () => void; ms: number; id: number; gone: boolean }[] = [];
  const sections: Section[] = [];
  const logs: number[] = [];
  const copied: string[] = [];
  const device = new Map<string, string>();
  const setTimeout = (fn: () => void, ms: number) => {
    const t = { fn, ms, id: timers.length + 1, gone: false };
    timers.push(t);
    return t.id;
  };
  const clearTimeout = (id: number) => {
    const t = timers.find((x) => x.id === id);
    if (t) t.gone = true;
  };
  const git = new GitSync({ git: () => (o.git === undefined ? null : o.git), settings: () => data.sync, now: () => s.now, setTimeout, clearTimeout });
  const r = new Reminders({
    adapter: v.adapter,
    now: () => s.now,
    moment: (ms) => ({ date: clock.dayOf(ms), minutes: (ms - clock.dayStart(ms)) / MIN, ms }),
    clock,
    settings: () => data,
    remindHere: () => s.remindHere,
    mac: () => 'Home Mac',
    device: { get: (k) => device.get(k) ?? null, set: (k, val) => void device.set(k, val) },
    idleSeconds: async () => s.idle,
    focused: () => s.focused,
    visible: () => true,
    otherCardOpen: () => false,
    ui: {
      open(view, actions) {
        const rec: Rec = {
          view, actions, closed: false, msgs: [], dirty: false,
          userClose: () => {
            if (rec.closed) return;
            rec.closed = true;
            actions.closed();
          },
          answer: (a) => actions.answer(a),
        };
        cards.push(rec);
        return {
          update: (nv) => void (rec.view = nv),
          close: () => rec.userClose(),
          message: (t) => void rec.msgs.push(t ?? ''),
          dirty: () => rec.dirty,
          focus: () => {},
        };
      },
    },
    notifyMac: (title, body) => void mac.push({ title, body }),
    notice: (m) => void notices.push(m),
    focusApp: () => {},
    holdFront: () => {},
    chime: () => {},
    convertPhoto: async (p) => ({ data: p.data, ext: 'jpeg' }),
    git,
    checkin: new CheckinWriter(v.adapter),
    openLog: () => void logs.push(s.now),
    openSection: (x) => void sections.push(x),
    copy: async (t) => void copied.push(t),
    setTimeout,
    clearTimeout,
  });
  const open = () => cards.filter((c) => !c.closed);
  /** Steps the 30-second tick for `minutes`, the clock moving with it. */
  const fast = async (minutes: number) => {
    for (let i = 0; i < minutes * 2; i++) {
      s.now += 30_000;
      await r.fastTick();
    }
  };
  return { r, v, s, data, cards, open, notices, mac, timers, sections, logs, device, fast, copied };
}

const nudge = (v: MemVault, date: string, key: string) => v.json(NUDGES).days?.[date]?.[key];
const setNudge = (v: MemVault, date: string, key: string, e: Record<string, unknown>) => {
  const doc = v.json(NUDGES);
  (doc.days[date] ??= {})[key] = e;
  v.files.set(NUDGES, JSON.stringify(doc, null, 2));
};

describe('the minute tick’s gating', () => {
  it('shows nothing with reminders off, on a Mac turned off, in quiet hours or while the Mac is idle', async () => {
    assert.equal(await harness({ settings: (d) => void (d.reminders.on = false) }).r.tick(), 'off');
    assert.equal(await harness({ remindHere: false }).r.tick(), 'not-here');
    assert.equal(await harness({ at: '23:10' }).r.tick(), 'quiet');
    const idle = harness({ idle: 400 });
    assert.equal(await idle.r.tick(), 'idle');
    assert.equal(idle.cards.length, 0);
  });

  it('a card asked for by hand skips the idle wait', async () => {
    const h = harness({ idle: 4000 });
    assert.equal(await h.r.showQueue(), true);
    assert.equal(h.cards.length, 1);
  });

  it('one card at a time: a tick while one is open shows nothing more', async () => {
    const h = harness();
    assert.equal(await h.r.tick(), 'shown');
    assert.equal(await h.r.tick(), 'open');
    assert.equal(h.cards.length, 1);
  });

  it('nothing due: says so, by hand', async () => {
    // The shake after the session is due all day once a session is logged: take it first.
    const h = harness({ at: '05:30', settings: (d) => void (d.reminders.quiet.on = false), mutate: (v) => {
      const t = v.json(TRACKING);
      t.days['2026-04-10'].shake = { done: true };
      v.files.set(TRACKING, JSON.stringify(t));
    } });
    assert.equal(await h.r.tick(), 'none');
    await h.r.showQueue();
    assert.match(h.notices.at(-1)!, /nothing is due right now/);
  });
});

describe('the queue', () => {
  it('opens the card for the earliest set time first, then chains to the next after an answer', async () => {
    const h = harness();
    await h.r.tick();
    // At 20:05 the tape (its own card, since 07:30), the 20:00 habits, after the session, water and a desk break are due.
    assert.equal(h.cards[0]!.view.key, 'tape');
    await h.cards[0]!.answer({ do: 'later' });
    assert.equal(nudge(h.v, '2026-04-10', 'tape').how, 'later');
    const chain = h.timers.find((t) => t.ms === CHAIN_MS && !t.gone)!;
    assert.ok(chain, 'the next card is looked for 3 s after a card closes');
    h.s.now += CHAIN_MS;
    chain.fn();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(h.cards[1]?.view.key, 'slot:20:00');
  });
});

describe('snooze, skip and close', () => {
  it('Snooze writes when the card comes back, and it stays away on both Macs until then', async () => {
    const h = harness();
    await h.r.tick();
    await h.cards[0]!.answer({ do: 'snooze', choice: 60 });
    assert.equal(nudge(h.v, '2026-04-10', 'tape').snoozedUntil, new Date(h.s.now + 60 * MIN).toISOString());
    h.s.now += 59 * MIN;
    await h.r.tick();
    assert.notEqual(h.cards[1]?.view.key, 'tape');
  });

  it('closing the card is the default snooze; Skip today ends it for the day', async () => {
    const h = harness({ settings: (d) => void (d.reminders.snoozeMinutes = 10) });
    await h.r.tick();
    const t0 = h.s.now;
    h.cards[0]!.userClose();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(nudge(h.v, '2026-04-10', 'tape').snoozedUntil, new Date(t0 + 10 * MIN).toISOString());
    h.s.now += 11 * MIN;
    await h.r.tick();
    assert.equal(h.cards[1]!.view.key, 'tape', 'back after the snooze');
    await h.cards[1]!.answer({ do: 'later' });
    h.s.now += 60 * MIN;
    await h.r.tick();
    assert.notEqual(h.cards[2]?.view.key, 'tape');
  });

  it('Skip this photo day skips the occurrence until the next one', async () => {
    const h = harness({ date: '2026-04-26', at: '08:00', mutate: (v) => {
      const b = v.json(BODY);
      b.days['2026-04-26'] = { checkedAt: '2026-04-26T07:10:00.000Z' };
      v.files.set(BODY, JSON.stringify(b));
    } });
    assert.equal(await h.r.tick(), 'shown');
    assert.equal(h.cards[0]!.view.key, 'tape', 'the tape on its own comes first (a set time)');
    await h.cards[0]!.answer({ do: 'later' });
    await h.r.openKey('photos');
    const photo = h.cards.find((c) => c.view.kind === 'photos')!;
    assert.ok(photo, 'photo day is due once the morning is in');
    assert.match(photo.view.skipPeriod!.label, /Skip this photo day/);
    await photo.answer({ do: 'skip-period' });
    assert.ok(h.v.json(NUDGES).skipped['photos:2026-04-26']);
  });

  it('on the morning card, Skip this tape day drops only the tape: the card stays without it', async () => {
    const h = harness({ date: '2026-04-12', at: '07:35' });
    await h.r.tick();
    const c = h.cards[0]!;
    assert.equal(c.view.kind, 'morning');
    assert.ok(c.view.body.kind === 'morning' && c.view.body.tape);
    await c.answer({ do: 'skip-period' });
    assert.equal(c.closed, false);
    assert.ok(c.view.body.kind === 'morning' && c.view.body.tape === null);
    assert.ok(h.v.json(NUDGES).skipped['tape:2026-04-12']);
    assert.equal(nudge(h.v, '2026-04-12', 'morning'), undefined, 'the morning itself is still open');
  });
});

describe('across Macs', () => {
  it('the other Mac answered the same way while the card was open here: quiet, the card goes', async () => {
    const h = harness();
    await h.r.tick();
    setNudge(h.v, '2026-04-10', 'tape', { how: 'later', at: '2026-04-10T20:06:00.000Z', by: 'Work Mac' });
    await h.cards[0]!.answer({ do: 'later' });
    assert.equal(h.cards[0]!.closed, true);
    assert.deepEqual(h.notices, []);
    assert.equal(nudge(h.v, '2026-04-10', 'tape').by, 'Work Mac');
  });

  it('another answer from the other Mac stays, and says so', async () => {
    const h = harness();
    await h.r.tick();
    setNudge(h.v, '2026-04-10', 'tape', { how: 'skipped', at: '2026-04-10T20:06:00.000Z', by: 'Work Mac' });
    await h.cards[0]!.answer({ do: 'later' });
    assert.equal(nudge(h.v, '2026-04-10', 'tape').how, 'skipped');
    assert.match(h.notices.at(-1)!, /already answered on the other Mac/);
  });

  it('a card answered on the other Mac (pulled in while it is open, untouched here) closes on the next tick', async () => {
    const h = harness();
    await h.r.tick();
    setNudge(h.v, '2026-04-10', 'tape', { how: 'done', at: '2026-04-10T20:06:00.000Z', by: 'Work Mac' });
    await h.r.tick();
    assert.equal(h.cards[0]!.closed, true);
    assert.match(h.notices.at(-1)!, /answered on Work Mac/);
    assert.equal(nudge(h.v, '2026-04-10', 'tape').how, 'done', 'closing it wrote no snooze over the answer');
  });

  it('pulls before showing, so a card the other Mac answered never shows here', async () => {
    let pulls = 0;
    const v0: { v?: MemVault } = {};
    const git = {
      promiseQueue: { addTask: (fn: () => Promise<unknown>, done: () => void) => void fn().then(done) },
      pullChangesFromRemote: async () => {
        pulls++;
        setNudge(v0.v!, '2026-04-10', 'tape', { how: 'done', at: '2026-04-10T19:00:00.000Z', by: 'Work Mac' });
      },
      commitAndSync: async () => {},
    };
    const h = harness({ git });
    v0.v = h.v;
    await h.r.tick();
    assert.equal(pulls, 1);
    assert.equal(h.cards[0]!.view.key, 'slot:20:00');
  });

  it('commits and syncs a minute after an answer, with Sync after saving on; never without obsidian-git', async () => {
    let synced = 0;
    const git = { promiseQueue: { addTask: (fn: () => Promise<unknown>, done: () => void) => void fn().then(done) }, pullChangesFromRemote: async () => {}, commitAndSync: async () => void synced++ };
    const h = harness({ git });
    await h.r.tick();
    await h.cards[0]!.answer({ do: 'later' });
    const t = h.timers.find((x) => x.ms === SYNC_DELAY_MS && !x.gone)!;
    assert.ok(t);
    t.fn();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(synced, 1);
    const off = harness({ git, settings: (d) => void (d.sync.syncAfter = false) });
    await off.r.tick();
    await off.cards[0]!.answer({ do: 'later' });
    assert.ok(!off.timers.some((x) => x.ms === SYNC_DELAY_MS));
    const none = harness();
    await none.r.tick();
    await none.cards[0]!.answer({ do: 'later' });
    assert.ok(!none.timers.some((x) => x.ms === SYNC_DELAY_MS));
  });
});

describe('an open card the data or the day answers', () => {
  const LOG = '3-Personal/Fitness/fitness-log-data.json';
  // Thu 9 Apr with a session planned, nothing logged and the Workout habit not ticked; the tape and the 20:00 habits answered.
  const untrained = (v: MemVault) => {
    const hb = v.json(HABITS);
    delete hb.checkins[habitCheckinKey('workout', '2026-04-09')];
    v.files.set(HABITS, JSON.stringify(hb));
    const n = v.json(NUDGES);
    n.days['2026-04-09'] = { tape: { how: 'later', at: '2026-04-09T08:00:00.000Z' }, 'slot:20:00': { how: 'done', at: '2026-04-09T20:00:00.000Z' } };
    v.files.set(NUDGES, JSON.stringify(n));
  };

  it('"Did you train today?" left open closes once the day has a session logged (by the coach, say), with no snooze', async () => {
    const h = harness({ date: '2026-04-09', at: '20:05', mutate: untrained });
    await h.r.tick();
    const c = h.cards.at(-1)!;
    assert.equal(c.view.kind, 'train');
    h.s.now += MIN;
    await h.r.tick();
    assert.equal(c.closed, false, 'nothing changed: it stays');
    const log = h.v.json(LOG);
    log.sessions.push({ date: '2026-04-09', type: 'S1', lift1: null, lift2: null, durationMin: 50, cardioMin: 30 });
    h.v.files.set(LOG, JSON.stringify(log));
    h.s.now += MIN;
    await h.r.tick();
    assert.equal(c.closed, true);
    assert.match(h.notices.at(-1)!, /Did you train today\? closed: Thu 9 Apr has a session logged/);
    assert.equal(nudge(h.v, '2026-04-09', 'train'), undefined, 'closing it wrote no snooze');
  });

  it('one left open in the evening closes at midnight, inside the quiet hours, with no snooze', async () => {
    const h = harness({ date: '2026-04-09', at: '20:05', mutate: untrained });
    await h.r.tick();
    const c = h.cards.at(-1)!;
    assert.equal(c.view.kind, 'train');
    h.s.now = momentAt('2026-04-09', '23:30', 0).ms;
    assert.equal(await h.r.tick(), 'quiet');
    assert.equal(c.closed, false, 'still Thursday: it stays');
    h.s.now = momentAt('2026-04-10', '00:01', 0).ms;
    assert.equal(await h.r.tick(), 'quiet');
    assert.equal(c.closed, true);
    assert.match(h.notices.at(-1)!, /Did you train today\? for Thu 9 Apr closed: that day is over/);
    assert.equal(nudge(h.v, '2026-04-09', 'train'), undefined);
  });

  it('the habits card closes once its items are ticked elsewhere (the homepage, the phone)', async () => {
    const h = harness();
    await h.r.tick();
    await h.cards.at(-1)!.answer({ do: 'later' });
    await h.r.tick();
    const c = h.cards.at(-1)!;
    assert.equal(c.view.key, 'slot:20:00');
    const hb = h.v.json(HABITS);
    hb.checkins[habitCheckinKey('protein', '2026-04-10')] = '1';
    h.v.files.set(HABITS, JSON.stringify(hb));
    h.s.now += MIN;
    await h.r.tick();
    assert.equal(c.closed, true);
    assert.match(h.notices.at(-1)!, /closed: everything on it is ticked/);
    assert.equal(nudge(h.v, '2026-04-10', 'slot:20:00'), undefined);
  });

  it('a card with something typed or ticked on it stays, whatever the data says', async () => {
    const h = harness({ date: '2026-04-09', at: '20:05', mutate: untrained });
    await h.r.tick();
    const c = h.cards.at(-1)!;
    c.dirty = true;
    h.s.now = momentAt('2026-04-10', '00:01', 0).ms;
    await h.r.tick();
    assert.equal(c.closed, false);
  });
});

describe('notifications', () => {
  it('go with a card only when Obsidian is not in front, with the card’s own text', async () => {
    const away = harness({ focused: false });
    await away.r.tick();
    assert.deepEqual(away.mac, [{ title: 'Tape day', body: 'Waist, hips, chest and arm' }]);
    const here = harness({ focused: true });
    await here.r.tick();
    assert.deepEqual(here.mac, []);
    const off = harness({ focused: false, settings: (d) => void (d.reminders.notifications = false) });
    await off.r.tick();
    assert.deepEqual(off.mac, []);
  });
});

describe('what Save writes', () => {
  const later = async (h: ReturnType<typeof harness>) => {
    await h.r.tick();
    await h.cards.at(-1)!.answer({ do: 'later' });
  };

  it('the habits card: each tick in tracking.json and its linked habit, then the slot answered', async () => {
    const h = harness();
    await later(h);
    await h.r.openKey('slot:20:00');
    const c = h.cards.at(-1)!;
    assert.equal(c.view.kind, 'habits');
    await c.answer({ do: 'save', payload: { kind: 'habits', ticks: { protein: true } } });
    assert.equal(h.v.json(TRACKING).days['2026-04-10'].protein.done, true);
    assert.equal(h.v.json(HABITS).checkins[habitCheckinKey('protein', '2026-04-10')], '1');
    assert.equal(nudge(h.v, '2026-04-10', 'slot:20:00').how, 'done');
    assert.equal(nudge(h.v, '2026-04-10', 'slot:20:00').by, 'Home Mac');
  });

  it('water: the amount added here and on the homepage, the clock moved', async () => {
    const h = harness();
    await h.r.openKey('amount:water');
    const c = h.cards.at(-1)!;
    assert.equal(c.view.title, '1,250 / 2,500 mL');
    await c.answer({ do: 'save', payload: { kind: 'amount', add: 500 } });
    assert.equal(h.v.json(TRACKING).days['2026-04-10'].water.amount, 1750);
    assert.equal(nudge(h.v, '2026-04-10', 'amount:water').lastAt, new Date(h.s.now).toISOString());
    assert.equal(nudge(h.v, '2026-04-10', 'amount:water').how, undefined, 'Done on a repeating card only moves its clock');
  });

  it('a desk break: one more done, the clock moved, and the sitting stretch ends there (no stand-up minutes)', async () => {
    const h = harness({ at: '13:00' });
    await h.fast(20);
    const live = h.r.sittingNow()!.current!;
    assert.ok(live.minutes >= 19);
    const standBefore = JSON.stringify(h.v.json(TRACKING).days['2026-04-10']['stand-ups']);
    await h.r.openKey('desk:desk-breaks');
    const c = h.cards.find((x) => x.view.kind === 'desk')!;
    await c.answer({ do: 'save', payload: { kind: 'desk' } });
    assert.equal(h.v.json(TRACKING).days['2026-04-10']['desk-breaks'].count, 3);
    assert.equal(h.r.sittingNow()!.current, null, 'you got up: the stretch is closed');
    const mine = h.v.json(SITTING).days['2026-04-10']['Home Mac'];
    const last = mine.at(-1);
    assert.equal(last.start, new Date(live.start).toISOString(), 'the stretch counted here, written in full');
    assert.ok(Date.parse(last.end) - Date.parse(last.start) >= 19 * MIN);
    assert.equal(mine.length, 2, 'the fixture’s earlier stretch on this Mac stays');
    assert.equal(JSON.stringify(h.v.json(TRACKING).days['2026-04-10']['stand-ups']), standBefore);
  });

  it('the morning card: only the changed fields, filed by the morning writer, then answered', async () => {
    const h = harness({ date: '2026-04-12', at: '07:35' });
    await h.r.tick();
    const c = h.cards[0]!;
    await c.answer({ do: 'save', payload: { kind: 'morning', values: { energy: 4, sleepH: 7.33, steps: 10250 }, baseline: { energy: null, sleepH: null, steps: null }, tape: { waist: 93.1 }, tapeBaseline: { waist: null } } });
    const b = h.v.json(BODY);
    assert.deepEqual({ e: b.days['2026-04-12'].energy, s: b.days['2026-04-12'].sleepH, steps: b.days['2026-04-11'].steps }, { e: 4, s: 7.33, steps: 10250 });
    assert.equal(typeof b.days['2026-04-12'].checkedAt, 'string');
    assert.deepEqual(b.tape.at(-1), { date: '2026-04-12', waist: 93.1 });
    assert.equal(nudge(h.v, '2026-04-12', 'morning').how, 'done');
  });

  it('the morning card’s quick sore pick: the areas’ muscles go into the body log with the morning', async () => {
    const h = harness({ date: '2026-04-12', at: '07:35' });
    await h.r.tick();
    const c = h.cards[0]!;
    await c.answer({ do: 'save', payload: { kind: 'morning', values: {}, baseline: {}, sore: { quads: 'sore', hamstrings: 'mild' } } });
    const day = h.v.json(BODY).days['2026-04-12'];
    assert.deepEqual(day.soreMuscles, { quads: 'sore', hamstrings: 'mild' });
    assert.equal(typeof day.checkedAt, 'string', 'a sore pick alone is a check-in too');
    assert.equal(nudge(h.v, '2026-04-12', 'morning').how, 'done');
  });

  it('the morning card’s "I’m ill today" and HRV go into the body log, and the day reads as ill', async () => {
    const h = harness({ date: '2026-04-12', at: '07:35' });
    await h.r.tick();
    const c = h.cards[0]!;
    await c.answer({ do: 'save', payload: { kind: 'morning', values: { hrv: 51 }, baseline: { hrv: null }, illness: true } });
    const day = h.v.json(BODY).days['2026-04-12'];
    assert.deepEqual([day.illness, day.hrv, typeof day.checkedAt], [true, 51, 'string']);
    assert.equal(nudge(h.v, '2026-04-12', 'morning').how, 'done');
  });

  it('a save that fails keeps the card open with the reason', async () => {
    const h = harness();
    await h.r.openKey('amount:water');
    h.v.files.set(TRACKING, '{ not json');
    const c = h.cards.at(-1)!;
    await c.answer({ do: 'save', payload: { kind: 'amount', add: 250 } });
    assert.equal(c.closed, false);
    assert.match(c.msgs.at(-1)!, /not valid JSON/);
  });

  it('"Did you train today?": Rest day marks the day; Log session opens the log', async () => {
    const mutate = (v: MemVault) => {
      const hb = v.json(HABITS);
      delete hb.checkins[habitCheckinKey('workout', '2026-04-09')];
      v.files.set(HABITS, JSON.stringify(hb));
      const n = v.json(NUDGES);
      delete n.days['2026-04-09'];
      n.days['2026-04-09'] = { tape: { how: 'later', at: '2026-04-09T08:00:00.000Z' }, 'slot:20:00': { how: 'done', at: '2026-04-09T20:00:00.000Z' } };
      v.files.set(NUDGES, JSON.stringify(n));
    };
    const h = harness({ date: '2026-04-09', at: '20:05', mutate });
    await h.r.openKey('train');
    const c = h.cards.at(-1)!;
    assert.equal(c.view.kind, 'train');
    await c.answer({ do: 'train', choice: 'rest' });
    assert.equal(h.v.json(BODY).days['2026-04-09'].mark, 'rest');
    assert.equal(nudge(h.v, '2026-04-09', 'train').how, 'rest');
    const h2 = harness({ date: '2026-04-09', at: '20:05', mutate });
    await h2.r.openKey('train');
    await h2.cards.at(-1)!.answer({ do: 'train', choice: 'logged' });
    assert.equal(h2.logs.length, 1);
    assert.equal(nudge(h2.v, '2026-04-09', 'train').how, 'logged');
  });
});

describe('the stand-up', () => {
  it('comes up after the sitting minutes, can’t be closed, and a finished stand logs its minutes and count', async () => {
    const h = harness({ at: '12:00' });
    await h.fast(31);
    const c = h.open().find((x) => x.view.kind === 'standup')!;
    assert.ok(c, 'the stand-up card is up');
    assert.equal(c.view.closable, false);
    assert.equal(c.view.skip, null);
    await c.answer({ do: 'stand' });
    assert.equal(c.closed, false);
    assert.ok(c.view.body.kind === 'standup' && c.view.body.standing);
    const before = h.v.json(TRACKING).days['2026-04-10']['stand-ups'];
    await h.fast(21);
    const after = h.v.json(TRACKING).days['2026-04-10']['stand-ups'];
    assert.deepEqual({ minutes: after.minutes, count: after.count }, { minutes: before.minutes + 20, count: before.count + 1 });
    assert.equal(after.deskMinutes, undefined, 'a stand the card asked for is not a desk stand');
    assert.equal(c.closed, true);
    assert.match(h.notices.join(' '), /stand done, 20 minutes logged/);
  });

  it('its snooze is the round’s one, in this Mac’s count (not in nudges.json)', async () => {
    const h = harness({ at: '12:00' });
    await h.fast(31);
    const c = h.open().find((x) => x.view.kind === 'standup')!;
    await c.answer({ do: 'snooze', choice: 5 });
    assert.equal(nudge(h.v, '2026-04-10', 'standup:stand-ups'), undefined);
    await h.fast(6);
    const again = h.open().find((x) => x.view.kind === 'standup')!;
    assert.ok(again, 'back after the snooze');
    assert.equal(again.view.snooze, null, 'one snooze per round');
  });

  it('"Standing now" logs desk stands quietly, starts the stand-up round over and stops the sitting count; it is kept per Mac', async () => {
    const h = harness({ at: '12:00' });
    await h.fast(5);
    assert.ok(h.r.sittingNow()!.current);
    const before = h.v.json(TRACKING).days?.['2026-04-10']?.['stand-ups'] ?? {};
    const macs = h.mac.length;
    h.r.setStandingNow(true);
    assert.ok(h.device.get('pahlavan-standing-now'));
    await h.fast(40);
    assert.equal(h.r.sittingNow()!.current, null);
    assert.ok(!h.open().some((x) => x.view.kind === 'standup'));
    const st = h.r.standStatus()[0]!;
    assert.equal(st.satMinutes, 0, 'a desk stand starts the round over');
    assert.ok(st.deskLeft !== null && st.deskLeft !== undefined, 'the minutes to the next desk stand');
    const after = h.v.json(TRACKING).days['2026-04-10']['stand-ups'];
    assert.ok((after.minutes ?? 0) > (before.minutes ?? 0) && (after.count ?? 0) > (before.count ?? 0), 'the desk stands logged');
    // Each desk stand's minutes go into the day's minutes and its desk minutes alike: the reviews can tell them apart.
    assert.equal((after.deskMinutes ?? 0) - (before.deskMinutes ?? 0), after.minutes - (before.minutes ?? 0), 'every logged minute was at the desk');
    assert.equal((after.deskMinutes ?? 0) % 20, 0, 'whole stands of 20 minutes');
    assert.equal(h.mac.length, macs, 'quietly: no Mac notification');
    h.r.setStandingNow(false);
    assert.equal(h.device.get('pahlavan-standing-now'), '');
    await h.fast(2);
    assert.ok(h.r.sittingNow()!.current, 'sitting counts again');
  });

  it('"Standing now" turns itself off after half an hour away', async () => {
    const h = harness({ at: '12:00' });
    h.r.setStandingNow(true);
    h.s.idle = 31 * 60;
    await h.fast(1);
    assert.equal(h.r.standingNow().on, false);
    assert.match(h.notices.at(-1)!, /Standing now turned off/);
  });
});

describe('cards by hand', () => {
  it('the tests when not due: a card with Cancel; closing writes nothing', async () => {
    const h = harness({ at: '10:00' });
    assert.equal(await h.r.openCard('tests'), true);
    const c = h.cards[0]!;
    assert.equal(c.view.manual, true);
    assert.equal(c.view.snooze, null);
    const before = h.v.files.get(NUDGES);
    c.userClose();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(h.v.files.get(NUDGES), before);
  });

  it('a card opened by hand is not titled as if due: "Tape" with its next due date and no reminder time', async () => {
    // The 29 Mar tape is in, so the next tape day is Sunday 12 April.
    const taped = (v: MemVault) => { const b = JSON.parse(v.files.get(BODY)!); b.tape.push({ date: '2026-03-29', waist: 94.2 }); v.files.set(BODY, JSON.stringify(b)); };
    const h = harness({ at: '10:00', mutate: taped });
    assert.equal(await h.r.openCard('tape'), true);
    const v = h.cards[0]!.view;
    assert.equal(v.manual, true);
    assert.deepEqual([v.kicker, v.title, v.sub], ['Tape', 'Friday 10 April', 'Next due Sun 12 Apr · waist, hips, chest and arm']);
    for (const t of [v.kicker, v.title, v.sub]) assert.doesNotMatch(t, /\d{2}:\d{2}/, 'no reminder time');
    h.cards[0]!.userClose();
    await new Promise((r) => setTimeout(r, 10));
    const t = harness({ at: '10:00' });
    await t.r.openCard('tests');
    assert.match(t.cards[0]!.view.sub, /^(Next due \w{3} \d{1,2} \w{3}|None planned) · leave any you can’t do blank$/);
    const p = harness({ at: '10:00' });
    await p.r.openCard('photos');
    assert.equal(p.cards[0]!.view.kicker, 'Progress photos');
    assert.match(p.cards[0]!.view.sub, /^(Next due \w{3} \d{1,2} \w{3}|None planned) · front, side, back and the posture close-up$/);
  });

  it('a due card opened by hand keeps its title (the morning on a tape day)', async () => {
    const h = harness({ date: '2026-04-12', at: '07:35' });
    assert.equal(await h.r.openCard('tape'), true);
    const v = h.cards[0]!.view;
    assert.equal(v.manual, false);
    assert.deepEqual([v.kicker, v.sub], ['Morning check-in · tape day', '07:30 · the morning numbers, plus the tape']);
  });

  it('Open check-in: the morning card while today’s is not in, else the Check-in screen', async () => {
    const done = harness({ at: '10:00' });
    await done.r.openCheckin();
    assert.deepEqual(done.sections, ['checkin']);
    const open = harness({ date: '2026-04-12', at: '07:35' });
    await open.r.openCheckin();
    assert.equal(open.cards[0]!.view.kind, 'morning');
  });

  it('Due today’s hooks: what is due today, a tick and an amount from a screen', async () => {
    const h = harness({ at: '10:00' });
    const t = await h.r.dueToday();
    assert.equal(t!.value.amounts[0]!.value, 1250);
    assert.equal(await h.r.tickItem('magnesium', true), true);
    assert.equal(h.v.json(TRACKING).days['2026-04-10'].magnesium.done, true);
    assert.equal(await h.r.addAmount('water', 250), true);
    assert.equal(h.v.json(TRACKING).days['2026-04-10'].water.amount, 1500);
    assert.equal(await h.r.tickItem('water', true), false, 'an amount is not ticked');
  });

  it('Due today after a screen reloads: reread reads the files again, the snapshot otherwise', async () => {
    const h = harness({ at: '10:00' });
    await h.r.dueToday();
    // The other Mac adds water; git brings the file over.
    const t = h.v.json(TRACKING);
    t.days['2026-04-10'].water.amount = 2000;
    h.v.files.set(TRACKING, JSON.stringify(t));
    assert.equal((await h.r.dueToday())!.value.amounts[0]!.value, 1250, 'the snapshot, up to 5 minutes old');
    assert.equal((await h.r.dueToday({ reread: true }))!.value.amounts[0]!.value, 2000);
  });
});

describe('a computer that can’t read keyboard and mouse activity', () => {
  it('runs no stand-ups or sitting there, and says why; the clock’s cards still come', async () => {
    const h = harness({ at: '12:00', idle: null });
    const sittingBefore = h.v.files.get(SITTING);
    await h.fast(40);
    assert.deepEqual(h.r.activity(), { readable: false, why: ACTIVITY_UNAVAILABLE });
    assert.ok(!h.cards.some((c) => c.view.kind === 'standup'), 'no stand-up card');
    assert.equal(h.v.files.get(SITTING), sittingBefore, 'nothing counted as sitting');
    assert.equal(h.r.sittingNow(), null);
    assert.deepEqual(h.r.standStatus(), []);
    assert.equal(h.r.standAskNow(), false);
    assert.deepEqual((await h.r.dueToday())!.value.sitting, [], 'Due today has no sitting row to show from here');
    // An unknown reading still counts as "here" for a reminder: the minute tick shows the due card.
    assert.equal(await h.r.tick(), 'shown');
    assert.equal(h.open()[0]!.view.key, 'tape');
    await h.open()[0]!.answer({ do: 'later' });
    assert.equal(await h.r.openKey('desk:desk-breaks'), true, 'desk breaks run on the clock');
  });

  it('a reading that fails now and then on a Mac that reads it keeps the stretch; a few in a row stop the counts', async () => {
    const h = harness({ at: '12:00' });
    await h.fast(5);
    const live = h.r.sittingNow()!.current!;
    assert.ok(live.minutes >= 4);
    assert.equal(h.r.activity().readable, true);
    h.s.idle = null;
    await h.fast(0.5 * (IDLE_FAILS_OFF - 1));
    assert.equal(h.r.activity().readable, true, 'one slow reading is not the end');
    assert.equal(h.r.sittingNow()!.current!.start, live.start, 'the stretch is kept, not closed');
    await h.fast(0.5);
    assert.equal(h.r.activity().readable, false);
    const mine = h.v.json(SITTING).days['2026-04-10']['Home Mac'].at(-1);
    assert.equal(mine.start, new Date(live.start).toISOString(), 'the stretch so far is written when the counts stop');
    h.s.idle = 2;
    await h.fast(2);
    assert.deepEqual(h.r.activity(), { readable: true, why: null });
    assert.ok(h.r.sittingNow()!.current, 'counting again once it reads');
  });
});

describe('Ask the coach', () => {
  const CHECKINS = `${COACH}/checkins.json`;
  const LETTERS = `${COACH}/Letters`;
  /** Sun 26 Apr (plan week 8, the phase's end) saved, and nothing else tracked or asked, so the coach card is the queue's only one. */
  const sunday = (o: { at: string; date?: string; letter?: string; saved?: boolean }) => harness({ date: o.date ?? '2026-04-26', at: o.at, settings: (d) => void (d.reminders.didYouTrain = false), mutate: (v) => {
    if (o.saved !== false) v.files.set(CHECKINS, JSON.stringify({ schemaVersion: 1, checkins: [{ date: '2026-04-26', weekStart: '2026-04-20' }] }));
    const t = v.json(TRACKING);
    t.items = [];
    t.morning = { on: false, at: '07:30' };
    delete t.bodyRecord;
    v.files.set(TRACKING, JSON.stringify(t));
    if (o.letter) {
      v.folders.add(LETTERS);
      v.files.set(`${LETTERS}/${o.letter}.md`, `---\ntype: phase-review\ndate: ${o.letter}\n---\n\n# Phase 1 review\n`);
    }
  } });

  it('the step’s Sunday at 18:00, once the answers are saved: the card names the step and its command, and Copy copies it', async () => {
    assert.equal(await sunday({ at: '17:55' }).r.tick(), 'none', 'before its time');
    const h = sunday({ at: '18:05' });
    assert.equal(await h.r.tick(), 'shown');
    const c = h.cards[0]!;
    assert.deepEqual([c.view.kind, c.view.kicker, c.view.title, c.view.primary], ['coach', 'Ask the coach', 'Phase review', 'OK']);
    assert.ok(c.view.body.kind === 'coach' && c.view.body.command === '/fitness-coach review');
    assert.deepEqual(c.view.notify, { title: 'Ask the coach: Phase review', body: 'Run /fitness-coach review in Claude Code' });
    await c.answer({ do: 'copy', text: '/fitness-coach review' });
    assert.deepEqual(h.copied, ['/fitness-coach review']);
    assert.equal(c.closed, false, 'Copy keeps the card open');
    assert.match(h.notices.at(-1)!, /copied \/fitness-coach review/);
    await c.answer({ do: 'save', payload: { kind: 'coach' } });
    assert.equal(nudge(h.v, '2026-04-26', 'coach').how, 'done');
    assert.equal(c.closed, true);
    h.s.now += 3 * 60 * MIN;
    assert.equal(await h.r.tick(), 'none', 'once a day');
  });

  it('not while the answers wait, nor once a letter dated on or after the Sunday is in; a Saturday’s letter is last week’s', async () => {
    assert.equal(await sunday({ at: '19:00', saved: false }).r.tick(), 'none');
    assert.equal(await sunday({ at: '19:00', letter: '2026-04-26' }).r.tick(), 'none');
    const sat = sunday({ at: '19:00', letter: '2026-04-25' });
    assert.equal(await sat.r.tick(), 'shown');
    assert.equal(sat.cards[0]!.view.kind, 'coach');
  });

  it('late: the next evening again, until the letter is in; Skip today holds it for the day', async () => {
    const h = sunday({ date: '2026-04-28', at: '18:30' });
    assert.equal(await h.r.tick(), 'shown');
    const c = h.cards[0]!;
    assert.equal(c.view.kicker, 'Ask the coach · still to do');
    assert.equal(c.view.sub, 'For the check-in of Sun 26 Apr · no letter yet');
    await c.answer({ do: 'skip' });
    assert.equal(nudge(h.v, '2026-04-28', 'coach').how, 'skipped');
    h.s.now += 60 * MIN;
    assert.equal(await h.r.tick(), 'none');
    h.s.now += 24 * 60 * MIN;
    assert.equal(await h.r.tick(), 'shown', 'Wed 29 Apr, again');
    // The letter arrives: done, whichever day.
    h.v.folders.add(LETTERS);
    h.v.files.set(`${LETTERS}/2026-04-26.md`, '---\ntype: phase-review\ndate: 2026-04-26\n---\n');
    h.open()[0]!.userClose();
    h.s.now += 2 * 60 * MIN;
    assert.equal(await h.r.tick(), 'none');
  });
});
