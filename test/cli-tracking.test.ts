// The CLI's read-only commands for what is tracked and reminded (tracked,
// due, habits, bring-over) and validate for the new files: through `run`
// with an in-memory copy of the synthetic vault and a fixed clock, then the
// built dist/engine.cjs on the vault itself, which must be left unchanged.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';
import { HELP, run } from '../src/cli/cli.ts';
import { builtEngine, fixtureFiles, memoryIo, VAULT } from './helpers.ts';

type Json = Record<string, any>;
const io = (edit: (f: Record<string, string>) => void = () => {}, today = '2026-04-10', minutes = 13 * 60 + 5) => {
  const f = fixtureFiles('v');
  edit(f);
  return { ...memoryIo(f, today), clock: () => ({ minutes, offsetMinutes: 0 }) };
};
const j = (argv: string[], i = io()) => {
  const r = run(argv, i);
  return { code: r.code, out: JSON.parse(r.stdout) as Json };
};

describe('cli: tracked', () => {
  it('lists every item in words, the open suggestions, the morning time, the body record and the plan\'s desk breaks', () => {
    const { code, out } = j(['tracked', '--vault', 'v', '--date', '2026-04-10']);
    assert.equal(code, 0);
    assert.equal(out.command, 'tracked');
    assert.equal(out.items.length, 11);
    const w = out.items.find((x: Json) => x.id === 'water');
    assert.deepEqual([w.schedule, w.when, w.asks, w.reminder, w.habit, w.source.text], ['every day', 'through the day', '2500 mL a day', 'every 2 h, 09:00 to 21:00', 'water', 'Suggested by your coach']);
    const f = out.items.find((x: Json) => x.id === 'fish-oil');
    assert.deepEqual([f.paused, f.schedule, f.reminder], ['2026-03-28', 'weekdays', '12:30']);
    const s = out.items.find((x: Json) => x.id === 'sitting');
    assert.equal(s.reminder, 'a card at 5 h 30 of 6 h, when a stretch reaches 45 min');
    assert.equal(out.items.find((x: Json) => x.id === 'stand-ups').when, '09:00 to 17:30');
    assert.equal(out.items.find((x: Json) => x.id === 'desk-breaks').desk.source, 'plan');
    assert.deepEqual(out.suggestions.map((x: Json) => x.id), ['lights-out']);
    assert.deepEqual(out.morning, { on: true, at: '07:30' });
    assert.deepEqual(out.bodyRecord.parts.map((p: Json) => [p.value.part, p.value.due, p.value.nextDate]), [['tape', true, '2026-03-29'], ['photos', false, '2026-04-26'], ['tests', false, '2026-04-25']]);
    assert.equal(out.deskBreaks.value.steps[0].name, 'Doorway chest stretch');
    assert.deepEqual(out.sources.tracking.tracking, 'found');
  });

  it('with no tracking file: nothing tracked, calmly', () => {
    const { code, out } = j(['tracked', '--vault', 'v'], io((f) => delete f['v/3-Personal/Fitness/Coach/tracking.json']));
    assert.equal(code, 0);
    assert.deepEqual([out.exists, out.items, out.morning], [false, [], null]);
  });

  it('an invalid tracking file is a data error (exit 1), named', () => {
    const { code, out } = j(['tracked', '--vault', 'v'], io((f) => (f['v/3-Personal/Fitness/Coach/tracking.json'] = '{"schemaVersion": 1, "items": [{}], "days": {}}')));
    assert.equal(code, 1);
    assert.match(out.errors.map((e: Json) => e.message).join(), /Coach\/tracking.json is invalid/);
  });
});

describe('cli: due', () => {
  it('the cards due at the moment, in order, with their reasons; Due today beside them', () => {
    const { code, out } = j(['due', '--vault', 'v', '--date', '2026-04-10']);
    assert.equal(code, 0);
    assert.deepEqual([out.date, out.time], ['2026-04-10', '13:05']);
    assert.deepEqual(out.due.value.cards.map((c: Json) => c.key), ['tape', 'slot:after-log', 'amount:water', 'desk:desk-breaks']);
    for (const c of out.due.value.cards) assert.ok(c.reason.title && c.reason.title !== 'Rule', c.key);
    assert.deepEqual(out.today.value.desk[0], { id: 'desk-breaks', name: 'Desk breaks', done: 2, total: 4, times: ['10:00', '11:30', '13:00', '14:30'], next: '13:01' });
    assert.equal(out.today.value.sitting[0].minutes, 207);
  });

  it('--time picks the moment; a bad time is a usage error', () => {
    assert.deepEqual(j(['due', '--vault', 'v', '--date', '2026-04-10', '--time', '12:15']).out.due.value.cards.map((c: Json) => c.key), ['tape', 'slot:after-log']);
    const r = run(['due', '--vault', 'v', '--time', '25:00'], io());
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--time must be a time as HH:MM/);
  });
});

describe('cli: quiet hours in due and tracked', () => {
  const SETTINGS = 'v/.obsidian/plugins/pahlavan/data.json';
  const TRACKING = 'v/3-Personal/Fitness/Coach/tracking.json';
  const quiet = (q: object) => (f: Record<string, string>) => (f[SETTINGS] = JSON.stringify({ version: 2, reminders: { on: true, quiet: q } }));
  const at = (time: string, edit?: (f: Record<string, string>) => void) => j(['due', '--vault', 'v', '--date', '2026-04-10', '--time', time], io(edit)).out;

  it('without Pahlavan\'s data.json: its default hours, 22:30 to 07:00, hold every card, and the sources say so', () => {
    const out = at('23:30');
    assert.deepEqual(out.due.value, { cards: [], quiet: true });
    assert.equal(out.due.reason.rule, 'nudges.quiet');
    assert.deepEqual(out.sources.quietHours, { file: '.obsidian/plugins/pahlavan/data.json', source: 'default' });
    assert.deepEqual(out.quiet, { hours: { on: true, from: '22:30', to: '07:00', source: 'default' }, held: [] });
    assert.ok(at('21:35').due.value.cards.some((c: Json) => c.key === 'slot:21:30'), 'outside them, as before');
  });

  it('the plugin\'s own hours: off, the evening\'s cards are due at 23:30; earlier hours hold the 21:30 slot for good', () => {
    const off = at('23:30', quiet({ on: false, from: '22:30', to: '07:00' }));
    assert.deepEqual([off.sources.quietHours.source, off.due.value.quiet, off.quiet.held], ['settings', false, []]);
    assert.ok(off.due.value.cards.some((c: Json) => c.key === 'slot:21:30'));
    const early = at('21:35', quiet({ on: true, from: '21:00', to: '06:00' }));
    assert.deepEqual(early.due.value.cards, []);
    assert.deepEqual(early.quiet.held.map((h: Json) => [h.value.item, h.value.spans]), [
      ['magnesium', [{ from: '21:30', to: '21:30', shows: null }]],
      ['flossing', [{ from: '21:30', to: '21:30', shows: null }]],
      ['water', [{ from: '21:00', to: '21:00', shows: null }]],
    ]);
  });

  it('a 23:30 reminder is flagged with its reason in due and in tracked; the other items are not', () => {
    const late = (f: Record<string, string>) => {
      const t = JSON.parse(f[TRACKING]!);
      t.items.find((x: Json) => x.id === 'flossing').reminder = { at: '23:30' };
      f[TRACKING] = JSON.stringify(t);
    };
    const note = 'Pahlavan holds cards from 22:30 to 07:00: this 23:30 card never shows; move it before 22:30, or change quiet hours in Settings.';
    const due = at('12:15', late);
    assert.deepEqual(due.quiet.held.map((h: Json) => [h.value.item, h.reason.rule, h.reason.note]), [['flossing', 'nudges.quiet', note]]);
    const { code, out } = j(['tracked', '--vault', 'v', '--date', '2026-04-10'], io(late));
    assert.equal(code, 0);
    assert.deepEqual(out.sources.quietHours.source, 'default');
    assert.equal(out.items.find((x: Json) => x.id === 'flossing').quiet.reason.note, note);
    assert.deepEqual(out.items.filter((x: Json) => x.quiet).map((x: Json) => x.id), ['flossing']);
    assert.deepEqual(out.quiet.held.map((h: Json) => h.value.item), ['flossing']);
  });
});

describe('cli: habits', () => {
  it('each item\'s streak, 30 days and grid; sitting\'s bars; the three tiles', () => {
    const { code, out } = j(['habits', '--vault', 'v', '--date', '2026-04-10']);
    assert.equal(code, 0);
    assert.equal(out.items.length, 11);
    const creatine = out.items.find((x: Json) => x.item === 'creatine');
    assert.deepEqual([creatine.grid.cells.length, creatine.today.state, creatine.unit], [182, 'taken', 'days']);
    assert.equal(out.items.find((x: Json) => x.item === 'shake').unit, 'sessions');
    const sit = out.items.find((x: Json) => x.item === 'sitting');
    assert.equal(sit.sitting.length, 28);
    assert.deepEqual(sit.sitting.find((b: Json) => b.date === '2026-03-30'), { date: '2026-03-30', minutes: 480, longest: 210, overLimit: true, overStretch: true, today: false, beforeStart: false, source: 'desk-time' });
    assert.deepEqual(Object.keys(out.tiles), ['last30', 'longest', 'today']);
    assert.equal(out.tiles.last30.active, 10, 'fish oil is paused');
  });

  it('stand-ups: minutes from the stand-up card and at the desk, per day and over the last 30 days', () => {
    const { out } = j(['habits', '--vault', 'v', '--date', '2026-04-10', '--item', 'stand-ups'], io((f) => {
      const t = JSON.parse(f['v/3-Personal/Fitness/Coach/tracking.json']!);
      t.days['2026-04-09']['stand-ups'].deskMinutes = 40;
      t.days['2026-04-10']['stand-ups'].deskMinutes = 20;
      f['v/3-Personal/Fitness/Coach/tracking.json'] = JSON.stringify(t);
    }));
    const s = out.items[0];
    assert.deepEqual([s.today.value, s.today.desk], [80, 20]);
    assert.equal(s.grid.cells.find((c: Json) => c.date === '2026-04-09').desk, 40);
    assert.deepEqual([s.standing.value.desk, s.standing.value.deskDays, s.standing.value.prompted + s.standing.value.desk], [60, 2, s.standing.value.minutes]);
    assert.equal(s.standing.reason.title, 'Standing minutes');
    assert.equal(j(['habits', '--vault', 'v', '--date', '2026-04-10', '--item', 'stand-ups']).out.items[0].standing.value.desk, 0);
  });

  it('--item picks one; an unknown one is a usage error listing the ids', () => {
    assert.deepEqual(j(['habits', '--vault', 'v', '--item', 'water']).out.items.map((x: Json) => x.item), ['water']);
    const r = run(['habits', '--vault', 'v', '--item', 'ghost'], io());
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--item must be a tracked item's id: creatine, multivitamin/);
  });
});

describe('cli: bring-over', () => {
  it('the offer from Habit Nudges\' settings and the linked habits; what Pahlavan tracks already is marked', () => {
    const { code, out } = j(['bring-over', '--vault', 'v', '--date', '2026-04-10'], io((f) => delete f['v/3-Personal/Fitness/Coach/tracking.json']));
    assert.equal(code, 0);
    assert.equal(out.settingsFound, true);
    assert.equal(out.file, '.obsidian/plugins/habit-nudges/data.json');
    const v = out.offer.value;
    assert.deepEqual(v.items.map((x: Json) => [x.item.id, x.checked]), [['water', true], ['stand-ups', true], ['desk-breaks', true], ['sitting', true], ['protein', true]]);
    assert.deepEqual(v.items[0].item.reminder, { every: 90, from: '08:30', to: '20:00' });
    assert.equal(v.items.find((x: Json) => x.item.id === 'protein').item.goal.amount, 134);
    assert.deepEqual(v.bodyRecord, { schedule: 'fixed', tapeFrom: '2026-03-10', tapeEvery: 14, testsFrom: '2026-03-07', testsEvery: 28 });
    const already = j(['bring-over', '--vault', 'v', '--date', '2026-04-10']).out.offer.value.items;
    assert.ok(already.every((x: Json) => x.already && !x.checked));
  });
});

describe('cli: validate the new files', () => {
  for (const [file, kind, shape] of [['tracking', 'tracking', 'tracking'], ['nudges', 'nudges', 'nudges'], ['sitting', 'sitting', 'sittingLog']] as const) {
    it(`${file}.json: inferred and valid`, () => {
      const { code, out } = j(['validate', `v/3-Personal/Fitness/Coach/${file}.json`]);
      assert.equal(code, 0);
      assert.deepEqual([out.kind, out.shape, out.valid, out.inferred], [kind, shape, true, true]);
    });
  }

  it('reports errors with paths, and the help names the commands', () => {
    const { code, out } = j(['validate', 'v/x.json', '--kind', 'tracking'], io((f) => (f['v/x.json'] = '{"schemaVersion": 1, "items": [], "days": {"2026-04-10": {"ghost": {"done": true}}}}')));
    assert.equal(code, 1);
    assert.match(out.errors[0].message, /days.2026-04-10.ghost: no item with the id ghost/);
    for (const c of ['tracked', 'due', 'habits', 'bring-over', 'tracking|nudges|sitting']) assert.ok(HELP.includes(c), c);
  });
});

/** Every file's name, size, time and text: any write shows. */
function snapshot(dir: string): string {
  return readdirSync(dir, { recursive: true })
    .sort()
    .map((f) => {
      const p = join(dir, f);
      const s = statSync(p);
      return s.isFile() ? `${f}:${s.size}:${s.mtimeMs}:${readFileSync(p, 'utf8')}` : f;
    })
    .join('\n');
}

describe('cli: the built engine on the synthetic vault, read only', () => {
  let before0 = '';
  before(() => {
    builtEngine();
    before0 = snapshot(VAULT);
  });

  it('runs each command and leaves every file as it was', () => {
    for (const argv of [['tracked'], ['due', '--time', '12:15'], ['habits'], ['bring-over']]) {
      const r = spawnSync(process.execPath, [builtEngine(), argv[0]!, '--vault', VAULT, '--date', '2026-04-10', ...argv.slice(1)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${argv[0]}: ${r.stderr}`);
      assert.equal(JSON.parse(r.stdout).command, argv[0]);
    }
    assert.equal(snapshot(VAULT), before0);
  });
});
