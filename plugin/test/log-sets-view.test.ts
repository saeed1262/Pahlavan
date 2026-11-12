// The Log panel at Every set, drawn in Node with the small fake DOM: a tick
// per set (its number), an RIR tap that ticks the set too, "Every set as
// the target" ticking them all, and Save writing the ticked sets only. The
// summary counts the ticked sets per exercise, and a superset's parts each
// get their own sets, saved as their own exercises.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeLog } from '../../src/adapters/vault/log-write.ts';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildSession, logFormFor, type LogForm } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { freshPanelState, previewEntry, renderLogPanel, type LogPanelCtx } from '../src/ui/log-panel.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const DATE = '2026-04-10';
const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
const files = fixtureFiles('v');
const read = readVault(memoryIo(files, DATE), 'v', { asOf: DATE });
type Sets = { name: string; planned?: string; sets: { weight?: number; unit?: string; reps: number; rir?: number }[] }[];

/** Session A at Every set, drawn; `click` and `type` act as a tap and a typed value, and the panel draws again. */
function panel(over: Partial<LogPanelCtx> = {}) {
  const form: LogForm = logFormFor(read, buildSession(read.data, DATE, 'full', { type: 'A' }), DATE)!;
  form.tracking = 'full';
  const layer = new FakeElement('div');
  const ctx: LogPanelCtx = { form, state: freshPanelState(), plan: read.raw!.plan, log: read.raw!.log, today: DATE, onChange: () => draw(), onClose: () => {}, onRebuild: () => {}, onDate: () => {}, onSave: () => {}, onDelete: () => {}, onEditExisting: () => {}, onUseDisk: () => {}, ...over };
  const draw = () => renderLogPanel(layer as unknown as HTMLElement, ctx);
  draw();
  const button = (label: string) => {
    const b = layer.querySelectorAll('button').find((x) => x.getAttribute('aria-label') === label || (!x.hasAttribute('aria-label') && text(x) === label));
    assert.ok(b, `the button "${label}"`);
    return b;
  };
  const click = (label: string) => {
    const b = button(label);
    for (const fn of b.listeners.get('click') ?? []) fn({ target: b, stopPropagation() {}, preventDefault() {} });
  };
  const type = (label: string, v: string) => {
    const input = layer.querySelectorAll('input').find((x) => x.getAttribute('aria-label') === label);
    assert.ok(input, `the input "${label}"`);
    (input as unknown as { value: string }).value = v;
    for (const fn of input.listeners.get('change') ?? []) fn({ target: input });
  };
  const saved = () => {
    const r = previewEntry(ctx);
    assert.ok(r.ok, r.ok ? '' : r.error);
    return r.entry;
  };
  const setsOf = (name: string) => ((saved()['exerciseSets'] as Sets).find((x) => x.name === name)?.sets ?? null);
  return { form, ctx, layer, button, click, type, saved, setsOf, draw };
}

describe('the Log panel at Every set: a tick per set', () => {
  it('rows start from the target, none ticked, so nothing is saved for them yet', () => {
    const p = panel();
    const goblet = p.form.rows.find((r) => r.name === 'Goblet Squat')!;
    assert.deepEqual(goblet.rows.map((x) => [x.weight, x.reps, x.done]), [[55, 10, false], [55, 10, false], [55, 10, false]]);
    assert.equal(p.setsOf('Goblet Squat'), null);
    assert.equal(p.button('Set 1 done').getAttribute('aria-pressed'), 'false');
  });

  it('a tick saves only that set, as shown, and makes it the logged lift\'s top set', () => {
    const p = panel();
    p.click('Set 1 done');
    assert.deepEqual(p.setsOf('Goblet Squat'), [{ weight: 55, unit: 'lb', reps: 10 }]);
    assert.deepEqual(p.saved()['lift1'], { name: 'Goblet Squat', weight: 55, reps: 10, unit: 'lb' });
    // Tapped again: unticked, and not saved.
    p.click('Set 1 done');
    assert.equal(p.setsOf('Goblet Squat'), null);
    assert.deepEqual(p.saved()['lift1'], { name: 'Goblet Squat', weight: 0, reps: 0, unit: 'lb' });
  });

  it('an RIR tap ticks the set too; 4 and 5+ are two chips', () => {
    const p = panel();
    // The first set's chips belong to Goblet Squat (the first table).
    const chips = p.layer.querySelectorAll('.pv-lg-rir')[0]!.querySelectorAll('button').map((b) => text(b));
    assert.deepEqual(chips, ['0', '1', '2', '3', '4', '5+']);
    const rir = (n: number, label: string) => {
      const b = p.layer.querySelectorAll('.pv-lg-rir')[n]!.querySelectorAll('button').find((x) => x.getAttribute('aria-label') === label)!;
      for (const fn of b.listeners.get('click') ?? []) fn({ target: b });
    };
    rir(1, 'RIR 2');
    assert.deepEqual(p.setsOf('Goblet Squat'), [{ weight: 55, unit: 'lb', reps: 10, rir: 2 }]);
    rir(2, 'RIR 5 or more');
    assert.deepEqual(p.setsOf('Goblet Squat')!.map((s) => s.rir), [2, 5]);
    rir(0, 'RIR 4');
    assert.deepEqual(p.setsOf('Goblet Squat')!.map((s) => s.rir), [4, 2, 5]);
  });

  it('"Every set as the target" fills and ticks them all', () => {
    const p = panel();
    p.type('Set 2 reps', '7');
    assert.deepEqual(p.setsOf('Goblet Squat'), [{ weight: 55, unit: 'lb', reps: 7 }], 'a typed value ticks its set');
    const [target] = p.layer.querySelectorAll('.pv-lg-sets-foot button').filter((b) => text(b) === 'Every set as the target');
    for (const fn of target!.listeners.get('click') ?? []) fn({ target });
    assert.deepEqual(p.setsOf('Goblet Squat'), [{ weight: 55, unit: 'lb', reps: 10 }, { weight: 55, unit: 'lb', reps: 10 }, { weight: 55, unit: 'lb', reps: 10 }]);
  });

  it('the summary and the foot count the ticked sets; an exercise with none says so', () => {
    const p = panel();
    p.click('Set 1 done');
    p.click('Set 2 done');
    p.ctx.state.summary = true;
    p.draw();
    const sum = text(p.layer.querySelector('.pv-lg-sum')!);
    assert.match(sum, /Goblet Squat: 2 of 3 sets ticked/);
    assert.match(sum, /Flat DB Bench Press: no sets ticked/);
    assert.match(sum, /2 sets across 1 exercises/);
    assert.match(text(p.layer.querySelector('.pv-lg-foot-line')!), /2 of \d+ sets ticked/);
    // Every set ticked: no line for it.
    for (const s of p.form.rows.find((r) => r.name === 'Goblet Squat')!.rows) s.done = true;
    p.draw();
    assert.doesNotMatch(text(p.layer.querySelector('.pv-lg-sum')!), /Goblet Squat: /);
  });

  it('a set without reps cannot be ticked until its reps are in', () => {
    const p = panel();
    const face = p.form.rows.find((r) => r.split)!.split!.find((x) => x.name === 'Face Pull')!;
    assert.equal(face.rows[0]!.reps, null);
    assert.ok(p.button('Face Pull, set 1 done').hasAttribute('disabled'));
    p.type('Face Pull, set 1 reps', '15');
    assert.equal(face.rows[0]!.done, true);
    assert.ok(!p.button('Face Pull, set 1 done').hasAttribute('disabled'));
  });

  it('a superset\'s parts each get their sets, saved as their own exercises, and read back so', () => {
    const p = panel();
    const pair = p.form.rows.find((r) => r.line === 'Face Pull + Band External Rotation')!;
    assert.deepEqual(pair.split!.map((x) => [x.name, x.kind, x.rows.length]), [['Face Pull', 'load', 3], ['Band External Rotation', 'reps', 2]]);
    const li = p.layer.querySelectorAll('.pv-lg-item')[p.form.rows.indexOf(pair)]!;
    assert.deepEqual(li.querySelectorAll('.pv-lg-part b').map((b) => text(b)), ['Face Pull', 'Band External Rotation']);
    p.type('Face Pull, set 1 weight', '30');
    p.type('Face Pull, set 1 reps', '15');
    p.type('Band External Rotation, set 1 reps', '15');
    p.type('Band External Rotation, set 2 reps', '12');
    assert.deepEqual(p.setsOf('Face Pull'), [{ weight: 30, unit: 'lb', reps: 15 }]);
    assert.deepEqual(p.setsOf('Band External Rotation'), [{ reps: 15 }, { reps: 12 }]);
    // Into the log and read back: two exercises, each with its own sets.
    const entry = p.saved();
    const m = mergeLog(files[LOG]!, entry, { mode: 'add' });
    assert.equal(m.result, 'added');
    const back = readVault(memoryIo({ ...files, [LOG]: m.text! }, DATE), 'v', { asOf: DATE });
    const s = back.data.sessions.find((x) => x.date === DATE && x.template === 'a')!;
    assert.equal(s.trackingLevel, 'full');
    assert.deepEqual(s.exercises.map((x) => [x.exercise, x.sets.length]).sort(), [['band-external-rotation', 2], ['face-pull', 1]]);
  });

  it('switching the tracking is reported, for the next new log on this Mac', () => {
    const seen: string[] = [];
    const p = panel({ onTracking: (t) => seen.push(t) });
    const seg = p.layer.querySelector('.pv-lg-track')!.querySelectorAll('button');
    for (const b of seg) for (const fn of b.listeners.get('click') ?? []) fn({ target: b });
    assert.deepEqual(seen, ['standard', 'full']);
  });
});
