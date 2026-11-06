// The coach's write path into Coach/tracking.json (`track`): the changes the
// skill asks for become the Habits screen's own operations (item-form.ts),
// merged, validated and read back; a dry run unless --write. Through `run`
// with an in-memory copy of the synthetic vault and a fixed day, then the
// built engine on a temp copy of the vault (only Coach/tracking.json moves).
// Made-up data; the fixture files are read, never written.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { landed, mergeTracking } from '../src/adapters/vault/tracking-write.ts';
import type { TrackedItem, Tracking } from '../src/core/schema.ts';
import { validateTracking } from '../src/core/validate.ts';
import { run } from '../src/cli/cli.ts';
import { acceptOps, formFromItem, itemFromForm, newForm } from '../src/report/item-form.ts';
import { planTrack, readChanges, setUp, type TrackChanges, type TrackContext } from '../src/report/track-write.ts';
import { builtEngine, fixtureFiles, memoryIo, VAULT } from './helpers.ts';

type Json = Record<string, any>;
const DATE = '2026-04-10';
const TRACKING = 'v/3-Personal/Fitness/Coach/tracking.json';
const fixture = (): Tracking => JSON.parse(readFileSync(join(VAULT, '3-Personal/Fitness/Coach/tracking.json'), 'utf8'));
const ctx = (tracking: Tracking | null = fixture(), over: Partial<TrackContext> = {}): TrackContext => ({ tracking, today: DATE, protein: null, habits: null, ...over });
const applied = (changes: TrackChanges, c = ctx()): { plan: ReturnType<typeof planTrack>; doc: Tracking | null } => {
  const plan = planTrack(changes, c);
  if (plan.errors.length) return { plan, doc: null };
  const m = mergeTracking(c.tracking ? JSON.stringify(c.tracking) : null, plan.ops);
  return { plan, doc: m.result === 'merged' ? m.doc : m.result === 'unchanged' ? c.tracking : null };
};
const why = 'Optional. You lift 4 days a week for strength: 5 g a day (Kreider 2017).';

/** A CLI run on an in-memory vault that records what it writes. */
function cli(argv: string[], edit: (f: Record<string, string>) => void = () => {}) {
  const f = fixtureFiles('v');
  edit(f);
  const writes: string[] = [];
  const io = { ...memoryIo(f, DATE), writeTracking: (_root: string, text: string) => { writes.push(text); f[TRACKING] = text; } };
  const r = run(argv, io);
  return { code: r.code, out: JSON.parse(r.stdout) as Json, stderr: r.stderr, writes, files: f };
}

describe('track: suggestions', () => {
  it('a suggestion takes the Add form\'s defaults for its kind and slot, keeps its Why, and is open from today', () => {
    const { plan, doc } = applied({ suggest: [{ kind: 'supplement', name: 'Creatine monohydrate', dose: '5 g', when: 'evening', why, from: 'intake' }] });
    assert.deepEqual(plan.results.map((r) => [r.result, r.id]), [['suggested', 'creatine-monohydrate']]);
    const sg = doc!.suggestions!.find((s) => s.id === 'creatine-monohydrate')!;
    assert.deepEqual([sg.state, sg.on], ['open', DATE]);
    // The same item the Add form makes for these fields (evening: the 21:00 card), with the coach's source.
    const form = { ...newForm('supplement', DATE), name: 'Creatine monohydrate', doseAmount: '5', doseUnit: 'g', when: 'evening' as const, remindAt: '21:00' };
    const screen = itemFromForm(form, null, { today: DATE, ids: [] }).item;
    assert.deepEqual({ ...sg.item, source: screen.source }, { ...screen, id: 'creatine-monohydrate' });
    assert.deepEqual(sg.item.source, { by: 'coach', why, from: 'intake' });
  });

  it('suggesting what is tracked, or what was dismissed, is skipped and said; "again" suggests it under a new id', () => {
    const tracked = planTrack({ suggest: [{ id: 'creatine', kind: 'supplement', name: 'Creatine', why }] }, ctx());
    assert.deepEqual([tracked.results[0]!.result, tracked.warnings[0]!.code, tracked.ops.length], ['skipped', 'already-tracked', 0]);
    const vd = { id: 'vitamin-d', kind: 'supplement' as const, name: 'Vitamin D', dose: '400 IU', why: 'Optional. Little winter sun at your latitude (SACN 2016).' };
    const dismissed = planTrack({ suggest: [vd] }, ctx());
    assert.equal(dismissed.results[0]!.result, 'skipped');
    assert.match(dismissed.warnings[0]!.message, /dismissed on 2026-03-09: not suggested again without new data/);
    const again = applied({ suggest: [{ ...vd, again: true }] });
    assert.deepEqual(again.doc!.suggestions!.map((s) => [s.id, s.state]), [['lights-out', 'open'], ['vitamin-d', 'dismissed'], ['vitamin-d-2', 'open']]);
  });

  it('a suggestion still open is updated in place, not added twice', () => {
    const { plan, doc } = applied({ suggest: [{ id: 'lights-out', kind: 'tick', name: 'Lights out by 22:45', when: 'bedtime', reminder: { at: '22:15' }, why: 'Sleep averaged 6.4 h over 4 weeks: lights out by 22:45 (Watson 2015).' }] });
    assert.equal(plan.results[0]!.result, 'updated');
    const open = doc!.suggestions!.filter((s) => s.item.id === 'lights-out');
    assert.deepEqual([open.length, open[0]!.item.name, open[0]!.item.reminder, open[0]!.on], [1, 'Lights out by 22:45', { at: '22:15' }, '2026-04-05']);
  });

  it('a coach item without its Why, an unknown field or kind, and a bad id are errors in words; nothing is planned', () => {
    const p = planTrack({ suggest: [{ kind: 'supplement', name: 'Creatine' }, { kind: 'pill' as never, name: 'X', why }, { kind: 'tick', name: 'Y', why, colour: 'red' }, { id: 'Bad Id', kind: 'tick', name: 'Z', why }] }, ctx());
    assert.deepEqual(p.errors.map((e) => e.message), [
      'suggest[0]: a coach item needs its why (one line: the data, the item and its number, the source)',
      'suggest[1]: kind must be one of supplement, amount, tick, standup, sitting, desk',
      'suggest[2]: unknown fields: colour',
      'suggest[3]: id must be lowercase words joined by dashes',
    ]);
    const v = planTrack({ suggest: [{ kind: 'amount', name: 'Water', why, amount: { target: -5 } }] }, ctx());
    assert.match(v.errors[0]!.message, /^suggest\[0\]: amount.target/);
  });
});

describe('track: items accepted in the conversation', () => {
  it('a coach item is added as the Accept chip adds it: the suggestion accepted, the item from today, source.on today', () => {
    const { plan, doc } = applied({ add: [{ kind: 'supplement', name: 'Creatine monohydrate', dose: '5 g', when: 'morning', reminder: { at: '08:00' }, why, from: 'intake', start: '2026-04-01' }] });
    assert.deepEqual(plan.results.map((r) => r.result), ['added']);
    const it = doc!.items.find((x) => x.id === 'creatine-monohydrate')!;
    assert.deepEqual([it.start, it.source, it.reminder, it.dose], [DATE, { by: 'coach', why, from: 'intake', on: DATE }, { at: '08:00' }, '5 g']);
    const sg = doc!.suggestions!.find((s) => s.id === 'creatine-monohydrate')!;
    assert.deepEqual([sg.state, sg.decided, sg.on], ['accepted', DATE, DATE]);
    // The same as accepting that suggestion on the screen.
    const screen = mergeTracking(JSON.stringify(fixture()), [{ op: 'suggest', suggestion: { ...sg, state: 'open' } }, ...acceptOps({ ...sg, state: 'open' }, { today: DATE, ids: fixture().items.map((x) => x.id) })]);
    assert.deepEqual(screen.result === 'merged' && screen.doc, doc);
    assert.deepEqual(validateTracking(doc), []);
  });

  it('the user\'s own item is "Added by you" with no suggestion, and may start earlier', () => {
    const { doc } = applied({ add: [{ kind: 'tick', name: 'Stretch before bed', when: 'bedtime', start: '2026-04-01' }] });
    const it = doc!.items.find((x) => x.id === 'stretch-before-bed')!;
    assert.deepEqual([it.source, it.start, it.reminder], [{ by: 'user', on: DATE }, '2026-04-01', { at: '22:30' }]);
    assert.equal(doc!.suggestions!.some((s) => s.item.id === 'stretch-before-bed'), false);
  });

  it('adding an open suggestion\'s id accepts it with the settings given', () => {
    const { plan, doc } = applied({ add: [{ id: 'lights-out', reminder: { at: '22:00' } } as never] });
    assert.match(plan.results[0]!.note, /its open suggestion accepted/);
    const it = doc!.items.find((x) => x.id === 'lights-out')!;
    assert.deepEqual([it.start, it.reminder, it.source.on, it.name], [DATE, { at: '22:00' }, DATE, 'Lights out by 23:00']);
    assert.equal(doc!.suggestions!.find((s) => s.id === 'lights-out')!.state, 'accepted');
  });

  it('an id in use is a change from today: the old settings stay with the past days (earlier), as the Edit form does', () => {
    const water = fixture().items.find((x) => x.id === 'water')!;
    const { plan, doc } = applied({ add: [{ id: 'water', amount: { target: 2100 } } as never] });
    assert.equal(plan.results[0]!.result, 'updated');
    const it = doc!.items.find((x) => x.id === 'water')!;
    assert.deepEqual([it.amount!.target, it.amount!.quick, it.start, it.source], [2100, water.amount!.quick, water.start, water.source]);
    const form = { ...formFromItem(water, DATE), target: 2100 };
    assert.deepEqual(it, itemFromForm(form, water, { today: DATE, ids: [] }).item);
    assert.deepEqual(it.earlier!.at(-1), { until: '2026-04-09', schedule: water.schedule, amount: water.amount });
    assert.equal(planTrack({ add: [{ id: 'water', kind: 'tick', name: 'Water' }] }, ctx()).errors[0]!.message, 'add[0]: water is a amount: the kind stays once an item exists');
  });

  it('a change to the user\'s own item is allowed and flagged', () => {
    const p = planTrack({ add: [{ id: 'flossing', reminder: { at: '22:00' } } as never] }, ctx());
    assert.deepEqual([p.results[0]!.result, p.warnings[0]!.code], ['updated', 'user-item']);
  });

  it('declined items are kept as dismissed suggestions; an open one is dismissed', () => {
    const { plan, doc } = applied({ decline: [{ kind: 'amount', name: 'Water at work', amount: { target: 2000, unit: 'mL' }, why: 'You said you drink little at work (EFSA 2010).' }, { id: 'lights-out' } as never] });
    assert.deepEqual(plan.results.map((r) => [r.id, r.result]), [['water-at-work', 'declined'], ['lights-out', 'dismissed']]);
    assert.deepEqual(doc!.suggestions!.map((s) => [s.id, s.state, s.decided]), [['lights-out', 'dismissed', DATE], ['vitamin-d', 'dismissed', '2026-03-09'], ['water-at-work', 'dismissed', DATE]]);
    assert.equal(planTrack({ suggest: [{ kind: 'amount', name: 'Water at work', why }] }, ctx(doc)).results[0]!.result, 'skipped');
  });
});

describe('track: accept, dismiss and the settings', () => {
  it('accept and dismiss by id, as the chips do; unknown and decided ids say so', () => {
    const a = applied({ accept: ['lights-out'] });
    const it = a.doc!.items.find((x) => x.id === 'lights-out')!;
    assert.deepEqual([it.start, it.source.on, a.doc!.suggestions![0]!.state], [DATE, DATE, 'accepted']);
    const d = applied({ dismiss: ['lights-out'] });
    assert.deepEqual([d.doc!.suggestions![0]!.state, d.doc!.items.length], ['dismissed', 11]);
    assert.equal(planTrack({ dismiss: ['vitamin-d'] }, ctx()).results[0]!.result, 'unchanged');
    assert.equal(planTrack({ accept: ['nope'] }, ctx()).errors[0]!.message, 'no suggestion with the id nope (open: lights-out)');
    assert.match(planTrack({ dismiss: ['lights-out'] }, ctx(a.doc)).errors[0]!.message, /was accepted on 2026-04-10 and is tracked/);
  });

  it('the morning check-in: a time turns it on; off keeps the time; no time yet needs one', () => {
    assert.deepEqual(applied({ morning: { at: '06:45' } }).doc!.morning, { on: true, at: '06:45' });
    assert.deepEqual(applied({ morning: { on: false } }).doc!.morning, { on: false, at: '07:30' });
    assert.equal(planTrack({ morning: { at: '07:30' } }, ctx()).results[0]!.result, 'unchanged');
    assert.match(planTrack({ morning: { on: true } }, ctx(null)).errors[0]!.message, /has no time yet/);
    assert.match(planTrack({ morning: { at: '7am' } }, ctx()).errors[0]!.message, /HH:MM/);
  });

  it('the body record: the plan, or every N days with its four fields', () => {
    const fixed = { schedule: 'fixed' as const, tapeFrom: '2026-03-10', tapeEvery: 14, testsFrom: '2026-03-07', testsEvery: 28 };
    const f = applied({ bodyRecord: fixed });
    assert.deepEqual(f.doc!.bodyRecord, fixed);
    assert.deepEqual(applied({ bodyRecord: { schedule: 'plan' } }, ctx(f.doc)).doc!.bodyRecord, { ...fixed, schedule: 'plan' });
    assert.match(planTrack({ bodyRecord: { schedule: 'fixed', tapeFrom: '2026-03-10' } }, ctx()).errors[0]!.message, /needs tapeFrom, tapeEvery, testsFrom, testsEvery/);
  });

  it('starting fresh records an empty bring-over once; Pahlavan counts as set up only once an item is tracked', () => {
    const { plan, doc } = applied({ bringOver: [] }, ctx(null));
    assert.deepEqual([plan.results[0]!.result, doc!.bringOver, doc!.items], ['recorded', { on: DATE, items: [] }, []]);
    assert.deepEqual([setUp(null), setUp({ items: [] }), setUp(doc), setUp(fixture())], [false, false, false, true]);
    assert.equal(planTrack({ bringOver: [] }, ctx(doc)).results[0]!.result, 'unchanged');
    assert.match(planTrack({ bringOver: ['ghost'] }, ctx(null)).errors[0]!.message, /not tracked: ghost/);
  });

  it('the protein item: a new one takes the engine\'s target; `protein` moves a coach item to it, never the user\'s', () => {
    const protein = { tier: 'lifting' as const, deficit: true, gPerKg: [1.9, 2.2] as [number, number], floorGPerKg: 1.9, grams: [159, 184] as [number, number], targetG: 159 };
    const fresh = applied({ add: [{ kind: 'tick', name: 'Protein', when: 'evening', why: 'Your eating plan: at least 159 g a day (Morton 2018).', from: 'eating plan' }] }, ctx(null, { protein }));
    assert.deepEqual([fresh.doc!.items[0]!.goal, fresh.doc!.items[0]!.means], [{ amount: 159, unit: 'g' }, 'At least 159 g of protein']);
    const moved = applied({ protein: true }, ctx(fixture(), { protein }));
    const p = moved.doc!.items.find((x) => x.id === 'protein')!;
    assert.deepEqual([moved.plan.results[0]!.result, p.goal, p.means], ['updated', { amount: 159, unit: 'g' }, 'At least 159 g of protein']);
    assert.equal(planTrack({ protein: true }, ctx(moved.doc, { protein })).results[0]!.result, 'unchanged');
    const t = fixture();
    t.items.find((x) => x.id === 'protein')!.source = { by: 'user', on: '2026-03-02' };
    assert.equal(planTrack({ protein: true }, ctx(t, { protein })).results[0]!.result, 'skipped');
    assert.match(planTrack({ protein: true }, ctx(fixture())).errors[0]!.message, /no trend weight yet/);
  });

  it('one changes file does several things in order, in one write', () => {
    const changes = readChanges({
      add: [
        { kind: 'supplement', name: 'Creatine', dose: '5 g', why, from: 'intake' },
        { kind: 'standup', name: 'Stand-ups', standup: { sitMinutes: 30, standMinutes: 20, targetMinutes: 60 }, why: 'About 8 h at the computer, a standing desk (Duran 2023).', from: 'intake' },
      ],
      decline: [{ kind: 'amount', name: 'Water', amount: { target: 2000, unit: 'mL' }, why: 'You said you drink little at work (EFSA 2010).', from: 'intake' }],
      morning: { at: '07:00' },
      bodyRecord: { schedule: 'plan' },
      bringOver: [],
    }).changes!;
    const { plan, doc } = applied(changes, ctx(null));
    assert.deepEqual(plan.results.map((r) => `${r.what}:${r.result}`), ['add:added', 'add:added', 'decline:declined', 'morning:set', 'bodyRecord:set', 'bringOver:recorded']);
    assert.deepEqual(doc!.items.map((x) => [x.id, x.start, x.source.by]), [['creatine', DATE, 'coach'], ['stand-ups', DATE, 'coach']]);
    assert.deepEqual(doc!.items[1]!.standup, { sitMinutes: 30, standMinutes: 20, snoozeMinutes: 10, targetMinutes: 60, hours: ['09:00', '17:30'], pauseCalls: false, activeOnly: true, activeSeconds: 120, awayMinutes: 30, standAwayMinutes: 5 });
    assert.deepEqual([doc!.morning, doc!.bodyRecord, doc!.bringOver], [{ on: true, at: '07:00' }, { schedule: 'plan' }, { on: DATE, items: [] }]);
    assert.deepEqual(validateTracking(doc), []);
    assert.match(readChanges({ items: [] }).errors[0]!.message, /unknown keys in the changes file: items/);
    assert.deepEqual(readChanges([{ kind: 'tick', name: 'A' }], 'add').changes, { add: [{ kind: 'tick', name: 'A' }] });
  });
});

describe('cli: track', () => {
  it('is a dry run by default: what would change, the file as it would be, nothing written', () => {
    const { code, out, writes } = cli(['track', 'accept', '--vault', 'v', '--id', 'lights-out']);
    assert.equal(code, 0);
    assert.deepEqual([out.command, out.action, out.dryRun, out.written, writes.length], ['track', 'accept', true, false, 0]);
    assert.deepEqual(out.changed, ['suggestion lights-out accepted', 'item lights-out']);
    assert.ok(out.after.items.some((x: Json) => x.id === 'lights-out' && x.source.text === 'Suggested by your coach'));
    assert.deepEqual(out.after.suggestions, []);
    assert.equal(out.handOver.before, true);
  });

  it('--write merges, writes Coach/tracking.json only, and reads it back', () => {
    const { code, out, writes, files } = cli(['track', 'morning', '--vault', 'v', '--at', '06:45', '--write']);
    assert.deepEqual([code, out.written, writes.length], [0, true, 1]);
    assert.deepEqual(JSON.parse(files[TRACKING]!).morning, { on: true, at: '06:45' });
    assert.equal(cli(['track', 'morning', '--vault', 'v', '--at', '07:30', '--write']).writes.length, 0, 'unchanged: no write');
  });

  it('starting fresh on a vault without the file: the file is made, but Pahlavan is not set up yet (Habit Nudges keeps its reminders)', () => {
    const { code, out, files } = cli(['track', 'fresh', '--vault', 'v', '--write'], (f) => delete f[TRACKING]);
    assert.deepEqual([code, out.written, out.handOver.before, out.handOver.after], [0, true, false, false]);
    assert.match(out.handOver.note, /not set up yet/);
    assert.deepEqual(JSON.parse(files[TRACKING]!), { schemaVersion: 1, items: [], days: {}, bringOver: { on: DATE, items: [] } });
  });

  it('suggest, add and decline read an item, a list, or {items}; apply reads a changes file', () => {
    const item = { kind: 'tick', name: 'Caffeine cut-off', when: 'midday', reminder: { at: '13:30' }, why: 'Coffee at 16:00 and lights out at 23:00 (Gardiner 2023).', from: 'checkin' };
    const one = cli(['track', 'suggest', '--vault', 'v', '--file', 'v/s.json'], (f) => (f['v/s.json'] = JSON.stringify(item)));
    assert.deepEqual(one.out.results.map((r: Json) => r.result), ['suggested']);
    const list = cli(['track', 'add', '--vault', 'v', '--file', 'v/s.json'], (f) => (f['v/s.json'] = JSON.stringify({ items: [item] })));
    assert.deepEqual(list.out.results.map((r: Json) => r.result), ['added']);
    const batch = cli(['track', 'apply', '--vault', 'v', '--file', 'v/c.json', '--write'], (f) => (f['v/c.json'] = JSON.stringify({ suggest: [item], dismiss: ['lights-out'], bodyRecord: { schedule: 'plan' } })));
    assert.deepEqual([batch.code, batch.writes.length, batch.out.results.map((r: Json) => r.result)], [0, 1, ['suggested', 'dismissed', 'unchanged']]);
  });

  it('body-record and its flags; usage errors for the wrong flags', () => {
    const fixed = cli(['track', 'body-record', '--vault', 'v', '--schedule', 'fixed', '--tape-from', '2026-03-10', '--tape-every', '14', '--tests-from', '2026-03-07', '--tests-every', '28']);
    assert.deepEqual(fixed.out.after.bodyRecord, { schedule: 'fixed', tapeFrom: '2026-03-10', tapeEvery: 14, testsFrom: '2026-03-07', testsEvery: 28 });
    for (const [argv, re] of [
      [['track'], /track takes one of: suggest, add, decline, accept, dismiss, morning, body-record, fresh, protein, apply/],
      [['track', 'morning', '--vault', 'v'], /needs --at HH:MM or --off/],
      [['track', 'accept', '--vault', 'v', '--at', '07:00'], /track accept does not take --at/],
      [['track', 'body-record', '--vault', 'v', '--schedule', 'fixed', '--tape-from', '2026-03-10'], /needs --tape-every, --tests-from, --tests-every/],
      [['track', 'add', '--vault', 'v'], /needs --file <items.json>/],
      [['track', 'fresh', '--vault', 'v', '--date', DATE], /track fresh does not take --date|track does not take --date/],
    ] as const) {
      const r = cli([...argv]);
      assert.equal(r.code, 2, argv.join(' '));
      assert.match(r.stderr, re);
    }
  });

  it('errors write nothing (exit 1): a coach item without its Why, an invalid tracking file', () => {
    const r = cli(['track', 'add', '--vault', 'v', '--file', 'v/s.json', '--write'], (f) => (f['v/s.json'] = JSON.stringify({ kind: 'supplement', name: 'Creatine', by: 'coach' })));
    assert.deepEqual([r.code, r.writes.length, r.out.written], [1, 0, false]);
    assert.match(r.out.errors[0].message, /needs its why/);
    const bad = cli(['track', 'fresh', '--vault', 'v', '--write'], (f) => (f[TRACKING] = '{"schemaVersion": 1, "items": [{}], "days": {}}'));
    assert.deepEqual([bad.code, bad.writes.length], [1, 0]);
    assert.match(bad.out.errors[0].message, /Coach\/tracking.json is invalid/);
  });
});

/** Every file's name and text: any write shows. */
function snapshot(dir: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of readdirSync(dir, { recursive: true }) as string[]) {
    const p = join(dir, f);
    if (statSync(p).isFile()) m.set(f, readFileSync(p, 'utf8'));
  }
  return m;
}

describe('cli: track with the built engine, on a temp copy of the vault', () => {
  it('the dry run leaves every file as it was; --write changes Coach/tracking.json and nothing else', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pahlavan-track-'));
    try {
      const vault = join(tmp, 'vault');
      cpSync(VAULT, vault, { recursive: true });
      const items = join(tmp, 'items.json');
      writeFileSync(items, JSON.stringify([{ kind: 'supplement', name: 'Magnesium glycinate', dose: '200 mg', when: 'bedtime' }]));
      const before = snapshot(vault);
      const dry = spawnSync(process.execPath, [builtEngine(), 'track', 'add', '--vault', vault, '--file', items], { encoding: 'utf8' });
      assert.equal(dry.status, 0, dry.stderr);
      assert.deepEqual(snapshot(vault), before);
      const wet = spawnSync(process.execPath, [builtEngine(), 'track', 'add', '--vault', vault, '--file', items, '--write'], { encoding: 'utf8' });
      assert.equal(wet.status, 0, wet.stderr);
      assert.equal(JSON.parse(wet.stdout).written, true);
      const after = snapshot(vault);
      const changed = [...after.keys()].filter((k) => after.get(k) !== before.get(k));
      assert.deepEqual(changed, ['3-Personal/Fitness/Coach/tracking.json']);
      const doc = JSON.parse(after.get('3-Personal/Fitness/Coach/tracking.json')!) as Tracking;
      const added = doc.items.find((x: TrackedItem) => x.id === 'magnesium-glycinate')!;
      assert.deepEqual([added.source.by, added.reminder, validateTracking(doc)], ['user', { at: '22:30' }, []]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('track: a sitting card follows its limit', () => {
  const sitting = (doc: Tracking | null, id = 'sitting') => doc!.items.find((x) => x.id === id)!;
  const deskWhy = 'Desk job, 9 h a day: under 8 h of sitting (Patterson 2018).';

  it('a new item with its own limit and no card time: the card 30 minutes before it, the stretch card on', () => {
    const t = fixture();
    t.items = t.items.filter((x) => x.kind !== 'sitting');
    const { plan, doc } = applied({ add: [{ kind: 'sitting', name: 'Sitting time', sitting: { limitMinutes: 480 } }] }, ctx(t));
    assert.deepEqual(sitting(doc, 'sitting-time').reminder, { atMinutes: 450, stretch: true });
    assert.equal(plan.results[0]!.note, 'Sitting time, added by you; its card at 7 h 30 of 8 h, 30 minutes before the limit');
    const sg = applied({ suggest: [{ kind: 'sitting', name: 'Sitting time', sitting: { limitMinutes: 420 }, why: deskWhy }] }, ctx(t));
    assert.deepEqual(sg.doc!.suggestions!.find((s) => s.id === 'sitting-time')!.item.reminder, { atMinutes: 390, stretch: true });
    assert.match(sg.plan.results[0]!.note, /its card at 6 h 30 of 7 h/);
    // The Add form's own limit keeps its own card: nothing to say.
    assert.equal(applied({ add: [{ kind: 'sitting', name: 'Sitting time' }] }, ctx(t)).plan.results[0]!.note, 'Sitting time, added by you');
  });

  it('a changed limit moves the card, the stretch card as it was; the same limit leaves it', () => {
    const { plan, doc } = applied({ add: [{ id: 'sitting', kind: 'sitting', sitting: { limitMinutes: 480 } } as never] });
    const it = sitting(doc);
    assert.deepEqual([it.sitting!.limitMinutes, it.sitting!.stretchMaxMinutes, it.reminder], [480, 45, { atMinutes: 450, stretch: true }]);
    assert.deepEqual([plan.results[0]!.result, plan.results[0]!.note], ['updated', 'Sitting time changed from today; the settings until yesterday stay with the past days; its card at 7 h 30 of 8 h, 30 minutes before the limit']);
    const t = fixture();
    t.items.find((x) => x.id === 'sitting')!.reminder = { atMinutes: 300, stretch: false };
    assert.deepEqual(sitting(applied({ add: [{ id: 'sitting', sitting: { limitMinutes: 420 } } as never] }, ctx(t)).doc).reminder, { atMinutes: 390, stretch: false });
    const same = applied({ add: [{ id: 'sitting', sitting: { limitMinutes: 360, stretchMaxMinutes: 40 } } as never] }, ctx(t));
    assert.deepEqual(sitting(same.doc).reminder, { atMinutes: 300, stretch: false });
  });

  it('a card time given always wins; no card stays no card', () => {
    const given = applied({ add: [{ id: 'sitting', sitting: { limitMinutes: 480 }, reminder: { atMinutes: 400, stretch: true } } as never] });
    assert.deepEqual(sitting(given.doc).reminder, { atMinutes: 400, stretch: true });
    assert.doesNotMatch(given.plan.results[0]!.note, /its card at/);
    const none = applied({ add: [{ id: 'sitting', sitting: { limitMinutes: 480 }, reminder: null } as never] });
    assert.equal(sitting(none.doc).reminder, undefined);
    const t = fixture();
    delete t.items.find((x) => x.id === 'sitting')!.reminder;
    const off = applied({ add: [{ id: 'sitting', sitting: { limitMinutes: 480 } } as never] }, ctx(t));
    assert.equal(sitting(off.doc).reminder, undefined);
    assert.match(off.plan.results[0]!.note, /no sitting card: its reminder is off/);
  });

  it('cli: track add writes the card with the limit', () => {
    const r = cli(['track', 'add', '--vault', 'v', '--file', 'v/in.json', '--write'], (f) => (f['v/in.json'] = JSON.stringify({ id: 'sitting', kind: 'sitting', sitting: { limitMinutes: 480 } })));
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.files[TRACKING]!).items.find((x: Json) => x.id === 'sitting').reminder, { atMinutes: 450, stretch: true });
    assert.match(r.out.results[0].note, /its card at 7 h 30 of 8 h/);
  });
});

describe('track: one item per name', () => {
  it('a new item named like a tracked one is an error (pass its id to change it); a suggestion of it is skipped', () => {
    const p = planTrack({ add: [{ kind: 'supplement', name: 'Creatine', dose: '3 g', why }] }, ctx());
    assert.equal(p.errors[0]!.message, 'add[0]: Creatine is tracked already as creatine (Creatine): pass "id": "creatine" to change it, or give it another name');
    const s = planTrack({ suggest: [{ kind: 'supplement', name: 'Creatine', dose: '3 g', why }] }, ctx());
    assert.deepEqual([s.results[0]!.result, s.ops.length], ['skipped', 0]);
  });
});

describe('track: links to the habits', () => {
  it('a link to a habit habits-data.json lacks, and a protein item left unlinked, are warned about', () => {
    const p = planTrack({ add: [{ kind: 'tick', name: 'Protein', why: 'Your eating plan (Morton 2018).' }, { kind: 'tick', name: 'Stretch', habit: 'ghost' }] }, ctx(null, { habits: ['protein', 'water'] }));
    assert.deepEqual(p.warnings.map((w) => w.code), ['protein-unlinked', 'unknown-habit']);
    const linked = planTrack({ add: [{ kind: 'tick', name: 'Protein', habit: 'protein', why: 'Your eating plan (Morton 2018).' }] }, ctx(null, { habits: ['protein'] }));
    assert.deepEqual(linked.warnings, []);
  });
});

describe('track: the read-back after a write', () => {
  it('a suggestion added and accepted in one merge reads back accepted (the check follows the merged file)', () => {
    const plan = planTrack({ add: [{ kind: 'supplement', name: 'Creatine monohydrate', dose: '5 g', why }] }, ctx());
    const m = mergeTracking(JSON.stringify(fixture()), plan.ops);
    assert.equal(m.result, 'merged');
    if (m.result !== 'merged') return;
    assert.equal(landed(m.text, m.check), true);
    assert.deepEqual(m.check.find((c) => c.path.join('/') === 'suggestions/creatine-monohydrate')!.value, m.doc.suggestions!.find((s) => s.id === 'creatine-monohydrate'));
    assert.equal(landed(m.text.replace('"state": "accepted"', '"state": "open"'), m.check), false);
  });

  it('cli: a coach item accepted in the conversation writes and reads back', () => {
    const r = cli(['track', 'add', '--vault', 'v', '--file', 'v/s.json', '--write'], (f) => (f['v/s.json'] = JSON.stringify({ kind: 'supplement', name: 'Creatine monohydrate', dose: '5 g', why })));
    assert.deepEqual([r.code, r.out.written, r.out.errors], [0, true, []]);
    const doc = JSON.parse(r.files[TRACKING]!) as Tracking;
    assert.equal(doc.suggestions!.find((s) => s.id === 'creatine-monohydrate')!.state, 'accepted');
  });
});
