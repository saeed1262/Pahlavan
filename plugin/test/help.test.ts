// The in-plugin help: the tips' memory in Coach/help.json (both Macs share
// it; each write reads the file and applies its one change, so the other
// Mac's tips are kept), the next tip per screen, the screens' memory in the
// same file (At a glance's visits and fold, each section's fold, the Food
// tab's light checks) with its validation and rules, and the help's pieces
// drawn in Node with the small fake DOM: the ? menu, the welcome card, a tip.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { welcomeSteps } from '../../src/report/welcome.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { applyHelp, CHECK_DAYS, COACH_TIMES, earlyVisit, FRESH_HELP, HelpStore, nextTip, OPEN_VISITS, panelOpen, parseHelp, sectionFolded, TIPS, type HelpState } from '../src/help.ts';
import { DEFAULT_GUIDE_URL, loadPluginData } from '../src/settings.ts';
import { helpMenu, SAFETY_LINE, tipBubble, welcomeCard } from '../src/ui/help.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';
import { paths } from '../../src/adapters/vault/layout.ts';

installFakeDom();
const click = (el: FakeElement | null) => {
  assert.ok(el, 'drawn');
  for (const fn of el!.listeners.get('click') ?? []) fn({ target: el });
};

/** One shared vault file, as both Macs see it once synced. */
function memAdapter(files = new Map<string, string>()) {
  return {
    files,
    async exists(p: string) { return files.has(p) || [...files.keys()].some((k) => k.startsWith(`${p}/`)); },
    async read(p: string) { return files.get(p)!; },
    async list() { return { files: [], folders: [] }; },
    async write(p: string, d: string) { files.set(p, d); },
    async mkdir() {},
  };
}

describe('the tips’ memory', () => {
  it('the six signed-off tips, in order, at their elements, with no em-dashes', () => {
    assert.deepEqual(TIPS.map((t) => [t.id, t.screen]), [['readiness', 'today'], ['why', 'today'], ['log', 'today'], ['due', 'today'], ['sunday', 'checkin'], ['cycle', 'progress']]);
    for (const t of TIPS) assert.doesNotMatch(t.text, /—/);
    assert.match(TIPS[0]!.text, /^Readiness compares this morning with your own usual/);
  });

  it('reads a missing or broken file as nothing seen; keeps only known tips', () => {
    assert.deepEqual(parseHelp(null), FRESH_HELP);
    assert.deepEqual(parseHelp('{ nope'), FRESH_HELP);
    assert.deepEqual(parseHelp(JSON.stringify({ tips: { why: '2026-11-02', bogus: 'x' }, welcomeHidden: '2026-11-02' })), { schemaVersion: 1, tips: { why: '2026-11-02' }, welcomeHidden: '2026-11-02' });
  });

  it('seen, reset and hide; the next tip per screen among those drawn', () => {
    let st = applyHelp(FRESH_HELP, { op: 'seen', tips: ['readiness'], on: '2026-11-02' });
    assert.equal(nextTip(st, 'today', () => true)!.id, 'why');
    assert.equal(nextTip(st, 'today', (sel) => sel !== '.pv-why-btn:not(.is-none)')!.id, 'log', 'a tip whose element is not drawn waits');
    assert.equal(nextTip(st, 'checkin', () => true)!.id, 'sunday');
    st = applyHelp(st, { op: 'hide-welcome', on: '2026-11-02' });
    st = applyHelp(st, { op: 'reset' });
    assert.deepEqual([st.tips, st.welcomeHidden], [{}, '2026-11-02'], 'the tips again; the welcome card stays hidden');
  });

  it('two Macs: each write reads the file first, so neither drops the other’s tips; a reset on one is kept', async () => {
    const shared = new Map<string, string>();
    const a = new HelpStore(memAdapter(shared));
    const b = new HelpStore(memAdapter(shared));
    await a.apply({ op: 'seen', tips: ['readiness'], on: '2026-11-02' });
    await b.apply({ op: 'seen', tips: ['why'], on: '2026-11-03' });
    assert.deepEqual(Object.keys((await a.read()).tips).sort(), ['readiness', 'why']);
    await a.apply({ op: 'reset' });
    await b.apply({ op: 'seen', tips: ['log'], on: '2026-11-03' });
    assert.deepEqual((await b.read()).tips, { log: '2026-11-03' });
    assert.ok(shared.has(paths().help));
    assert.match(shared.get(paths().help)!, /\n$/);
  });

  it('writes nothing for a change that changes nothing', async () => {
    const shared = new Map<string, string>();
    await new HelpStore(memAdapter(shared)).apply({ op: 'reset' });
    assert.equal(shared.size, 0);
  });
});

describe('the screens’ memory in Coach/help.json', () => {
  const fresh = (): HelpState => ({ ...FRESH_HELP, tips: {} });

  it('keeps only the known tabs, well-formed folds and light checks; the visits capped at the 3 the panel opens for', () => {
    const st = parseHelp(JSON.stringify({
      tips: {},
      glance: { today: { visits: 7, open: false }, food: { visits: 1 }, bogus: { visits: 1 }, plan: 'x' },
      folds: { today: { readiness: { folded: false, on: '2026-11-03' }, 'Bad Id': { folded: true, on: '2026-11-03' }, week: { folded: 'yes', on: '2026-11-03' } }, progress: { 'overview.sets': { folded: true, on: '2026-11-02' } }, nope: {} },
      foodChecks: { '2026-11-03': { veg: [1, 0, 0, 12, -1, 'a'], 'Bad Id': [0] }, 'not a day': { veg: [0] }, '2026-11-04': { fruit: [] } },
    }));
    assert.deepEqual(st.glance, { today: { visits: OPEN_VISITS, open: false }, food: { visits: 1 } });
    assert.deepEqual(st.folds, { today: { readiness: { folded: false, on: '2026-11-03' } }, progress: { 'overview.sets': { folded: true, on: '2026-11-02' } } });
    assert.deepEqual(st.foodChecks, { '2026-11-03': { veg: [0, 1] } });
    assert.deepEqual(parseHelp(JSON.stringify({ tips: {}, welcomeHidden: null })), FRESH_HELP, 'a file without them reads as before');
  });

  it('a visit counts until 3; the panel opens on the early visits, else folds, unless the user chose', () => {
    let st = fresh();
    for (let i = 0; i < 5; i++) st = applyHelp(st, { op: 'visit', tab: 'plan' });
    assert.equal(st.glance!.plan!.visits, OPEN_VISITS);
    assert.equal(earlyVisit(fresh(), 'plan'), true);
    assert.equal(earlyVisit(applyHelp(applyHelp(fresh(), { op: 'visit', tab: 'plan' }), { op: 'visit', tab: 'plan' }), 'plan'), true, 'the third visit is still one of the first');
    assert.equal(earlyVisit(st, 'plan'), false);
    assert.equal(earlyVisit(st, 'food'), true, 'per tab');
    assert.equal(panelOpen(st, 'plan', false), false);
    st = applyHelp(st, { op: 'panel', tab: 'plan', open: true });
    assert.equal(panelOpen(st, 'plan', false), true, 'the user’s open wins over the visits');
    st = applyHelp(st, { op: 'panel', tab: 'plan', open: false });
    assert.equal(panelOpen(st, 'plan', true), false, 'and the user’s fold');
    assert.deepEqual(applyHelp(st, { op: 'reset' }).glance, st.glance, 'Show the tips again keeps the panels');
  });

  it('a section: the user’s choice, else its starting state; something due opens on a new day whatever was folded before', () => {
    const sec = { id: 'readiness', start: 'folded' as const };
    assert.equal(sectionFolded(null, 'today', sec, '2026-11-03'), true);
    assert.equal(sectionFolded(null, 'today', { ...sec, start: 'open' }, '2026-11-03'), false);
    let st = applyHelp(fresh(), { op: 'fold', tab: 'today', sections: { readiness: false, due: true }, on: '2026-11-02' });
    assert.equal(sectionFolded(st, 'today', sec, '2026-11-03'), false, 'opened by the user, kept');
    assert.equal(sectionFolded(st, 'today', { id: 'due', start: 'open' }, '2026-11-03'), true, 'folded by the user, kept');
    assert.equal(sectionFolded(st, 'today', { id: 'due', start: 'open', due: true }, '2026-11-03'), false, 'due today: yesterday’s fold gives way');
    assert.equal(sectionFolded(st, 'today', { id: 'due', start: 'open', due: true }, '2026-11-02'), true, 'folded today while due: kept');
    assert.equal(sectionFolded(st, 'checkin', { id: 'due', start: 'folded' }, '2026-11-03'), true, 'per tab');
    st = applyHelp(st, { op: 'fold', tab: 'today', sections: { readiness: true, week: true, fortoday: true }, on: '2026-11-03' });
    assert.deepEqual(Object.keys(st.folds!.today!).sort(), ['due', 'fortoday', 'readiness', 'week'], 'Fold all: every section at once, the others kept');
  });

  it('the light checks: a slot tapped and untapped, the day and the check dropped when empty, the last 2 weeks kept', () => {
    let st = applyHelp(fresh(), { op: 'check', date: '2026-11-01', id: 'veg', slot: 0, on: true });
    st = applyHelp(st, { op: 'check', date: '2026-11-03', id: 'veg', slot: 1, on: true });
    st = applyHelp(st, { op: 'check', date: '2026-11-03', id: 'veg', slot: 0, on: true });
    st = applyHelp(st, { op: 'check', date: '2026-11-03', id: 'fruit', slot: 0, on: true });
    assert.deepEqual(st.foodChecks, { '2026-11-01': { veg: [0] }, '2026-11-03': { veg: [0, 1], fruit: [0] } });
    st = applyHelp(st, { op: 'check', date: '2026-11-03', id: 'fruit', slot: 0, on: false });
    assert.deepEqual(st.foodChecks!['2026-11-03'], { veg: [0, 1] });
    st = applyHelp(st, { op: 'check', date: `2026-11-${String(1 + CHECK_DAYS + 1).padStart(2, '0')}`, id: 'veg', slot: 0, on: true });
    assert.ok(!('2026-11-01' in st.foodChecks!), 'older than two weeks: dropped');
    let empty = applyHelp(fresh(), { op: 'check', date: '2026-11-03', id: 'veg', slot: 0, on: true });
    empty = applyHelp(empty, { op: 'check', date: '2026-11-03', id: 'veg', slot: 0, on: false });
    assert.equal(empty.foodChecks, undefined);
  });

  it('two Macs and quick clicks: each change reads the file the last one wrote, and reads back as written', async () => {
    const shared = new Map<string, string>();
    const a = new HelpStore(memAdapter(shared));
    const b = new HelpStore(memAdapter(shared));
    // Two folds on one Mac before the first write lands, then one on the other Mac.
    const [x, y] = await Promise.all([a.apply({ op: 'fold', tab: 'plan', sections: { meso: true }, on: '2026-11-03' }), a.apply({ op: 'fold', tab: 'plan', sections: { vol: false }, on: '2026-11-03' })]);
    assert.deepEqual(Object.keys(x.folds!.plan!), ['meso']);
    assert.deepEqual(Object.keys(y.folds!.plan!).sort(), ['meso', 'vol']);
    await b.apply({ op: 'check', date: '2026-11-03', id: 'veg', slot: 1, on: true });
    await a.apply({ op: 'seen', tips: ['why'], on: '2026-11-03' });
    const after = await b.read();
    assert.deepEqual([Object.keys(after.folds!.plan!).sort(), after.foodChecks, Object.keys(after.tips)], [['meso', 'vol'], { '2026-11-03': { veg: [1] } }, ['why']]);
    // A file that does not read back as written is an error, not a silent loss.
    const bad = { ...memAdapter(new Map()), async write() {} };
    const failed = await new HelpStore(bad).apply({ op: 'visit', tab: 'food' }).then(() => null, (e: Error) => e.message);
    assert.match(failed ?? '', /did not read back/);
  });
});

describe('the help’s pieces', () => {
  it('the ? menu: User guide and Show the tips again', () => {
    const calls: string[] = [];
    const m = helpMenu({ onGuide: () => void calls.push('guide'), onTips: () => void calls.push('tips') }) as unknown as FakeElement;
    assert.deepEqual(m.querySelectorAll('.pv-menu-item').map(text), ['User guide', 'Show the tips again', 'When to talk to the coach']);
    click(m.querySelector('[data-k="help"]'));
    assert.ok(m.classList.contains('is-open'));
    click(m.querySelector('[data-k="help-guide"]'));
    click(m.querySelector('[data-k="help-tips"]'));
    assert.deepEqual(calls, ['guide', 'tips']);
  });

  it('the ? menu’s When to talk to the coach: the scheduled steps with their commands, and the times to ask on your own', () => {
    const m = helpMenu({ onGuide: () => {}, onTips: () => {} }) as unknown as FakeElement;
    click(m.querySelector('[data-k="help"]'));
    click(m.querySelector('[data-k="help-coach"]'));
    assert.ok(m.classList.contains('is-coach') && !m.classList.contains('is-open'), 'the panel in place of the menu');
    const panel = m.querySelector('[data-help="coach"]')!;
    assert.deepEqual(panel.querySelectorAll('.pv-hc-list li').map((li) => [text(li.querySelector('b')!), text(li.querySelector('code')!)]), [['Every Sunday, after you save the questions', '/fitness-coach checkin'], ['Each light week’s Sunday, and each phase end', '/fitness-coach review']]);
    const any = panel.querySelectorAll('.pv-hc-any li').map(text);
    assert.equal(any.length, 8);
    assert.deepEqual([any[0], any.at(-1)], ['Pain or an injury', 'Any question about your numbers']);
    assert.match(text(panel), /Type \/fitness-coach and say what’s going on/);
    assert.doesNotMatch(text(panel), /—/);
    click(panel.querySelector('[data-k="help-coach-close"]'));
    assert.ok(!m.classList.contains('is-coach'), 'Got it closes it');
    assert.equal(COACH_TIMES.scheduled.length, 2);
  });

  it('the welcome card: the steps from the files, the next one marked, Open the guide, Show me around, Hide', () => {
    const read = readVault(memoryIo(fixtureFiles('v'), '2026-04-10'), 'v', { asOf: '2026-04-10' });
    const calls: string[] = [];
    const card = welcomeCard({ welcome: welcomeSteps(read, '2026-04-10').value, onGuide: () => void calls.push('guide'), onTour: () => void calls.push('tour'), onHide: () => void calls.push('hide') }) as unknown as FakeElement;
    assert.match(text(card), /Welcome to Pahlavan/);
    assert.match(text(card), /4 of 5 first steps done/);
    assert.equal(card.querySelectorAll('li.is-done').length, 4);
    assert.equal(card.querySelector('li.is-next')!.getAttribute('data-step'), 'sunday');
    for (const k of ['welcome-guide', 'welcome-tour', 'welcome-hide']) click(card.querySelector(`[data-k="${k}"]`));
    assert.deepEqual(calls, ['guide', 'tour', 'hide']);
    assert.doesNotMatch(text(card), /—/);
    assert.equal(text(card.querySelector('[data-k="welcome-safety"]')!), SAFETY_LINE, 'the safety line, as the settings and the README say it');
    assert.match(SAFETY_LINE, /adults 18 and over, not medical advice/);
  });

  it('the welcome card on a fresh vault: Set up the coach first, with its button and a missing Node; the commands with Copy', () => {
    const read = readVault(memoryIo({ 'v/Welcome.md': '' }, '2026-04-10'), 'v', { asOf: '2026-04-10' });
    const calls: string[] = [];
    const draw = (state: 'checking' | 'missing' | 'old' | 'ok', node: boolean | null) => welcomeCard({ welcome: welcomeSteps(read, '2026-04-10').value, onGuide: () => {}, onTour: () => {}, onHide: () => {}, onCopy: (t) => void calls.push(`copy ${t}`), coach: { state, node, onSetUp: () => void calls.push('setup') } }) as unknown as FakeElement;
    const fresh = draw('missing', false);
    assert.match(text(fresh), /0 of 6 first steps done/);
    assert.equal(fresh.querySelector('li.is-next')!.getAttribute('data-step'), 'coach');
    assert.match(text(fresh.querySelector('li[data-step="coach"]')!), /Set up the coach.*It needs Node 18 or later/);
    click(fresh.querySelector('[data-k="welcome-coach"]'));
    for (const b of fresh.querySelectorAll('[data-k="copy-command"]')) click(b);
    assert.deepEqual(calls, ['setup', 'copy /fitness-coach intake', 'copy /fitness-coach plan', 'copy /fitness-coach checkin']);
    assert.equal(draw('checking', null).querySelector('[data-k="welcome-coach"]'), null, 'no button until Pahlavan has looked');
    assert.equal(text(draw('old', true).querySelector('[data-k="welcome-coach"]')!), 'Update the coach');
    const set = draw('ok', true);
    assert.match(text(set), /1 of 6 first steps done/);
    assert.equal(set.querySelector('li.is-next')!.getAttribute('data-step'), 'intake');
    assert.equal(set.querySelector('[data-k="welcome-coach"]'), null);
    assert.doesNotMatch(text(set), /Node 18/);
  });

  it('a tip: its place, its words, Got it and Skip the tips', () => {
    const calls: string[] = [];
    const t = tipBubble({ tip: TIPS[1]!, n: 2, total: 6, onGot: () => void calls.push('got'), onSkip: () => void calls.push('skip') }) as unknown as FakeElement;
    assert.match(text(t), /^Tip 2 of 6WhyEvery number has a reason/);
    click(t.querySelector('[data-k="tip-got"]'));
    click(t.querySelector('[data-k="tip-skip"]'));
    assert.deepEqual(calls, ['got', 'skip']);
  });

  it('the guide’s address: the published page by default, a web address kept, anything else not', () => {
    assert.equal(loadPluginData(null, { gitSynced: false }).data.guideUrl, DEFAULT_GUIDE_URL);
    assert.equal(loadPluginData({ version: 2, guideUrl: 'https://example.org/guide' }, { gitSynced: false }).data.guideUrl, 'https://example.org/guide');
    assert.equal(loadPluginData({ version: 2, guideUrl: 'file:///etc/passwd' }, { gitSynced: false }).data.guideUrl, DEFAULT_GUIDE_URL);
  });
});
