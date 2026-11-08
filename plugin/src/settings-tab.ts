// Pahlavan's tab in Obsidian's settings, as signed off in
// mockups/settings.html: only what applies to every reminder (on or off,
// this Mac, macOS notifications, the default snooze, quiet hours, the
// evening "Did you train today?" and its time), git sync, and the phone's
// inbox (importing what the phone sends). What is tracked, and each item's
// own reminder, is set where it lives. The options are read by the
// reminder machinery and the import; the tab only edits and saves them.

import { Notice, PluginSettingTab, Setting, type App, type Plugin, type TextComponent } from 'obsidian';
import { DEFAULT_GUIDE_URL, isTime, isWebAddress, SNOOZE_CHOICES, type PluginData, type Section } from './settings.ts';
import { h, icon } from './ui/dom.ts';
import { DEFAULT_FOLDERS, folders, paths, type Folders } from '../../src/adapters/vault/layout.ts';
import { COACH_DIR, nodeOk, type CoachState, type SetupResult } from './coach-setup.ts';
import { BETA_LINE, SAFETY_LINE } from './ui/help.ts';

/** Where the reminders' shared state lives (snoozes, skips and answers, for both Macs). */

/** What the tab needs from the plugin. */
export interface SettingsHost {
  data: PluginData;
  save(): void | Promise<void>;
  /** "Remind on this Mac", from this Mac's local storage. */
  remindHere(): boolean;
  setRemindHere(on: boolean): void;
  /** The vault is a git repository with the obsidian-git plugin on. */
  gitSynced: boolean;
  /** Opens Pahlavan on a screen (the links in the note at the top); `sub`: a Progress section (Habits). */
  openSection?(section: Section, sub?: 'habits'): void;
  /** Opens the user guide (the vault note when it exists, else the address below). */
  openGuide?(): void;
  /** "Show the first-run tips again". */
  resetTips?(): void;
  /** "Import phone entries" turned on: import what is waiting now. */
  importPhone?(): void;
  /** The folders changed: use them and read the vault again (the setting is saved already). */
  setFolders?(f: Folders): void;
  /** The coach skill: where it stands in this vault (and Node), and setting it up or updating it. */
  coach?: { state(): Promise<CoachState & { node: { path: string; version: string } | null }>; setUp(): Promise<SetupResult> };
  /** Habit Nudges is in this vault (its settings were found): only then does the footer say what it still keeps. */
  habitNudges?(): boolean;
}

const SNOOZE_LABEL = (m: number) => (m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`);

/** "8 Nov 2026" from "2026-11-08". */
function betaDay(d: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1] ?? ''} ${d.slice(0, 4)}`;
}

export class PahlavanSettingTab extends PluginSettingTab {
  private readonly host: SettingsHost;

  constructor(app: App, plugin: Plugin, host: SettingsHost) {
    super(app, plugin);
    this.host = host;
  }

  override display(): void {
    const el = this.containerEl;
    el.replaceChildren();
    el.classList.add('pahlavan-settings');
    const host = this.host;
    const r = host.data.reminders;
    const save = () => void host.save();
    const link = (label: string, section: Section, sub?: 'habits') => host.openSection ? h('a', { href: '#', onclick: (ev: Event) => { ev.preventDefault(); host.openSection!(section, sub); } }, label) : h('b', {}, label);

    el.append(h('h2', { class: 'pv-st-title' }, 'Pahlavan'));
    // The help, under the title: the guide, and the tips once more.
    el.append(h('div', { class: 'pv-st-help' },
      h('span', {}, 'New to Pahlavan? ', host.openGuide ? h('a', { href: '#', onclick: (ev: Event) => { ev.preventDefault(); host.openGuide!(); } }, 'Read the user guide') : h('b', {}, 'Read the user guide'), '.'),
      host.resetTips ? h('button', { class: 'mod-cta-quiet pv-st-tips', onclick: () => host.resetTips!() }, 'Show the first-run tips again') : null));
    // The beta's promise, with the date that keeps it: free now, and free after 1.0 for everyone who installed before it.
    if (host.data.installedOn) el.append(h('p', { class: 'pv-st-beta' }, h('b', {}, `Beta user since ${betaDay(host.data.installedOn)}.`), ' Pahlavan is free during the beta. 1.0 will be paid, and everyone who installs before 1.0 keeps it free, so you do.'));
    el.append(h('div', { class: 'pv-st-callout' }, icon('info'), h('div', {},
      h('b', {}, 'Set where it lives.'), ' What you track and each item’s reminder: ', link('Progress, Habits', 'progress', 'habits'),
      '. The morning check-in’s time: its card on ', link('Check-in', 'checkin'),
      '. When the tape, photos and tests are due: the Body record card there. Here: what applies to every reminder.')));

    new Setting(el).setName('Reminders').setHeading();
    // The rest of the group dims while reminders are off (they stay editable).
    const dimmed: HTMLElement[] = [];
    const dim = () => dimmed.forEach((x) => x.classList.toggle('pv-st-off', !r.on));
    const toggle = (s: Setting, get: () => boolean, set: (v: boolean) => void, after?: () => void) => s.addToggle((t) => t.setValue(get()).onChange((v) => {
      set(v);
      save();
      after?.();
    }));

    toggle(new Setting(el).setName('Reminders').setDesc('Cards and notifications for what you track and the coach’s check-ins. Off: nothing pops up; Today still lists what’s due.'), () => r.on, (v) => { r.on = v; }, dim);
    const here = new Setting(el).setName('Remind on this Mac').setDesc('Kept on each Mac, not synced: turn it off on a Mac you don’t want cards on. The other Mac still reminds.');
    toggle(here, () => host.remindHere(), (v) => host.setRemindHere(v));
    const notes = new Setting(el).setName('macOS notifications').setDesc('A notification with each card, so a reminder reaches you outside Obsidian. macOS asks for permission once.');
    toggle(notes, () => r.notifications, (v) => { r.notifications = v; });
    const snooze = new Setting(el).setName('Default snooze').setDesc('What Snooze, and closing a card, use. Each card’s menu offers other times.')
      .addDropdown((d) => {
        for (const m of SNOOZE_CHOICES) d.addOption(String(m), SNOOZE_LABEL(m));
        d.setValue(String(r.snoozeMinutes)).onChange((v) => { r.snoozeMinutes = Number(v); save(); });
      });
    const quiet = new Setting(el).setName('Quiet hours').setDesc('No cards or notifications. A card due in the early morning waits until they end; one due late in the evening is skipped that day, so set evening reminders before quiet hours start.');
    const times: HTMLElement[] = [];
    toggle(quiet, () => r.quiet.on, (v) => { r.quiet.on = v; }, () => times.forEach((x) => x.classList.toggle('is-off', !r.quiet.on)));
    const time = (get: () => string, set: (v: string) => void) => quiet.addText((t) => {
      t.inputEl.type = 'time';
      t.inputEl.classList.add('pv-st-time');
      times.push(t.inputEl);
      t.setValue(get()).onChange((v) => { if (isTime(v)) { set(v); save(); } });
    });
    time(() => r.quiet.from, (v) => { r.quiet.from = v; });
    quiet.controlEl.append(h('span', { class: 'pv-st-to' }, 'to'));
    time(() => r.quiet.to, (v) => { r.quiet.to = v; });
    times.forEach((x) => x.classList.toggle('is-off', !r.quiet.on));
    const train = new Setting(el).setName('Did you train today?').setDesc('An evening card at this time on a training day when nothing is logged: Log session, Rest day or Not today.');
    const trainTime: HTMLElement[] = [];
    toggle(train, () => r.didYouTrain, (v) => { r.didYouTrain = v; }, () => trainTime.forEach((x) => x.classList.toggle('is-off', !r.didYouTrain)));
    train.addText((t) => {
      t.inputEl.type = 'time';
      t.inputEl.classList.add('pv-st-time');
      t.inputEl.setAttribute('aria-label', 'Did you train today? time');
      trainTime.push(t.inputEl);
      t.setValue(r.didYouTrainAt).onChange((v) => { if (isTime(v)) { r.didYouTrainAt = v; save(); } });
    });
    trainTime.forEach((x) => x.classList.toggle('is-off', !r.didYouTrain));
    dimmed.push(here.settingEl, notes.settingEl, snooze.settingEl, quiet.settingEl, train.settingEl);
    dim();

    const s = host.data.sync;
    new Setting(el).setName('Sync').setDesc(host.gitSynced ? 'For a vault synced with git' : 'For a vault synced with git. This vault has no git repository with the Git plugin on, so there is nothing to sync with.').setHeading();
    toggle(new Setting(el).setName('Pull before reminding').setDesc('Fetch the other Mac’s changes first, so a card already answered there doesn’t show here.'), () => s.pullBefore, (v) => { s.pullBefore = v; });
    toggle(new Setting(el).setName('Sync after saving').setDesc('Commit and push a minute after you answer a card, so the other Mac sees it.'), () => s.syncAfter, (v) => { s.syncAfter = v; });
    new Setting(el).setName('Shared state').setDesc('Snoozes, skips and answers live here, so a skip on one Mac silences the other.')
      .controlEl.append(h('code', { class: 'pv-st-code' }, paths().nudges));

    new Setting(el).setName('Phone').setHeading();
    const phone = host.data.phone;
    toggle(new Setting(el).setName('Import phone entries').setDesc('What your phone’s shortcuts send into the inbox (a session, habit ticks, water, the morning check-in, Did you train today?) is saved on each refresh, the same way Pahlavan’s own screens save it. An entry that clashes with what’s there stays in the inbox, and Today says why. Pahlavan also keeps phone.json there, today’s list for the phone.'), () => phone.import, (v) => { phone.import = v; }, () => {
      if (phone.import) host.importPhone?.();
    });
    new Setting(el).setName('Phone inbox').setDesc('Where the phone’s entries arrive, and where applied ones move (applied, by month).')
      .controlEl.append(h('code', { class: 'pv-st-code' }, paths().inbox));

    new Setting(el).setName('Files').setHeading();
    const now = (): Folders => host.data.folders ?? folders();
    // Applied when the field is left (or Enter), not on each key: a half-typed folder would read an empty vault.
    const folderField = (t: TextComponent, read: () => string, write: (v: string) => Folders, placeholder: string) => {
      t.setPlaceholder(placeholder).setValue(read());
      t.inputEl.addEventListener('change', () => {
        const next = write(t.getValue().trim());
        host.data.folders = next;
        save();
        host.setFolders?.(next);
      });
    };
    new Setting(el).setName('Fitness folder').setDesc('Where Pahlavan keeps your plan, log and body record, with the coach’s files in its Coach folder, relative to the vault. Changing it moves nothing: move the folder first, then change this.')
      .addText((t) => folderField(t, () => now().fitness, (v) => ({ ...now(), fitness: v || DEFAULT_FOLDERS.fitness }), DEFAULT_FOLDERS.fitness));
    new Setting(el).setName('Habit check-ins file').setDesc('Leave empty to keep them beside the plan. Set it when another habits page owns the file.')
      .addText((t) => folderField(t, () => now().habits ?? '', (v) => {
        const { habits: _old, ...rest } = now();
        return v ? { ...rest, habits: v } : rest;
      }, `${now().fitness}/habits-data.json`));

    if (host.coach) this.coachSection(el, host.coach);

    new Setting(el).setName('Help').setHeading();
    new Setting(el).setName('User guide address').setDesc(`Where “User guide” goes when the vault has no copy of the guide (${paths().guide}).`)
      .addText((t) => {
        t.inputEl.classList.add('pv-st-url');
        t.setPlaceholder(DEFAULT_GUIDE_URL).setValue(host.data.guideUrl).onChange((v) => {
          const next = v.trim() || DEFAULT_GUIDE_URL;
          if (isWebAddress(next)) { host.data.guideUrl = next; save(); }
        });
      });

    if (host.habitNudges?.()) el.append(h('div', { class: 'pv-st-foot' }, icon('sync'), h('span', {}, 'Habit Nudges keeps the word cards, the ⏰ plan reminders and the work timer. Every health and fitness reminder is Pahlavan’s now.')));
    el.append(h('div', { class: 'pv-st-foot', 'data-k': 'st-safety' }, icon('shield'), h('span', {}, SAFETY_LINE)));
    el.append(h('div', { class: 'pv-st-foot pv-st-foot-tight', 'data-k': 'st-beta' }, icon('info'), h('span', {}, BETA_LINE)));
  }

  /** The coach in Claude Code: set up, up to date or older, Node found or not, and the button. Filled in once the vault is read. */
  private coachSection(el: HTMLElement, coach: NonNullable<SettingsHost['coach']>): void {
    new Setting(el).setName('Coach').setHeading();
    const row = new Setting(el).setName('The coach in Claude Code').setDesc('Checking this vault…');
    const node = new Setting(el).setName('Node').setDesc('Looking for it…');
    void coach.state().then((st) => {
      const upToDate = st.installed === st.bundled && !st.missing.length && !st.differ.length;
      row.setDesc(st.installed === null
        ? `Not set up in this vault. The coach is a Claude Code skill (/fitness-coach); this writes it into ${COACH_DIR}.`
        : upToDate
          ? `Set up, version ${st.bundled}. In Claude Code, open this vault and run /fitness-coach.`
          : `Version ${st.installed} is set up; this Pahlavan carries ${st.bundled}.${st.differ.length ? ` ${st.differ.length} of its files differ and will be replaced.` : ''}`);
      if (!upToDate) {
        let armed = false;
        row.addButton((b) => {
          b.setButtonText(st.installed === null ? 'Set up the coach' : 'Update the coach').setCta().onClick(async () => {
            // Files that differ may be the user's own edits: a second click replaces them.
            if (st.differ.length && !armed) {
              armed = true;
              b.setButtonText(`Replace ${st.differ.length} file${st.differ.length === 1 ? '' : 's'}?`);
              return;
            }
            b.setDisabled(true).setButtonText('Writing…');
            const r = await coach.setUp();
            new Notice(r.ok ? `The coach is set up (${r.written.length} files). In Claude Code, open this vault and run /fitness-coach.` : `The coach was not set up: ${r.error}`);
            this.display();
          });
        });
      }
      node.setDesc(st.node && nodeOk(st.node.version)
        ? `${st.node.version} (${st.node.path}): the coach's engine runs on it.`
        : st.node
          ? `${st.node.version} is too old: the coach's engine needs Node 18 or later (nodejs.org).`
          : 'Not found. The coach’s engine needs Node 18 or later: install it from nodejs.org, then the coach works in Claude Code.');
    }, (e: unknown) => row.setDesc(`Could not read the coach's folder: ${(e as Error).message}`));
  }
}
