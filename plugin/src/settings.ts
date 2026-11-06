// Pahlavan's settings, as the plugin's data.json holds them: the view's own
// state (the last tab, the session mode, today's pick, the Progress section
// and each Progress view's range: this cycle or all)
// and the global options the Settings tab edits, for every reminder, for
// git sync and for the phone's inbox. Each item's own reminder lives with
// the item, not here. One option is per Mac and lives in local storage
// instead: "Remind on this Mac". Pure: no Obsidian import; the plugin
// passes in what it detects.

import { SCOPES, type Scope } from '../../src/core/cycle.ts';
import { SESSION_MODES, type SessionMode } from '../../src/core/variant.ts';
import type { SessionPickSetting, SwapsSetting } from './pick.ts';
import type { ProgressSection } from './ui/progress-more.ts';
import { foldersOf, type Folders } from '../../src/adapters/vault/layout.ts';

export type Section = 'today' | 'progress' | 'plan' | 'checkin' | 'food';
const SECTIONS: readonly Section[] = ['today', 'progress', 'plan', 'checkin', 'food'];
const PROGRESS_SECTIONS: readonly ProgressSection[] = ['overview', 'training', 'body', 'health', 'skills', 'habits'];

/** The Progress views with a range switch (Habits counts from each item's own start). */
export type ScopedSection = Exclude<ProgressSection, 'habits'>;
export const SCOPED_SECTIONS: readonly ScopedSection[] = ['overview', 'training', 'body', 'health', 'skills'];

/** The view's own state, kept between sessions. */
export interface PahlavanSettings {
  lastTab: Section;
  mode: SessionMode;
  /** The session the user chose for one day (a plan session type); ignored on any other day. */
  pick: SessionPickSetting | null;
  /** Swaps chosen on Today's chips for one day, by the plan's item; the Log panel starts with them. */
  swaps?: SwapsSetting | null;
  /** The Progress section last open. */
  progressSection?: ProgressSection;
  /** Each Progress view's range when it is not the default (this cycle): `all` shows the earlier data too. */
  progressScopes?: Partial<Record<ScopedSection, Scope>>;
}

/** A Progress view's range: what the user chose for it, else this cycle. Habits always counts from each item's start. */
export function progressScope(settings: Pick<PahlavanSettings, 'progressScopes'>, section: ProgressSection): Scope {
  return section === 'habits' ? 'cycle' : (settings.progressScopes?.[section] ?? 'cycle');
}

/** Remembers a view's range; the default (this cycle) is stored as nothing. */
export function setProgressScope(settings: PahlavanSettings, section: ScopedSection, scope: Scope): void {
  const next = { ...(settings.progressScopes ?? {}) };
  if (scope === 'cycle') delete next[section];
  else next[section] = scope;
  if (Object.keys(next).length) settings.progressScopes = next;
  else delete settings.progressScopes;
}

export const DEFAULT_SETTINGS: PahlavanSettings = { lastTab: 'today', mode: 'full', pick: null };

/** What Snooze, and closing a card, can wait, in minutes. */
export const SNOOZE_CHOICES = [10, 30, 60, 120] as const;

export interface ReminderSettings {
  /** Cards and notifications at all; off, nothing pops up and Today still lists what is due. */
  on: boolean;
  /** A macOS notification with each card. */
  notifications: boolean;
  /** What Snooze and closing a card use, in minutes (one of SNOOZE_CHOICES). */
  snoozeMinutes: number;
  /** No cards or notifications between `from` and `to` (local "HH:MM"; may cross midnight). */
  quiet: { on: boolean; from: string; to: string };
  /** The evening "Did you train today?" card when nothing is logged that day. */
  didYouTrain: boolean;
  /** Its time, local "HH:MM". */
  didYouTrainAt: string;
}

/** For a vault synced with git through the obsidian-git plugin. */
export interface SyncSettings {
  /** Pull the other Mac's changes before showing a reminder. */
  pullBefore: boolean;
  /** Commit and sync a little after a card is answered. */
  syncAfter: boolean;
}

/** The phone's inbox (Coach/Inbox/): entries the phone's shortcuts send. */
export interface PhoneSettings {
  /** Import them on each refresh, and keep Coach/Inbox/phone.json (today's list for the phone) up to date. */
  import: boolean;
}

export const SETTINGS_VERSION = 2;

/** The whole of data.json. */
export interface PluginData extends PahlavanSettings {
  version: number;
  reminders: ReminderSettings;
  sync: SyncSettings;
  phone: PhoneSettings;
  /** Where "User guide" goes when the vault has no copy of the guide (an http or https address). */
  guideUrl: string;
  /** Where the vault keeps Pahlavan's files; missing until the plugin has looked for them once (then saved). */
  folders?: Folders;
}

/** What the plugin detects when it loads: a vault that is a git repository with obsidian-git enabled. */
export interface SettingsEnv {
  gitSynced: boolean;
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  on: true,
  notifications: true,
  snoozeMinutes: 30,
  quiet: { on: true, from: '22:30', to: '07:00' },
  didYouTrain: true,
  didYouTrainAt: '20:00',
};

/** Sync is on by default only where there is something to sync with. */
export const defaultSync = (env: SettingsEnv): SyncSettings => ({ pullBefore: env.gitSynced, syncAfter: env.gitSynced });

/** The published guide: the default address when the vault has no copy of it. */
export const DEFAULT_GUIDE_URL = 'https://github.com/saeed1262/pahlavan/blob/main/docs/user-guide.md';
export const isWebAddress = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/\S+$/.test(v.trim());

/** On by default: a vault the phone sends nothing to has no inbox, and nothing happens. */
export const DEFAULT_PHONE: PhoneSettings = { import: true };

export function defaultPluginData(env: SettingsEnv): PluginData {
  return { ...structuredClone(DEFAULT_SETTINGS), version: SETTINGS_VERSION, reminders: structuredClone(DEFAULT_REMINDERS), sync: defaultSync(env), phone: { ...DEFAULT_PHONE }, guideUrl: DEFAULT_GUIDE_URL };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = (v: unknown): v is string => typeof v === 'string' && TIME.test(v);

/**
 * data.json as stored, into the current shape. Version 1 (no `version`:
 * the view's state alone, from plugin 0.1 to 0.5) gains the reminder and
 * sync options at their defaults; a partial or malformed group keeps what
 * is valid and fills the rest. `migrated` says the result differs from
 * what was stored, so the plugin saves it once.
 */
export function loadPluginData(raw: unknown, env: SettingsEnv): { data: PluginData; migrated: boolean } {
  const d = defaultPluginData(env);
  const r = isObj(raw) ? raw : {};
  if (SECTIONS.includes(r['lastTab'] as Section)) d.lastTab = r['lastTab'] as Section;
  if ((SESSION_MODES as readonly unknown[]).includes(r['mode'])) d.mode = r['mode'] as SessionMode;
  const pick = r['pick'];
  if (isObj(pick) && typeof pick['date'] === 'string' && typeof pick['type'] === 'string') d.pick = { date: pick['date'], type: pick['type'] };
  const sw = r['swaps'];
  if (isObj(sw) && typeof sw['date'] === 'string' && isObj(sw['by'])) {
    const by = Object.fromEntries(Object.entries(sw['by']).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== ''));
    if (Object.keys(by).length) d.swaps = { date: sw['date'], by };
  }
  if (PROGRESS_SECTIONS.includes(r['progressSection'] as ProgressSection)) d.progressSection = r['progressSection'] as ProgressSection;
  const scopes = isObj(r['progressScopes']) ? r['progressScopes'] : {};
  const kept: Partial<Record<ScopedSection, Scope>> = {};
  for (const k of SCOPED_SECTIONS) if ((SCOPES as readonly unknown[]).includes(scopes[k]) && scopes[k] !== 'cycle') kept[k] = scopes[k] as Scope;
  if (Object.keys(kept).length) d.progressScopes = kept;

  const rem = isObj(r['reminders']) ? r['reminders'] : {};
  const def = d.reminders;
  const quiet = isObj(rem['quiet']) ? rem['quiet'] : {};
  d.reminders = {
    on: bool(rem['on'], def.on),
    notifications: bool(rem['notifications'], def.notifications),
    snoozeMinutes: (SNOOZE_CHOICES as readonly unknown[]).includes(rem['snoozeMinutes']) ? (rem['snoozeMinutes'] as number) : def.snoozeMinutes,
    quiet: { on: bool(quiet['on'], def.quiet.on), from: isTime(quiet['from']) ? quiet['from'] : def.quiet.from, to: isTime(quiet['to']) ? quiet['to'] : def.quiet.to },
    didYouTrain: bool(rem['didYouTrain'], def.didYouTrain),
    didYouTrainAt: isTime(rem['didYouTrainAt']) ? rem['didYouTrainAt'] : def.didYouTrainAt,
  };
  const sync = isObj(r['sync']) ? r['sync'] : {};
  d.sync = { pullBefore: bool(sync['pullBefore'], d.sync.pullBefore), syncAfter: bool(sync['syncAfter'], d.sync.syncAfter) };
  const phone = isObj(r['phone']) ? r['phone'] : {};
  d.phone = { import: bool(phone['import'], d.phone.import) };
  if (isWebAddress(r['guideUrl'])) d.guideUrl = (r['guideUrl'] as string).trim();
  const folders = foldersOf(r);
  if (folders) d.folders = folders;
  return { data: d, migrated: JSON.stringify(canonical(raw)) !== JSON.stringify(canonical(d)) };
}

/** Key order does not count as a change. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (!isObj(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
}

/** Whether a local time ("HH:MM") falls in the quiet hours; a window that crosses midnight wraps. */
export function inQuietHours(q: ReminderSettings['quiet'], time: string): boolean {
  if (!q.on || q.from === q.to) return false;
  return q.from < q.to ? time >= q.from && time < q.to : time >= q.from || time < q.to;
}

// ---------------------------------------------------------------- this Mac

/** The vault's local storage on this Mac (Obsidian's loadLocalStorage and saveLocalStorage). */
export interface DeviceStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** "Remind on this Mac": per computer, so it never travels with data.json. */
export const REMIND_HERE_KEY = 'pahlavan-remind-here';

/** On unless this Mac was turned off (as Habit Nudges' "Remind on this Mac" reads). */
export const remindHere = (store: DeviceStore): boolean => store.get(REMIND_HERE_KEY) !== 'off';
export const setRemindHere = (store: DeviceStore, on: boolean): void => store.set(REMIND_HERE_KEY, on ? 'on' : 'off');
