// Today's rows with the plan's rest, supersets and form cues, drawn in Node
// with the small fake DOM: a pair is numbered 3a and 3b, its rows joined
// into one block (one tick, for both), each naming the other; every row
// says its rest; a cue line only where the note has a cue. The Log panel
// tags the paired line as a superset.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checklistLines } from '../../src/adapters/vault/log-write.ts';
import { readVault } from '../../src/adapters/vault/read.ts';
import { checklistTargets } from '../../src/report/dashboard.ts';
import { buildToday, logFormFor } from '../../src/report/index.ts';
import { applySupersets } from '../../test/fixtures/supersets.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { freshPanelState, renderLogPanel } from '../src/ui/log-panel.ts';
import { renderToday, type TodayContext } from '../src/ui/today.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const DATE = '2026-04-10'; // the rotation suggests B
const files = fixtureFiles('v');
applySupersets(files, 'v');
const read = readVault(memoryIo(files, DATE), 'v', { asOf: DATE });

function draw(pick: string | null = null, opts: { checklist?: boolean } = {}) {
  const m = buildToday(read, DATE, 'full', 'v', { type: pick });
  const sess = m.session!;
  let checklist: TodayContext['checklist'] = null;
  if (opts.checklist) {
    const lines = checklistLines(read.raw!.plan, sess.session!.type, false, false).map((l) => ({ ...l, steps: [] }));
    checklist = { lines, checked: lines.map(() => false), targets: checklistTargets(lines, sess.items, sess.finisher?.name ?? null), canTick: true };
  }
  const ticked: number[] = [];
  const ctx: TodayContext = { mode: 'full', session: sess, phase: { id: 'workday', isfahan: false }, open: new Set(), pick, onMode: () => {}, onPick: () => {}, onToggleWhy: () => {}, onLog: () => {}, onEditSession: () => {}, checklist, onTick: (i) => void ticked.push(i) };
  const root = new FakeElement('div');
  renderToday(root as unknown as HTMLElement, m, ctx);
  return { root, rows: root.querySelectorAll('.pv-ex'), ticked, sess };
}

describe('Today’s rows: rest, supersets and form cues', () => {
  it('numbers the rows as the month plan does; a pair’s two rows join into one block', () => {
    const { rows } = draw();
    assert.deepEqual(rows.map((r) => text(r.querySelector('.pv-ex-num')!)), ['1', '2', '3a', '3b']);
    assert.deepEqual(rows.map((r) => [r.classList.contains('is-pair-a'), r.classList.contains('is-pair-b')]), [[false, false], [false, false], [true, false], [false, true]]);
    const badges = rows.map((r) => r.querySelector('.pv-ex-num')!);
    assert.ok(badges[2]!.classList.contains('is-pair') && badges[3]!.classList.contains('is-pair') && !badges[1]!.classList.contains('is-pair'));
    assert.equal(badges[2]!.getAttribute('data-tip'), 'Superset|Bulgarian Split Squat, then Side Plank: a set of each, then rest');
    assert.equal(badges[3]!.getAttribute('data-tip'), 'Superset|Bulgarian Split Squat, then Side Plank: a set of each, then rest');
  });

  it('the second line: sets for a lift with a target, the partner, then the plan’s rest', () => {
    const { rows } = draw();
    assert.deepEqual(rows.map((r) => text(r.querySelector('.pv-ex-meta')!)), [
      'rest 2 min',
      '3 sets · rest 90 s',
      'with Side Plank · rest 90 s after each pair',
      'with Bulgarian Split Squat · rest 90 s after each pair',
    ]);
    assert.equal(text(rows[2]!.querySelector('.pv-ex-pair b')!), 'Side Plank');
  });

  it('a cue line where the note has one; none for a swap or a note that is only RIR and a Why', () => {
    const { rows } = draw();
    assert.deepEqual(rows.map((r) => (r.querySelector('.pv-ex-cue') ? text(r.querySelector('.pv-ex-cue')!) : null)), [null, 'Chest up, pull to the lower ribs.', 'Dumbbells.', null]);
    // The Why still holds the plan's reason, and the superset sentence is in neither.
    const { root } = draw();
    assert.doesNotMatch(text(root.querySelector('.pv-ex-list')!), /Superset with|a set of each|RIR 2\.|Double progression|Why:/);
  });

  it('one tick for the pair, on its first row, named for both; the second row keeps the column', () => {
    const { rows, ticked } = draw(null, { checklist: true });
    const t = rows[2]!.querySelector('.pv-tick')!;
    assert.equal(t.getAttribute('aria-label'), 'Bulgarian Split Squat + Side Plank: not done yet');
    assert.equal(rows[3]!.querySelector('.pv-tick'), null);
    assert.ok(rows[3]!.querySelector('.pv-tick-gap'));
    for (const fn of t.listeners.get('click') ?? []) fn({});
    assert.deepEqual(ticked, [3], 'the checklist’s paired line (warm-up, RDL, row, then the pair)');
    // Without a checklist there are no ticks and no gaps.
    assert.equal(draw().rows[3]!.querySelector('.pv-tick-gap'), null);
  });

  it('A by pick: the temporary change’s cue, the pair from the plan’s first accessories', () => {
    const { rows } = draw('A');
    assert.deepEqual(rows.map((r) => text(r.querySelector('.pv-ex-num')!)), ['1', '2', '3a', '3b']);
    assert.equal(text(rows[0]!.querySelector('.pv-ex-cue')!), 'Elbows inside the knees.');
    assert.equal(rows[2]!.querySelector('.pv-ex-cue'), null);
    assert.equal(text(rows[3]!.querySelector('.pv-ex-cue')!), 'Elbow at your side, a rolled towel under it.');
  });

  it('a rest of "—" says nothing; the screen shows no em-dash', () => {
    const plain = readVault(memoryIo(fixtureFiles('v'), DATE), 'v', { asOf: DATE });
    const m = buildToday(plain, DATE, 'full', 'v', { type: 'A' });
    const root = new FakeElement('div');
    renderToday(root as unknown as HTMLElement, m, { mode: 'full', session: m.session, phase: { id: 'workday', isfahan: false }, open: new Set(), pick: 'A', onMode: () => {}, onPick: () => {}, onToggleWhy: () => {}, onLog: () => {}, onEditSession: () => {} });
    const rows = root.querySelectorAll('.pv-ex');
    assert.equal(text(rows[2]!.querySelector('.pv-ex-meta')!), 'with Band External Rotation');
    assert.equal(text(rows[3]!.querySelector('.pv-ex-meta')!), 'with Face Pull · rest 45 s');
    assert.doesNotMatch(text(root.querySelector('.pv-session')!), /—/);
    assert.doesNotMatch(text(draw().root.querySelector('.pv-session')!), /—/);
  });

  it('the Log panel tags the paired line as a superset', () => {
    const { sess } = draw();
    const form = logFormFor(read, sess, DATE)!;
    const layer = new FakeElement('div');
    renderLogPanel(layer as unknown as HTMLElement, { form, state: freshPanelState(), plan: read.raw!.plan, log: read.raw!.log, today: DATE, onChange: () => {}, onClose: () => {}, onRebuild: () => {}, onDate: () => {}, onSave: () => {}, onDelete: () => {}, onEditExisting: () => {}, onUseDisk: () => {} });
    const items = layer.querySelectorAll('.pv-lg-item');
    const paired = items.filter((li) => li.querySelectorAll('.pv-lg-tag').some((t) => text(t) === 'Superset'));
    assert.equal(paired.length, 1);
    assert.match(text(paired[0]!.querySelector('.pv-lg-name-line')!), /Bulgarian Split Squat \+ Side Plank/);
  });
});
