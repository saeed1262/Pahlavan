# Developing Pahlavan

Pahlavan is one TypeScript codebase with three parts: an **engine** that holds every coaching rule and the reason for each number, an **Obsidian plugin** that draws the screens and the reminders from the same engine, and a **coach skill** for Claude Code that calls the engine as a command-line tool.

## The layout

| Folder | What it holds |
|---|---|
| `src/core/` | The rules, pure and tested: progression, readiness, volume, deloads, the body record, tracked habits, stand-ups and sitting, and the data formats (`schema.ts`, `validate.ts`). Every result comes with its reason (`reason.ts`). |
| `src/adapters/vault/` | Reading and writing the vault's files: where they are (`layout.ts`), reading (`read.ts`, `tracking-read.ts`) and the merges that write them (`log-write.ts`, `tracking-write.ts`, `body-write.ts`, `habits-write.ts`). |
| `src/report/` | What each screen and command shows, built from the rules (Today, Progress, Plan, Check-in, Food, Habits, the weekly review). |
| `src/cli/` | The engine as a command: `engine review`, `check`, `draft`, `plan-write`, `log add`, `track`, `checkin`, `folders` and the rest, each with `--json` and a dry run before `--write`. |
| `plugin/` | The Obsidian plugin: `src/` (the view, the settings, the reminder machine in `src/reminders/`, the screens in `src/ui/`) and `styles.css`; its `manifest.json` is at the repository's root. |
| `skill/` | The coach skill: `SKILL.md`, its reference files, `scripts/selfcheck.mjs` and the made-up `scripts/sample-plan.json` the self-check reads on a vault with no plan yet. The built engine ships beside it as `scripts/engine.cjs`. |
| `test/`, `plugin/test/` | The tests, on a made-up vault in `test/fixtures/vault/` and other fixtures. |
| `docs/` | The user guide and this page. |
| `tools/` | The builds, the shipping scripts, the phone-shortcut builder and the public export. |

## Working on it

You need Node.js 23.6 or later for development (the tests run TypeScript directly). The built engine and plugin run on Node 18 and later.

```bash
npm install
npm run typecheck      # both projects: the engine and the plugin
npm test               # every test, engine and plugin
npm run build          # the plugin: plugin/dist (main.js, manifest.json, styles.css), main.js and styles.css also at the root
npm run build-engine   # the engine alone: dist/pahlavan.js and dist/engine.cjs
npm run preview        # the plugin's screens in a browser, on the made-up vault
npm run build-demo     # the Try it page: plugin/preview/dist/demo/index.html, one file (--out docs/demo at a release)
```

Open `plugin/preview/index.html` after `npm run preview` (`file://` works, no server needed); its URL options (a tab, a section, light or dark, an empty vault) are listed at the top of `plugin/preview/preview.ts`.

The Try it page is the same harness built in demo mode (`tools/build-demo.mjs`, the template `plugin/preview/demo.html`): the rich made-up data in Obsidian's look, and only `tab`, `mode` and `isfahan` read from the link (`plugin/preview/demo-options.ts`). Everything is inline and its CSP refuses every request; `test/demo-page.test.ts` checks the built page. At a release, `npm run build-demo -- --out docs/demo` writes it where GitHub Pages serves the repository's `docs/` folder, at saeed1262.github.io/pahlavan/demo/.

To try your build in a vault:

```bash
npm run ship-plugin -- <vault>/.obsidian/plugins/pahlavan
npm run ship-skill -- <vault>/.claude/skills/fitness-coach
```

`ship-skill` builds the engine and runs its plan check on the made-up vault (`test/fixtures/vault`: no hard error on a date its Ledger allows, exactly the expected one while a constraint holds; anything else stops the ship), copies the skill and the engine, then runs the skill's self-check against that vault (read-only dry runs, and the docs held to the engine's `facts` from `engine --version --json`).

## Scoring coach-written plans

The coach (the skill) designs plans; `tools/eval-plans.mjs` scores them, so models and prompts can be compared on the same made-up athletes (`test/fixtures/athletes/`). Running a model is manual: save each draft as a whole `plan-data.json` named after its athlete (`1-beginner.json`, `1-beginner-try2.json`, or by number, `1-a.json`) in one folder, build the engine, then:

```bash
npm run build-engine
node tools/eval-plans.mjs <drafts folder> [--athletes <folder>] [--engine dist/engine.cjs] [--date YYYY-MM-DD] [--json]
```

For each draft it makes a scratch vault (the athlete's profile, its Ledger, a plan, empty logs) and runs the engine on the athlete's date. An athlete may carry its current plan as `input.current` (a whole plan-data object; `2-desk-recomp` has one). Its drafts are then redesigns: the current plan is the vault's plan-data.json, the draft is checked against it with `check --plan <draft> --redesign` (exercise changes are information, and a draft keeping over half of the current plan's movements warns `similar-to-current`), and `overlap --plans <draft> --vault` gives the share it keeps. Without `current` the draft is the plan and `check --plan` runs as usual. `review --plan` always reads the draft.

It prints one row per draft: hard errors, warnings by code, overrides used, `in current` (the share of the draft's movements the current plan also holds, `overlap.current` in the JSON, `-` without a current plan), `fit` (sessions over the profile's minutes, movements the Ledger blocks, ones the equipment does not cover and ones the person dislikes: `time-over`, `ledger-blocked`, `equipment-missing` and `disliked-movement`, 0 when absent), priority muscles inside their band, region rules met, sessions over the profile's minutes, and pulling to pushing sets. Under the rows, a diversity section from one `overlap` run over every draft that reads as a plan: for drafts of different athletes the mean and largest share (different people should get different plans), and for each athlete's own candidates every pair's shares both ways, the pairs over the limit (over half) named. `--json` gives every number, the section as `diversity: {limit, acrossAthletes: {mean, max, pairs, over}, withinAthlete: [{athlete, pairs, over}], skipped}`. A high share is a score, not a failure: the exit code is 1 only when a draft, or the overlap run, could not be scored. `tools/eval-samples/` holds the sample drafts the tests score: for the beginner a clean one and one with a hard error, and for the desk athlete a redesign that copies its current plan and one designed fresh.

## Rules of the codebase

- **Numbers come from code, with their reasons.** A rule returns its value and a reason (the rule, its inputs and a plain note), and the screens and the coach quote the note instead of doing their own sums.
- **The core is pure.** `src/core/` reads no files and has no clock of its own; a test checks this.
- **Writes merge against the file as it is now**, read it back, and change nothing else in it.
- **The plugin and the coach write the same shapes**, through the same functions, so either can pick up what the other wrote.

## Releasing

Bump the version in `src/core/version.ts`, `package.json` (and `package-lock.json`), `manifest.json` (at the root, where Obsidian's directory reads it), `versions.json`, and the line near the top of `docs/user-guide.md`; add the release to `CHANGELOG.md`, then run the type check and the tests. A release carries `main.js`, `manifest.json` and `styles.css` from `plugin/dist`: Obsidian's review runs `npm ci` and `npm run build` on a clean checkout and compares the result with them, so build a release from a clean tree.
