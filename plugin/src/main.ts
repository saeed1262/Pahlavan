// Pahlavan: the fitness coach's screens inside Obsidian. It reads the
// fitness dashboard's files and the coach's files and shows them through the
// engine's rules. It writes only on a Save, through three writers: LogWriter (a
// session or a ladder level into fitness-log-data.json, the add-only Workout
// tick into habits-data.json, the day's sore muscles into body-data.json),
// CheckinWriter (the morning check-in's fields and checkedAt into
// body-data.json, the Sunday check-in into Coach/checkins.json), and
// TrackingWriter (the Habits section's item edits, the coach's suggestions,
// the bring-over, the morning time and the body-record schedule into
// Coach/tracking.json); LogWriter
// also writes today's checklist record (todayChecklist: ticks, the pick, the
// version), shared with the dashboard and Isfahan's briefing. Its own settings (the last tab,
// the session mode, today's pick, and the global reminder and sync options its
// Settings tab edits) are saved in data.json; "Remind on this Mac" stays in this
// Mac's local storage. The help's memory (the tips seen, the welcome card
// hidden) is Coach/help.json, a vault file both Macs share.
//
// The reminder cards (reminders/machine.ts): a minute tick opens the next
// due card, a 30-second tick counts stand-ups and sitting time; their writes
// go through ReminderWriter (Coach/tracking.json, nudges.json, sitting.json,
// the linked habits, the body record and the progress photos).
//
// The phone's inbox (inbox.ts): each data refresh first imports the entries
// waiting in Coach/Inbox/ through the same writers, moves the applied ones
// to Coach/Inbox/applied/ and keeps the refusals in Coach/Inbox/refused.json
// (Due today and the Data notes show them); Coach/Inbox/phone.json, what the
// phone reads, is written a few seconds after a change and at the first
// refresh of each day. "Import phone entries" in Settings turns both off.

import { addIcon, Notice, Plugin, TFolder, type TAbstractFile, type WorkspaceLeaf } from 'obsidian';
import { PAHLAVAN_ICON, PAHLAVAN_ICON_ID } from './brand-icon.ts';
import { modalCards } from './card-modal.ts';
import { CheckinWriter } from './checkin-writer.ts';
import { isWatched, PahlavanData } from './data-source.ts';
import { LogWriter } from './log-writer.ts';
import { chime, convertPhoto, focusObsidian, holdObsidianFront, homeDir, hostName, notifyMac, runProgram, systemIdleSeconds } from './reminders/mac.ts';
import { Reminders } from './reminders/machine.ts';
import { localClock, localMoment, macName } from './reminders/moment.ts';
import { GitSync } from './reminders/sync.ts';
import type { ReminderAdapter } from './reminders/writer.ts';
import { defaultPluginData, loadPluginData, remindHere, setRemindHere, type DeviceStore, type PluginData, type Section } from './settings.ts';
import { PahlavanSettingTab } from './settings-tab.ts';
import { HelpStore } from './help.ts';
import { importNotice, InboxImporter, type InboxAdapter, type ImportSummary } from './inbox.ts';
import { ReminderWriter } from './reminders/writer.ts';
import { TrackingWriter } from './tracking-writer.ts';
import { renderStatus } from './ui/status.ts';
import { PahlavanView, VIEW_TYPE } from './view.ts';
import { findFoldersAsync, paths, useFolders } from '../../src/adapters/vault/layout.ts';
import { COACH_FILES } from 'virtual:coach-files';
import { coachState, findNode, nodeOk, setUpCoach, type CoachState } from './coach-setup.ts';

const RELOAD_DELAY_MS = 600;
const TICK_MS = 60_000;
const FAST_TICK_MS = 30_000;
/** The first look waits for obsidian-git's pull-on-boot (Habit Nudges' FIRST_TICK_MS). */
const FIRST_TICK_MS = 20_000;
/** This Mac's name in Coach/sitting.json, kept in local storage once chosen. */
const MAC_NAME_KEY = 'pahlavan-mac-name';
/** phone.json waits for the edits to settle (a tick, then its habit, then the reload). */
const PHONE_DELAY_MS = 5_000;

const pad = (n: number) => String(n).padStart(2, '0');
/** Today's local date: the plugin layer is the only place that reads the clock. */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default class PahlavanPlugin extends Plugin {
  override settings: PluginData = defaultPluginData({ gitSynced: false });
  private source!: PahlavanData;
  private reloadTimer: number | null = null;
  /** The reminder machinery; its hooks are what Due today and the Habits section use. */
  reminders: Reminders | null = null;
  /** The phone's inbox: the import on each refresh, and phone.json. */
  private inbox: InboxImporter | null = null;
  private git: GitSync | null = null;
  private phoneTimer: number | null = null;
  /** The day phone.json was last written for (null: not yet this session). */
  private phoneDay: string | null = null;
  /** The refused entries already announced, so a refusal tried again on each refresh says so once. */
  private announced = new Set<string>();
  /** The first tick has run: obsidian-git's pull on boot went first, so the inbox can be imported. */
  private booted = false;
  /** What other plugins may call (Isfahan's new-tab Check-in row): app.plugins.plugins.pahlavan.api, versioned. */
  api: Readonly<{ version: number; openCheckin(): Promise<boolean>; showQueue(): Promise<boolean>; standingNow(): { on: boolean; since: number | null }; setStandingNow(on: boolean): void }> | null = null;

  override async onload(): Promise<void> {
    const gitSynced = await this.gitSynced();
    const { data, migrated } = loadPluginData(await this.loadData(), { gitSynced });
    this.settings = data;
    // Older data (the view's state alone) gains the reminder and sync options once.
    if (migrated) await this.saveData(this.settings);
    // Where the vault keeps Pahlavan's files: the setting, else looked for (an install from before the setting keeps its folders).
    if (this.settings.folders) useFolders(this.settings.folders);
    else {
      const found = await findFoldersAsync((dir) => this.childrenOf(dir));
      useFolders(found);
      // Saved once a plan is seen there, so a vault the coach hasn't set up yet (or a listing that came back empty) is looked at again next time.
      if ((await this.childrenOf(found.fitness))?.files.includes('plan-data.json')) {
        this.settings.folders = found;
        await this.saveData(this.settings);
      }
    }
    this.source = new PahlavanData(this.app.vault.adapter, '', { configDir: this.app.vault.configDir });
    // The help's memory, in a vault file both Macs share (Coach/help.json).
    const help = new HelpStore(this.app.vault.adapter);
    const device = this.deviceStore();
    this.addSettingTab(new PahlavanSettingTab(this.app, this, {
      data: this.settings,
      save: () => this.saveData(this.settings),
      remindHere: () => remindHere(device),
      setRemindHere: (on) => setRemindHere(device, on),
      gitSynced,
      openSection: (section, sub) => void this.openSection(section, sub),
      openGuide: () => void this.openGuide(),
      resetTips: () => void this.resetTips(help),
      importPhone: () => void this.refresh(),
      // A new folder: every read and write follows it from now on, and the open tabs read the vault again.
      coach: { state: () => this.coachState(), setUp: () => setUpCoach(this.app.vault.adapter, COACH_FILES) },
      habitNudges: () => this.source.tracking?.files.nudgesSettings === 'found',
      setFolders: (f) => {
        useFolders(f);
        void this.refresh();
      },
    }));

    const checkinWriter = new CheckinWriter(this.app.vault.adapter);
    const reminders = this.startReminders(device, checkinWriter);
    const adapter = this.app.vault.adapter as unknown as InboxAdapter;
    this.inbox = new InboxImporter({ adapter, log: new LogWriter(adapter), writer: new ReminderWriter(adapter), checkin: checkinWriter, configDir: this.app.vault.configDir });

    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new PahlavanView(leaf, {
      data: this.source,
      settings: this.settings,
      coach: { state: () => this.coachState(), setUp: () => setUpCoach(this.app.vault.adapter, COACH_FILES) },
      saveSettings: () => void this.saveData(this.settings),
      today: () => localToday(),
      hour: () => new Date().getHours(),
      minutes: () => {
        const d = new Date();
        return d.getHours() * 60 + d.getMinutes();
      },
      bodyClasses: () => activeDocument.body.classList,
      writer: new LogWriter(this.app.vault.adapter),
      notify: (message) => new Notice(message, 6000),
      requestReload: () => this.scheduleReload(),
      resourcePath: (path) => this.app.vault.adapter.getResourcePath(path),
      checkinWriter,
      reminders,
      trackingWriter: new TrackingWriter(this.app.vault.adapter),
      offsetMinutes: () => -new Date().getTimezoneOffset(),
      openSettings: () => this.openSettings(),
      clockText: (ms) => {
        const d = new Date(ms);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      },
      openNote: (path) => void this.app.workspace.openLinkText(path, '', 'tab'),
      help,
      openGuide: () => void this.openGuide(),
      nowIso: () => new Date().toISOString(),
      copy: (text) => navigator.clipboard.writeText(text),
    }));

    addIcon(PAHLAVAN_ICON_ID, PAHLAVAN_ICON);
    this.addRibbonIcon(PAHLAVAN_ICON_ID, 'Open Pahlavan', () => void this.activate());
    this.addCommand({ id: 'open', name: 'Open', callback: () => void this.activate() });
    this.addCommand({ id: 'open-guide', name: 'Open the user guide', callback: () => void this.openGuide() });
    // "Open check-in" is what Isfahan's new-tab Check-in row runs: the morning card until today's is in, then the Check-in screen.
    this.addCommand({ id: 'open-checkin', name: 'Open check-in', callback: () => void reminders.openCheckin() });
    this.addCommand({ id: 'morning-checkin', name: 'Open the morning check-in', callback: () => void reminders.openCard('morning') });
    this.addCommand({ id: 'photo-day', name: 'Add progress photos', callback: () => void reminders.openCard('photos') });
    this.addCommand({ id: 'fitness-tests', name: 'Enter the fitness tests', callback: () => void reminders.openCard('tests') });
    this.addCommand({ id: 'reminder-queue', name: 'Open the reminder queue (what is due now)', callback: () => void reminders.showQueue() });
    this.addCommand({ id: 'standing-now', name: 'Standing now (on or off, this Mac)', callback: () => this.toggleStanding() });
    this.addCommand({
      id: 'set-up-coach',
      name: 'Set up the coach (the Claude Code skill)',
      callback: async () => {
        const st = await this.coachState();
        if (st.installed === st.bundled && !st.missing.length && !st.differ.length) return void new Notice(`The coach is set up and up to date (version ${st.bundled}).`);
        // Files that differ may be the user's own edits: the settings tab asks before replacing them.
        if (st.differ.length) return void new Notice(`${st.differ.length} of the coach's files differ from this Pahlavan's: update it from Pahlavan's settings, Coach.`);
        const r = await setUpCoach(this.app.vault.adapter, COACH_FILES);
        new Notice(r.ok ? `The coach is set up (${r.written.length} files). In Claude Code, open this vault and run /fitness-coach.` : `The coach was not set up: ${r.error}`);
        if (!nodeOk(st.node?.version ?? null)) new Notice('The coach’s engine needs Node 18 or later: install it from nodejs.org.');
      },
    });
    this.addCommand({ id: 'stand-ask', name: 'Stand-up: ask me now', callback: () => {
      if (reminders.standAskNow()) void reminders.fastTick();
      else new Notice('Pahlavan: no stand-up is counting on this Mac right now.');
    } });

    this.api = Object.freeze({
      version: 1,
      openCheckin: () => reminders.openCheckin(),
      showQueue: () => reminders.showQueue(),
      standingNow: () => reminders.standingNow(),
      setStandingNow: (on: boolean) => void reminders.setStandingNow(on),
    });

    const changed = (file: TAbstractFile, oldPath?: string) => {
      if (isWatched(file.path) || (oldPath !== undefined && isWatched(oldPath))) this.scheduleReload();
    };
    this.registerEvent(this.app.vault.on('modify', changed));
    this.registerEvent(this.app.vault.on('create', changed));
    this.registerEvent(this.app.vault.on('delete', changed));
    this.registerEvent(this.app.vault.on('rename', changed));
  }

  override onunload(): void {
    if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
    if (this.phoneTimer !== null) window.clearTimeout(this.phoneTimer);
    void this.reminders?.dispose();
  }

  /** The reminder machinery with this Mac's pieces: the clock, idle seconds, the call helper, sips, notifications, git. */
  private startReminders(device: DeviceStore, checkin: CheckinWriter): Reminders {
    const adapter = this.app.vault.adapter as unknown as ReminderAdapter;
    let mac = device.get(MAC_NAME_KEY);
    if (!mac) {
      mac = macName(hostName());
      device.set(MAC_NAME_KEY, mac);
    }
    const name = macName(mac);
    const plugins = () => (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins ?? {};
    const timers = { setTimeout: (fn: () => void, ms: number) => window.setTimeout(fn, ms), clearTimeout: (id: number) => window.clearTimeout(id) };
    const git = new GitSync({ git: () => plugins()['obsidian-git'] ?? null, settings: () => this.settings.sync, now: () => Date.now(), ...timers });
    this.git = git;
    const r = new Reminders({
      adapter,
      configDir: this.app.vault.configDir,
      now: () => Date.now(),
      moment: localMoment,
      clock: localClock,
      settings: () => this.settings,
      remindHere: () => remindHere(device),
      mac: () => name,
      device,
      idleSeconds: systemIdleSeconds,
      focused: () => activeDocument.hasFocus(),
      visible: () => activeDocument.visibilityState !== 'hidden',
      otherCardOpen: () => activeDocument.querySelector('.modal.isfahan-card') !== null,
      ui: modalCards(this.app),
      notifyMac,
      notice: (message) => new Notice(message, 8000),
      focusApp: focusObsidian,
      holdFront: holdObsidianFront,
      chime,
      convertPhoto,
      git,
      checkin,
      openLog: () => void this.openLog(),
      openSection: (section) => void this.openSection(section),
      copy: (text) => navigator.clipboard.writeText(text),
      ...timers,
    });
    this.reminders = r;
    const status = this.addStatusBarItem();
    status.addClass('pahlavan-status');
    const draw = () => renderStatus(status, { stand: r.standStatus(), standing: r.standingNow(), sitting: r.sittingNow() !== null, onStanding: () => this.toggleStanding() });
    this.register(r.onChange(draw));
    this.app.workspace.onLayoutReady(() => {
      this.registerInterval(window.setInterval(() => void r.tick(), TICK_MS));
      this.registerInterval(window.setInterval(() => void r.fastTick(), FAST_TICK_MS));
      // A new day: the entries waiting for it import, and phone.json turns to today's list.
      this.registerInterval(window.setInterval(() => {
        if (this.settings.phone.import && this.phoneDay !== null && this.phoneDay !== localToday()) void this.refresh();
      }, TICK_MS));
      window.setTimeout(() => {
        void r.fastTick();
        void r.tick();
        // The first import, after obsidian-git's pull on boot: what the phone sent meanwhile.
        this.booted = true;
        void this.refresh();
      }, FIRST_TICK_MS);
      draw();
    });
    return r;
  }

  /** "Standing now", from the command or the status bar. */
  private toggleStanding(): void {
    const r = this.reminders;
    if (!r) return;
    const on = !r.standingNow().on;
    r.setStandingNow(on);
    new Notice(on ? 'Pahlavan: standing now. Sitting time is not counted until you turn it off (or step away for half an hour).' : 'Pahlavan: sitting again; sitting time counts.', 5000);
  }

  /** The user guide: the vault's copy when it exists (a note in a tab), else the published page in the browser. */
  private async openGuide(): Promise<void> {
    if (await this.app.vault.adapter.exists(paths().guide)) {
      (this.app as unknown as { setting?: { close?: () => void } }).setting?.close?.();
      await this.app.workspace.openLinkText(paths().guide, '', 'tab');
      return;
    }
    window.open(this.settings.guideUrl, '_blank');
  }

  /** "Show the first-run tips again" from Settings: every open Pahlavan tab reads the help again. */
  private async resetTips(help: HelpStore): Promise<void> {
    await help.apply({ op: 'reset' });
    new Notice('Pahlavan: the tips show again, one at a time, as each screen opens.', 5000);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof PahlavanView) await leaf.view.helpChanged();
  }

  /** "Log session" on "Did you train today?": Today with the Log panel open. */
  private async openLog(): Promise<void> {
    await this.activate();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof PahlavanView) await leaf.view.startLog();
  }

  /** Re-reads once the edits settle (a save writes a file, then often its neighbours). */
  private scheduleReload(): void {
    if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
    this.reloadTimer = window.setTimeout(() => {
      this.reloadTimer = null;
      void this.refresh();
    }, RELOAD_DELAY_MS);
  }

  /**
   * A data refresh: the phone's entries first (so Today shows them on this
   * read), then every open Pahlavan tab reads again; phone.json follows, at
   * once on a new day, else a few seconds after the change. Until the first
   * tick (20 s, the pull on boot first) it only reads again, as the cards wait.
   */
  private async refresh(): Promise<void> {
    if (this.settings.phone.import && this.inbox && this.booted) {
      const today = localToday();
      try {
        const s = await this.inbox.run(today);
        if (s) this.imported(s);
      } catch (e) {
        console.warn('[Pahlavan] the phone entries were not imported', e);
      }
      this.schedulePhone(this.phoneDay !== today);
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof PahlavanView) void view.reload();
    }
  }

  /** After an import: one notice line, a refusal announced once, and the other Mac told (Sync after saving). */
  private imported(s: ImportSummary): void {
    const fresh = s.refused.filter((r) => !this.announced.has(r.file));
    for (const r of s.refused) this.announced.add(r.file);
    const line = importNotice(s) ?? (fresh.length ? `Pahlavan: ${fresh.length} phone ${fresh.length === 1 ? 'entry needs' : 'entries need'} a look on Today.` : null);
    if (line) new Notice(line, 6000);
    for (const w of s.warnings) console.warn(`[Pahlavan] phone entry ${w}`);
    if (s.wrote) this.git?.schedule();
  }

  /** phone.json, debounced: what the phone's shortcuts read (written only when it changes). */
  private schedulePhone(now: boolean): void {
    if (this.phoneTimer !== null) window.clearTimeout(this.phoneTimer);
    this.phoneTimer = window.setTimeout(() => {
      this.phoneTimer = null;
      const today = localToday();
      void this.inbox?.writePhone(today).then((r) => {
        this.phoneDay = today;
        if (r === 'written') this.git?.schedule();
      }, (e: unknown) => console.warn('[Pahlavan] phone.json was not written', e));
    }, now ? 0 : PHONE_DELAY_MS);
  }

  /** The vault is a git repository and obsidian-git is on: the sync options then default to on. */
  private async gitSynced(): Promise<boolean> {
    const plugins = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string>; plugins?: Record<string, unknown> } }).plugins;
    const on = Boolean(plugins?.enabledPlugins?.has('obsidian-git') || plugins?.plugins?.['obsidian-git']);
    return on && (await this.app.vault.adapter.exists('.git'));
  }

  /** The coach skill in this vault (what setting it up would write) and Node, for the settings tab and the command. */
  private async coachState(): Promise<CoachState & { node: { path: string; version: string } | null }> {
    const st = await coachState(this.app.vault.adapter, COACH_FILES);
    return { ...st, node: await findNode(runProgram, homeDir()) };
  }

  /** A vault folder's file and subfolder names (`''`: the vault root), for the folder search; null when it isn't there. */
  private async childrenOf(dir: string): Promise<{ files: string[]; folders: string[] } | null> {
    const a = this.app.vault.adapter;
    const name = (p: string) => p.slice(p.lastIndexOf('/') + 1);
    if (dir === '') {
      // The vault root two ways (the vault's own tree, and the adapter's listing), so neither alone decides.
      const files = new Set<string>();
      const folders = new Set<string>();
      for (const c of this.app.vault.getRoot().children) (c instanceof TFolder ? folders : files).add(c.name);
      for (const root of ['/', '']) {
        try {
          const l = await a.list(root);
          l.files.forEach((f) => files.add(name(f)));
          l.folders.forEach((f) => folders.add(name(f)));
        } catch {
          // not this spelling of the root
        }
      }
      return files.size || folders.size ? { files: [...files], folders: [...folders] } : null;
    }
    if (!(await a.exists(dir))) return null;
    const { files, folders } = await a.list(dir);
    return { files: files.map(name), folders: folders.map(name) };
  }

  /** This vault's local storage on this Mac (Obsidian 1.8.7 and later; else the window's, keyed by the vault, as Habit Nudges does). */
  private deviceStore(): DeviceStore {
    const app = this.app as unknown as { loadLocalStorage?: (k: string) => unknown; saveLocalStorage?: (k: string, v: unknown) => void };
    const key = (k: string) => `${this.app.vault.getName()}:${k}`;
    return {
      get: (k) => {
        const v = typeof app.loadLocalStorage === 'function' ? app.loadLocalStorage(k) : window.localStorage.getItem(key(k));
        return typeof v === 'string' ? v : null;
      },
      set: (k, v) => {
        if (typeof app.saveLocalStorage === 'function') app.saveLocalStorage(k, v);
        else window.localStorage.setItem(key(k), v);
      },
    };
  }

  /** Obsidian's settings window on Pahlavan's tab (Due today's gear). */
  private openSettings(): void {
    const setting = (this.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void } }).setting;
    setting?.open?.();
    setting?.openTabById?.(this.manifest.id);
  }

  /** Opens Pahlavan on a screen (from the Settings tab's links), closing the settings window. */
  private async openSection(section: Section, sub?: 'habits'): Promise<void> {
    this.settings.lastTab = section;
    if (sub) this.settings.progressSection = sub;
    await this.saveData(this.settings);
    (this.app as unknown as { setting?: { close?: () => void } }).setting?.close?.();
    await this.activate();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof PahlavanView) leaf.view.showSection(section);
  }

  /** Opens the view in a tab, or brings the open one forward. */
  async activate(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) {
      await workspace.revealLeaf(existing);
      return;
    }
    // Opened from an empty new tab (a launcher tile there), use that tab rather than leave it behind.
    const current = workspace.getMostRecentLeaf();
    const leaf = current && current.view.getViewType() === 'empty' ? current : workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
  }
}
