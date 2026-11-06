// The synthetic plan with supersets, its notes written as the coach writes
// them now: each pair's two items share the rest "90 s after each pair" and
// open with "Superset with <other>: a set of each, then rest."; the notes
// hold an RIR sentence, a progression sentence, a form cue and "Why: ...".
// A: Face Pull + Band External Rotation (the fixture's own pair). B: the
// Bulgarian split squat + Side Plank, made a pair here. All made up. Shared by
// the tests and the plugin preview (`&supersets=1`); pure, so it bundles for
// the page: it edits a map of file texts in place.

type Item = { name: string; rest?: string; note?: string; pair?: boolean };

const NOTES: Record<string, Record<string, Partial<Item>>> = {
  A: {
    'Flat DB Bench Press': { note: 'RIR 2. Double progression: at the top of the range on every set, 5 lb more per hand. Lower over 2 s to a light touch on the chest. Why: the main horizontal press; dumbbells let each side work alone.' },
    'Face Pull': { rest: '90 s after each pair', note: 'Superset with Band External Rotation: a set of each, then rest. RIR 2. Double progression: at the top of the range on every set, the next step up. Why: rear delts and upper back for the posture emphasis.' },
    'Band External Rotation': { rest: '90 s after each pair', pair: true, note: 'Superset with Face Pull: a set of each, then rest. RIR 2. Elbow at your side, a rolled towel under it. Why: the rotator cuff, before the pressing.' },
  },
  B: {
    'Romanian Deadlift': { note: 'RIR 3. Linear: add one step each session every rep is made (one step at most). Hinge at the hips, the bar close to the legs. Why: the main hinge, for the hamstrings and the back.' },
    'Seated Cable Row': { note: 'RIR 2. Double progression: at the top of the range on every set, the next step up. Chest up, pull to the lower ribs. Why: upper back is a priority (shoulders rolled forward in the photos).' },
    'Bulgarian Split Squat': { rest: '90 s after each pair', note: 'Superset with Side Plank: a set of each (both legs), then rest. RIR 2. Dumbbells. Double progression: at the top of the range on every set, the next step up. Why: single-leg work while the balance holds are short.' },
    'Side Plank': { rest: '90 s after each pair', pair: true, note: 'Superset with Bulgarian Split Squat: a set of each, then rest. RIR 2. Why: obliques, held while the legs rest.' },
  },
};

/** Rewrites the plan-data.json in `files` (under `root`) with the supersets above. */
export function applySupersets(files: Record<string, string>, root = ''): void {
  const path = `${root ? `${root}/` : ''}3-Personal/Fitness/plan-data.json`;
  const plan = JSON.parse(files[path]!) as { sessions: Record<string, Item[]> };
  for (const [type, items] of Object.entries(NOTES)) {
    for (const it of plan.sessions[type] ?? []) if (items[it.name]) Object.assign(it, items[it.name]);
  }
  files[path] = JSON.stringify(plan, null, 2);
}
