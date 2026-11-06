// Every text meant for people in the reports writes dates as "Wed 1 Apr",
// never "2026-04-01": ISO dates stay in inputs, values and data fields. This
// walks the review, session, today, progress and check-in template output on
// the synthetic vault over several dates (a normal week, the stale check-in
// after it, a deload week, weeks off) and fails on an ISO date in any note,
// title, suggestion, question, answer, text, why or message.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { dayText } from '../src/core/dates.ts';
import { buildProgress, buildReview, buildSession, buildTemplate, buildToday } from '../src/report/index.ts';
import { ROOT } from './helpers.ts';

const VAULT = join(ROOT, 'test', 'fixtures', 'vault');
const fsIo = {
  readText: (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null),
  listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null),
};
const HUMAN = new Set(['note', 'title', 'suggestion', 'question', 'answer', 'text', 'why', 'message', 'countermeasure', 'risk', 'instructions']);
const ISO = /\b\d{4}-\d{2}-\d{2}\b/;
const DATES = ['2026-03-03', '2026-04-10', '2026-04-12', '2026-04-13', '2026-04-22', '2026-05-12'];

function walk(x: unknown, path: string, found: string[]): void {
  if (Array.isArray(x)) return x.forEach((v, i) => walk(v, `${path}[${i}]`, found));
  if (!x || typeof x !== 'object') return;
  for (const [k, v] of Object.entries(x)) {
    if (k === 'inputs' || k === 'threshold') continue;
    if (HUMAN.has(k) && typeof v === 'string' && ISO.test(v)) found.push(`${path}.${k}: ${v}`);
    walk(v, `${path}.${k}`, found);
  }
}

describe('readable dates in the reports', () => {
  it('dayText writes a date for people', () => {
    assert.equal(dayText('2026-04-01'), 'Wed 1 Apr');
    assert.equal(dayText('2026-04-12'), 'Sun 12 Apr');
  });

  for (const date of DATES) {
    it(`no ISO date in a note on ${date}`, () => {
      const read = readVault(fsIo, VAULT, { asOf: date });
      const found: string[] = [];
      walk(buildReview(read.data, date), 'review', found);
      for (const mode of ['full', 'express', 'hotel'] as const) walk(buildSession(read.data, date, mode), `session.${mode}`, found);
      walk(buildToday(read, date, 'full'), 'today', found);
      walk(buildProgress(read, date), 'progress', found);
      walk(buildTemplate(read.data, date, null), 'checkin', found);
      assert.deepEqual(found, []);
    });
  }
});
