// What each card shows, from the engine's due cards on the synthetic vault
// (made-up data), against the signed-off mockups' wording: the kicker,
// title and line under it, the buttons, the Snooze menu (the default marked,
// "This evening" before 18:00, "Tomorrow morning" and "Skip this tape day"
// where they apply), the Why line, the notification's text, and the
// pre-filled fields with last time's values.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { readTracking } from '../../src/adapters/vault/tracking-read.ts';
import { momentAt } from '../../src/core/clock.ts';
import { bodyParts, dueNow, type DueCard } from '../../src/core/nudges.ts';
import { STAND_FRESH } from '../../src/core/standup.ts';
import { trainingToday } from '../../src/report/tracking.ts';
import { cardView, snoozeEntries, type CardContext } from '../src/reminders/card-model.ts';
import { FIX } from './mem-vault.ts';

const io = { readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null), listDir: (p: string) => (existsSync(p) ? readdirSync(p) : null) };
const vault = readVault(io, FIX, { asOf: '2026-04-10' });
const tr = readTracking(io, FIX);

function at(date: string, time: string, extra: Partial<Parameters<typeof dueNow>[0]> = {}): { cards: DueCard[]; ctx: CardContext } {
  const now = momentAt(date, time, 0);
  const input = { now, tracking: tr.tracking, nudges: tr.nudges, body: tr.body, photoFolders: tr.photoFolders, habits: tr.habits, program: vault.data.program, training: trainingToday(vault.data, date), settings: { quiet: null }, ...extra };
  const parts = bodyParts(input, date);
  return { cards: dueNow(input).value.cards, ctx: { now, tracking: tr.tracking, habits: tr.habits, body: tr.body, program: vault.data.program, morningAt: '07:30', parts: { tape: parts.tape.value, photos: parts.photos.value, tests: parts.tests.value }, session: 'Full Body B — Hinge' } };
}
const view = (date: string, time: string, key: string, extra = {}) => {
  const { cards, ctx } = at(date, time, extra);
  const c = cards.find((x) => x.key === key);
  assert.ok(c, `${key} is due at ${date} ${time} (due: ${cards.map((x) => x.key).join(', ')})`);
  return cardView(c, { ...ctx, ...('sitting' in extra ? { sitting: (extra as { sitting: CardContext['sitting'] }).sitting } : {}), ...('stand' in extra ? { stand: new Map(Object.entries((extra as { stand: Record<string, typeof STAND_FRESH> }).stand)) } : {}) });
};

describe('snoozeEntries', () => {
  it('lists the minutes with the default marked, then this evening and tomorrow morning where they apply', () => {
    assert.deepEqual(snoozeEntries({ minutes: [10, 30, 60, 120], default: 30, evening: '18:00' })!.map((e) => `${e.label}${e.isDefault ? '*' : ''}`), ['10 minutes', '30 minutes*', '1 hour', '2 hours', 'This evening, 18:00']);
    assert.deepEqual(snoozeEntries({ minutes: [30, 60], default: 30, tomorrow: true })!.map((e) => e.label), ['30 minutes', '1 hour', 'Tomorrow morning']);
    assert.equal(snoozeEntries(null), null);
  });
});

describe('cardView', () => {
  it('water: the day’s amount against the target, quick amounts, Done and No more today', () => {
    const v = view('2026-04-10', '15:40', 'amount:water');
    assert.deepEqual({ kicker: v.kicker, title: v.title, sub: v.sub, primary: v.primary, skip: v.skip?.label }, { kicker: 'Water', title: '1,250 / 2,500 mL', sub: 'Friday 10 April · 11:02 was the last glass', primary: 'Done', skip: 'No more today' });
    assert.deepEqual(v.snooze!.map((e) => `${e.label}${e.isDefault ? '*' : ''}`), ['30 minutes', '1 hour*', '2 hours']);
    assert.deepEqual(v.notify, { title: 'Water: 1250 / 2500 mL', body: 'Click to log a glass' });
    assert.ok(v.body.kind === 'amount' && v.body.quick.join() === '250,500' && v.body.next === '17:40');
    assert.equal(v.why.rule, 'habits.amount');
  });

  it('a desk break: which one of the day, the plan’s steps with their how-to, the next time', () => {
    const v = view('2026-04-10', '15:40', 'desk:desk-breaks');
    assert.equal(v.kicker, 'Desk break · 3 of 4');
    assert.equal(v.title, '5 minutes');
    assert.match(v.sub, /^Friday 10 April · 13:01 · next at 14:31$/);
    assert.ok(v.body.kind === 'desk' && v.body.steps.length > 0);
    assert.equal(v.notify.title, 'Desk break: 5 minutes');
    assert.equal(v.why.rule, 'plan.desk-breaks');
  });

  it('the morning check-in on a tape day: the tape joins it, Tomorrow morning and Skip this tape day in the menu', () => {
    const v = view('2026-04-12', '07:35', 'morning');
    assert.deepEqual({ kicker: v.kicker, title: v.title, sub: v.sub, icon: v.icon }, { kicker: 'Morning check-in · tape day', title: 'Sunday 12 April', sub: '07:30 · the morning numbers, plus the tape', icon: 'tape' });
    assert.ok(v.snooze!.some((e) => e.label === 'Tomorrow morning'));
    assert.deepEqual(v.skipPeriod, { label: 'Skip this tape day', next: 'Sun 26 Apr' });
    assert.equal(v.skip?.label, 'Skip today');
    assert.ok(v.body.kind === 'morning');
    if (v.body.kind !== 'morning') return;
    assert.deepEqual(v.body.fields.map((f) => f.label), ['Sleep', 'Resting HR', 'Weight', 'Steps yesterday', 'Floors yesterday']);
    // Floors yesterday is an ordinary field now: no "New" badge on any field.
    assert.ok(v.body.fields.some((f) => f.id === 'floors'));
    assert.ok(v.body.fields.every((f) => !('isNew' in f)));
    assert.equal(v.body.tape!.text, 'every second Sunday, from your plan');
    assert.deepEqual(v.body.tape!.fields.map((f) => f.placeholder), ['last 94.5', 'last 97', 'last 101', 'last 33']);
    assert.deepEqual(v.notify, { title: 'Good morning · tape day', body: 'Weight, sleep, resting HR, steps and floors, plus the tape' });
  });

  it('the morning card is pre-filled from body-data.json, the steps and floors from yesterday', () => {
    const { ctx } = at('2026-04-10', '07:35');
    const card: DueCard = { key: 'morning', kind: 'morning', date: '2026-04-10', items: [], at: 450, late: 5, closable: true, skip: 'today', snooze: { minutes: [10, 30, 60, 120], default: 30, evening: '18:00' }, reason: { rule: 'coach.morning-checkin', title: '', inputs: {}, threshold: null, note: 'Daily at 07:30.' } as never };
    const v = cardView(card, ctx);
    assert.ok(v.body.kind === 'morning');
    if (v.body.kind !== 'morning') return;
    assert.deepEqual(v.body.scales.map((s) => s.value), [2, 3, 2]);
    assert.deepEqual(Object.fromEntries(v.body.fields.map((f) => [f.id, f.value])), { sleepH: '5.5', rhr: '68', weight: '83.8', steps: '9184', floors: '4' });
    assert.equal(v.sub, '07:30 · about 30 seconds · feeds today’s readiness');
    assert.deepEqual(v.notify, { title: 'Good morning', body: 'Morning check-in: about 30 seconds' });
  });

  it('the evening habits share one card: the items with their doses and kinds', () => {
    const v = view('2026-04-10', '21:35', 'slot:21:30');
    assert.deepEqual({ kicker: v.kicker, icon: v.icon, title: v.title, sub: v.sub }, { kicker: 'Evening habits', icon: 'moon', title: '21:30', sub: 'Friday 10 April · 2 habits' });
    assert.ok(v.body.kind === 'habits');
    if (v.body.kind !== 'habits') return;
    assert.deepEqual(v.body.items.map((i) => [i.name, i.dose, i.kind]), [['Magnesium', '300 mg', 'supplement'], ['Flossing', null, 'tick']]);
    assert.equal(v.notify.body, 'Magnesium 300 mg, Flossing');
  });

  it('the protein tick shows its gram goal; a linked habit by name', () => {
    const v = view('2026-04-10', '20:05', 'slot:20:00');
    assert.ok(v.body.kind === 'habits');
    if (v.body.kind !== 'habits') return;
    assert.deepEqual(v.body.items.map((i) => [i.name, i.dose, i.habit]), [['Protein', '134 g', 'Protein']]);
  });

  it('the stand-up: minutes sitting, can’t be closed or skipped, the round’s snooze; standing turns it into the count', () => {
    const stand = { 'stand-ups': { ...STAND_FRESH, phase: 'due' as const, satMs: 32 * 60_000 } };
    const v = view('2026-04-10', '12:46', 'standup:stand-ups', { stand });
    assert.deepEqual({ kicker: v.kicker, title: v.title, sub: v.sub, primary: v.primary, closable: v.closable, skip: v.skip }, { kicker: 'Stand-up', title: 'Time to stand', sub: '12:46 · stand-up 5 today', primary: 'I’m standing', closable: false, skip: null });
    assert.deepEqual(v.snooze!.map((e) => `${e.label}${e.isDefault ? '*' : ''}`), ['5 minutes', '10 minutes*']);
    assert.deepEqual(v.notify, { title: 'Time to stand', body: 'You’ve been sitting 32 minutes' });
    const { cards, ctx } = at('2026-04-10', '12:46', { stand });
    const s = cardView(cards.find((c) => c.kind === 'standup')!, { ...ctx, stand: new Map([['stand-ups', { ...STAND_FRESH, phase: 'standing', stoodMs: 5 * 60_000 }]]) });
    assert.ok(s.body.kind === 'standup' && s.body.standing?.left === 15);
    assert.equal(s.closable, true);
    assert.equal(s.primary, null);
  });

  it('sitting time: today against the limit, the longest stretch, the time left in words', () => {
    const sitting = { today: { date: '2026-04-10', minutes: 330, longest: 52, stretches: 5, source: 'pahlavan' as const }, current: null };
    const v = view('2026-04-10', '15:40', 'sitting:sitting', { sitting });
    assert.deepEqual({ kicker: v.kicker, title: v.title, primary: v.primary }, { kicker: 'Sitting time', title: '5 h 30 of 6 h', primary: 'OK' });
    assert.deepEqual(v.notify, { title: 'Sitting: 5 h 30 of 6 h', body: 'Half an hour left under your limit' });
    assert.ok(v.body.kind === 'sitting' && v.body.lead === 'Half an hour left under your 6 h limit today, and one stretch already ran 52 minutes (your longest is 45).');
  });

  it('photo day and the tests: Not today, the occurrence in the menu, last results in the hints', () => {
    const body = JSON.parse(JSON.stringify(tr.body));
    body.days['2026-04-26'] = { checkedAt: '2026-04-26T07:10:00.000Z' };
    const p = view('2026-04-26', '08:00', 'photos', { body });
    assert.deepEqual({ kicker: p.kicker, title: p.title, skip: p.skip?.label, primary: p.primary }, { kicker: 'Photo day', title: 'Sunday 26 April', skip: 'Not today', primary: 'Save photos' });
    assert.equal(p.skipPeriod?.label, 'Skip this photo day');
    assert.ok(p.body.kind === 'photos' && p.body.poses.map((x) => x.id).join() === 'front,side,back,posture-closeup');
    body.days['2026-04-25'] = { checkedAt: '2026-04-25T07:10:00.000Z' };
    const t = view('2026-04-25', '08:00', 'tests', { body });
    assert.equal(t.kicker, 'Fitness tests');
    assert.match(t.sub, /^End of .+ · in the light week, so you test fresh$/);
    assert.ok(t.body.kind === 'tests');
    if (t.body.kind !== 'tests') return;
    assert.equal(t.body.fields.find((f) => f.id === 'pushups')!.hint, 'max clean reps, one set · last 12, 7 Mar');
    assert.equal(t.body.fields.find((f) => f.id === 'hollowS')!.hint, 'good form · last 25 s, 7 Mar');
    assert.equal(t.body.fields.find((f) => f.id === 'pistol')!.hint, 'e.g. to a box, 3 each · last box 4');
    assert.equal(t.skipPeriod?.label, 'Skip this test day');
  });

  it('"Did you train today?": no Save, its three choices, the planned session named without the dash', () => {
    const { ctx } = at('2026-04-09', '20:05');
    const card: DueCard = { key: 'train', kind: 'train', date: '2026-04-09', items: [], at: 1200, late: 5, closable: true, skip: null, snooze: { minutes: [30, 60], default: 30, tomorrow: true }, reason: { rule: 'coach.did-you-train', title: '', inputs: {}, threshold: null, note: 'Nothing logged by 20:00.' } as never };
    const v = cardView(card, ctx);
    assert.deepEqual({ kicker: v.kicker, title: v.title, sub: v.sub, primary: v.primary, skip: v.skip }, { kicker: 'Did you train today?', title: 'Thursday 9 April', sub: '20:00 · only when nothing is logged by then', primary: null, skip: null });
    assert.ok(v.body.kind === 'train' && v.body.session === 'Full Body B · Hinge');
    assert.ok(v.body.kind === 'train' && v.body.lead === 'Nothing is logged for Thursday 9 April, and the Workout habit isn’t ticked.');
    assert.deepEqual(v.notify, { title: 'Did you train today?', body: 'Nothing logged for Thursday yet' });
  });

  it('the last hints count from the cycle start: the tape, the tests and the photo day show nothing from before it', () => {
    const { cards, ctx } = at('2026-04-12', '07:35');
    const morning = cards.find((c) => c.key === 'morning')!;
    const tapeOf = (since: string | null) => {
      const v = cardView(morning, { ...ctx, since });
      assert.ok(v.body.kind === 'morning' && v.body.tape);
      return v.body.kind === 'morning' ? v.body.tape!.fields.map((f) => f.placeholder) : [];
    };
    assert.deepEqual(tapeOf('2026-04-01'), ['', '', '', ''], 'the 24 Mar tape is from before the cycle');
    assert.deepEqual(tapeOf('2026-03-24'), ['last 94.5', 'last 97', 'last 101', 'last 33'], 'a tape on the first day counts');
    assert.deepEqual(tapeOf(null), ['last 94.5', 'last 97', 'last 101', 'last 33'], 'no cycle start: everything counts');

    const body = JSON.parse(JSON.stringify(tr.body));
    body.days['2026-04-25'] = { checkedAt: '2026-04-25T07:10:00.000Z' };
    body.days['2026-04-26'] = { checkedAt: '2026-04-26T07:10:00.000Z' };
    const tests = at('2026-04-25', '08:00', { body });
    const t = cardView(tests.cards.find((c) => c.key === 'tests')!, { ...tests.ctx, body, since: '2026-03-08' });
    assert.ok(t.body.kind === 'tests');
    if (t.body.kind !== 'tests') return;
    assert.equal(t.body.fields.find((f) => f.id === 'pushups')!.hint, 'max clean reps, one set');
    assert.equal(t.body.fields.find((f) => f.id === 'pistol')!.hint, 'e.g. to a box, 3 each');
    const photos = at('2026-04-26', '08:00', { body });
    const card = photos.cards.find((c) => c.key === 'photos')!;
    const last = (since: string | null) => { const v = cardView(card, { ...photos.ctx, body, since }); return v.body.kind === 'photos' ? v.body.last : 'not photos'; };
    assert.equal(last(null), '2026-02-24');
    assert.equal(last('2026-03-01'), null);
  });

  it('no em-dash in any card’s text', () => {
    const texts: string[] = [];
    for (const [d, t] of [['2026-04-10', '15:40'], ['2026-04-10', '21:35'], ['2026-04-12', '07:35']] as const) {
      const { cards, ctx } = at(d, t);
      for (const c of cards) texts.push(JSON.stringify(cardView(c, ctx)));
    }
    assert.ok(texts.length > 3);
    for (const x of texts) assert.ok(!x.includes('—'), x.slice(0, 120));
  });
});


describe('the card’s frame', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url).pathname, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));

  it('shows one close control: the card’s own, never Obsidian’s beside it (whatever 1.15 or later calls it)', () => {
    const hide = rules.find((r) => r.sel.split(',').some((s) => s.trim() === '.modal.pahlavan-modal > :not(.modal-content)'));
    assert.ok(hide, 'a rule hides every child of the card’s modal but its content');
    assert.match(hide.body, /display:\s*none\s*!important/);
    // Nothing shows one of those children again.
    const back = rules.filter((r) => r.sel.split(',').some((s) => /\.pahlavan-modal\s*>\s*\.(?!modal-content\b)/.test(s)) && /display:\s*(?!none)/.test(r.body));
    assert.deepEqual(back.map((r) => r.sel), []);
  });

  it('every card that can be closed draws its own ×; the stand-up that can’t says it stays open', () => {
    const src = readFileSync(new URL('../src/ui/cards.ts', import.meta.url).pathname, 'utf8');
    assert.match(src, /v\.closable \? h\('button', \{ class: 'pv-nv-x'/);
    assert.equal((src.match(/'pv-nv-x'/g) ?? []).length, 1, 'one × in the card');
  });
});
