// The engine's reading of Pahlavan's quiet hours (the vault adapter, for the
// CLI's due and tracked) against the plugin's own: the same defaults, and the
// same hours into the reminder rules from the same data.json, partial or
// malformed included, so `due` holds the cards the plugin holds.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quietHoursFrom } from '../../src/adapters/vault/tracking-read.ts';
import { PLUGIN_QUIET_HOURS } from '../../src/core/nudges.ts';
import { quietSetting } from '../../src/report/tracking.ts';
import { DEFAULT_REMINDERS, loadPluginData } from '../src/settings.ts';

const GIT = { gitSynced: true };

describe('quiet hours: the engine reads them as the plugin does', () => {
  it('the same defaults', () => {
    assert.deepEqual(PLUGIN_QUIET_HOURS, DEFAULT_REMINDERS.quiet);
  });

  it('the same hours into the reminder rules, from any data.json', async () => {
    const { nudgeSettings } = await import('../src/reminders/machine.ts');
    const files: unknown[] = [
      null,
      {},
      { version: 2, reminders: { quiet: { on: false, from: '23:00', to: '06:30' } } },
      { version: 2, reminders: { quiet: { from: '21:00' } } },
      { version: 2, reminders: { quiet: { on: 'yes', from: '25:00', to: '7:00' } } },
      { version: 2, reminders: { quiet: { on: true, from: '13:00', to: '14:00' } } },
      { lastTab: 'today', reminders: 'off' },
      { version: 2, reminders: { didYouTrain: false, didYouTrainAt: '21:15' } },
      { version: 2, reminders: { didYouTrain: 'no', didYouTrainAt: '9:00' } },
    ];
    for (const raw of files) {
      const read = quietHoursFrom(raw === null ? null : JSON.stringify(raw));
      const engine = read.hours;
      const plugin = loadPluginData(raw, GIT).data;
      assert.deepEqual({ on: engine.on, from: engine.from, to: engine.to }, plugin.reminders.quiet, JSON.stringify(raw));
      assert.deepEqual(quietSetting(engine), nudgeSettings(plugin).quiet, JSON.stringify(raw));
      // And "Did you train today?", whose time the quiet hours may hold.
      assert.deepEqual(read.didYouTrain, nudgeSettings(plugin).didYouTrain, JSON.stringify(raw));
    }
  });
});
