// "Set up the coach": the coach is a Claude Code skill, and Pahlavan carries
// its files (the skill's text, its engine and self-check, built in). Setting
// it up writes them into the vault's .claude/skills/fitness-coach/, where
// Claude Code finds /fitness-coach; updating writes this Pahlavan's copy over
// an older one, never over a newer one (the other Mac's newer Pahlavan set it
// up: this Pahlavan is the one to update). Only the skill's own files are
// written: anything else in that folder, and the vault's Coach/local.md,
// stay. The engine needs Node 18 or later, looked for where a Mac usually
// has it.

import { coachVersion, type CoachVersion } from '../../src/core/version.ts';
import type { MkdirAdapter } from './checkin-writer.ts';

/** Where Claude Code finds a vault's skill. */
export const COACH_DIR = '.claude/skills/fitness-coach';
/** The skill's file that names the engine's version. */
const VERSION_FILE = 'scripts/VERSION';

export interface CoachState {
  /** The engine version set up in the vault (its VERSION file), or null when the coach isn't set up. */
  installed: string | null;
  /** The version this Pahlavan carries. */
  bundled: string;
  /** The skill's files missing from the vault. */
  missing: string[];
  /** The skill's files there with other text than this Pahlavan's (an older version, or edited by hand). */
  differ: string[];
  /** The version there against the one carried: only `coach-older` (and `not-set-up`) is this Pahlavan's to write over. */
  direction: CoachVersion;
}

/** The engine version in a VERSION file's text ("engine 0.19.0"), else null. */
export function versionOf(text: string | null): string | null {
  return text ? (/^engine (\S+)/m.exec(text)?.[1] ?? null) : null;
}

/** What setting up would change: the version there, and each of the skill's files missing or different. */
export async function coachState(adapter: MkdirAdapter, files: Readonly<Record<string, string>>): Promise<CoachState> {
  const at = (rel: string) => `${COACH_DIR}/${rel}`;
  const read = async (rel: string) => ((await adapter.exists(at(rel))) ? adapter.read(at(rel)) : null);
  const missing: string[] = [];
  const differ: string[] = [];
  for (const [rel, text] of Object.entries(files)) {
    const now = await read(rel);
    if (now === null) missing.push(rel);
    else if (now !== text) differ.push(rel);
  }
  const found = versionOf(await read(VERSION_FILE));
  const installed = found ?? ((await adapter.exists(at('SKILL.md'))) ? 'unknown' : null);
  const bundled = bundledVersion(files);
  return { installed, bundled, missing, differ, direction: coachVersion(installed, bundled) };
}

/** The engine version this Pahlavan carries (its copy's VERSION file). */
const bundledVersion = (files: Readonly<Record<string, string>>): string => versionOf(files[VERSION_FILE] ?? null) ?? 'unknown';

/** What the settings and the command say when the vault's coach is newer than this Pahlavan's copy. */
export function newerCoachLine(installed: string, bundled: string): string {
  return `The coach in this vault (${installed}) is newer than this Pahlavan's (${bundled}): update Pahlavan from Community plugins.`;
}

/**
 * The settings' Coach row: what it says about the coach in this vault, and
 * its button (null: nothing for this Pahlavan to write). An older coach is
 * updated; a newer one is never written over; at the same version, files
 * that differ are the user's own edits, so the button only restores them.
 */
export function coachRow(st: CoachState): { line: string; button: string | null } {
  if (st.direction === 'not-set-up') return { line: `Not set up in this vault. The coach is a Claude Code skill (/fitness-coach); this writes it into ${COACH_DIR}.`, button: 'Set up the coach' };
  if (st.direction === 'coach-newer') return { line: newerCoachLine(st.installed ?? 'unknown', st.bundled), button: null };
  if (st.direction === 'coach-older') {
    return { line: `Version ${st.installed} is set up; this Pahlavan carries ${st.bundled}.${st.differ.length ? ` ${st.differ.length} of its files differ and will be replaced.` : ''}`, button: 'Update the coach' };
  }
  if (!st.missing.length && !st.differ.length) return { line: `Set up, version ${st.bundled}. In Claude Code, open this vault and run /fitness-coach.`, button: null };
  const m = st.missing.length;
  const d = st.differ.length;
  const parts = [
    m ? `${m} of its files ${m === 1 ? 'is' : 'are'} missing` : null,
    d ? `${d}${m ? '' : ' of its files'} ${d === 1 ? 'differs' : 'differ'} from this Pahlavan's copy (your own edits, perhaps)` : null,
  ].filter(Boolean);
  return { line: `Set up, version ${st.bundled}. ${parts.join(' and ')}.`, button: 'Restore its files' };
}

export type SetupResult = { ok: true; written: string[] } | { ok: false; error: string; written: string[] };

/**
 * Writes the skill's files that are missing or different (the folders made
 * first), each read back. A coach newer than this Pahlavan's copy is left
 * as it is: nothing is written.
 */
export async function setUpCoach(adapter: MkdirAdapter, files: Readonly<Record<string, string>>): Promise<SetupResult> {
  const versionPath = `${COACH_DIR}/${VERSION_FILE}`;
  const installed = versionOf((await adapter.exists(versionPath)) ? await adapter.read(versionPath) : null);
  const bundled = bundledVersion(files);
  if (installed !== null && coachVersion(installed, bundled) === 'coach-newer') {
    return { ok: false, error: `the coach in this vault (${installed}) is newer than this Pahlavan's (${bundled}): update Pahlavan from Community plugins`, written: [] };
  }
  const written: string[] = [];
  const made = new Set<string>();
  for (const [rel, text] of Object.entries(files)) {
    const path = `${COACH_DIR}/${rel}`;
    if ((await adapter.exists(path)) && (await adapter.read(path)) === text) continue;
    const dir = path.slice(0, path.lastIndexOf('/'));
    // Each folder on the way, once (the adapter makes one level at a time on some systems).
    const parts = dir.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      if (made.has(d)) continue;
      if (!(await adapter.exists(d))) await adapter.mkdir?.(d);
      made.add(d);
    }
    try {
      await adapter.write(path, text);
    } catch (e) {
      return { ok: false, error: `${path} could not be written: ${(e as Error).message}`, written };
    }
    if ((await adapter.read(path)) !== text) return { ok: false, error: `${path} did not read back as written`, written };
    written.push(rel);
  }
  return { ok: true, written };
}

/** "v22.11.0" (node --version) is 18 or later. */
export function nodeOk(version: string | null): boolean {
  const major = version ? Number(/^v?(\d+)\./.exec(version.trim())?.[1]) : NaN;
  return Number.isFinite(major) && major >= 18;
}

/**
 * Node, where a Mac usually has it: on the app's PATH, Homebrew's two
 * places, Volta's, else the login shell's. `run` runs a program and gives its
 * output (null when it doesn't run). The first that answers --version wins.
 */
export async function findNode(run: (file: string, args: string[]) => Promise<string | null>, home: string | null): Promise<{ path: string; version: string } | null> {
  const candidates = ['node', '/opt/homebrew/bin/node', '/usr/local/bin/node', ...(home ? [`${home}/.volta/bin/node`] : [])];
  for (const path of candidates) {
    const out = await run(path, ['--version']);
    if (out && /^v\d+\./.test(out.trim())) return { path, version: out.trim() };
  }
  const where = await run('/bin/zsh', ['-lc', 'command -v node']);
  const path = where?.trim().split('\n').pop() ?? '';
  if (path.startsWith('/')) {
    const out = await run(path, ['--version']);
    if (out && /^v\d+\./.test(out.trim())) return { path, version: out.trim() };
  }
  return null;
}
