# Changelog

## 0.25.2: Obsidian 1.7.2 or later

- **Needs Obsidian 1.7.2 or later** (it was 1.5.0). Pahlavan opens its tab with Obsidian's `revealLeaf`, which since 1.7.2 waits for the tab to load; the directory's review asks the declared minimum to cover it. Obsidian 1.7.2 came out in October 2024.

## 0.25.1: Obsidian's review

Changes from the community directory's automated review. Nothing you do in Pahlavan changes.

- **Popout windows:** the screens are built on the window in use (Obsidian's `activeDocument`) and their timers run on it, as Obsidian's guidelines ask.
- **The open command** is now **Pahlavan: Open** in the command palette (it was "Pahlavan: Open Pahlavan").
- **For developers:** `npm run build` builds the plugin, the same on any system (the engine alone is `npm run build-engine`); `package-lock.json` lists every dependency, so `npm ci` works; the preview builds from the public repository; the code passes Obsidian's lint rules, with two exceptions: the coach's command-line engine runs outside Obsidian, where `Vault#configDir` doesn't exist, and the settings don't yet use Obsidian 1.13's settings search.

## 0.25.0: the first public beta

The first public version of Pahlavan, free while it's in beta. It was built and used in private before this, from 0.1 to 0.24.

- **The plugin:** Today (the session, how to do each movement and why it's in your plan, a checklist, the log), Progress (your week, strength over time, the body record and photos, your habits with 4-week charts for sitting, stand-ups and desk breaks), Plan, Check-in, Food, and reminder cards with quiet hours.
- **The coach:** the `/fitness-coach` skill for Claude Code (intake, plan, logging, the Sunday check-in and letter, reviews, progress reports, an eating plan, habits), set up from Pahlavan's welcome card or its settings.
- **Licence:** the Elastic License 2.0. The code is open to read, use and change; it can't be offered as a service, have a licence key removed or got around, or lose its notices.
- **Calls are not detected:** a stand-up or sitting count treats a call without typing as time away. Pausing during calls, through a small helper program you choose in the settings, is planned for a later version.
