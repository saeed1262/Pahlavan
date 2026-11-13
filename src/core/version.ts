// The engine's own version. A test keeps it equal to package.json's.
export const ENGINE_VERSION = '0.28.1';

/**
 * The vault's coach against the engine version Pahlavan carries: the same,
 * older (Pahlavan's copy updates it), newer (a newer Pahlavan on the other
 * Mac set it up: Pahlavan is the one to update, its older copy never goes
 * over it), or not set up.
 */
export type CoachVersion = 'same' | 'coach-older' | 'coach-newer' | 'not-set-up';

/** "0.27.0" (or "v0.27.0") as its three numbers; null for anything else ("unknown"). */
function semver(v: string | null | undefined): [number, number, number] | null {
  const m = v ? /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim()) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * `a` against `b`, major, then minor, then patch: below 0 when `a` is older,
 * 0 the same, above 0 newer. A version that can't be read is older than any
 * that can (a coach from before its VERSION file); two such are the same.
 */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const x = semver(a);
  const y = semver(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/** Where the vault's coach (its VERSION file's engine, null when it isn't set up) stands against the one Pahlavan carries. */
export function coachVersion(installed: string | null, bundled: string): CoachVersion {
  if (installed === null) return 'not-set-up';
  const c = compareVersions(installed, bundled);
  return c < 0 ? 'coach-older' : c > 0 ? 'coach-newer' : 'same';
}
