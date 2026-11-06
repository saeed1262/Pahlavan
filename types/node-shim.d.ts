// Minimal declarations for the few Node APIs the tests and the CLI entry use.
// The project installs only esbuild and typescript, so there is no @types/node.
// src/core never sees these: a test fails if it imports anything from Node.

declare module 'node:test' {
  type Body = () => void | Promise<void>;
  export function test(name: string, fn: Body): Promise<void>;
  export function describe(name: string, fn: Body): Promise<void>;
  export function it(name: string, fn: Body): Promise<void>;
  export function before(fn: Body): void;
}

declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
    match(value: string, pattern: RegExp, message?: string): void;
    doesNotMatch(value: string, pattern: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp | (new (...args: never[]) => Error), message?: string): void;
    fail(message?: string): never;
  }
  const assert: Assert;
  export default assert;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string, options?: { recursive?: boolean }): string[];
  export function existsSync(path: string): boolean;
  export function statSync(path: string): { isFile(): boolean; isDirectory(): boolean; size: number; mtimeMs: number };
  export function mkdtempSync(prefix: string): string;
  export function writeFileSync(path: string, text: string): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function renameSync(from: string, to: string): void;
  export function cpSync(from: string, to: string, options?: { recursive?: boolean }): void;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
  export function dirname(path: string): string;
}

declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: readonly string[],
    options?: { encoding?: 'utf8'; cwd?: string; env?: Record<string, string | undefined> },
  ): { status: number | null; stdout: string; stderr: string };
}

interface ImportMeta {
  readonly dirname: string;
  readonly filename: string;
}

declare const process: {
  readonly argv: string[];
  readonly pid: number;
  readonly execPath: string;
  readonly env: Record<string, string | undefined>;
  exitCode: number | undefined;
  readonly stdout: { write(text: string): boolean };
  readonly stderr: { write(text: string): boolean };
  on(event: 'exit', listener: () => void): unknown;
};
