# Developing Pahlavan

Pahlavan is one TypeScript codebase with three parts: an **engine** that holds every coaching rule and the reason for each number, an **Obsidian plugin** that draws the screens and the reminders from the same engine, and a **coach skill** for Claude Code that calls the engine as a command-line tool.

## The layout

| Folder | What it holds |
|---|---|
| `src/core/` | The rules, pure and tested: the plan generator, progression, readiness, volume, deloads, the body record, tracked habits, stand-ups and sitting, and the data formats (`schema.ts`, `validate.ts`). Every result comes with its reason (`reason.ts`). |
| `src/adapters/vault/` | Reading and writing the vault's files: where they are (`layout.ts`), reading (`read.ts`, `tracking-read.ts`) and the merges that write them (`log-write.ts`, `tracking-write.ts`, `body-write.ts`, `habits-write.ts`). |
| `src/report/` | What each screen and command shows, built from the rules (Today, Progress, Plan, Check-in, Food, Habits, the weekly review). |
| `src/cli/` | The engine as a command: `engine review`, `plan`, `log add`, `track`, `checkin`, `folders` and the rest, each with `--json` and a dry run before `--write`. |
| `plugin/` | The Obsidian plugin: `src/` (the view, the settings, the reminder machine in `src/reminders/`, the screens in `src/ui/`) and `styles.css`; its `manifest.json` is at the repository's root. |
| `skill/` | The coach skill: `SKILL.md`, its reference files and `scripts/selfcheck.mjs`. The built engine ships beside it as `scripts/engine.cjs`. |
| `test/`, `plugin/test/` | The tests, on a made-up vault in `test/fixtures/vault/` and other fixtures. |
| `docs/` | The user guide and this page. |
| `tools/` | The builds, the shipping scripts, the phone-shortcut builder and the public export. |

## Working on it

You need Node.js 23.6 or later for development (the tests run TypeScript directly). The built engine and plugin run on Node 18 and later.

```bash
npm install
npm run typecheck      # both projects: the engine and the plugin
npm test               # every test, engine and plugin
npm run build-plugin   # plugin/dist: main.js, manifest.json, styles.css
npm run preview        # the plugin's screens in a browser, on the made-up vault
```

The preview opens `plugin/preview/index.html` with a static server; its URL options (a tab, a section, light or dark, an empty vault) are listed at the top of `plugin/preview/preview.ts`.

To try your build in a vault:

```bash
npm run ship-plugin -- <vault>/.obsidian/plugins/pahlavan
npm run ship-skill -- <vault>/.claude/skills/fitness-coach
```

`ship-skill` copies the skill and the freshly built engine, then runs the skill's self-check against that vault (read-only dry runs).

## Rules of the codebase

- **Numbers come from code, with their reasons.** A rule returns its value and a reason (the rule, its inputs and a plain note), and the screens and the coach quote the note instead of doing their own sums.
- **The core is pure.** `src/core/` reads no files and has no clock of its own; a test checks this.
- **Writes merge against the file as it is now**, read it back, and change nothing else in it.
- **The plugin and the coach write the same shapes**, through the same functions, so either can pick up what the other wrote.

## Releasing

Bump the version in `src/core/version.ts`, `package.json` (and `package-lock.json`), `manifest.json` (at the root, where Obsidian's directory reads it), `versions.json`, and the line near the top of `docs/user-guide.md`; add the release to `CHANGELOG.md`, then run the type check and the tests. A release carries `main.js`, `manifest.json` and `styles.css` from `plugin/dist`.
