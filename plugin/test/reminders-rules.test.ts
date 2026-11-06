// The reminder machinery's pure parts: the tick's gating (the settings,
// this Mac, quiet hours across midnight, a card already open, Isfahan's day
// card, the idle wait) and when a notification goes with a card; the queue
// order (a reminder for its time first, as Habit Nudges orders them) and the
// keys held back after an answer; the card's inputs (Habit Nudges' sleep
// formats); this Mac's name and clock.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TAPE_FIELDS, TEST_FIELDS } from '../../src/adapters/vault/body-write.ts';
import { explain } from '../../src/core/reason.ts';
import type { CardKind, DueCard } from '../../src/core/nudges.ts';
import { IDLE_WAIT_S, shouldNotify, standGate, tickGate, type GateInput } from '../src/reminders/gate.ts';
import { morningValues, parseHours, parseNumber, recordValues } from '../src/reminders/inputs.ts';
import { convertPhoto, parseIoreg, systemIdleSeconds } from '../src/reminders/mac.ts';
import { localClock, localMoment, macName } from '../src/reminders/moment.ts';
import { HeldKeys, queueOrder } from '../src/reminders/queue.ts';
import { DEFAULT_REMINDERS } from '../src/settings.ts';

const base = (over: Partial<GateInput> = {}): GateInput => ({ reminders: { on: true, quiet: { on: true, from: '22:30', to: '07:00' } }, remindHere: true, time: '15:40', cardOpen: false, otherCard: false, busy: false, idleS: 4, ...over });

describe('tickGate', () => {
  it('lets a card show with reminders on, this Mac on, outside quiet hours, nothing open and someone at the Mac', () => {
    assert.deepEqual(tickGate(base()), { go: true });
  });

  it('says why not, in order: off, this Mac, quiet hours, busy, a card open, Isfahan’s card, idle', () => {
    assert.deepEqual(tickGate(base({ reminders: { ...DEFAULT_REMINDERS, on: false }, remindHere: false })), { go: false, why: 'off' });
    assert.deepEqual(tickGate(base({ remindHere: false, time: '23:00' })), { go: false, why: 'not-here' });
    assert.deepEqual(tickGate(base({ time: '23:00', cardOpen: true })), { go: false, why: 'quiet' });
    assert.deepEqual(tickGate(base({ busy: true, cardOpen: true })), { go: false, why: 'busy' });
    assert.deepEqual(tickGate(base({ cardOpen: true, otherCard: true })), { go: false, why: 'open' });
    assert.deepEqual(tickGate(base({ otherCard: true, idleS: 9999 })), { go: false, why: 'other-card' });
    assert.deepEqual(tickGate(base({ idleS: IDLE_WAIT_S + 1 })), { go: false, why: 'idle' });
  });

  it('waits while the Mac is idle longer than five minutes, but not for a card asked for by hand, or when idle is unknown', () => {
    assert.equal(tickGate(base({ idleS: IDLE_WAIT_S })).go, true);
    assert.equal(tickGate(base({ idleS: IDLE_WAIT_S + 1 })).go, false);
    assert.equal(tickGate(base({ idleS: 3600, byHand: true })).go, true);
    assert.equal(tickGate(base({ idleS: null })).go, true);
  });

  it('keeps quiet hours across midnight, and not at all when they are off or empty', () => {
    for (const t of ['22:30', '23:59', '00:00', '06:59']) assert.equal(tickGate(base({ time: t })).go, false, t);
    for (const t of ['07:00', '12:00', '22:29']) assert.equal(tickGate(base({ time: t })).go, true, t);
    assert.equal(tickGate(base({ time: '23:00', reminders: { on: true, quiet: { on: false, from: '22:30', to: '07:00' } } })).go, true);
    assert.equal(tickGate(base({ time: '23:00', reminders: { on: true, quiet: { on: true, from: '23:00', to: '23:00' } } })).go, true);
    assert.equal(tickGate(base({ time: '13:30', reminders: { on: true, quiet: { on: true, from: '13:00', to: '14:00' } } })).go, false);
  });

  it('a stand-up card needs no idle check (its count starts over after time away) but waits for another card', () => {
    const g = { reminders: base().reminders, remindHere: true, time: '12:46', cardOpen: false, otherCard: false };
    assert.deepEqual(standGate(g), { go: true });
    assert.deepEqual(standGate({ ...g, cardOpen: true }), { go: false, why: 'open' });
    assert.deepEqual(standGate({ ...g, time: '23:10' }), { go: false, why: 'quiet' });
    assert.deepEqual(standGate({ ...g, remindHere: false }), { go: false, why: 'not-here' });
  });
});

describe('shouldNotify', () => {
  it('sends a notification only when they are on and Obsidian is not in front (unfocused or hidden), never for a card by hand', () => {
    assert.equal(shouldNotify({ notifications: true, focused: false, visible: true, byHand: false }), true);
    assert.equal(shouldNotify({ notifications: true, focused: true, visible: false, byHand: false }), true);
    assert.equal(shouldNotify({ notifications: true, focused: true, visible: true, byHand: false }), false);
    assert.equal(shouldNotify({ notifications: false, focused: false, visible: false, byHand: false }), false);
    assert.equal(shouldNotify({ notifications: true, focused: false, visible: false, byHand: true }), false);
  });
});

const card = (key: string, kind: CardKind, at: number): DueCard => ({ key, kind, date: '2026-04-10', items: [], at, late: 0, closable: kind !== 'standup', skip: 'today', snooze: null, reason: explain(true, 'x', {}).reason });

describe('queueOrder', () => {
  it('puts the stand-up first, then the cards for a set time (earliest first), then the ones that can wait in the engine’s order', () => {
    // As dueNow orders them: by kind, then time.
    const engine = [card('morning', 'morning', 450), card('slot:21:30', 'habits', 1290), card('train', 'train', 1200), card('amount:water', 'amount', 782), card('desk:d', 'desk', 781), card('photos', 'photos', 450), card('standup:s', 'standup', 1300)];
    assert.deepEqual(queueOrder(engine).map((c) => c.key), ['standup:s', 'morning', 'train', 'slot:21:30', 'amount:water', 'desk:d', 'photos']);
  });

  it('a reminder for its time goes before a repeating card that fell due earlier', () => {
    const q = queueOrder([card('amount:water', 'amount', 540), card('slot:09:00', 'habits', 540), card('desk:d', 'desk', 600), card('slot:12:30', 'habits', 750)]);
    assert.deepEqual(q.map((c) => c.key), ['slot:09:00', 'slot:12:30', 'amount:water', 'desk:d']);
  });

  it('keeps the engine’s order between timed cards at the same time', () => {
    const q = queueOrder([card('morning', 'morning', 450), card('slot:07:30', 'habits', 450)]);
    assert.deepEqual(q.map((c) => c.key), ['morning', 'slot:07:30']);
  });
});

describe('HeldKeys', () => {
  it('holds a key until its time, then lets the next look offer it again', () => {
    const h = new HeldKeys();
    h.hold('amount:water', 1000);
    const cards = [card('amount:water', 'amount', 1), card('desk:d', 'desk', 2)];
    assert.equal(h.next(cards, 999)?.key, 'desk:d');
    assert.equal(h.next(cards, 1000)?.key, 'amount:water');
    h.hold('desk:d', 5000);
    h.hold('desk:d', 2000);
    assert.equal(h.held('desk:d', 4000), true, 'a shorter hold never cuts a longer one');
  });
});

describe('the card’s inputs', () => {
  it('reads sleep as Habit Nudges did: 7:20, 7h20, 7h 20m, 7.3 or 7,3', () => {
    assert.equal(parseHours('7:20'), 7.33);
    assert.equal(parseHours('7h20'), 7.33);
    assert.equal(parseHours('7h 20m'), 7.33);
    assert.equal(parseHours('7.3'), 7.3);
    assert.equal(parseHours('7,3'), 7.3);
    assert.equal(parseHours(''), null);
    assert.equal(parseHours('lots'), null);
  });

  it('reads steps with thousands separators, and decimals with a comma', () => {
    assert.equal(parseNumber('9,917', { thousands: true }), 9917);
    assert.equal(parseNumber('9 917', { thousands: true }), 9917);
    assert.equal(parseNumber('83,8'), 83.8);
    assert.equal(parseNumber('x'), null);
  });

  it('turns the morning fields into the writer’s values, empty as null, and names what is out of range', () => {
    const ok = morningValues({ energy: 3, soreness: null, sleepQ: 4 }, { sleepH: '7:20', rhr: '58', weight: '83,84', steps: '10,250', floors: '' });
    assert.deepEqual(ok.errors, []);
    assert.deepEqual(ok.values, { energy: 3, soreness: null, sleepQ: 4, sleepH: 7.33, rhr: 58, weight: 83.8, steps: 10250, floors: null });
    const bad = morningValues({}, { rhr: '300', weight: 'heavy' });
    assert.deepEqual(bad.bad.sort(), ['rhr', 'weight']);
    assert.ok(bad.errors.some((e) => /Resting HR is between 30 and 120/.test(e)));
    assert.ok(bad.errors.some((e) => /Weight is not a number/.test(e)));
  });

  it('turns the tape and tests into numbers or text, within the engine’s limits', () => {
    assert.deepEqual(recordValues(TAPE_FIELDS, { waist: '93,5', hips: '', arm: '33' }).values, { waist: 93.5, hips: null, arm: 33 });
    const t = recordValues(TEST_FIELDS, { pushups: '17.6', pullupLevel: 'negatives 3×3', hollowS: '900' });
    assert.equal(t.values['pushups'], 18);
    assert.equal(t.values['pullupLevel'], 'negatives 3×3');
    assert.deepEqual(t.bad, ['hollowS']);
  });
});

describe('this Mac', () => {
  it('names itself from the host name, in the pattern Coach/sitting.json takes', () => {
    assert.equal(macName('Saeeds-MacBook-Pro.local'), 'Saeeds-MacBook-Pro');
    assert.equal(macName('Saeed’s MacBook Pro'), 'Saeed s MacBook Pro');
    assert.equal(macName('...'), 'This Mac');
    assert.equal(macName(null), 'This Mac');
    assert.equal(macName('x'.repeat(90)).length, 64);
  });

  it('reads the local clock as the rules want it', () => {
    const d = new Date(2026, 3, 10, 15, 40, 30);
    const m = localMoment(d.getTime());
    assert.deepEqual({ date: m.date, minutes: m.minutes }, { date: '2026-04-10', minutes: 15 * 60 + 40.5 });
    assert.equal(localClock.dayStart(d.getTime()), new Date(2026, 3, 10).getTime());
    assert.equal(localClock.dayOf(d.getTime()), '2026-04-10');
  });
});

describe('the Mac’s readings fail soft', () => {
  it('idle time: ioreg’s HIDIdleTime in seconds; null when it can’t tell (no Obsidian require, another OS)', async () => {
    assert.equal(parseIoreg('  |   "HIDIdleTime" = 4500000000\n'), 4.5);
    assert.equal(parseIoreg('no such key'), null);
    assert.equal(await systemIdleSeconds(), null);
  });

  it('without sips a photo is saved as it is, with its own extension', async () => {
    const data = new TextEncoder().encode('x').buffer as ArrayBuffer;
    assert.deepEqual(await convertPhoto({ pose: 'front', name: 'IMG_1.HEIC', data }), { data, ext: 'heic' });
  });
});
