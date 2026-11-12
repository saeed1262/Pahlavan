// Pahlavan's version beside the coach's. The plugin in the vault's config
// folder carries its own copy of the coach's engine ("Set up the coach"
// writes it into the vault), and two Macs that share a vault can end up with
// different ones. The first line of the plugin's main.js names the engine it
// carries ("// Pahlavan 0.27.0 (engine 0.27.0) | ..."); without that line,
// its manifest.json's version stands in. Read only, through the io given.

import { compareVersions } from '../../core/version.ts';
import type { VaultWarning } from './convert.ts';
import { joinPath, type ReadIo } from './read.ts';

/** Where Claude Code finds the vault's coach skill (Pahlavan writes it there). */
export const COACH_SKILL_DIR = '.claude/skills/fitness-coach';

export interface PluginVersion {
  /** Pahlavan's own version. */
  plugin: string;
  /** The engine version Pahlavan carries. */
  engine: string;
  /** Where it was read: main.js's first line, or manifest.json's version (the engine's taken as the same). */
  from: 'main.js' | 'manifest.json';
}

/** main.js's first line, as tools/build-plugin.mjs writes it. */
const BANNER = /^\/\/ Pahlavan (\S+) \(engine (\S+)\)/;

/** The engine Pahlavan carries in the vault (`<configDir>/plugins/pahlavan/`); null with no plugin there, or no version to read. */
export function pluginVersion(io: ReadIo, root: string, configDir: string): PluginVersion | null {
  const dir = joinPath(root, `${configDir.replace(/\/+$/, '')}/plugins/pahlavan`);
  const main = io.readText(`${dir}/main.js`);
  const first = main === null ? '' : main.slice(0, main.indexOf('\n') >= 0 ? main.indexOf('\n') : main.length);
  const m = BANNER.exec(first);
  if (m) return { plugin: m[1]!, engine: m[2]!, from: 'main.js' };
  const manifest = io.readText(`${dir}/manifest.json`);
  if (manifest === null) return null;
  try {
    const v = (JSON.parse(manifest) as { version?: unknown }).version;
    return typeof v === 'string' && v.trim() ? { plugin: v.trim(), engine: v.trim(), from: 'manifest.json' } : null;
  } catch {
    return null;
  }
}

/**
 * `version-differs`: Pahlavan in the vault carries another engine than this
 * coach's (`engine`, the one running), with which is newer and what the
 * user does about it. Null when they agree, and when the vault has no
 * Pahlavan or no coach (nothing to compare).
 */
export function versionWarning(io: ReadIo, root: string, configDir: string, engine: string): VaultWarning | null {
  if (io.listDir(joinPath(root, COACH_SKILL_DIR)) === null) return null;
  const p = pluginVersion(io, root, configDir);
  if (!p) return null;
  const c = compareVersions(p.engine, engine);
  if (c === 0) return null;
  const carries = p.from === 'main.js' ? `Pahlavan ${p.plugin} in this vault carries engine ${p.engine}` : `Pahlavan in this vault is version ${p.plugin} (its manifest.json; main.js names no engine)`;
  const todo = c > 0
    ? 'Pahlavan\'s is newer: press Update the coach in Pahlavan\'s settings, Coach (or run the command "Set up the coach"), then start the coach again.'
    : 'This coach is newer: update Pahlavan from Community plugins (Pahlavan never writes its older copy over a newer coach).';
  return { code: 'version-differs', message: `${carries}; this coach runs engine ${engine}. ${todo}` };
}
