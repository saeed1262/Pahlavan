// The coach's write path into body-data.json (`body`): a date's morning
// fields, tape and tests through the forms' merges; conflicts with what the
// file holds, --replace, the read-back; the CLI on an in-memory copy of the
// synthetic vault, then the built engine on a temp copy (only body-data.json
// changes).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { run } from '../src/cli/cli.ts';
import { bodyLanded, planBody, readBodyInput } from '../src/report/body-add.ts';
import { builtEngine, fixtureFiles, memoryIo, VAULT } from './helpers.ts';

type Json = Record<string, any>;
const BODY = 'v/3-Personal/Fitness/body-data.json';
const TEXT = readFileSync(join(VAULT, '3-Personal/Fitness/body-data.json'), 'utf8');
const TODAY = '2026-04-12';
const RECORD = { date: '2026-04-12', morning: { weight: 83.1 }, tape: { waist: 93.8 }, tests: { pushups: 14, pullups: 0, pullupLevel: 'negatives 3x3', hollowS: 28, wallGapCm: 3 } };

describe('readBodyInput', () => {
  it('takes {date, morning, tape, tests}; unknown parts and fields, a missing date or one after today are errors', () => {
    assert.deepEqual(readBodyInput(RECORD, TODAY).errors, []);
    const msgs = (v: unknown) => readBodyInput(v, TODAY).errors.map((e) => e.message);
    assert.match(msgs([])[0]!, /must be an object/);
    assert.match(msgs({ morning: { weight: 80 } })[0]!, /needs its "date"/);
    assert.match(msgs({ date: '2026-04-13', tape: { waist: 90 } })[0]!, /after today/);
    assert.match(msgs({ date: TODAY, photos: {} }).join(), /unknown keys in the record file: photos/);
    assert.match(msgs({ date: TODAY, tape: { belly: 90 } }).join(), /"tape" has unknown fields: belly/);
    assert.match(msgs({ date: TODAY })[0]!, /holds nothing to write/);
  });
});

describe('planBody', () => {
  it('merges the morning fields, the tape and the tests for the date, field by field; everything else stays', () => {
    const p = planBody(TEXT, readBodyInput(RECORD, TODAY).input!);
    assert.deepEqual(p.errors, []);
    assert.deepEqual(p.results.map((r) => [r.part, r.result, r.changed]), [['morning', 'set', ['weight']], ['tape', 'set', ['waist']], ['tests', 'set', ['pushups', 'pullups', 'pullupLevel', 'hollowS', 'wallGapCm']]]);
    const before = JSON.parse(TEXT) as Json;
    const after = JSON.parse(p.text!) as Json;
    assert.deepEqual(after.days['2026-04-12'], { weight: 83.1 });
    assert.deepEqual(after.tape.at(-1), { date: '2026-04-12', waist: 93.8 });
    assert.deepEqual(after.tests.at(-1), { date: '2026-04-12', pushups: 14, pullups: 0, pullupLevel: 'negatives 3x3', hollowS: 28, wallGapCm: 3 });
    // Nothing else moved.
    delete after.days['2026-04-12'];
    after.tape.pop();
    after.tests.pop();
    assert.deepEqual(after, before);
    assert.deepEqual([p.after.morning.weight, p.after.tape['waist'], p.after.tests['pushups']], [83.1, 93.8, 14]);
    assert.equal(bodyLanded(p.text, readBodyInput(RECORD, TODAY).input!, p), true);
    assert.equal(bodyLanded(TEXT, readBodyInput(RECORD, TODAY).input!, p), false, 'the old file is not what was written');
  });

  it('steps and floors go on the day before, as the morning check-in files them; a missing file starts one', () => {
    const p = planBody(null, readBodyInput({ date: TODAY, morning: { weight: 80, steps: 8000, floors: 6 } }, TODAY).input!);
    const doc = JSON.parse(p.text!) as Json;
    assert.deepEqual(doc.days, { '2026-04-12': { weight: 80 }, '2026-04-11': { steps: 8000, floors: 6 } });
    assert.match(p.results[0]!.note, /steps and floors on 2026-04-11/);
  });

  it('a field holding another value is a conflict and nothing is written; --replace writes over it', () => {
    const input = readBodyInput({ date: '2026-04-11', morning: { weight: 82.9, rhr: 69 } }, TODAY).input!;
    const p = planBody(TEXT, input);
    assert.equal(p.text, null);
    assert.deepEqual(p.results[0]!.conflicts, [{ field: 'weight', disk: 83.4, mine: 82.9 }]);
    assert.match(p.errors.map((e) => e.message).join(), /nothing is written \(check with the user, then --replace/);
    assert.equal(p.after.morning.weight, 83.4, 'after shows the file as it stays');
    const r = planBody(TEXT, input, { replace: true });
    assert.deepEqual(r.errors, []);
    assert.equal((JSON.parse(r.text!) as Json).days['2026-04-11'].weight, 82.9);
    assert.match(r.results[0]!.note, /replaced weight 83\.4/);
    const tape = planBody(TEXT, readBodyInput({ date: '2026-03-24', tape: { waist: 95 } }, TODAY).input!);
    assert.deepEqual([tape.results[0]!.result, tape.text], ['conflict', null]);
  });

  it('what the file holds already is unchanged (no write); an invalid value stops the whole write', () => {
    const same = planBody(TEXT, readBodyInput({ date: '2026-04-11', morning: { weight: 83.4 }, tape: { waist: 94.5 } }, TODAY).input!);
    // The tape on 2026-04-11 is a new entry; the weight is there already.
    assert.deepEqual(same.results.map((r) => r.result), ['unchanged', 'set']);
    const none = planBody(TEXT, readBodyInput({ date: '2026-03-24', tape: { waist: 94.5, hips: 97 } }, TODAY).input!);
    assert.deepEqual([none.results[0]!.result, none.text], ['unchanged', null]);
    const bad = planBody(TEXT, readBodyInput({ date: TODAY, morning: { weight: 500 }, tests: { pushups: 10 } }, TODAY).input!);
    assert.equal(bad.text, null);
    assert.match(bad.errors[0]!.message, /^morning: Weight is between 30 and 250$/);
  });
});

describe('cli: body', () => {
  const cli = (argv: string[], edit: (f: Record<string, string>) => void = () => {}) => {
    const f = fixtureFiles('v');
    f['v/r.json'] = JSON.stringify(RECORD);
    edit(f);
    const writes: string[] = [];
    const io = { ...memoryIo(f, TODAY), writeBody: (_root: string, text: string) => { writes.push(text); f[BODY] = text; } };
    const r = run(argv, io);
    return { code: r.code, out: JSON.parse(r.stdout) as Json, writes, files: f };
  };

  it('a dry run unless --write; --write writes body-data.json once and reads it back', () => {
    const dry = cli(['body', '--vault', 'v', '--file', 'v/r.json']);
    assert.equal(dry.code, 0);
    assert.deepEqual([dry.out.command, dry.out.dryRun, dry.out.written, dry.writes.length], ['body', true, false, 0]);
    assert.deepEqual(dry.out.results.map((r: Json) => r.result), ['set', 'set', 'set']);
    const wet = cli(['body', '--vault', 'v', '--file', 'v/r.json', '--write']);
    assert.deepEqual([wet.code, wet.out.written, wet.writes.length], [0, true, 1]);
    assert.equal((JSON.parse(wet.files[BODY]!) as Json).tape.at(-1).waist, 93.8);
  });

  it('a conflict exits 1 and writes nothing; --replace writes it; a bad record or flag is named', () => {
    const conflict = cli(['body', '--vault', 'v', '--file', 'v/r.json', '--write'], (f) => (f['v/r.json'] = JSON.stringify({ date: '2026-04-11', morning: { weight: 82.9 } })));
    assert.deepEqual([conflict.code, conflict.writes.length], [1, 0]);
    assert.equal(conflict.out.errors[0].code, 'conflict');
    const replaced = cli(['body', '--vault', 'v', '--file', 'v/r.json', '--replace', '--write'], (f) => (f['v/r.json'] = JSON.stringify({ date: '2026-04-11', morning: { weight: 82.9 } })));
    assert.deepEqual([replaced.code, replaced.writes.length, replaced.out.replace], [0, 1, true]);
    const bad = cli(['body', '--vault', 'v', '--file', 'v/r.json'], (f) => (f['v/r.json'] = JSON.stringify({ date: TODAY, tape: { belly: 1 } })));
    assert.equal(bad.code, 1);
    assert.equal(cli(['body', '--vault', 'v']).code, 2, '--file is required');
    assert.equal(cli(['body', '--vault', 'v', '--file', 'v/r.json', '--date', TODAY]).code, 2, 'the date is the record’s');
  });
});

function snapshot(dir: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of readdirSync(dir, { recursive: true }) as string[]) {
    const p = join(dir, f);
    if (statSync(p).isFile()) m.set(f, readFileSync(p, 'utf8'));
  }
  return m;
}

describe('cli: body with the built engine, on a temp copy of the vault', () => {
  it('the dry run leaves every file as it was; --write changes body-data.json and nothing else', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pahlavan-body-'));
    try {
      const vault = join(tmp, 'vault');
      cpSync(VAULT, vault, { recursive: true });
      const rec = join(tmp, 'record.json');
      // The built engine reads the clock: the record's date (12 April 2026) is in the past.
      writeFileSync(rec, JSON.stringify(RECORD));
      const before = snapshot(vault);
      const dry = spawnSync(process.execPath, [builtEngine(), 'body', '--vault', vault, '--file', rec], { encoding: 'utf8' });
      assert.equal(dry.status, 0, dry.stdout + dry.stderr);
      assert.deepEqual(snapshot(vault), before);
      const wet = spawnSync(process.execPath, [builtEngine(), 'body', '--vault', vault, '--file', rec, '--write'], { encoding: 'utf8' });
      assert.equal(wet.status, 0, wet.stdout + wet.stderr);
      assert.equal(JSON.parse(wet.stdout).written, true);
      const after = snapshot(vault);
      assert.deepEqual([...after.keys()].filter((k) => after.get(k) !== before.get(k)), ['3-Personal/Fitness/body-data.json']);
      assert.deepEqual((JSON.parse(after.get('3-Personal/Fitness/body-data.json')!) as Json).tests.at(-1).date, '2026-04-12');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
