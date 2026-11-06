// Two weeks of ab work on the synthetic vault, for the priority minimum (a
// priority muscle's 10 sets come from direct sets near failure). Abs are a
// priority; the side plank is tested at 60 s, the plank (the self-check's
// core hold) at 60 s, and the core ladder stands at level 3 (hollow hold,
// arms by sides). Both lifting days squat with abs as a helping muscle.
//
// The old ab work: S1 the hollow hold at the user's level (2 × hold, RIR 2)
// and a Pallof press (3 × 10/side, RIR 2); S2 a reverse crunch (3 × 10–15,
// RIR 1) and a side plank at 30–45 s; S3 a dead bug (level 1 of the core
// ladder, no RIR) and the side plank again. Abs: 15 sets in all, 8 of them
// direct and near failure.
//
// The new ab work: S1 a cable crunch (3 × 8–12, RIR 1) and the Pallof press;
// S2 the hollow hold (3 × hold, "RIR 1: ...") and a side plank at 45–60 s;
// S3 an ab wheel rollout (3 × 6–10, "RIR 1–2") and the side plank. Abs: 12
// direct sets near failure. All made up; pure, it edits a map of file texts.

type Item = { name: string; table?: string; sr: string; rest?: string; note?: string; label?: string; ladder?: string };

const squat = (name: string, sr: string): Item => ({ name, table: name, sr, rest: '2–3 min', note: 'RIR 2. Why: the main squat.' });

const LIFT: Record<string, Item[]> = {
  A: [squat('Barbell Back Squat', '3 × 6'), { name: 'Flat DB Bench Press', table: 'Flat DB Bench Press', sr: '3 × 8–12', rest: '2 min', note: 'RIR 2.' }],
  B: [squat('Goblet Squat', '3 × 10–15'), { name: 'Romanian Deadlift', table: 'Romanian Deadlift', sr: '3 × 8–10', rest: '2–3 min', note: 'RIR 2.' }],
};

const HOLLOW = (sr: string, note: string): Item => ({ name: 'Core (abs) (your level)', table: 'Core (abs) (your level)', sr, rest: '45 s', note, ladder: 'hollow' });
const PALLOF: Item = { name: 'Pallof Press', table: 'Pallof Press', sr: '3 × 10/side', rest: '45 s', note: 'RIR 2. Why: obliques and anti-rotation.' };
const SIDE = (sr: string): Item => ({ name: 'Side Plank', table: 'Side Plank', sr, rest: '30 s', note: 'Hips high. Why: obliques.' });

export const AB_WORK: Record<'old' | 'new', Record<string, Item[]>> = {
  old: {
    S1: [HOLLOW('2 × hold', 'RIR 2. Why: the core ladder at your level.'), PALLOF],
    S2: [{ name: 'Reverse crunch', table: 'Reverse crunch', sr: '3 × 10–15', rest: '45 s', note: 'RIR 1. Why: abs.' }, SIDE('2 × 30–45 s/side')],
    S3: [{ name: 'Dead Bug', table: 'Dead Bug', sr: '2 × 8/side', rest: '45 s', note: 'Lower back pressed to the floor.' }, SIDE('2 × 30–45 s/side')],
  },
  new: {
    S1: [{ name: 'Cable crunch', table: 'Cable crunch', sr: '3 × 8–12', rest: '60 s', note: 'RIR 1. Double progression: at the top of the range on every set, the next step up on the stack.' }, PALLOF],
    S2: [HOLLOW('3 × hold', 'RIR 1: stop about 5 s before the lower back would lift. Why: abs are a priority.'), SIDE('3 × 45–60 s/side')],
    S3: [{ name: 'Ab wheel rollout', table: 'Ab wheel rollout', sr: '3 × 6–10', rest: '60 s', note: 'From the knees. RIR 1–2: stop when the lower back starts to sag.' }, SIDE('3 × 45–60 s/side')],
  },
};

const GUIDE: Record<string, { main: string[]; helps: string[] }> = {
  'Dead bug': { main: ['abs'], helps: [] },
  'Tuck hollow hold': { main: ['abs'], helps: ['obliques'] },
  'Hollow hold, arms by sides': { main: ['abs'], helps: ['obliques'] },
  'Hollow hold, arms overhead': { main: ['abs'], helps: ['obliques', 'lats'] },
  'Pallof Press': { main: ['obliques', 'abs'], helps: ['shoulders'] },
  'Reverse crunch': { main: ['abs'], helps: ['obliques'] },
  'Cable crunch': { main: ['abs'], helps: ['obliques'] },
  'Ab wheel rollout': { main: ['abs'], helps: ['obliques', 'lats', 'shoulders'] },
};

/** Rewrites the synthetic vault's files (under `root`) to hold one week of ab work: two lifting days and three short days, abs a priority. */
export function applyAbWork(files: Record<string, string>, which: 'old' | 'new', root = ''): void {
  const at = (rel: string) => `${root ? `${root}/` : ''}3-Personal/Fitness/${rel}`;
  const plan = JSON.parse(files[at('plan-data.json')]!) as Record<string, unknown> & { sessions: Record<string, Item[]>; guide: Record<string, { muscles?: unknown }>; ladders: { id: string; name: string; levels: { name: string }[] }[]; titles: Record<string, string>; shortNames: Record<string, string> };
  plan['weekTarget'] = { lift: 2, short: 3 };
  plan['shortTypes'] = ['S1', 'S2', 'S3'];
  plan.titles = { ...plan.titles, S2: 'Short 2 · Core' };
  plan.shortNames = { ...plan.shortNames, S2: 'Short 2 · Core' };
  plan.sessions = { ...LIFT, ...AB_WORK[which] };
  for (const [name, muscles] of Object.entries(GUIDE)) plan.guide[name] = { ...(plan.guide[name] ?? {}), muscles };
  plan.ladders = [...plan.ladders.filter((l) => l.id !== 'hollow'), { id: 'hollow', name: 'Core (abs)', levels: ['Dead bug', 'Tuck hollow hold', 'Hollow hold, arms by sides', 'Hollow hold, arms overhead'].map((name) => ({ name })) }];
  files[at('plan-data.json')] = JSON.stringify(plan, null, 2);

  const log = JSON.parse(files[at('fitness-log-data.json')]!) as { ladders?: Record<string, { level: number; date: string }[]> };
  log.ladders = { ...(log.ladders ?? {}), hollow: [{ level: 3, date: '2026-03-01' }] };
  files[at('fitness-log-data.json')] = JSON.stringify(log, null, 2);

  const body = JSON.parse(files[at('body-data.json')]!) as { tests?: Record<string, unknown>[] };
  body.tests = [...(body.tests ?? []), { date: '2026-03-08', sidePlankS: 60 }];
  files[at('body-data.json')] = JSON.stringify(body, null, 2);

  const profile = JSON.parse(files[at('Coach/profile.json')]!) as Record<string, unknown>;
  profile['priorityMuscles'] = ['abs'];
  profile['selfCheck'] = { date: '2026-03-01', coreHold: { kind: 'plank', seconds: 60 } };
  files[at('Coach/profile.json')] = JSON.stringify(profile, null, 2);
}
