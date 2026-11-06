// The outer shape every report shares, the CLI's JSON and the plugin's data
// alike: the command, the engine and schema versions, the sources read, the
// report itself, and the adapter's warnings and errors.

import type { VaultWarning } from '../adapters/vault/convert.ts';
import type { VaultRead } from '../adapters/vault/read.ts';
import { SCHEMA_VERSION } from '../core/schema.ts';
import { ENGINE_VERSION } from '../core/version.ts';

export function envelope<P extends Record<string, unknown>>(command: string, payload: P, warnings: VaultWarning[], errors: VaultWarning[]) {
  return { command, engine: ENGINE_VERSION, schema: SCHEMA_VERSION, ok: errors.length === 0, ...payload, warnings, errors };
}

/** Which files were found, and the coach files' state. */
export function sourcesOf(read: VaultRead, root: string) {
  return { vault: root, files: read.files, coach: read.data.coach };
}
