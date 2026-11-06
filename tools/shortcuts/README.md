# Phone shortcuts

Builds the two iPhone shortcuts that log to Pahlavan through its phone inbox (`Coach/Inbox/`):

| File | What it does |
|---|---|
| `Pahlavan.shortcut` | One menu: Water, Tick habits, Log a session, Did you train?, Morning check-in. Reads `phone.json`, asks only what is open, sends one entry. |
| `Health to Pahlavan.shortcut` | For a 07:00 automation: yesterday's steps and floors and the resting heart rate, then last night's sleep, from Apple Health. |

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

`test/shortcuts.test.ts` builds both into a temp folder and checks the action counts, that every action output a step uses exists, and that no token is in either file.

The files are unsigned XML plists, and iPhones and Macs only open signed ones. On a Mac signed into iCloud:

```bash
shortcuts sign --mode anyone --input "Pahlavan.shortcut" --output ~/Desktop/"Pahlavan.shortcut"
```

Open the signed file (on that Mac, or AirDrop it to the phone) and choose **Add Shortcut**. Then, on the phone:

1. In the first step, **Run Shortcut**, pick **Pahlavan Token** (the link by name doesn't survive the import).
2. Tap **Allow Access** on the Health steps.
3. For Health to Pahlavan: Automation > Time of Day 07:00, Daily, Run Immediately, Run Shortcut **Health to Pahlavan**.

Delete the old copy first, or the new one arrives as "Pahlavan 1". The user's guide in the vault is `3-Personal/Fitness/Phone shortcuts.md`.

## What survives the import, and what doesn't

Found on iOS 26 (November 2026); `shortcut.mjs` and the two builders work around each one.

- **Run Shortcut by name** doesn't link: the step says "Shortcut Not Found" until the user picks the shortcut. Keep it to one Run Shortcut per file, at the top.
- **If "is", "is not", "contains"** lose their comparison value. Use `Flow.ifMatch` (or `ifNotMatch`): **Match Text** with a regular expression, then **has any value**.
- **Find Health Samples:** the type and the date filters import; a category value filter (Sleep's "is not In Bed") doesn't. Sleep reads each sample's Value instead and skips "bed" and "awake". A Sleep step finds nothing with "Start Date is between" two dates, or with no date filter at all; only "is in the last" works (`Operator: 1001, Values: { Number, Unit }`, read off a working copy on the phone). So sleep takes the last day and skips any stretch that started before 18:00 yesterday, with Match Text on the minutes between them (negative: the night before).
- **Limit is applied to the raw samples before Group by**, so "Group by Day, Limit 1" returns one small sample (32 steps), not the day. No Limit.
- **Fill Missing** adds an empty bucket for the range's end day, so a one-day range gives two buckets: take the first.
- **No samples at all is an error**, not an empty result, and it stops the shortcut. Fill Missing keeps a quantity from being empty; sleep (a category) can't fill, so it goes last, after the main send.
- Numbers go into the JSON quoted and two Replace Text steps unquote them, so a decimal comma or a thousands separator can't break the entry. Check a new entry with `engine validate <file> --kind inbox`.
