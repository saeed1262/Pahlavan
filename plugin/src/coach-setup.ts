// "Set up the coach": the coach is a Claude Code skill, and Pahlavan carries
// its files (the skill's text, its engine and self-check, built in). Setting
// it up writes them into the vault's .claude/skills/fitness-coach/, where
// Claude Code finds /fitness-coach; updating writes this Pahlavan's copy over
// an older one. Only the skill's own files are written: anything else in that
// folder, and the vault's Coach/local.md, stay. The engine needs Node 18 or
// later, looked for where a Mac usually has it.

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
  const installed = versionOf(await read(VERSION_FILE));
  return { installed: installed ?? ((await adapter.exists(at('SKILL.md'))) ? 'unknown' : null), bundled: versionOf(files[VERSION_FILE] ?? null) ?? 'unknown', missing, differ };
}

export type SetupResult = { ok: true; written: string[] } | { ok: false; error: string; written: string[] };

/** Writes the skill's files that are missing or different (the folders made first), each read back. */
export async function setUpCoach(adapter: MkdirAdapter, files: Readonly<Record<string, string>>): Promise<SetupResult> {
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
