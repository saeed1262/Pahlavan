// A small argument parser: `command [positionals] --flag value --switch`.

export interface ParsedArgs {
  command: string | null;
  positionals: string[];
  flags: Record<string, string | true>;
  errors: string[];
}

/** Flags that take a value; every other flag is a switch. */
const VALUE_FLAGS = new Set(['vault', 'date', 'plan', 'lift', 'profile', 'ledger', 'start', 'weeks', 'format', 'kind', 'file', 'mode', 'type', 'time', 'item', 'id', 'at', 'schedule', 'tape-from', 'tape-every', 'tests-from', 'tests-every', 'amount', 'lift1', 'lift2', 'skip', 'level', 'label', 'weight', 'reps', 'topic', 'pattern', 'region', 'muscle', 'equipment', 'query']);
/** Flags whose value is optional: "true" or "false" when it follows, else a switch (true). */
const OPTIONAL_VALUE = new Set(['done']);
const SHORT: Record<string, string> = { h: 'help', v: 'version' };

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { command: null, positionals: [], flags: {}, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (!name) {
        out.errors.push('empty flag "--"');
        continue;
      }
      if (OPTIONAL_VALUE.has(name) && eq < 0) {
        const next = argv[i + 1];
        if (next === 'true' || next === 'false') {
          out.flags[name] = next;
          i++;
        } else out.flags[name] = true;
      } else if (VALUE_FLAGS.has(name) || OPTIONAL_VALUE.has(name)) {
        const value = eq > 0 ? a.slice(eq + 1) : argv[i + 1];
        if (value === undefined || (eq < 0 && value.startsWith('--'))) out.errors.push(`--${name} needs a value`);
        else {
          out.flags[name] = value;
          if (eq < 0) i++;
        }
      } else if (eq > 0) out.errors.push(`--${name} takes no value`);
      else out.flags[name] = true;
    } else if (/^-[a-z]$/.test(a)) {
      const name = SHORT[a.slice(1)];
      if (name) out.flags[name] = true;
      else out.errors.push(`unknown flag ${a}`);
    } else if (out.command === null) out.command = a;
    else out.positionals.push(a);
  }
  return out;
}
