// The preview harness: the real PahlavanView, opened in a plain page against
// the synthetic vault (its files are bundled in by tools/build-preview.mjs),
// with the date fixed to 2026-04-10. The look comes from the URL:
//   ?isfahan=1&phase=workday | ?isfahan=0&mode=dark [&hour=11] [&tab=today] [&session=full] [&pick=S3]
//   [&log=new|edit] [&logstate=summary|full|skip|swap]: opens the Log panel (writes go to memory only)
//   [&logdate=YYYY-MM-DD]: then changes the panel's date, as the date field does
//   [&units=lb]: the profile's body units in lb and inches
//   [&help=fresh|welcome]: the help as a new vault has it (the welcome card and the tips), or the welcome card alone
//   [&helpmenu=1|coach|routine]: the ? menu open, or its When to talk to the coach or Your routine panel; [&seen=readiness,why,...]: those tips seen, the next one shows
//   [&yourday=morning,open,rest,done,nofood]: Your day's states on the date, any of them together: the morning
//   check-in not in yet (with [&time=07:00] its card still to come), the session not logged (nor the Workout tick),
//   the day marked rest, every habit and the protein ticked, the protein item paused (the food step quiet); with
//   [&today=2026-04-12] the Sunday step (answer first; [&coach=saved] the command with Copy)
//   [&ticks=110101]: today's ticks on the session's checklist, line by line (the Log panel starts from them)
//   [&sec=training|body|health|skills]: a Progress section (photos are drawn as placeholders)
//   [&rich=1]: adds made-up profile targets, tape days, tests and photo sets to the
//   fixture in memory (the same as mockups/data.js), to show the sections filled in,
//   and the plan's own reasons ("Why: ...") on a few items
//   [&whyopen=<type>:<name>]: on the Plan, that item's Why opened
//   [&today=YYYY-MM-DD]: another date than 2026-04-10 (a Sunday shows the Sunday check-in open)
//   [&settings=1] [&git=0] [&remind=0]: Obsidian's settings window on Pahlavan's tab, over the view
//   (git=0: a vault without git; remind=0: reminders off, the group dimmed)
//   [&coach=saved]: the Sunday check-in on or before &today saved and no letter since, so the coach step is due
//   on that Sunday and still to do after it (Today's Ask the coach card, Check-in's Next: ask the coach)
//   [&card=morning|tape|habits|evening|water|stand|sitting|desk|photos|tests|train|coach] [&menu=1]: a
//   reminder card over the view, opened by the real reminder machinery on the fixture (with the
//   &rich=1 data) at that card's moment, with the macOS notification drawn beside it; menu=1 opens
//   its Snooze menu (writes stay in memory)
//   The screens get the same machinery as the plugin (Due today, the Habits section, the Body record card),
//   at 12:15 on the date (the mockups' moment; [&time=HH:MM] for another), with a few 30-second steps of
//   made-up keyboard activity first, so the stand-up and sitting counts run:
//   [&sec=habits] [&habits=empty] (nothing tracked, the coach's made-up suggestions, the bring-over)
//   [&standdesk=1] (minutes stood at the desk on three days, for the stand-ups chart's split)
//   [&edit=water|sitting|desk|creatine|stand]: the Habits form on that item
//   [&brsched=1] [&sched=fixed]: Check-in's Body record with its schedule open, every N days
//   [&desk=none]: a plan without desk breaks; [&activity=0]: a computer that can't read activity
//   [&baseline=YYYY-MM-DD]: a made-up newer baseline note, as after a fresh start (the cycle starts there)
//   [&range=all]: every Progress view switched to All
//   [&nolog=1]: the log's sessions archived (with &baseline=..., a fresh start before its first session)
//   [&named=1]: the plan's phases named Foundation, Build and Peak (with &rich=1 or a card)
//   [&skill=missing|old|ok] [&node=0]: the coach skill as the welcome card finds it
//   [&vault=empty|profile]: a fresh vault (nothing yet), or one after the intake (no plan yet), in Fitness/
//   [&hand=tape|photos|tests]: that card opened by hand (as the Body record's buttons do), not due with &rich=1
//   [&food=early|later|empty]: the Food tab's states as the mockup draws them (test/fixtures/food: a fresh cycle
//   from Mon 2 Nov 2026, its first day or four weeks on, or no eating plan), on the state's date; with
//   [&tab=food] [&tick=1] (today's protein ticked through the reminders) [&why=<key>] (that Why pinned open);
//   the plan with the day, the meal ideas, the reasons, the light checks and the tips by default, [&plan=plain]
//   the schema 1 plan without them; [&checks=1] a few of today's light checks tapped
//   [&glance=folded]: At a glance past each tab's first three visits (folded to its line)
//   [&open=<ids>]: those sections of the tab opened, as the user would (Progress's "<view>.<section>")
//   [&supersets=1]: the plan's supersets (A: face pull + band external rotation, B: split squat + side
//   plank) with the coach's notes: rest, an RIR and a progression sentence, a form cue, "Why: ..."
//   [&abs=old|new]: a week of ab work with abs a priority (test/fixtures/ab-work.ts): the old one short of
//   direct sets near failure, the new one at 12 (the Plan's Sets per muscle)

import { fixedOffsetClock, momentAt } from '../../src/core/clock.ts';
import { habitCheckinKey } from '../../src/core/tracking.ts';
import type { SessionMode } from '../../src/core/variant.ts';
import { CardModal } from '../src/card-modal.ts';
import { CheckinWriter, type MkdirAdapter } from '../src/checkin-writer.ts';
import { TrackingWriter } from '../src/tracking-writer.ts';
import { PahlavanData } from '../src/data-source.ts';
import { LogWriter } from '../src/log-writer.ts';
import type { ProgressSection } from '../src/ui/progress-more.ts';
import { Reminders } from '../src/reminders/machine.ts';
import { GitSync } from '../src/reminders/sync.ts';
import { loadPluginData } from '../src/settings.ts';
import { PahlavanSettingTab } from '../src/settings-tab.ts';
import { PahlavanView, type Section } from '../src/view.ts';
import { HelpStore } from '../src/help.ts';
import { h, s as svg } from '../src/ui/dom.ts';
import { findFolders, useFolders } from '../../src/adapters/vault/layout.ts';
import { WorkspaceLeaf } from './obsidian-stub.ts';
import { applyFoodState } from '../../test/fixtures/food/food-state.ts';
import { applySupersets } from '../../test/fixtures/supersets.ts';
import { applyAbWork } from '../../test/fixtures/ab-work.ts';

const params = new URLSearchParams(location.search);
const isfahan = params.get('isfahan') !== '0';
const phase = params.get('phase') ?? 'workday';
const dark = isfahan ? phase === 'evening' || phase === 'night' : params.get('mode') === 'dark';
activeDocument.body.classList.add(dark ? 'theme-dark' : 'theme-light');
if (isfahan) activeDocument.body.classList.add('isfahan', `isfahan-${phase}`);

const fixture = (window as unknown as { PAHLAVAN_FIXTURE: Record<string, string> }).PAHLAVAN_FIXTURE;
// [&vault=empty]: a vault Pahlavan was just installed in (no fitness files at all), as a new user first sees it;
// [&vault=profile]: the same after the coach's intake (the Athlete profile and its twins, no plan yet).
const VAULT_MODE = params.get('vault');
const files: Record<string, string> = VAULT_MODE === 'empty'
  ? {}
  : VAULT_MODE === 'profile'
    ? Object.fromEntries(Object.entries(fixture).filter(([k]) => /Coach\/(profile|ledger)\.json$/.test(k)).map(([k, v]) => [k.replace('3-Personal/Fitness/', 'Fitness/'), v]))
    : fixture;
// The folders as the plugin's first load finds them (the synthetic vault has no folders setting).
useFolders(findFolders((dir) => {
  const under = Object.keys(files).filter((f) => dir === '' || f.startsWith(`${dir}/`)).map((f) => (dir === '' ? f : f.slice(dir.length + 1)));
  if (!under.length) return null;
  return { files: [...new Set(under.filter((u) => !u.includes('/')))], folders: [...new Set(under.filter((u) => u.includes('/')).map((u) => u.split('/')[0]!))] };
}));
const CARD = params.get('card');
if (params.get('rich') === '1' || CARD) {
  // MADE UP, preview only: what a fuller cycle would hold.
  const fit = '3-Personal/Fitness';
  const prof = JSON.parse(files[`${fit}/Coach/profile.json`]!);
  prof.targets = { waistDropCm: [4, 6], weightDropKg: [3, 5], rhrDropBpm: [3, 6], tests: { pushups: 25, pullups: 5, hollowS: 45, handstandS: 45, sidePlankS: 60 } };
  files[`${fit}/Coach/profile.json`] = JSON.stringify(prof);
  const body = JSON.parse(files[`${fit}/body-data.json`]!);
  body.tape.push({ date: '2026-03-10', waist: 95.2, hips: 97.6, chest: 101, arm: 33 }, { date: '2026-04-07', waist: 93.6, hips: 96.4, chest: 101.5, arm: 33.5 });
  body.tests.push({ date: '2026-03-21', pushups: 15, pullups: 0, hollowS: 31, handstandS: 18, sidePlankS: 40 }, { date: '2026-04-04', pushups: 17, pullups: 1, hollowS: 36, handstandS: 24, sidePlankS: 52 });
  body.photos.push({ date: '2026-03-10', poses: ['front', 'side', 'back'] }, { date: '2026-03-24', poses: ['front', 'side', 'back', 'posture-closeup'] }, { date: '2026-04-07', poses: ['front', 'back', 'posture-closeup'] });
  files[`${fit}/body-data.json`] = JSON.stringify(body);
  // The push-up ladder one level behind its latest test, so Skills shows "Move to level".
  const log = JSON.parse(files[`${fit}/fitness-log-data.json`]!);
  log.ladders.pushup = log.ladders.pushup.slice(0, 1);
  files[`${fit}/fitness-log-data.json`] = JSON.stringify(log, null, 2);
  const samples = (window as unknown as { PAHLAVAN_SAMPLES: Record<string, string> }).PAHLAVAN_SAMPLES;
  files[`${fit}/Coach/Decisions.md`] = samples.decisions!;
  files[`${fit}/Coach/Letters/2026-04-05.md`] = samples.letter!;
  // The plan's notes, as empty made-up stand-ins, so the Plan's links show.
  for (const n of ['6-Month Roadmap', 'Month 2 Plan', 'Exercise Guide', 'Weekly Tracker', 'Session History']) files[`${fit}/${n}.md`] = `# ${n} (made up for the preview)\n`;
  // A busy week, as a check-in would have recorded it.
  files[`${fit}/Coach/checkins.json`] = JSON.stringify({ schemaVersion: 1, checkins: [{ date: '2026-04-05', weekStart: '2026-03-30', knownBusy: [{ from: '2026-05-04', to: '2026-05-10', kind: 'travel', note: 'Work trip, hotel gym' }] }] });
  // The plan's desk routine (the mockup's five steps, with a how-to each in the plan's guide).
  const plan = JSON.parse(files[`${fit}/plan-data.json`]!);
  const steps: [string, string, string][] = [
    ['Chin tuck', '×10, hold 2 s', 'Slide the head straight back, eyes level.'],
    ['Doorway chest stretch', '2 × 30 s', 'Forearms on the frame, step through.'],
    ['Band pull-apart', '×20', 'Or wall slides ×10 without a band.'],
    ['Thoracic extension', '5 slow breaths', 'Over the chair back, hands behind the head.'],
    ['Walk', '1 min', 'Stand up and walk: water, stairs, a window.'],
  ];
  // Two months of made-up ticks and amounts before the fixture's own week, so the Habits grid reads as a
  // habit with a history (a fixed pseudo-random pattern per item, as the mockup's).
  const TR = `${fit}/Coach/tracking.json`;
  const trk = JSON.parse(files[TR]!);
  const rate: Record<string, number> = { creatine: 0.92, multivitamin: 0.8, shake: 0.86, magnesium: 0.76, protein: 0.7, flossing: 0.66, water: 0.68, 'stand-ups': 0.58, 'desk-breaks': 0.62 };
  const hash = (str: string) => {
    let x = 2166136261;
    for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619);
    return ((x >>> 0) % 1000) / 1000;
  };
  for (let t = Date.UTC(2026, 2, 2); t < Date.UTC(2026, 3, 6); t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10);
    const dow = new Date(t).getUTCDay();
    const day: Record<string, Record<string, unknown>> = {};
    for (const [id, r] of Object.entries(rate)) {
      const it = trk.items.find((x: { id: string }) => x.id === id);
      if (!it || (it.schedule.kind === 'weekdays' && (dow === 0 || dow === 6)) || (id === 'fish-oil')) continue;
      const met = hash(id + d) < r;
      const f = met ? 1 + 0.2 * hash(d + id) : 0.3 + 0.6 * hash(d + id);
      if (it.kind === 'supplement' || it.kind === 'tick') { if (met) day[id] = { done: true }; }
      else if (it.kind === 'amount') day[id] = { amount: Math.round((2500 * f) / 250) * 250 };
      else if (it.kind === 'standup') day[id] = { minutes: Math.round((120 * f) / 20) * 20, count: Math.round((6 * f)) };
      else if (it.kind === 'desk') day[id] = { count: Math.min(4, Math.round(4 * f)) };
    }
    if (Object.keys(day).length) trk.days[d] = day;
  }
  files[TR] = JSON.stringify(trk);
  // The plan's own reasons ("Why: ..." at the end of each note), as the coach writes them.
  const whys: Record<string, Record<string, string>> = {
    A: { 'Goblet Squat': 'the knee tolerates it while the back squat waits.', 'Flat DB Bench Press': 'the main horizontal press; dumbbells let each side work alone.', 'Face Pull': 'rear delts and upper back for the posture emphasis.' },
    B: { 'Romanian Deadlift': 'the main hinge, for the hamstrings and the back.', 'Seated Cable Row': 'upper back is a priority (shoulders rolled forward in the photos).', 'Zone 2 finisher': 'easy minutes toward the cardio goal without a separate session.' },
  };
  for (const [type, items] of Object.entries(whys)) for (const it of plan.sessions[type] ?? []) if (items[it.name]) it.note = `${it.note ? `${it.note} ` : ''}Why: ${items[it.name]}`;
  plan.deskRoutine = steps.map(([name, dose]) => ({ name, dose }));
  for (const [name, , how] of steps) plan.guide[name] = { ...(plan.guide[name] ?? {}), do: how };
  files[`${fit}/plan-data.json`] = JSON.stringify(plan);
}
{
  // MADE UP, preview only: the variations the screens' renders show.
  const fit = '3-Personal/Fitness';
  const TRK = `${fit}/Coach/tracking.json`;
  if (params.get('desk') === 'none') {
    const plan = JSON.parse(files[`${fit}/plan-data.json`]!);
    delete plan.deskRoutine;
    files[`${fit}/plan-data.json`] = JSON.stringify(plan);
  }
  if (params.get('standdesk') === '1') {
    // MADE UP, preview only: minutes stood at the desk on three days, for the stand-ups chart's split (8 Apr all at the desk).
    const t = JSON.parse(files[TRK]!);
    for (const [d, m] of [['2026-04-07', 40], ['2026-04-08', 140], ['2026-04-09', 30]] as const) if (t.days[d]?.['stand-ups']) t.days[d]['stand-ups'].deskMinutes = m;
    files[TRK] = JSON.stringify(t);
  }
  if (params.get('habits') === 'empty') {
    // Nothing tracked yet; the coach's suggestions from an intake and a plan (the mockup's list).
    const sg = (id: string, item: Record<string, unknown>, why: string, from: string) => ({ id, on: '2026-04-09', state: 'open', item: { id, start: '2026-04-10', ...item, source: { by: 'coach', why, from } } });
    const wk = { kind: 'weekdays', days: ['mon', 'tue', 'wed', 'thu', 'fri'] };
    files[TRK] = JSON.stringify({ schemaVersion: 1, items: [], days: {}, suggestions: [
      sg('stand-ups', { kind: 'standup', name: 'Stand-ups', schedule: wk, standup: { sitMinutes: 30, standMinutes: 20, snoozeMinutes: 10, targetMinutes: 120, hours: ['09:00', '17:30'], pauseCalls: true, activeOnly: true, activeSeconds: 120, awayMinutes: 30, standAwayMinutes: 5 } }, 'Desk job, 8 h sitting, from your intake', 'intake'),
      sg('desk-breaks', { kind: 'desk', name: 'Desk breaks', schedule: wk, desk: { followPlan: true, every: 90, from: '10:00', to: '15:00', minutes: 5 } }, 'Forward head posture in the photo assessment, from your plan', 'plan'),
      sg('sitting', { kind: 'sitting', name: 'Sitting time', schedule: { kind: 'daily' }, reminder: { atMinutes: 330, stretch: true }, sitting: { limitMinutes: 360, stretchMaxMinutes: 45, awayMinutes: 5 } }, 'Desk job, 8 h a day; from your intake', 'intake'),
      sg('water', { kind: 'amount', name: 'Water', when: 'day', schedule: { kind: 'daily' }, reminder: { every: 120, from: '09:00', to: '21:00' }, amount: { target: 2500, unit: 'mL', quick: [250, 500] } }, 'About 30 mL per kg, from your eating plan', 'eating plan'),
      sg('creatine', { kind: 'supplement', name: 'Creatine', dose: '5 g', when: 'morning', schedule: { kind: 'daily' }, reminder: { at: '09:00' } }, 'Strength goal, from your eating plan', 'eating plan'),
      sg('protein', { kind: 'tick', name: 'Protein', goal: { amount: 134, unit: 'g' }, means: 'At least 134 g of protein', when: 'evening', schedule: { kind: 'daily' }, reminder: { at: '20:00' } }, 'Your protein floor from the eating plan; the Sunday check-in counts these days', 'eating plan'),
    ] });
  }
  if (params.get('nolog') === '1') {
    // MADE UP, preview only: a fresh start with the log archived (no sessions yet).
    const log = JSON.parse(files[`${fit}/fitness-log-data.json`]!);
    log.sessions = [];
    files[`${fit}/fitness-log-data.json`] = JSON.stringify(log, null, 2);
  }
  if (params.get('named') === '1') {
    // MADE UP, preview only: the plan's phases by name (plan-data's optional `phases`).
    const pd = JSON.parse(files[`${fit}/plan-data.json`]!);
    pd.phases = [{ name: 'Foundation' }, { name: 'Build' }, { name: 'Peak' }];
    files[`${fit}/plan-data.json`] = JSON.stringify(pd, null, 2);
  }
  if (params.get('units') === 'lb') {
    // MADE UP, preview only: a profile in lb and inches (the files keep kg and cm).
    const p = `${fit}/Coach/profile.json`;
    const prof = JSON.parse(files[p]!);
    prof.units = { ...prof.units, body: 'lb' };
    files[p] = JSON.stringify(prof);
  }
  // The help's memory (Coach/help.json): by default every tip seen and the welcome card hidden, so the
  // renders show the screens; &help=fresh starts as a new vault does (the welcome card and the tips),
  // &help=welcome shows the welcome card with the tips seen.
  const help = params.get('help');
  const seen = params.get('seen');
  if (seen !== null) {
    // [&seen=readiness,why]: those tips seen, the rest to come; the welcome card hidden.
    files[`${fit}/Coach/help.json`] = JSON.stringify({ schemaVersion: 1, tips: Object.fromEntries(seen.split(',').filter(Boolean).map((t) => [t, '2026-04-01'])), welcomeHidden: '2026-04-01' });
  } else if (help !== 'fresh') {
    const all = { readiness: '2026-04-01', why: '2026-04-01', log: '2026-04-01', due: '2026-04-01', sunday: '2026-04-01', cycle: '2026-04-01' };
    // [&glance=folded]: every tab past its first three visits, so At a glance starts folded to its line
    // (and the Food tab's plan folded); by default a first visit, the panel open.
    const glance = params.get('glance') === 'folded' ? Object.fromEntries(['today', 'progress', 'plan', 'checkin', 'food'].map((t) => [t, { visits: 3 }])) : undefined;
    // [&open=going,sets]: those sections of the open tab opened by the user (Progress's as "<view>.<section>").
    const tab = params.get('tab') ?? (params.get('sec') ? 'progress' : 'today');
    const opened = (params.get('open') ?? '').split(',').filter(Boolean);
    const folds = opened.length ? { [tab]: Object.fromEntries(opened.map((id) => [id, { folded: false, on: '2026-04-01' }])) } : undefined;
    files[`${fit}/Coach/help.json`] = JSON.stringify({ schemaVersion: 1, tips: all, welcomeHidden: help === 'welcome' ? null : '2026-04-01', ...(glance ? { glance } : {}), ...(folds ? { folds } : {}) });
  }
  const ticks = params.get('ticks');
  if (ticks && /^[01]+$/.test(ticks)) {
    // MADE UP, preview only: today's ticks on the session's checklist (with &log=new, the Log panel starts from them).
    const log = JSON.parse(files[`${fit}/fitness-log-data.json`]!);
    log.todayChecklist = { date: params.get('today') ?? '2026-04-10', type: params.get('pick') ?? 'B', express: params.get('session') === 'express', checked: [...ticks].map((c) => c === '1') };
    files[`${fit}/fitness-log-data.json`] = JSON.stringify(log, null, 2);
  }
  const base = params.get('baseline');
  if (base && /^\d{4}-\d{2}-\d{2}$/.test(base)) files[`${fit}/Baseline - ${base}.md`] = `# Baseline · ${base} (made up for the preview)\n`;
  if (params.get('phone') === 'refused') {
    // MADE UP, preview only: two phone entries the import refused (Coach/Inbox/refused.json), for Due today's line and the Data notes.
    files[`${fit}/Coach/Inbox/refused.json`] = JSON.stringify({ v: 1, refused: [
      { file: '2026-04-08T18-00-00-session.json', date: '2026-04-08', kind: 'session', code: 'already', reason: 'Full Body A is logged on Wed 8 Apr already: the log keeps that one (open it in Pahlavan to change it), so delete this entry' },
      { file: '2026-04-10T07-05-00-morning.json', date: '2026-04-10', kind: 'morning', code: 'conflict', reason: 'Energy on Fri 10 Apr is 2 in body-data.json, the phone says 4: nothing was written (change it on the Check-in screen if the phone\'s is right, then delete this entry)' },
    ] });
  }
  if (params.get('sched') === 'fixed') {
    const t = JSON.parse(files[TRK]!);
    t.bodyRecord = { schedule: 'fixed', tapeFrom: '2026-03-24', tapeEvery: 14, testsFrom: '2026-03-21', testsEvery: 28 };
    files[TRK] = JSON.stringify(t);
  }
}
// MADE UP, preview only: the plan's supersets with the coach's notes (test/fixtures/supersets.ts), over &rich=1's reasons.
if (params.get('supersets') === '1') applySupersets(files);
// MADE UP, preview only: a week of ab work with abs a priority (test/fixtures/ab-work.ts).
const abs = params.get('abs');
if (abs === 'old' || abs === 'new') applyAbWork(files, abs);
// MADE UP, preview only: the Food tab's states (test/fixtures/food), on their own date.
if (params.get('coach') === 'saved') {
  // MADE UP, preview only: the Sunday check-in on or before the date saved, and no letter after the last one.
  const day = params.get('today') ?? '2026-04-10';
  const t = Date.parse(`${day}T00:00:00Z`);
  const sunday = new Date(t - (new Date(t).getUTCDay() * 864e5)).toISOString().slice(0, 10);
  const p = '3-Personal/Fitness/Coach/checkins.json';
  const d = JSON.parse(files[p] ?? '{"schemaVersion":1,"checkins":[]}');
  d.checkins = [...d.checkins.filter((c: { date: string }) => c.date !== sunday), { date: sunday, weekStart: new Date(Date.parse(`${sunday}T00:00:00Z`) - 6 * 864e5).toISOString().slice(0, 10) }];
  files[p] = JSON.stringify(d);
}
/** A fixture file's JSON as JSON.parse gives it: the made-up edits below know each file's shape. */
type FixtureJson = ReturnType<typeof JSON.parse>;
const YD = new Set((params.get('yourday') ?? '').split(',').filter(Boolean));
if (YD.size) {
  // MADE UP, preview only: Your day's states on the date (in memory only).
  const fit = '3-Personal/Fitness';
  const day = params.get('today') ?? '2026-04-10';
  const edit = (path: string, fn: (d: FixtureJson) => void) => {
    const d = JSON.parse(files[path]!);
    fn(d);
    files[path] = JSON.stringify(d, null, 2);
  };
  const unlog = () => {
    edit(`${fit}/fitness-log-data.json`, (d) => void (d['sessions'] = d['sessions'].filter((x: { date: string }) => x.date !== day)));
    edit('5-System/Data/habits-data.json', (d) => void delete d['checkins'][habitCheckinKey('workout', day)]);
  };
  if (YD.has('morning')) {
    edit(`${fit}/body-data.json`, (d) => void (d['days'][day] && delete d['days'][day].checkedAt));
    edit(`${fit}/Coach/nudges.json`, (d) => void (d['days'][day] && delete d['days'][day].morning));
  }
  if (YD.has('open')) unlog();
  if (YD.has('rest')) {
    unlog();
    edit(`${fit}/body-data.json`, (d) => void (d['days'][day] = { ...(d['days'][day] ?? {}), mark: 'rest' }));
  }
  if (YD.has('done')) {
    edit(`${fit}/Coach/tracking.json`, (d) => {
      const today: Record<string, unknown> = { ...(d['days'][day] ?? {}) };
      for (const it of d['items']) {
        if (it.kind === 'supplement' || it.kind === 'tick') today[it.id] = { done: true, at: `${day}T08:00:00.000Z` };
        if (it.kind === 'amount') today[it.id] = { amount: it.amount.target, at: `${day}T11:00:00.000Z` };
      }
      d['days'][day] = today;
    });
  }
  // Paused, not removed: the days already logged for it stay valid.
  if (YD.has('nofood')) edit(`${fit}/Coach/tracking.json`, (d) => void (d['items'].find((x: { id: string }) => x.id === 'protein').pauses = [{ from: '2026-03-02' }]));
}
const FOOD = params.get('food');
const foodToday = FOOD === 'early' || FOOD === 'later' || FOOD === 'empty' ? applyFoodState(files, FOOD, '', params.get('plan') === 'plain' ? 'plain' : 'day').today : null;
if (foodToday && params.get('checks') === '1') {
  // The light checks of the last week, as the Food tab keeps them in Coach/help.json: vegetables at both meals on
  // most days (so Sunday’s pattern starts as met), at lunch on one, fruit once a day; today vegetables at lunch.
  const hp = '3-Personal/Fitness/Coach/help.json';
  const h = JSON.parse(files[hp] ?? '{"schemaVersion":1,"tips":{},"welcomeHidden":null}');
  const day = (n: number) => new Date(Date.parse(`${foodToday}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
  const checks = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [day(n), { veg: n === 4 ? [0] : [0, 1], fruit: [0] }]));
  files[hp] = JSON.stringify({ ...h, foodChecks: { ...checks, [foodToday]: { veg: [0], fruit: [0] } } });
}
// The reminder card's moment and the made-up state it needs (in memory only).
const SCENE = CARD ? scenario(CARD) : null;
function scenario(card: string): { date: string; time: string; key: string; stand?: boolean } {
  const fit = '3-Personal/Fitness';
  const edit = (path: string, fn: (d: FixtureJson) => void) => {
    const d = JSON.parse(files[path]!);
    fn(d);
    files[path] = JSON.stringify(d, null, 2);
  };
  const NUD = `${fit}/Coach/nudges.json`;
  const TR = `${fit}/Coach/tracking.json`;
  const BODY = `${fit}/body-data.json`;
  const checked = (date: string) => edit(BODY, (d) => void (d['days'][date] = { ...(d['days'][date] ?? {}), checkedAt: `${date}T07:10:00.000Z` }));
  switch (card) {
    case 'morning':
      edit(BODY, (d) => void delete d['days']['2026-04-10'].checkedAt);
      edit(NUD, (d) => void delete d['days']['2026-04-10'].morning);
      return { date: '2026-04-10', time: '07:35', key: 'morning' };
    case 'tape':
      return { date: '2026-04-12', time: '07:35', key: 'morning' };
    case 'habits':
      edit(NUD, (d) => void delete d['days']['2026-04-10']['slot:09:00']);
      edit(TR, (d) => void delete d['days']['2026-04-10'].creatine);
      return { date: '2026-04-10', time: '09:05', key: 'slot:09:00' };
    case 'evening':
      return { date: '2026-04-10', time: '21:35', key: 'slot:21:30' };
    case 'water':
      return { date: '2026-04-10', time: '13:05', key: 'amount:water' };
    case 'stand':
      return { date: '2026-04-10', time: '12:46', key: 'standup:stand-ups', stand: true };
    case 'sitting': {
      // 5 h 30 by 15:40 in seven stretches, the longest 52 minutes.
      const st = [['07:30', '08:22'], ['08:30', '09:20'], ['09:30', '10:18'], ['10:30', '11:15'], ['11:30', '12:15'], ['13:00', '13:45'], ['14:00', '14:45']];
      edit(`${fit}/Coach/sitting.json`, (d) => void (d['days']['2026-04-10'] = { 'Work Mac': st.map(([a, b]) => ({ start: `2026-04-10T${a}:00.000Z`, end: `2026-04-10T${b}:00.000Z` })) }));
      return { date: '2026-04-10', time: '15:40', key: 'sitting:sitting' };
    }
    case 'desk':
      edit(TR, (d) => void delete d['days']['2026-04-10']['desk-breaks']);
      edit(NUD, (d) => void delete d['days']['2026-04-10']['desk:desk-breaks']);
      return { date: '2026-04-10', time: '10:00', key: 'desk:desk-breaks' };
    case 'photos':
      checked('2026-04-26');
      return { date: '2026-04-26', time: '08:00', key: 'photos' };
    case 'tests':
      checked('2026-04-25');
      return { date: '2026-04-25', time: '08:00', key: 'tests' };
    case 'train':
      edit('5-System/Data/habits-data.json', (d) => void delete d['checkins']['hab-workout-2026-W15-3']);
      edit(NUD, (d) => void delete d['days']['2026-04-09']);
      return { date: '2026-04-09', time: '20:05', key: 'train' };
    case 'coach':
      // Sun 26 Apr, plan week 8: the phase review, the answers saved and no letter yet.
      edit(`${fit}/Coach/checkins.json`, (d) => void d['checkins'].push({ date: '2026-04-26', weekStart: '2026-04-20' }));
      return { date: '2026-04-26', time: '18:05', key: 'coach' };
    default:
      return { date: '2026-04-10', time: '12:00', key: card };
  }
}
const folders = new Set(Object.keys(files).flatMap((p) => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
const binaries: Record<string, ArrayBuffer> = {};
(window as unknown as { PAHLAVAN_BINARIES: typeof binaries }).PAHLAVAN_BINARIES = binaries;
const adapter: MkdirAdapter & { writeBinary(p: string, d: ArrayBuffer): Promise<void>; remove(p: string): Promise<void> } = {
  async exists(p) {
    return p in files || p in binaries || folders.has(p);
  },
  async read(p) {
    if (!(p in files)) throw new Error(`no file ${p}`);
    return files[p]!;
  },
  async list(p) {
    const inside = [...Object.keys(files), ...Object.keys(binaries)].filter((f) => f.startsWith(`${p}/`) && !f.slice(p.length + 1).includes('/'));
    return { files: inside, folders: [] };
  },
  // Writes stay in this page's memory: the fixture files are never touched.
  async write(p, data) {
    files[p] = data;
  },
  async mkdir(p) {
    folders.add(p);
  },
  // The progress photos a card saves, in memory too.
  async writeBinary(p, data) {
    binaries[p] = data;
  },
  async remove(p) {
    delete files[p];
    delete binaries[p];
  },
};
const TODAY = params.get('today') ?? foodToday ?? '2026-04-10';

// The reminder machinery the view and the cards share: a fixed UTC clock at the card's moment, or 12:15.
const clock = fixedOffsetClock(0);
let now = momentAt(SCENE?.date ?? TODAY, SCENE?.time ?? params.get('time') ?? '12:15', 0).ms;
const pluginData = loadPluginData(null, { gitSynced: true }).data;
pluginData.reminders.quiet.on = false;
const device = new Map<string, string>();
const timers = { setTimeout: (fn: () => void, ms: number) => window.setTimeout(fn, ms), clearTimeout: (id: number) => window.clearTimeout(id) };
const cardStart = {
  menu: params.get('menu') === '1',
  ...(CARD === 'photos' ? { photos: { front: { name: 'IMG_4821.HEIC', file: null, url: null }, side: { name: 'IMG_4822.HEIC', file: null, url: null } } } : {}),
};
const reminders = new Reminders({
  adapter,
  now: () => now,
  moment: (ms) => ({ date: clock.dayOf(ms), minutes: (ms - clock.dayStart(ms)) / 60_000, ms }),
  clock,
  settings: () => pluginData,
  remindHere: () => true,
  mac: () => 'Work Mac',
  device: { get: (k) => device.get(k) ?? null, set: (k, v) => void device.set(k, v) },
  idleSeconds: async () => (params.get('activity') === '0' ? null : 3),
  focused: () => true,
  visible: () => true,
  otherCardOpen: () => false,
  ui: {
    open(cv, actions) {
      banner(cv.notify.title, cv.notify.body);
      const m = new CardModal({} as never, cv, actions, cardStart);
      m.open();
      return m.handle();
    },
  },
  notifyMac: () => {},
  notice: (message) => console.debug(`[notice] ${message}`),
  focusApp: () => {},
  holdFront: () => {},
  chime: () => {},
  convertPhoto: async (p) => ({ data: p.data, ext: 'jpeg' }),
  git: new GitSync({ git: () => null, settings: () => pluginData.sync, now: () => now, ...timers }),
  checkin: new CheckinWriter(adapter),
  openLog: () => console.debug('[open] the log'),
  openSection: (sec) => view.showSection(sec),
  copy: async (text) => {
    (window as unknown as { PAHLAVAN_COPIED?: string }).PAHLAVAN_COPIED = text;
  },
  ...timers,
});
(window as unknown as { PAHLAVAN_REMINDERS?: Reminders }).PAHLAVAN_REMINDERS = reminders;

// [&skill=missing|old|ok] [&node=0]: the coach skill as the welcome card's first step finds it (made up; Set up only says so).
const SKILL = params.get('skill');
// The fixture vault's config folder, as its files have it (the dot-folder holding plugins/).
const CONFIG_DIR = Object.keys(fixture).find((k) => /^\.[^/]+\/plugins\//.test(k))?.split('/')[0] ?? '';
let skillNow = SKILL;
const view = new PahlavanView(new WorkspaceLeaf() as never, {
  data: new PahlavanData(adapter, '', { configDir: CONFIG_DIR }),
  ...(SKILL ? {
    coach: {
      state: async () => ({ installed: skillNow === 'missing' ? null : skillNow === 'old' ? '0.19.0' : '0.20.1', bundled: '0.20.1', missing: [], differ: skillNow === 'old' ? ['scripts/engine.cjs'] : [], node: params.get('node') === '0' ? null : { path: '/opt/homebrew/bin/node', version: 'v22.11.0' } }),
      setUp: async () => {
        skillNow = 'ok';
        return { ok: true as const, written: ['SKILL.md', 'scripts/engine.cjs'] };
      },
    },
  } : {}),
  settings: { lastTab: (params.get('tab') as Section) ?? (params.get('sec') ? 'progress' : 'today'), mode: (params.get('session') as SessionMode) ?? 'full', pick: params.get('pick') ? { date: TODAY, type: params.get('pick')! } : null, progressSection: (params.get('sec') as ProgressSection | null) ?? 'overview', ...(params.get('range') === 'all' ? { progressScopes: { overview: 'all', training: 'all', body: 'all', health: 'all', skills: 'all' } } : {}) },
  saveSettings: () => {},
  today: () => TODAY,
  hour: () => Number(params.get('hour') ?? 11),
  bodyClasses: () => activeDocument.body.classList,
  writer: new LogWriter(adapter),
  checkinWriter: new CheckinWriter(adapter),
  nowIso: () => `${TODAY}T07:30:00.000Z`,
  copy: async (text) => {
    (window as unknown as { PAHLAVAN_COPIED?: string }).PAHLAVAN_COPIED = text;
  },
  openNote: (path) => console.debug(`[open] ${path}`),
  reminders,
  trackingWriter: new TrackingWriter(adapter),
  offsetMinutes: () => 0,
  openSettings: () => openSettings(),
  clockText: (ms) => new Date(ms).toISOString().slice(11, 16),
  notify: (message) => {
    console.debug(`[notice] ${message}`);
    const n = activeDocument.createElement('div');
    n.className = 'preview-notice';
    n.textContent = message;
    activeDocument.body.append(n);
    window.setTimeout(() => n.remove(), 6000);
  },
  requestReload: () => void view.reload(),
  help: new HelpStore(adapter),
  openGuide: () => console.debug('[open] the user guide'),
});
activeDocument.querySelector('.preview-leaf')!.append(view.containerEl);
// open() is View's internal start method (not in obsidian.d.ts); the stub mirrors it.
const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const click = (sel: string) => activeDocument.querySelector<HTMLElement>(sel)?.click();
void warmUp().then(() => (view as unknown as { open(): Promise<void> }).open()).then(async () => {
  const edit = params.get('edit');
  if (edit) {
    await wait(30);
    click(`[data-k="edit-${{ desk: 'desk-breaks', stand: 'stand-ups' }[edit] ?? edit}"]`);
    await wait(400);
    // The renders show the whole page from the top, as the mockups' do.
    view.contentEl.scrollTop = 0;
  }
  if (params.get('brsched') === '1') {
    await wait(30);
    click('[data-k="br-sched"]');
  }
  const log = params.get('log');
  if (log) {
    await wait(50);
    if (log === 'edit') click('.pv-day.is-editable[data-tip^="Wed 8 Apr"]');
    else click('.pv-btn-go');
    await wait(80);
    const st = params.get('logstate');
    const row = (n: number) => activeDocument.querySelectorAll('.pv-lg-item')[n] as HTMLElement | undefined;
    if (st === 'full') click('.pv-lg-track .pv-lg-seg button:last-child');
    if (st === 'skip') (row(4)?.querySelector('.pv-lg-seg button:last-child') as HTMLElement | null)?.click();
    if (st === 'swap') (row(3)?.querySelector('.pv-lg-item-foot .pv-lg-link') as HTMLElement | null)?.click();
    const logDate = params.get('logdate');
    if (logDate) {
      const input = activeDocument.querySelector<HTMLInputElement>('.pv-lg-date');
      if (input) {
        input.value = logDate;
        input.dispatchEvent(new Event('change'));
        await wait(150);
      }
    }
    if (st === 'summary' || log === 'edit') click('.pv-lg-sumbtn');
    await wait(50);
  }
  const menu = params.get('helpmenu');
  if (menu === '1' || menu === 'coach' || menu === 'routine') {
    await wait(30);
    click('[data-k="help"]');
    if (menu === 'coach') click('[data-k="help-coach"]');
    if (menu === 'routine') click('[data-k="help-routine"]');
  }
  if (params.get('settings') === '1') openSettings();
  if (CARD) await openCard(CARD);
  if (params.get('tick') === '1') {
    await wait(30);
    click('[data-k="fd-tick"]');
    await wait(400);
  }
  const WHYOPEN = params.get('whyopen');
  if (WHYOPEN) {
    await wait(30);
    const name = WHYOPEN.slice(WHYOPEN.indexOf(':') + 1);
    const li = [...activeDocument.querySelectorAll('.pv-tpl-list li')].find((x) => x.querySelector('.pv-tpl-ex')?.textContent?.startsWith(name));
    (li?.querySelector('.pv-tag-why') as HTMLElement | null)?.click();
    await wait(30);
  }
  const WHY = params.get('why');
  if (WHY) {
    await wait(30);
    // Hover cannot be shot: one Why opened by a made-up pointer at the element.
    const el = activeDocument.querySelector(`[data-why="${CSS.escape(WHY)}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.bottom }));
    }
  }
  const HAND = params.get('hand');
  if (!CARD && (HAND === 'tape' || HAND === 'photos' || HAND === 'tests')) await reminders.openCard(HAND);
  activeDocument.body.setAttribute('data-ready', '1');
});

/** Obsidian's settings window, with Pahlavan's tab drawn by the real PahlavanSettingTab (saves stay in memory). */
function openSettings(): void {
  const data = loadPluginData(null, { gitSynced: params.get('git') !== '0' }).data;
  if (params.get('remind') === '0') data.reminders.on = false;
  const device = new Map<string, string>();
  const tab = new PahlavanSettingTab({} as never, {} as never, {
    data,
    save: () => console.debug(`[settings] ${JSON.stringify(data)}`),
    remindHere: () => device.get('pahlavan-remind-here') !== 'off',
    setRemindHere: (on) => void device.set('pahlavan-remind-here', on ? 'on' : 'off'),
    gitSynced: params.get('git') !== '0',
    openSection: (s) => console.debug(`[open] ${s}`),
    openGuide: () => console.debug('[open] the user guide'),
    resetTips: () => console.debug('[help] the tips again'),
  });
  const side = (group: string, tabs: string[]) => [h('div', { class: 'preview-st-group' }, group), ...tabs.map((x) => h('div', { class: `preview-st-tab${x === 'Pahlavan' ? ' is-on' : ''}` }, x))];
  const overlay = h('div', { class: 'preview-st-overlay' },
    h('div', { class: 'preview-st-modal' },
      h('aside', { class: 'preview-st-side' },
        side('Options', ['General', 'Editor', 'Files and links', 'Appearance', 'Hotkeys', 'Core plugins', 'Community plugins']),
        side('Community plugins', ['Calendar', 'Dataview', 'Habit Nudges', 'Isfahan', 'Pahlavan', 'Spaced Repetition'])),
      h('div', { class: 'preview-st-main' }, tab.containerEl),
      h('div', { class: 'preview-st-x' }, '×')));
  activeDocument.body.append(overlay);
  tab.display();
}

/**
 * A reminder card, opened by the real machinery on the in-memory files at
 * the scene's moment (a fixed UTC clock), through the real CardModal; the
 * macOS notification it would send is drawn where macOS shows it.
 */
async function openCard(card: string): Promise<void> {
  const scene = SCENE!;
  const r = reminders;
  if (scene.stand) {
    await r.dueToday();
    r.standAskNow();
    now += 30_000;
    await r.fastTick();
  } else await r.openKey(scene.key);
}

/**
 * The screens: a few 30-second steps of made-up keyboard activity before
 * 12:15 (from 12:03), so the stand-up count and today's sitting run as on a
 * working Mac. Cards open at their own moment without it.
 */
async function warmUp(): Promise<void> {
  if (CARD) return;
  const target = now;
  now = target - 12 * 60_000;
  await reminders.dueToday({ reread: true });
  while (now < target) {
    await reminders.fastTick();
    now += 30_000;
  }
  await reminders.fastTick();
}

function banner(title: string, body: string): void {
  activeDocument.querySelector('.preview-banner')?.remove();
  const b = h('div', { class: 'preview-banner', role: 'status' },
    h('div', {}, h('span', { class: 'pb-icon' }, svg('svg', { viewBox: '0 0 24 24' },
      svg('path', { d: 'M12 2.5l6.5 4.2-1.3 9.6L12 21.5l-5.2-5.2-1.3-9.6z', fill: '#fff', opacity: '.92' }),
      svg('path', { d: 'M12 2.5v19M6.8 16.3L12 11l5.2 5.3', stroke: '#7a5ae8', 'stroke-width': '1.1', fill: 'none' })))),
    h('div', {},
      h('div', { class: 'pb-head' }, h('b', {}, 'Obsidian'), h('span', {}, 'now')),
      h('div', { class: 'pb-title' }, title),
      h('div', { class: 'pb-sub' }, 'Pahlavan'),
      h('div', { class: 'pb-body' }, body)));
  activeDocument.body.append(b);
}
