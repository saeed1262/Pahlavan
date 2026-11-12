// Every rule explains itself: the rule id, the inputs it used, the threshold it
// compared against and a short note. The skill quotes these; it never redoes
// the arithmetic.

export interface Reason {
  rule: string;
  /** A short display title ("Progression", "Load cap", "Injury limit"). */
  title: string;
  inputs: Record<string, unknown>;
  threshold?: unknown;
  note?: string;
  /**
   * The standing rule the result applies: the plan's own (plan-data.json's
   * `rules`, a lift's `progression`) or, where the plan sets none, the old
   * default. `path` is where the rule is written; the note starts with `text`.
   */
  from?: RuleFrom;
}

/** Where a result's rule comes from (rules.ts): the plan, or the old default the plan leaves standing. */
export interface RuleFrom {
  kind: 'plan' | 'legacy-default';
  path: string;
  text: string;
}

/**
 * Display titles by rule id: the longest matching prefix wins. A rule can
 * set its own title when its outcome changes the headline (a capped target
 * is a "Load cap", a flagged e1RM a "Unit check").
 */
export const TITLES: Readonly<Record<string, string>> = {
  progression: 'Progression',
  'progression.ladder': 'Ladder',
  'safety.ledger': 'Injury limit',
  'safety.load-cap': 'Load cap',
  'safety.screening': 'Screening',
  'safety.screening-caps': 'Screening limits',
  'safety.screening-due': 'Re-screening',
  'safety.red-flags': 'Red flags',
  'safety.apply-screening': 'Screening limits',
  'safety.cap-target': 'Screening limits',
  'safety.capped': 'Screening limits',
  safety: 'Safety',
  readiness: 'Readiness',
  'readiness.hrv-flag': 'HRV',
  deload: 'Light week',
  'deload.prescription': 'Light-week sets',
  stall: 'Stall',
  calibration: 'Calibration week',
  'stall.triage': 'Stall triage',
  e1rm: 'e1RM trend',
  'e1rm.epley': 'e1RM',
  missed: 'Back after time off',
  adherence: 'Adherence',
  'weight.trend': 'Weight trend',
  'weight.rate': 'Weight rate',
  'weight.band': 'Weight pace',
  'weight.dashboard': 'Dashboard weight',
  volume: 'Weekly sets',
  'volume.bands': 'Volume band',
  'volume.effort': 'Set effort',
  'volume.pull-push': 'Pull to push',
  concurrent: 'Concurrent training',
  'concurrent.back-to-back': 'Back-to-back days',
  'concurrent.week': 'Your training week',
  'plan.until': 'Temporary change',
  plan: 'Plan',
  units: 'Unit conversion',
  'units.body': 'Body units',
  checkin: 'Check-in',
  'checkin.triage-start': 'Stall triage',
  'checkin.early-deload': 'Early light week',
  'checkin.fatigue': 'Recovery',
  schema: 'Schema',
  features: 'Feature',
  load: 'Training load',
  soreness: 'Soreness',
  variant: 'Session variant',
  'variant.express': 'Express',
  'variant.hotel': 'Hotel swap',
  'plan.calendar': 'Plan calendar',
  'plan.desk-breaks': 'Desk breaks',
  'plan.minimum-week': 'The minimum week',
  'settings.body-record': 'Body record',
  habits: 'Habits',
  'habits.slot': 'Habits',
  'habits.amount': 'Amount',
  'habits.stand-ups': 'Stand-ups',
  'habits.sitting': 'Sitting time',
  'habits.streak': 'Streak',
  'habits.adherence': 'Last 30 days',
  'habits.standing': 'Standing minutes',
  'habits.import': 'Bring over',
  tracking: 'Tracked item',
  'tracking.day-training': 'Training that day',
  'tracking.day-morning': 'Morning check-in',
  'coach.morning-checkin': 'Morning check-in',
  'coach.did-you-train': 'Did you train?',
  'coach.step': 'Ask the coach',
  'coach.now': 'Ask the coach',
  'coach.ask': 'Ask the coach',
  day: 'Your day',
  'day.morning': 'Morning check-in',
  'day.session': 'Session',
  'day.habits': 'Habits',
  'day.food': 'Food',
  routine: 'Your routine',
  nudges: 'Reminders',
  'nudges.quiet': 'Quiet hours',
  'nudges.today': 'Due today',
  protein: 'Protein',
  diet: 'Eating plan',
  'diet.protein': 'Protein a day',
  'diet.meals': 'Planned protein',
  'diet.protein-days': 'Protein days',
  'diet.waist': 'Waist',
  'diet.weight': 'Weight trend',
  'diet.adjust': 'The adjustment rule',
  'diet.pattern': 'The pattern',
  energy: 'Energy',
  'energy.resting': 'Resting energy',
  'energy.maintenance': 'Maintenance',
  'energy.target': 'Goal energy',
  'energy.refused': 'Loss limit',
  'energy.floor': 'Energy floor',
  'energy.protein': 'Protein a meal',
  'energy.fat': 'Fat',
  'energy.fiber': 'Fiber',
  'energy.light': 'Hand portions',
  cycle: 'Cycle',
  'cycle.start': 'Cycle start',
  'cycle.adherence': 'Adherence',
  'cycle.baseline-note': 'Baseline note',
  help: 'Help',
  'help.welcome': 'Getting started',
  log: 'Session log',
  'log.freeze': 'Exercise list',
  time: 'Session length',
  'time.check': 'Time check',
  pain: 'Pain',
  'pain.rule': 'The pain rule',
  'pain.trend': 'Pain by exercise',
  exercises: 'Exercise facts',
  'e1rm.rise': 'Last rise',
  skips: 'Skipped lines',
  'skips.pain': 'Skipped for pain',
  'skips.equipment': 'Skipped for equipment',
  'skips.time': 'Skipped for time',
  'skips.energy': 'Skipped for energy',
  'lifts.hotel': 'Hotel session',
  ladders: 'Ladders',
  'ladders.test': 'Ladder test',
  tests: 'Tests',
  'tests.latest': 'Latest tests',
  letter: 'Coach letter',
};

/** The display title for a rule id: the longest prefix in TITLES (segments split on "."). */
export function titleFor(rule: string): string {
  const parts = rule.split('.');
  for (let n = parts.length; n > 0; n--) {
    const t = TITLES[parts.slice(0, n).join('.')];
    if (t) return t;
  }
  return 'Rule';
}

export interface Result<T> {
  value: T;
  reason: Reason;
}

export function explain<T>(
  value: T,
  rule: string,
  inputs: Record<string, unknown>,
  extra: { threshold?: unknown; note?: string | undefined; title?: string; from?: RuleFrom | undefined } = {},
): Result<T> {
  const reason: Reason = { rule, title: extra.title ?? titleFor(rule), inputs };
  if (extra.threshold !== undefined) reason.threshold = extra.threshold;
  const note = extra.from ? joinNotes(extra.from.text, extra.note) : extra.note;
  if (note) reason.note = note;
  if (extra.from) reason.from = extra.from;
  return { value, reason };
}

/** A reason's own note, without the rule it cites at its start (the note itself when it cites none). */
export function ownNote(reason: Pick<Reason, 'note' | 'from'>): string | undefined {
  const n = reason.note;
  if (!n || !reason.from || !n.startsWith(reason.from.text)) return n;
  return n.slice(reason.from.text.length).trim() || undefined;
}

/** A reason that also cites the rule it applied (its note led by the rule's text); unchanged without one. */
export function cited(reason: Reason, from: RuleFrom | undefined | null): Reason {
  if (!from) return reason;
  const note = joinNotes(from.text, reason.note);
  return { ...reason, ...(note ? { note } : {}), from };
}

/** Joins the non-empty parts of a note into sentences. */
export function joinNotes(...parts: (string | false | null | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => typeof p === 'string' && p.length > 0);
  return kept.length ? kept.join(' ') : undefined;
}
