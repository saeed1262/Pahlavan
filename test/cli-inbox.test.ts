// `engine inbox`: the phone's entries, read only by default (what would
// apply, what is there already, what is refused), `--write` through the same
// merges as the plugin (the files written whole and read back, the applied
// entries moved to applied/<YYYY-MM>/, refused.json rewritten), and
// `--phone` for phone.json; `validate` on an entry. Through `run` on an
// in-memory copy of the synthetic vault, then the built engine on a temp copy.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';
import { run } from '../src/cli/cli.ts';
import { habitCheckinKey } from '../src/core/tracking.ts';
import { builtEngine, fixtureFiles, memoryIo, VAULT } from './helpers.ts';

type Json = Record<string, any>;
const TODAY = '2026-04-10';
const IN = 'v/3-Personal/Fitness/Coach/Inbox';
const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
const TRACKING = 'v/3-Personal/Fitness/Coach/tracking.json';
const HABITS = 'v/5-System/Data/habits-data.json';
const BODY = 'v/3-Personal/Fitness/body-data.json';
const NUDGES = 'v/3-Personal/Fitness/Coach/nudges.json';

const ENTRIES: Record<string, Json> = {
  '2026-04-09T19-02-00-session.json': { v: 1, kind: 'session', at: '2026-04-09T19:02:00-04:00', date: '2026-04-09', session: { type: 'A', lift1: { weight: 55, reps: 10 }, lift2: { weight: 60, reps: 6 }, durationMin: 50 } },
  '2026-04-10T09-30-00-tick.json': { v: 1, kind: 'tick', at: '2026-04-10T09:30:00-04:00', date: TODAY, ids: ['multivitamin', 'protein'] },
  '2026-04-10T12-00-00-amount.json': { v: 1, kind: 'amount', at: '2026-04-10T12:00:00-04:00', date: TODAY, id: 'water', add: 500 },
  '2026-04-10T07-05-00-morning.json': { v: 1, kind: 'morning', at: '2026-04-10T07:05:00-04:00', date: TODAY, morning: { energy: 4 } },
  '2026-04-05T20-15-00-trained.json': { v: 1, kind: 'trained', at: '2026-04-05T20:15:00-04:00', date: '2026-04-05', answer: 'rest' },
  '2026-04-08T18-00-00-session.json': { v: 1, kind: 'session', at: '2026-04-08T18:00:00-04:00', date: '2026-04-08', session: { type: 'A', lift1: { weight: 55, reps: 9 }, lift2: { weight: 60, reps: 5 } } },
};

const cli = (argv: string[], edit: (f: Record<string, string>) => void = () => {}) => {
  const f = fixtureFiles('v');
  edit(f);
  const writes: { file: string; text: string }[] = [];
  const put = (file: string, path: string) => (_r: string, text: string) => {
    writes.push({ file, text });
    f[path] = text;
  };
  const io = {
    ...memoryIo(f, TODAY),
    writeLog: put('log', LOG),
    writeTracking: put('tracking', TRACKING),
    writeHabits: put('habits', HABITS),
    writeBody: put('body', BODY),
    writeNudges: put('nudges', NUDGES),
    writeInbox: (_r: string, name: string, text: string) => put(name, `${IN}/${name}`)(_r, text),
    moveInbox: (_r: string, file: string, to: string) => {
      writes.push({ file: `move ${file} ${to}`, text: '' });
      f[`${IN}/${to}`] = f[`${IN}/${file}`]!;
      delete f[`${IN}/${file}`];
    },
  };
  return { run: (args = argv) => {
    const r = run(args, io);
    return { code: r.code, out: JSON.parse(r.stdout) as Json, stderr: r.stderr };
  }, writes, files: f };
};
/** The writes' names so far (read through a function: an assertion on the list narrows it). */
const wrote = (c: { writes: { file: string }[] }) => c.writes.map((w) => w.file);
const withEntries = (names: readonly string[] = Object.keys(ENTRIES)) => (f: Record<string, string>) => {
  for (const n of names) f[`${IN}/${n}`] = JSON.stringify(ENTRIES[n]);
};

describe('cli: inbox (read only)', () => {
  it('says per entry what would apply, what is there already and what is refused, and writes nothing', () => {
    const c = cli(['inbox', '--vault', 'v'], withEntries());
    const before = JSON.stringify(c.files);
    const { code, out } = c.run();
    assert.equal(code, 0);
    assert.deepEqual([out.command, out.action, out.dryRun, out.written, out.dir], ['inbox', 'import', true, false, '3-Personal/Fitness/Coach/Inbox']);
    assert.deepEqual(out.counts, { files: 6, apply: 4, unchanged: 0, refused: 2 });
    assert.deepEqual(out.entries.map((e: Json) => [e.file, e.status, e.code ?? null]), [
      ['2026-04-05T20-15-00-trained.json', 'apply', null],
      ['2026-04-08T18-00-00-session.json', 'refused', 'already'],
      ['2026-04-09T19-02-00-session.json', 'apply', null],
      ['2026-04-10T07-05-00-morning.json', 'refused', 'conflict'],
      ['2026-04-10T09-30-00-tick.json', 'apply', null],
      ['2026-04-10T12-00-00-amount.json', 'apply', null],
    ]);
    assert.deepEqual(out.changed, ['3-Personal/Fitness/fitness-log-data.json', '3-Personal/Fitness/body-data.json', '5-System/Data/habits-data.json', '3-Personal/Fitness/Coach/tracking.json', '3-Personal/Fitness/Coach/nudges.json']);
    assert.deepEqual(out.moves[0], { from: '2026-04-05T20-15-00-trained.json', to: 'applied/2026-04/2026-04-05T20-15-00-trained.json' });
    assert.deepEqual(out.refused.map((r: Json) => [r.file, r.date, r.kind, r.code]), [['2026-04-08T18-00-00-session.json', '2026-04-08', 'session', 'already'], ['2026-04-10T07-05-00-morning.json', TODAY, 'morning', 'conflict']]);
    assert.deepEqual(out.warnings.map((w: Json) => w.code), ['refused', 'refused']);
    assert.match(out.warnings[1].message, /^2026-04-10T07-05-00-morning.json: Energy on Fri 10 Apr is 2 in body-data.json, the phone says 4/);
    assert.deepEqual(c.writes, []);
    assert.equal(JSON.stringify(c.files), before);
  });

  it('an empty inbox (or none) has nothing to do', () => {
    const { code, out } = cli(['inbox', '--vault', 'v']).run();
    assert.equal(code, 0);
    assert.deepEqual([out.counts, out.entries, out.refused], [{ files: 0, apply: 0, unchanged: 0, refused: 0 }, [], []]);
  });

  it('takes no positional arguments, and only --vault, --write and --phone', () => {
    assert.equal(cli(['inbox', 'now', '--vault', 'v']).run().code, 2);
    const r = cli(['inbox', '--vault', 'v', '--date', TODAY]).run();
    assert.equal(r.code, 2);
    assert.match(r.stderr, /inbox does not take --date/);
  });
});

describe('cli: inbox --write', () => {
  it('writes each file once through the merges, moves what applied, keeps what was refused with refused.json', () => {
    const c = cli(['inbox', '--vault', 'v', '--write'], withEntries());
    const { code, out } = c.run();
    assert.equal(code, 0);
    assert.equal(out.written, true);
    assert.deepEqual(wrote(c), ['log', 'body', 'habits', 'tracking', 'nudges',
      'move 2026-04-05T20-15-00-trained.json applied/2026-04/2026-04-05T20-15-00-trained.json',
      'move 2026-04-09T19-02-00-session.json applied/2026-04/2026-04-09T19-02-00-session.json',
      'move 2026-04-10T09-30-00-tick.json applied/2026-04/2026-04-10T09-30-00-tick.json',
      'move 2026-04-10T12-00-00-amount.json applied/2026-04/2026-04-10T12-00-00-amount.json',
      'refused.json']);
    const f = c.files;
    assert.ok(JSON.parse(f[LOG]!).sessions.some((s: Json) => s.date === '2026-04-09' && s.type === 'A' && s.lift1.name === 'Goblet Squat'));
    assert.equal(JSON.parse(f[TRACKING]!).days[TODAY].water.amount, 1750);
    assert.equal(JSON.parse(f[TRACKING]!).days[TODAY].multivitamin.done, true);
    assert.equal(JSON.parse(f[HABITS]!).checkins[habitCheckinKey('protein', TODAY)], '1');
    assert.equal(JSON.parse(f[BODY]!).days['2026-04-05'].mark, 'rest');
    assert.equal(JSON.parse(f[NUDGES]!).days['2026-04-05'].train.by, 'phone');
    assert.equal(JSON.parse(f[BODY]!).days[TODAY].energy, 2, 'the conflict wrote nothing');
    // The refused entries stay, listed with their reasons.
    assert.deepEqual(Object.keys(f).filter((k) => k.startsWith(`${IN}/`)).sort(), [
      `${IN}/2026-04-08T18-00-00-session.json`,
      `${IN}/2026-04-10T07-05-00-morning.json`,
      `${IN}/applied/2026-04/2026-04-05T20-15-00-trained.json`,
      `${IN}/applied/2026-04/2026-04-09T19-02-00-session.json`,
      `${IN}/applied/2026-04/2026-04-10T09-30-00-tick.json`,
      `${IN}/applied/2026-04/2026-04-10T12-00-00-amount.json`,
      `${IN}/refused.json`,
    ]);
    assert.deepEqual(JSON.parse(f[`${IN}/refused.json`]!).refused.map((r: Json) => r.code), ['already', 'conflict']);

    // Run again: the refused ones are refused again, the same refusals, so nothing is written.
    c.writes.length = 0;
    const again = c.run();
    assert.deepEqual([again.code, again.out.counts], [0, { files: 2, apply: 0, unchanged: 0, refused: 2 }]);
    assert.deepEqual(c.writes, []);

    // The user deletes them: refused.json is rewritten empty, once.
    delete f[`${IN}/2026-04-08T18-00-00-session.json`];
    delete f[`${IN}/2026-04-10T07-05-00-morning.json`];
    c.run();
    assert.deepEqual(wrote(c), ['refused.json']);
    assert.deepEqual(JSON.parse(f[`${IN}/refused.json`]!), { v: 1, refused: [] });
    c.writes.length = 0;
    c.run();
    assert.deepEqual(c.writes, []);
  });

  it('a copy of an entry imported before is refused as already, and its twin in the inbox too', () => {
    const name = '2026-04-10T12-00-00-amount.json';
    const c = cli(['inbox', '--vault', 'v', '--write'], (f) => {
      withEntries([name])(f);
      f[`${IN}/copy.json`] = JSON.stringify(ENTRIES[name]);
    });
    const { out } = c.run();
    assert.deepEqual(out.entries.map((e: Json) => [e.file, e.status, e.code ?? null]), [[name, 'apply', null], ['copy.json', 'refused', 'already']]);
    // The other Mac's copy turns up again after the move: it is in applied/ already.
    c.files[`${IN}/${name}`] = JSON.stringify(ENTRIES[name]);
    const again = c.run();
    assert.match(again.out.entries.find((e: Json) => e.file === name).reason, /^imported before/);
    assert.equal(JSON.parse(c.files[TRACKING]!).days[TODAY].water.amount, 1750, 'counted once');
  });

  it('only an entry that is there already still moves on', () => {
    const c = cli(['inbox', '--vault', 'v', '--write'], (f) => (f[`${IN}/t.json`] = JSON.stringify({ ...ENTRIES['2026-04-10T09-30-00-tick.json'], ids: ['creatine'] })));
    const { out } = c.run();
    assert.deepEqual([out.counts, out.changed], [{ files: 1, apply: 0, unchanged: 1, refused: 0 }, []]);
    assert.deepEqual(wrote(c), ['move t.json applied/2026-04/t.json', 'refused.json']);
  });
});

describe('cli: inbox --phone', () => {
  it('builds phone.json, writes it only with --write and only when it changes', () => {
    const c = cli(['inbox', '--vault', 'v', '--phone']);
    const dry = c.run();
    assert.equal(dry.code, 0);
    assert.deepEqual([dry.out.action, dry.out.file, dry.out.dryRun, dry.out.unchanged], ['phone', '3-Personal/Fitness/Coach/Inbox/phone.json', true, false]);
    assert.deepEqual(dry.out.phone.open, ['multivitamin', 'shake', 'magnesium', 'protein', 'flossing', 'water']);
    assert.deepEqual(c.writes, []);
    const w = c.run(['inbox', '--vault', 'v', '--phone', '--write']);
    assert.equal(w.out.written, true);
    assert.deepEqual(wrote(c), ['phone.json']);
    assert.deepEqual(JSON.parse(c.files[`${IN}/phone.json`]!), w.out.phone);
    const again = c.run(['inbox', '--vault', 'v', '--phone', '--write']);
    assert.deepEqual([again.out.unchanged, again.out.written, c.writes.length], [true, false, 1]);
  });
});

describe('cli: validate on a phone entry', () => {
  it('infers the inbox kind and checks it; phone.json and refused.json are named, not judged', () => {
    const f = fixtureFiles('v');
    f['v/e.json'] = JSON.stringify(ENTRIES['2026-04-10T07-05-00-morning.json']);
    f['v/bad.json'] = JSON.stringify({ ...ENTRIES['2026-04-10T07-05-00-morning.json'], morning: { energy: 7 } });
    f[`${IN}/phone.json`] = JSON.stringify({ v: 1, date: TODAY, items: [], open: [], sessions: [], inbox: {} });
    const io = memoryIo(f, TODAY);
    const good = JSON.parse(run(['validate', 'v/e.json'], io).stdout);
    assert.deepEqual([good.kind, good.shape, good.valid, good.inferred], ['inbox', 'inboxEntry', true, true]);
    const r = run(['validate', 'v/bad.json', '--kind', 'inbox'], io);
    assert.equal(r.code, 1);
    assert.deepEqual(JSON.parse(r.stdout).errors.map((e: Json) => e.message), ['morning.energy: must be at most 5']);
    const phone = run(['validate', `${IN}/phone.json`], io);
    assert.equal(phone.code, 2);
    assert.match(JSON.parse(phone.stdout).errors[0].message, /is Pahlavan's summary of today for the phone's shortcuts/);
  });
});

describe('cli: inbox on a temp copy of the synthetic vault (the built engine)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pahlavan-inbox-'));
  const vault = join(tmp, 'vault');
  const inbox = join(vault, '3-Personal', 'Fitness', 'Coach', 'Inbox');
  const engine = (args: string[]) => {
    const r = spawnSync(process.execPath, [builtEngine(), ...args], { encoding: 'utf8' });
    return { code: r.status, out: JSON.parse(r.stdout) as Json, stderr: r.stderr };
  };
  const snapshot = (dir: string): string => {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d).sort()) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(`${p.slice(dir.length)}\n${readFileSync(p, 'utf8')}`);
      }
    };
    walk(dir);
    return out.join('\n');
  };

  before(() => {
    builtEngine();
    cpSync(VAULT, vault, { recursive: true });
    mkdirSync(inbox, { recursive: true });
    // Today on the machine running the tests: entries for today and the day before, and one for a day long gone.
    const d = new Date();
    const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const today = iso(d);
    writeFileSync(join(inbox, 'water.json'), JSON.stringify({ v: 1, kind: 'amount', at: `${today}T12:00:00Z`, date: today, id: 'water', add: 250 }));
    writeFileSync(join(inbox, 'old.json'), JSON.stringify({ v: 1, kind: 'trained', at: '2026-01-01T20:00:00Z', date: '2026-01-01', answer: 'rest' }));
  });
  process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

  it('a dry run leaves the vault as it is', () => {
    const before = snapshot(vault);
    const r = engine(['inbox', '--vault', vault]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.out.entries.map((e: Json) => [e.file, e.status, e.code ?? null]), [['old.json', 'refused', 'too-old'], ['water.json', 'apply', null]]);
    assert.equal(snapshot(vault), before);
  });

  it('--write adds the water, moves the entry into applied/<month>/, and lists the old one in refused.json', () => {
    const r = engine(['inbox', '--vault', vault, '--write']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.out.written, true);
    const month = r.out.moves[0].to.split('/')[1];
    assert.ok(existsSync(join(inbox, 'applied', month, 'water.json')));
    assert.ok(!existsSync(join(inbox, 'water.json')));
    assert.ok(existsSync(join(inbox, 'old.json')));
    assert.deepEqual(JSON.parse(readFileSync(join(inbox, 'refused.json'), 'utf8')).refused.map((x: Json) => [x.file, x.code]), [['old.json', 'too-old']]);
    assert.match(JSON.parse(readFileSync(join(inbox, 'refused.json'), 'utf8')).refused[0].reason, /log it in Pahlavan/);
    const p = engine(['inbox', '--vault', vault, '--phone', '--write']);
    assert.equal(p.code, 0, p.stderr);
    assert.ok(existsSync(join(inbox, 'phone.json')));
    const before = snapshot(vault);
    assert.equal(engine(['inbox', '--vault', vault, '--write']).code, 0);
    assert.equal(engine(['inbox', '--vault', vault, '--phone', '--write']).out.unchanged, true);
    assert.equal(snapshot(vault), before, 'nothing more to write');
  });
});
