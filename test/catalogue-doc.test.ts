// The readable catalogue: docs/exercise-catalogue.md is exactly what the
// engine generates (run `npm run catalogue-doc` after changing the
// catalogue), every movement has its entry, and the words stay plain.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CATALOGUE } from '../src/core/data/exercises.ts';
import { catalogueMarkdown } from '../src/report/catalogue-doc.ts';

describe('the readable exercise catalogue', () => {
  const md = catalogueMarkdown();

  it('docs/exercise-catalogue.md is the generated document (npm run catalogue-doc writes it)', () => {
    assert.equal(readFileSync(join(import.meta.dirname, '..', 'docs', 'exercise-catalogue.md'), 'utf8'), md);
  });

  it('has an entry for every movement, with its guide text', () => {
    for (const e of CATALOGUE) {
      assert.ok(md.includes(`\n### ${e.name}\n`), e.id);
      assert.ok(md.includes(`- **Do:** ${e.guide.do}`), `${e.id}: its guide`);
    }
    assert.match(md, new RegExp(`Pahlavan knows: ${CATALOGUE.length} of them`));
  });

  it('a search’s page holds only the movements found, and the ladders they are in', () => {
    const one = catalogueMarkdown({ ids: ['pull-up', 'goblet-squat'] });
    assert.match(one, new RegExp(`^# Exercise catalogue\\n\\n2 of the ${CATALOGUE.length} movements Pahlavan knows`));
    assert.equal(one.split('\n### ').length - 1 - (one.match(/\n### .*\(by level\)\n|\n### [^\n]*\n\n1\. /g) ?? []).length, 2);
    assert.ok(one.includes('### Pull-up (by level)'), 'the pull-up ladder, which the pull-up is in');
    assert.ok(!one.includes('### Push-up (by level)'));
  });

  it('carries a stamp only when given one, and no long dashes', () => {
    assert.ok(!md.includes('*Written by'));
    assert.ok(catalogueMarkdown({ stamp: 'Written by Pahlavan 9.9.9 on 2026-11-08.' }).includes('\n*Written by Pahlavan 9.9.9 on 2026-11-08.*\n'));
    assert.ok(!md.includes('—'));
  });
});
