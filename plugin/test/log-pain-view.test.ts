// The Log panel's pain, drawn in Node with the small fake DOM: a skip for
// Pain turns the pain on with the row as its exercise, and until the slider
// moves the severity is not given, so the entry saves no severity (never
// the slider's start of 3); moving it saves the number, and so does a
// deliberate tap, click or Enter on it at its start.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildSession, logFormFor, type LogForm } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { freshPanelState, previewEntry, renderLogPanel, type LogPanelCtx } from '../src/ui/log-panel.ts';
import { FakeElement, installFakeDom } from './fake-dom.ts';

installFakeDom();
const DATE = '2026-04-10';
const read = readVault(memoryIo(fixtureFiles('v'), DATE), 'v', { asOf: DATE });

function panel(): { form: LogForm; ctx: LogPanelCtx; layer: FakeElement; draw: () => void } {
  const form = logFormFor(read, buildSession(read.data, DATE, 'full', { type: 'A' }), DATE)!;
  const layer = new FakeElement('div');
  const ctx: LogPanelCtx = { form, state: freshPanelState(), plan: read.raw!.plan, log: read.raw!.log, today: DATE, onChange: () => draw(), onClose: () => {}, onRebuild: () => {}, onDate: () => {}, onSave: () => {}, onDelete: () => {}, onEditExisting: () => {}, onUseDisk: () => {} };
  const draw = () => renderLogPanel(layer as unknown as HTMLElement, ctx);
  draw();
  return { form, ctx, layer, draw };
}
const fire = (el: FakeElement, type: string) => {
  for (const fn of el.listeners.get(type) ?? []) fn({ target: el } as unknown as Event);
};
const button = (root: FakeElement, text: string) => root.querySelectorAll('button').find((b) => b.textContent.trim() === text)!;

describe('the Log panel: a pain skip whose slider was not moved', () => {
  it('saves no severity, and the summary says not given', () => {
    const { form, ctx, layer, draw } = panel();
    // The paired line (Face Pull + Band External Rotation), skipped.
    const i = form.rows.findIndex((r) => r.parts.length > 1);
    const name = form.rows[i]!.name;
    form.rows[i]!.done = false;
    draw();
    // The skipped row's Pain reason turns the pain on, during that row.
    fire(button(layer.querySelectorAll('.pv-lg-item')[i]!, 'Pain'), 'click');
    assert.deepEqual([form.rows[i]!.why, form.painOn, form.pain.during, form.pain.severity], ['pain', true, name, null]);
    const sev = layer.querySelector('.pv-lg-sev')!;
    assert.ok(sev.classList.contains('is-unset'));
    assert.equal(sev.querySelector('b')!.textContent, '–/10');
    assert.equal(sev.querySelector('input')!.getAttribute('aria-valuetext'), 'not given');
    assert.match(layer.querySelector('.pv-lg-pain .pv-lg-hint')!.textContent, /move or tap the slider to say how bad, or it is saved as not given/);
    const r = previewEntry(ctx);
    assert.ok(r.ok, !r.ok ? r.error : '');
    assert.deepEqual(r.entry['pain'], [{ area: 'Lower back', exercise: name }]);
    assert.deepEqual((r.entry['checklist'] as { why?: Record<string, string> }).why, { [form.rows[i]!.line!]: 'pain' });
    // The summary.
    ctx.state.summary = true;
    draw();
    assert.match(layer.querySelector('.pv-lg-sum')!.textContent, /PainLower back \(how bad: not given\), during /);
  });

  it('moving the slider gives the severity, and the entry saves it', () => {
    const { form, ctx, layer } = panel();
    fire(button(layer, 'Yes'), 'click');
    assert.equal(form.painOn, true);
    const input = layer.querySelector('.pv-lg-sev input')!;
    (input as unknown as { value: string }).value = '5';
    fire(input, 'input');
    assert.equal(form.pain.severity, 5);
    const sev = layer.querySelector('.pv-lg-sev')!;
    assert.deepEqual([sev.classList.contains('is-unset'), sev.querySelector('b')!.textContent, input.getAttribute('aria-valuetext')], [false, '5/10', null]);
    const r = previewEntry(ctx);
    assert.ok(r.ok);
    assert.deepEqual(r.entry['pain'], [{ area: 'Lower back', severity: 5 }]);
  });

  it('a tap or click on the slider at its start records it (3), and so does Enter or Space; an untouched slider stays not given', () => {
    for (const [type, extra] of [['pointerup', {}], ['click', {}], ['keydown', { key: 'Enter' }], ['keydown', { key: ' ' }]] as const) {
      const { form, ctx, layer } = panel();
      fire(button(layer, 'Yes'), 'click');
      const input = layer.querySelector('.pv-lg-sev input')!;
      // The browser's value at the start: the slider's own 3.
      (input as unknown as { value: string }).value = input.getAttribute('value')!;
      assert.equal(form.pain.severity, null, 'drawn, not yet touched');
      for (const fn of input.listeners.get(type) ?? []) fn({ target: input, preventDefault: () => {}, ...extra } as unknown as Event);
      assert.equal(form.pain.severity, 3, `${type} ${JSON.stringify(extra)}`);
      assert.deepEqual([layer.querySelector('.pv-lg-sev')!.classList.contains('is-unset'), layer.querySelector('.pv-lg-sev b')!.textContent], [false, '3/10']);
      const r = previewEntry(ctx);
      assert.ok(r.ok);
      assert.deepEqual(r.entry['pain'], [{ area: 'Lower back', severity: 3 }]);
    }
    // Another key (Tab, moving the focus on) is no answer.
    const { form, layer } = panel();
    fire(button(layer, 'Yes'), 'click');
    const input = layer.querySelector('.pv-lg-sev input')!;
    (input as unknown as { value: string }).value = '3';
    for (const fn of input.listeners.get('keydown') ?? []) fn({ target: input, key: 'Tab', preventDefault: () => {} } as unknown as Event);
    assert.equal(form.pain.severity, null);
  });
});
