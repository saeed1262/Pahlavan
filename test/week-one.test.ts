// Week 1 of the plan: the Monday of the first logged plan session (the
// dashboard's clock); until the current cycle (the newest baseline note on
// or before the date) has a plan session of its own, the Monday of the cycle
// start, so a fresh start reads "Week 1" from day one. On made-up vaults in
// memory, then the vault's calendar script (gen-training-calendar.py) on the
// same made-up files in a temp folder, when it is on this machine.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { buildToday } from '../src/report/index.ts';
import { fixtureFiles, LIVE_VAULT, memoryIo } from './helpers.ts';

const FIT = 'v/3-Personal/Fitness';
const LIVE_SCRIPT = LIVE_VAULT ? join(LIVE_VAULT, '5-System/Scripts/gen-training-calendar.py') : '';

/** The synthetic vault with a made-up log (dates and types only) and baseline notes in place of its own. */
function files(sessions: { date: string; type: string }[], baselines: string[]): Record<string, string> {
  const f = fixtureFiles('v');
  for (const k of Object.keys(f)) if (/\/Baseline - .*\.md$/.test(k)) delete f[k];
  for (const b of baselines) f[`${FIT}/Baseline - ${b}.md`] = `# Baseline ${b} (made up)\n`;
  const log = JSON.parse(f[`${FIT}/fitness-log-data.json`]!) as Record<string, unknown>;
  log['sessions'] = sessions.map((s) => ({ date: s.date, type: s.type, lift1: { name: 'x', weight: 0, reps: 0 }, lift2: { name: 'y', weight: 0, reps: 0 } }));
  f[`${FIT}/fitness-log-data.json`] = JSON.stringify(log, null, 2);
  return f;
}
const startOf = (f: Record<string, string>, date: string) => readVault(memoryIo(f, date), 'v', { asOf: date }).data.plan.start;

const CASES: { name: string; sessions: { date: string; type: string }[]; baselines: string[]; date: string; week1: string }[] = [
  { name: 'nothing logged yet: the Monday of the cycle start', sessions: [], baselines: ['2026-11-04'], date: '2026-11-06', week1: '2026-11-02' },
  { name: 'only the old cycle\'s sessions: still the cycle start', sessions: [{ date: '2026-10-06', type: 'A' }], baselines: ['2026-09-30', '2026-11-04'], date: '2026-11-12', week1: '2026-11-02' },
  { name: 'a session in the cycle: the existing rule, the first logged plan session\'s Monday', sessions: [{ date: '2026-11-10', type: 'A' }], baselines: ['2026-11-04'], date: '2026-11-12', week1: '2026-11-09' },
  { name: 'a baseline note dated after the day does not count yet', sessions: [{ date: '2026-10-06', type: 'B' }], baselines: ['2026-11-20'], date: '2026-11-12', week1: '2026-10-05' },
];

describe('week 1 of the plan', () => {
  for (const c of CASES) {
    it(c.name, () => assert.equal(startOf(files(c.sessions, c.baselines), c.date), c.week1));
  }

  it('no baseline and nothing logged: no week yet, as before', () => {
    assert.equal(startOf(files([], []), '2026-11-06'), null);
  });

  it('Today and the banners read "Week 1" from the cycle\'s first day', () => {
    const f = files([], ['2026-11-04']);
    const t = buildToday(readVault(memoryIo(f, '2026-11-04'), 'v', { asOf: '2026-11-04' }), '2026-11-04', 'full');
    assert.deepEqual([t.review!.week.planWeek, t.review!.week.phase, t.review!.week.planStart], [1, 1, '2026-11-02']);
    assert.ok(t.session!.flags.some((x) => x.rule.startsWith('plan.calibration') || /calibration/i.test(x.title)), 'week 1 is the calibration week');
  });
});

const LIVE = existsSync(LIVE_SCRIPT) && spawnSync('python3', ['--version']).status === 0;
describe('the calendar script agrees (gen-training-calendar.py, when it is on this machine)', () => {
  if (!LIVE) it('is not on this machine: nothing to compare', () => {});
  else for (const c of CASES) {
    it(c.name, () => {
      const tmp = mkdtempSync(join(tmpdir(), 'pahlavan-week1-'));
      try {
        const f = files(c.sessions, c.baselines);
        for (const [k, v] of Object.entries(f)) {
          if (!k.startsWith(`${FIT}/`) || !/(plan-data|fitness-log-data)\.json$|Baseline - /.test(k)) continue;
          const p = join(tmp, k.slice(2));
          mkdirSync(join(p, '..'), { recursive: true });
          writeFileSync(p, v);
        }
        const script = join(tmp, '5-System', 'Scripts', 'gen-training-calendar.py');
        mkdirSync(join(script, '..'), { recursive: true });
        writeFileSync(script, readFileSync(LIVE_SCRIPT, 'utf8'));
        // Loads the script as a module (its main() does not run, so nothing is written) and asks it for week 1 on the date.
        const py = `import importlib.util, datetime as dt\nspec = importlib.util.spec_from_file_location('cal', ${JSON.stringify(script)})\nm = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nprint(m.week_one(dt.date.fromisoformat(${JSON.stringify(c.date)})).isoformat())`;
        const r = spawnSync('python3', ['-I', '-c', py], { encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout.trim(), c.week1);
        assert.equal(startOf(f, c.date), c.week1);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }
});
