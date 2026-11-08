// The cycle's baseline note: `Baseline - <date>.md` in the fitness folder
// marks a fresh start, and the cycle start, week 1, readiness's 14 mornings
// and every "This cycle" view count from it. The coach's first job in a fresh
// start (the intake, or the plan job when no note was written) writes it
// from this template, word for word; the engine works out its dates (week
// 1's Monday, the first light week's photo Sunday, phase 1's test Saturday)
// so the coach does no date arithmetic. Pure: the date and the notes already
// there are inputs; nothing is read or written here.

import { CALIBRATION } from '../core/calibration.ts';
import { addDays, dayText, isIsoDate, mondayOf } from '../core/dates.ts';
import { legacyRules, nthLightWeek, phaseWeeks, type LightWeeksRules } from '../core/rules.ts';
import { explain, type Result } from '../core/reason.ts';
import type { IsoDate } from '../core/schema.ts';
import { paths } from '../adapters/vault/layout.ts';

/** The note's path: in the fitness folder, named by its date. */
export const baselinePath = (date: IsoDate): string => `${paths().fitness}/Baseline - ${date}.md`;


export interface BaselineNote {
  /** The note's path in the vault. */
  path: string;
  /** A note for this date is there already: write nothing. */
  exists: boolean;
  /** The newest note before this one (the cycle before), or null. */
  previous: IsoDate | null;
  /** Week 1's Monday: the week the note's date falls in. */
  weekOne: IsoDate;
  /** The first light week's Sunday (the end of week 4 by default): the next photo set. */
  firstPhotos: IsoDate;
  /** Phase 1's last Saturday (week 8 by default): the first fitness tests. */
  firstTests: IsoDate;
  /** The note, word for word. */
  text: string;
}

/**
 * The baseline note for a fresh start on `date`, given the dates of the notes
 * already in the folder and the plan's light weeks (the old default's every
 * 4th week without them): the photos on the first light week's Sunday, the
 * tests on the Saturday of phase 1's last week (a phase is two mesocycles).
 */
export function baselineNote(date: IsoDate, existing: readonly string[], lightWeeks: Pick<LightWeeksRules, 'every' | 'weeks'> = legacyRules().lightWeeks, testWeeks: readonly number[] | null = null): Result<BaselineNote> {
  if (!isIsoDate(date)) throw new Error(`baselineNote needs a date as YYYY-MM-DD, got ${String(date)}`);
  const dates = [...existing].filter(isIsoDate).sort();
  const weekOne = mondayOf(date);
  const legacy = legacyRules().lightWeeks;
  const photosWeek = nthLightWeek(lightWeeks, 1) ?? nthLightWeek(legacy, 1)!;
  // The plan's first test week (rules.tests), else phase 1's last week.
  const testsWeek = testWeeks?.[0] ?? phaseWeeks(lightWeeks, 1).last ?? phaseWeeks(legacy, 1).last!;
  const firstPhotos = addDays(weekOne, photosWeek * 7 - 1);
  const firstTests = addDays(weekOne, testsWeek * 7 - 2);
  const previous = dates.filter((d) => d < date).at(-1) ?? null;
  const exists = dates.includes(date);
  const text = baselineText(date, firstPhotos, firstTests);
  return explain<BaselineNote>({ path: baselinePath(date), exists, previous, weekOne, firstPhotos, firstTests, text }, 'cycle.baseline-note', { date, existing: dates }, {
    note: exists
      ? `Baseline - ${date}.md is there already: nothing to write; the cycle starts on ${dayText(date)}.`
      : `A fresh start on ${dayText(date)}: week 1 is the week of ${dayText(weekOne)}, the first photo set the light week's Sunday ${dayText(firstPhotos)}, the first tests phase 1's last Saturday ${dayText(firstTests)}.${previous ? ` The note of ${dayText(previous)} stays and marks the cycle before.` : ''}`,
  });
}

function baselineText(date: IsoDate, photos: IsoDate, tests: IsoDate): string {
  return `# Baseline · ${date}

Day 1 of a new cycle ([[6-Month Roadmap]]), after the ${date} intake: a fresh start. Everything at the end of this cycle's plan gets compared with this page. The intake's own numbers are in the [[${paths().coach}/Athlete profile|Athlete profile]].

> [!note] Filled in by Pahlavan
> Pahlavan's morning check-in records weight, sleep, resting HR and steps each morning; its Body record takes the tape, photos and fitness tests on the plan's dates. This cycle's first entries are the baseline; nothing needs copying here.

## 1. Body

\`\`\`dataviewjs
let d = {};
try { d = JSON.parse(await app.vault.adapter.read("${paths().body}")); } catch (e) {}
const start = "${date}";
const days = Object.keys(d.days || {}).filter(k => k >= start).sort();
const first = f => { const k = days.find(x => d.days[x][f] != null); return k ? \`\${d.days[k][f]} (\${k})\` : "not yet"; };
const tape = (d.tape || []).filter(e => e.date >= start).sort((a, b) => a.date.localeCompare(b.date))[0];
dv.table(["Measure", "Baseline"], [
  ["Weight (kg)", first("weight")],
  ["Waist at the navel (cm)", tape && tape.waist != null ? \`\${tape.waist} (\${tape.date})\` : "not yet"],
  ["Resting heart rate (bpm)", first("rhr")],
  ["Sleep (h)", first("sleepH")],
  ["Steps (day total)", first("steps")],
]);
\`\`\`

## 2. Photos

The intake's set, if you took one, is in \`Progress Photos/${date}/\`. The next set comes on the first light week's Sunday (${dayText(photos)}), then on each light week's Sunday.

## 3. Fitness tests

The first tests come at the end of phase 1 (${dayText(tests)}, in the light week); the intake's movement self-check is the starting point until then.

## 4. Strength

No testing day. Week 1 is calibration: the first time you do each session, pick weights that leave ${CALIBRATION.rir} reps in reserve and log the top sets of the main lifts. Those first logs are the strength baseline.
`;
}
