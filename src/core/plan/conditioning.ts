// Conditioning's numbers (rules.md, concurrent training; the evidence
// library reads them): the 4 x 4 interval session, the weekly active
// minutes, and the daily steps, which rise by phase.

export const CONDITIONING = {
  intervalsMinutes: 30,
  /** The interval session: 4 rounds of 4 minutes hard with 3 minutes easy between; the session's other minutes easy around them. */
  intervals: { rounds: 4, workMin: 4, restMin: 3 },
  steps: { base: 6000, active: 7000, perPhase: 1000, max: 10000 },
  activeMinutes: [150, 300],
} as const;

/** Goal kinds that start the steps higher. */
const ACTIVE_GOALS = new Set(['fat-loss', 'recomposition', 'health', 'conditioning']);

/** The daily steps for a phase (0-based): 7,000 with an active goal (6,000 without), 1,000 more each phase, at most 10,000 (heuristic). */
export function stepsGoal(goalKinds: Iterable<string>, phase: number): number {
  const active = [...goalKinds].some((g) => ACTIVE_GOALS.has(g));
  return Math.min(CONDITIONING.steps.max, (active ? CONDITIONING.steps.active : CONDITIONING.steps.base) + Math.max(0, phase) * CONDITIONING.steps.perPhase);
}
