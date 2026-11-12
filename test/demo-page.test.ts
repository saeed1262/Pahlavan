// The Try it demo (tools/build-demo.mjs): one page that loads nothing and
// sends nothing, with the made-up athlete's date in its bar, and options a
// shared link can't stretch past the tab and the look.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// @ts-expect-error: a plain .mjs tool without type declarations
import { buildDemo } from '../tools/build-demo.mjs';
import { DEMO_FOOD_DATES, DEMO_TABS, PREVIEW_TODAY, demoDateLabel, demoEatingPlan, demoParams, openNoteNotice } from '../plugin/preview/demo-options.ts';
import { FOOD_PLAN_DAY } from './fixtures/food/food-state.ts';
// @ts-expect-error: a plain .mjs tool without type declarations
import { fixtureScript, previewFiles } from '../tools/preview-files.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe("the preview's made-up vault, as both builds inline it", () => {
  it("takes the vault's own files, its config folder included, and leaves out the Finder's and other systems' litter", () => {
    const root = mkdtempSync(join(tmpdir(), 'pahlavan-preview-files-'));
    try {
      const vault = join(root, 'test/fixtures/vault');
      for (const dir of ['Fitness', '.obsidian/plugins/p', 'Fitness/.hidden-by-finder']) mkdirSync(join(vault, dir), { recursive: true });
      writeFileSync(join(vault, 'Fitness/plan-data.json'), '{}');
      writeFileSync(join(vault, '.obsidian/plugins/p/data.json'), '{}');
      for (const junk of ['.DS_Store', 'Fitness/.DS_Store', 'Fitness/._plan-data.json', 'Thumbs.db', 'desktop.ini', 'Fitness/expected.json']) writeFileSync(join(vault, junk), 'x');
      writeFileSync(join(root, 'test/fixtures/decisions-sample.md'), 'd');
      writeFileSync(join(root, 'test/fixtures/letter-sample.md'), 'l');
      const { files } = previewFiles(root);
      assert.deepEqual(Object.keys(files).sort(), ['.obsidian/plugins/p/data.json', 'Fitness/plan-data.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('escapes every < in the inlined files, so a note can never end or open a script', () => {
    const script: string = fixtureScript({ files: { 'a.md': '<!-- x --> <script>alert(1)</script>' }, samples: { decisions: '<b>', letter: '' } });
    assert.doesNotMatch(script, /</);
    const win: { PAHLAVAN_FIXTURE?: Record<string, string> } = {};
    new Function('window', script)(win);
    assert.equal(win.PAHLAVAN_FIXTURE!['a.md'], '<!-- x --> <script>alert(1)</script>');
  });
});

describe('the demo page', async () => {
  const html: string = await buildDemo();

  it('refuses every request: exactly this CSP, inline script and style, its own data for pictures and the font', () => {
    const csps = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/g)].map((m) => m[1]);
    // Exactly one, and exactly this one: a connect-src or 'self' added later would open a door (on Pages, 'self' is github.io).
    assert.deepEqual(csps, ["default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'"]);
  });

  it('keeps its inline scripts whole: two scripts, nothing in them that could end or re-open one early', () => {
    assert.equal(html.match(/<script>/g)?.length, 2);
    assert.equal(html.match(/<\/script>/g)?.length, 2);
    for (const [, body] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      assert.doesNotMatch(body!, /<!--|<script|<\/script/i);
    }
  });

  it('loads nothing from anywhere: no stylesheet links, no outside scripts, pictures or fonts', () => {
    for (const link of html.match(/<link\b[^>]*>/g) ?? []) assert.equal(link, '<link rel="icon" href="data:,">');
    assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i);
    assert.doesNotMatch(html, /\bsrc="https?:/i);
    assert.doesNotMatch(html, /url\(\s*["']?https?:/i);
    assert.doesNotMatch(html, /@import/i);
  });

  it('links out only to the directory, the repository and the user guide', () => {
    const allowed = ['https://community.obsidian.md/plugins/pahlavan', 'https://github.com/saeed1262/pahlavan', 'https://github.com/saeed1262/pahlavan/blob/main/docs/user-guide.md'];
    const hrefs = [...html.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1]!);
    assert.ok(hrefs.length >= 2);
    for (const h of hrefs) assert.ok(allowed.includes(h), `links to ${h}`);
  });

  it('calls no network API', () => {
    for (const re of [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bsendBeacon\b/, /\bEventSource\b/]) assert.doesNotMatch(html, re);
  });

  it('can be found, and carries the font licence with the font', () => {
    assert.doesNotMatch(html, /noindex/);
    assert.match(html, /url\("data:font\/woff2;base64,/);
    assert.match(html, /SIL OPEN FONT LICENSE Version 1\.1/);
    assert.match(html, /Cormorant Garamond: Copyright 2015 The Cormorant Project Authors/);
  });

  it("names the harness's date in its bar", () => {
    assert.ok(html.includes(`A made-up athlete on ${demoDateLabel(PREVIEW_TODAY)}.`));
    assert.doesNotMatch(html, /\{\{date\}\}/);
  });

  it('holds no home folder, and stays small enough to open quickly', () => {
    assert.doesNotMatch(html, /\/Users\/[a-z]/);
    // Characters, which for this almost all-ASCII page are about its bytes.
    assert.ok(html.length < 2.5 * 1024 * 1024, `${html.length} characters`);
  });
});

describe("the demo's options", () => {
  it('start from the rich made-up data in Obsidian\'s look, light or dark from the system', () => {
    assert.deepEqual(demoParams('', false), { rich: '1', isfahan: '0', mode: 'light' });
    assert.equal(demoParams('', true)['mode'], 'dark');
    assert.equal(demoParams('?mode=light', true)['mode'], 'light');
  });

  it('read only the tab and the look from a link', () => {
    const p = demoParams('?tab=plan&card=morning&vault=empty&today=2026-01-01&settings=1&rich=0', false);
    assert.deepEqual(Object.keys(p).sort(), ['isfahan', 'mode', 'rich', 'tab']);
    assert.equal(p['tab'], 'plan');
    assert.equal(p['rich'], '1');
  });

  it('read a link as the browser does: the first of a repeated key, escapes decoded, a broken part skipped', () => {
    assert.equal(demoParams('?tab=plan&tab=food', false)['tab'], 'plan');
    assert.equal(demoParams('?t%61b=food', false)['tab'], 'food');
    assert.equal(demoParams('?x=%E0%A4%A&tab=food', false)['tab'], 'food');
  });

  it('open only a real tab', () => {
    for (const tab of DEMO_TABS) assert.equal(demoParams(`?tab=${tab}`, false)['tab'], tab);
    assert.equal(demoParams('?tab=nowhere', false)['tab'], undefined);
  });

  it('draw the Isfahan look at night when dark and in the working day when light', () => {
    assert.equal(demoParams('?isfahan=1', true)['phase'], 'night');
    assert.equal(demoParams('?isfahan=1&mode=light', true)['phase'], 'workday');
    assert.equal(demoParams('?isfahan=0', true)['phase'], undefined);
  });

  it('name a date as the bar does', () => {
    assert.equal(demoDateLabel('2026-04-10'), 'Fri 10 Apr 2026');
    assert.equal(demoDateLabel('2026-11-29'), 'Sun 29 Nov 2026');
  });

  it("move the Food tab's eating plan onto the demo athlete's cycle, every date", () => {
    const moved = demoEatingPlan(FOOD_PLAN_DAY);
    for (const [from, to] of Object.entries(DEMO_FOOD_DATES)) {
      assert.ok(!moved.includes(from), `${from} left`);
      assert.ok(moved.includes(to), `${to} missing`);
    }
    // Only the dates change.
    assert.equal(moved.replaceAll('2026-03-30', '2026-11-02').replaceAll('2026-04-26', '2026-11-29'), JSON.stringify(FOOD_PLAN_DAY, null, 2));
  });

  it("refuse an eating plan with a date the demo doesn't move", () => {
    assert.throws(() => demoEatingPlan({ start: '2026-12-01' }), /2026-12-01/);
  });

  it('say which note Obsidian would open', () => {
    assert.equal(openNoteNotice('3-Personal/Fitness/Coach/Letters/2026-04-05.md'), 'In Obsidian, this opens the note "2026-04-05".');
  });
});
