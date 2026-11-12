# Phone shortcuts

Builds the two iPhone shortcuts that log to Pahlavan through its phone inbox (`Coach/Inbox/`):

| File | What it does |
|---|---|
| `Pahlavan.shortcut` | One menu: Gym, Water, Tick habits, Log a session, Did you train?, Morning check-in. Reads `phone.json`, asks only what is open, sends one entry. Run by the gym page's Send, it sends the page's session instead (see [The gym page](#the-gym-page)). |
| `Health to Pahlavan.shortcut` | For a 07:00 automation: yesterday's steps and floors, the resting heart rate and HRV, then last night's sleep, from Apple Health. |

Neither file holds a token. Each runs the user's own **Pahlavan Token** shortcut, built by hand on the phone.

## Build, sign, install

```bash
node tools/shortcuts/build.mjs --repo OWNER/NAME --inbox PATH/TO/Coach/Inbox --out ~/Downloads
```

Plain Node, no dependencies. The sources, all in this folder:

| File | What it holds |
|---|---|
| `build.mjs` | The command above: writes both files and prints each one's action count. |
| `shortcut.mjs` | The builder: actions, text tokens with attachments, `Flow` (If, Menu and Repeat groups, `ifMatch`) and the XML plist writer. |
| `pahlavan-menu.mjs` | The actions of `Pahlavan.shortcut`. |
| `health-to-pahlavan.mjs` | The actions of `Health to Pahlavan.shortcut`. |

`test/shortcuts.test.ts` builds both into a temp folder and checks the action counts, that every action output a step uses exists, and that no token is in either file. For the gym page it reads Pahlavan back and checks the input branch, the Gym item, and that the number unquoting leaves the page's JSON as it came.

The files are unsigned XML plists, and iPhones and Macs only open signed ones. On a Mac signed into iCloud:

```bash
shortcuts sign --mode anyone --input "Pahlavan.shortcut" --output ~/Desktop/"Pahlavan.shortcut"
```

Open the signed file (on that Mac, or AirDrop it to the phone) and choose **Add Shortcut**. Then, on the phone:

1. In the first step, **Run Shortcut**, pick **Pahlavan Token** (the link by name doesn't survive the import).
2. Tap **Allow Access** on the Health steps.
3. For Health to Pahlavan: Automation > Time of Day 07:00, Daily, Run Immediately, Run Shortcut **Health to Pahlavan**.

Delete the old copy first, or the new one arrives as "Pahlavan 1" (and the gym page's Send, which calls it by name, runs the old one). The user's guide in the vault is `3-Personal/Fitness/Phone shortcuts.md`.

## The gym page

The gym page (`GYM_PAGE` in `src/core/gym.ts`, now `https://saeed1262.github.io/pahlavan-gym/`) logs every set at the gym. It must be hosted at that address before **Gym** works: the shortcut only opens it, with the link Pahlavan writes on the clipboard.

- **Gym**, the menu's first item, gets `gym` from `phone.json`: a ready link (the page's address, `#`, the day's sessions as base64url JSON), or null. It copies the link (Copy to Clipboard, on this phone only) and opens the page's address with `#paste`, and the page's **Load today's session** reads the clipboard at a tap. Open URLs can't carry the link itself: it hands the browser only the address, without the `#` part, already at 1,300 characters (a short `#abc` survives). The shortcut sends nothing itself. Null gives "No gym page yet: open Pahlavan on your Mac first".
- **The page hands the session back.** Its Send opens `shortcuts://run-shortcut?name=Pahlavan&input=text&text=<the session's JSON>`; Safari asks "Open in Shortcuts?". With Shortcut Input, the shortcut runs the token and the dates (the after-midnight question included), shows **Send to Pahlavan?** with the page's `_say` ("A · 12 sets"), and on OK sends `{"v":1,"at":…,"date":…,"kind":"session","session":<the page's JSON>}` through the same send as the menu. Cancel stops it with nothing sent. Without input (home screen, widget, Siri) it reads `phone.json` and shows the menu as before.
- The file says it takes input (`WFWorkflowHasShortcutInputVariables`) but lists no input types, so it stays out of the share sheet; the URL scheme passes its text anyway.

### Check on the phone

None of this can be checked on the Mac. After importing the new copy:

1. **Input arrives with the share sheet off.** On the page, Send, then Open: the alert shows the page's words. The menu instead means the input didn't arrive.
2. **The alert.** Cancel: no new file in the inbox. OK: the "Sent to Pahlavan" notification, "session for <day>".
3. **One Send gives one entry.** One new `…-session.json` in the inbox; `engine validate <file> --kind inbox` passes and it imports as one session with every set.
4. **A resend is refused.** Send the same session again: the import refuses it as already logged (`refused.json`), and the log keeps the first.
5. **Gym** opens the page on its Load step, and **Load today's session** (then Paste) shows today's sessions; with no link (`gym` null) it says so. Check that the Copy to Clipboard, URL, Open URLs and Show Alert steps kept their inputs on import.

## What survives the import, and what doesn't

Found on iOS 26 (November 2026); `shortcut.mjs` and the two builders work around each one.

- **Run Shortcut by name** doesn't link: the step says "Shortcut Not Found" until the user picks the shortcut. Keep it to one Run Shortcut per file, at the top.
- **If "is", "is not", "contains"** lose their comparison value. Use `Flow.ifMatch` (or `ifNotMatch`): **Match Text** with a regular expression, then **has any value**.
- **Find Health Samples:** the type and the date filters import; a category value filter (Sleep's "is not In Bed") doesn't. Sleep reads each sample's Value instead and skips "bed" and "awake". A Sleep step finds nothing with "Start Date is between" two dates, or with no date filter at all; only "is in the last" works (`Operator: 1001, Values: { Number, Unit }`, read off a working copy on the phone). So sleep takes the last day and skips any stretch that started before 18:00 yesterday, with Match Text on the minutes between them (negative: the night before).
- **Limit is applied to the raw samples before Group by**, so "Group by Day, Limit 1" returns one small sample (32 steps), not the day. No Limit.
- **Fill Missing** adds an empty bucket for the range's end day, so a one-day range gives two buckets: take the first.
- **No samples at all is an error**, not an empty result, and it stops the shortcut. Fill Missing keeps a quantity from being empty; sleep (a category) can't fill, so it goes last, after the main send.
- **HRV** is Apple's SDNN in ms (Heart Rate Variability, read like the resting heart rate: the latest day group over yesterday and today that isn't 0, rounded). Studies mostly use rMSSD, so Pahlavan compares it only with your own usual, never with a number from a paper.
- Numbers go into the JSON quoted and two Replace Text steps unquote them, so a decimal comma or a thousands separator can't break the entry. They change only a quoted whole value of a numeric key, where a key can start (after `{` or `,`), so the gym page's JSON (numbers already numbers, nulls, notes with quotes and commas) passes through unchanged. Check a new entry with `engine validate <file> --kind inbox`.
