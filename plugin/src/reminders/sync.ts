// Git sync through the obsidian-git plugin, as Habit Nudges does it: a pull
// before a reminder shows (so a card answered on the other Mac stays quiet
// here), and a commit-and-sync a minute after a card is answered (one
// commit covers the few files an answer writes). Both run in obsidian-git's
// own task queue, behind its auto-backup and pull-on-boot, so two git
// commands never race for the index lock; each resolves on success, failure
// or a 30-second timeout and never throws. Without obsidian-git (or its
// queue) both quietly do nothing. No Obsidian import: the plugin passes the
// lookup in.

import type { SyncSettings } from '../settings.ts';

/** The parts of obsidian-git's plugin object used here (as Habit Nudges uses them). */
export interface GitPlugin {
  promiseQueue: { addTask(task: () => Promise<unknown>, onFinished?: () => void): void };
  pullChangesFromRemote?(): Promise<unknown>;
  commitAndSync?(opts: { fromAutoBackup: boolean }): Promise<unknown>;
}

export const GIT_TIMEOUT_MS = 30_000;
/** At most one pull in this long (Habit Nudges' PULL_MIN_GAP_MS). */
export const PULL_MIN_GAP_MS = 5 * 60_000;
/** The commit waits this long after the last answer (Habit Nudges' SYNC_DELAY_MS). */
export const SYNC_DELAY_MS = 60_000;

export interface SyncDeps {
  /** obsidian-git's plugin object, when it is installed and on. */
  git(): unknown;
  settings(): SyncSettings;
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** obsidian-git, when it has the task queue this needs. */
export function gitPluginOf(g: unknown): GitPlugin | null {
  const p = g as Partial<GitPlugin> | null | undefined;
  return p && p.promiseQueue && typeof p.promiseQueue.addTask === 'function' ? (p as GitPlugin) : null;
}

export class GitSync {
  private readonly deps: SyncDeps;
  private lastPull = 0;
  private timer: number | null = null;

  constructor(deps: SyncDeps) {
    this.deps = deps;
  }

  /** Whether a commit-and-sync is waiting to run. */
  get pending(): boolean {
    return this.timer !== null;
  }

  private run(fn: () => Promise<unknown>): Promise<void> {
    const git = gitPluginOf(this.deps.git());
    if (!git) return Promise.resolve();
    return new Promise((resolve) => {
      const t = this.deps.setTimeout(() => resolve(), GIT_TIMEOUT_MS);
      const done = () => {
        this.deps.clearTimeout(t);
        resolve();
      };
      try {
        git.promiseQueue.addTask(fn, done);
      } catch {
        done();
      }
    });
  }

  /**
   * Pulls the other Mac's changes when "Pull before reminding" is on and the
   * last pull was over 5 minutes ago. True when a pull ran (read the files
   * again then).
   */
  async pull(): Promise<boolean> {
    if (!this.deps.settings().pullBefore) return false;
    const git = gitPluginOf(this.deps.git());
    if (!git || typeof git.pullChangesFromRemote !== 'function') return false;
    const now = this.deps.now();
    if (now - this.lastPull < PULL_MIN_GAP_MS) return false;
    this.lastPull = now;
    await this.run(() => git.pullChangesFromRemote!());
    return true;
  }

  /** A commit-and-sync a minute after the last write, when "Sync after saving" is on (debounced). */
  schedule(): void {
    if (!this.deps.settings().syncAfter) return;
    const git = gitPluginOf(this.deps.git());
    if (!git || typeof git.commitAndSync !== 'function') return;
    if (this.timer !== null) this.deps.clearTimeout(this.timer);
    this.timer = this.deps.setTimeout(() => {
      this.timer = null;
      void this.run(() => git.commitAndSync!({ fromAutoBackup: true }));
    }, SYNC_DELAY_MS);
  }

  dispose(): void {
    if (this.timer !== null) this.deps.clearTimeout(this.timer);
    this.timer = null;
  }
}
