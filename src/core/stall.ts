// Stall detection and the triage ladder (rules.md, "Stalls").
// A stall: an e1RM gain of 2 % or less over the last 3 exposures, with at
// least 80 % adherence over the span. Below 80 % it is an adherence question.

import { E1RM, type E1rmTrend } from './e1rm.ts';
import { explain, joinNotes, type Result, type RuleFrom } from './reason.ts';
import type { ReadinessBand } from './readiness.ts';
import type { RateStatus } from './weight.ts';

export const STALL = {
  gain: E1RM.stallGain,
  noise: E1RM.noise,
  minAdherence: 0.8,
  /** Triage step 1 thresholds. */
  sleepH: 7,
  proteinGPerKg: 1.6,
  /** Triage step 2: only when the scheduled deload is this many weeks away or more. */
  deloadWeeksAway: 2,
  /** Triage step 4: volume moves by this many sets; up only at this many weekly sets or fewer. */
  volumeStep: 2,
  volumeUpMax: 10,
  /** Weekly check-in recovery (1-5) at or under this is poor. */
  poorRecovery: 2,
} as const;

/** `calibration`: a calibration week, when no stall is called (calibration.ts). */
export type StallStatus = 'stalled' | 'progressing' | 'adherence' | 'insufficient-data' | 'needs-adherence' | 'calibration';

export interface Stall {
  stalled: boolean;
  status: StallStatus;
  /** Inside the noise band (plateau) or below it (decline). */
  kind: 'plateau' | 'decline' | null;
  change: number | null;
  adherence: number | null;
}

/** From an e1RM trend (e1rm.ts) and the adherence fraction over its span (adherence.ts). */
export function detectStall(trend: E1rmTrend, adherence: number | null): Result<Stall> {
  const change = trend.change;
  const inputs = { change, adherence, points: trend.points.length, best: trend.best };
  const threshold = { maxGain: STALL.gain, minAdherence: STALL.minAdherence, noise: STALL.noise };
  const out = (stalled: boolean, status: StallStatus, kind: Stall['kind'], note: string) =>
    explain<Stall>({ stalled, status, kind, change, adherence }, 'stall.detect', inputs, { threshold, note });

  if (change === null) return out(false, 'insufficient-data', null, 'Stall checks need 4 sessions with reps + RIR <= 10.');
  const pct = `${(change * 100).toFixed(1)} %`;
  if (change > STALL.gain) return out(false, 'progressing', null, `e1RM ${pct} over 3 sessions: more than 2 %, still progressing.`);
  const kind = change < -STALL.noise ? 'decline' : 'plateau';
  if (adherence === null) return out(false, 'needs-adherence', kind, `e1RM ${pct} over 3 sessions; a stall needs adherence of 80 % or more, which is not known.`);
  if (adherence < STALL.minAdherence) {
    return out(false, 'adherence', kind, `e1RM ${pct} over 3 sessions, but adherence is ${Math.round(adherence * 100)} %: an adherence question, not a stall.`);
  }
  return out(true, 'stalled', kind, `e1RM ${pct} over 3 sessions with ${Math.round(adherence * 100)} % adherence: a stall (${kind === 'decline' ? 'falling beyond the noise band' : 'inside the noise band'}).`);
}

export type TriageStepId = 'check-basics' | 'early-deload' | 'change-range-or-variation' | 'adjust-volume';

export interface TriageStep {
  step: 1 | 2 | 3 | 4;
  id: TriageStepId;
  applies: boolean;
  /** The first step that applies at or after `startAt`: this check-in's one step. */
  chosen: boolean;
  suggestion: string;
}

export interface TriageInput {
  /** Mean sleep over the last 7 days, hours. */
  sleepH?: number | null;
  readinessBand?: ReadinessBand | null;
  /** Protein a day per kg of trend weight. */
  proteinGPerKg?: number | null;
  /** The weight rate against a loss goal's band; "below" means losing faster than the band. */
  rateStatus?: RateStatus | null;
  /** The weekly check-in's recovery, 1-5. */
  recovery?: number | null;
  jointAches?: boolean | null;
  /** Weeks until the scheduled deload (deload.ts). */
  weeksToDeload?: number | null;
  /** Weeks until the next mesocycle boundary. */
  weeksToMesocycleEnd?: number | null;
  /** The stalled lift's main muscle and its weekly sets (volume.ts). */
  muscle?: { name: string; weeklySets: number } | null;
  /** Where last week's letter left off (1-4). */
  startAt?: 1 | 2 | 3 | 4;
  /** The stall rule (the plan's, or the old default's triage), cited by each step. */
  from?: RuleFrom;
}

/**
 * The triage ladder for a stall, in order; one step per check-in, starting
 * where the last letter left off, stopping at the first step that applies.
 */
export function triageLadder(exercise: string, input: TriageInput): Result<TriageStep>[] {
  const startAt = input.startAt ?? 1;
  const band = input.readinessBand ?? null;
  const fatigued =
    band === 'watch' || band === 'low' || (input.recovery != null && input.recovery <= STALL.poorRecovery) || input.jointAches === true;
  const recoveryGood = !fatigued && (band === 'good' || band === 'normal');

  // Step 1: sleep, food and readiness.
  const off: string[] = [];
  if (input.sleepH != null && input.sleepH < STALL.sleepH) off.push(`sleep ${input.sleepH.toFixed(1)} h (under 7)`);
  if (band === 'watch' || band === 'low') off.push(`readiness ${band}`);
  if (input.proteinGPerKg != null && input.proteinGPerKg < STALL.proteinGPerKg) off.push(`protein ${input.proteinGPerKg.toFixed(1)} g/kg (under 1.6)`);
  if (input.rateStatus === 'below') off.push('weight falling faster than the goal band (deficit too large)');
  const unknown = [input.sleepH == null && 'sleep', band === null && 'readiness', input.proteinGPerKg == null && 'protein'].filter(Boolean);

  // Step 2: an early deload, when fatigued and the scheduled one is 2+ weeks away.
  const away = input.weeksToDeload;
  const step2 = fatigued && away != null && away >= STALL.deloadWeeksAway;

  // Step 4: volume down 2 sets when recovery is poor, up 2 when it is good and the muscle is at 10 sets or fewer.
  const m = input.muscle ?? null;
  const down = m !== null && fatigued;
  const up = m !== null && recoveryGood && m.weeklySets <= STALL.volumeUpMax;

  const raw: Omit<TriageStep, 'chosen'>[] = [
    {
      step: 1,
      id: 'check-basics',
      applies: off.length > 0,
      suggestion: off.length ? `Fix ${off.join(', ')} first; no plan change this week.` : 'Sleep, food and readiness look fine.',
    },
    {
      step: 2,
      id: 'early-deload',
      applies: step2,
      suggestion: step2
        ? `Deload this week instead of in ${away} weeks: fatigue signs and a stall together.`
        : fatigued
          ? 'Fatigued, but the scheduled deload is less than 2 weeks away: keep it.'
          : 'No fatigue signs: no early deload.',
    },
    {
      step: 3,
      id: 'change-range-or-variation',
      applies: true,
      suggestion: `Change ${exercise}'s rep range or variation at the next mesocycle boundary${input.weeksToMesocycleEnd != null ? ` (in ${input.weeksToMesocycleEnd} week(s))` : ''}.`,
    },
    {
      step: 4,
      id: 'adjust-volume',
      applies: down || up,
      suggestion: m === null
        ? 'Volume: the muscle and its weekly sets are not known.'
        : down
          ? `Take ${m.name} down ${STALL.volumeStep} sets a week (from ${m.weeklySets}): recovery is poor.`
          : up
            ? `Add ${STALL.volumeStep} sets a week for ${m.name} (from ${m.weeklySets}): recovery is good and it is at 10 or fewer.`
            : `${m.name} is at ${m.weeklySets} sets: no volume change (recovery not poor, and more than 10 sets or recovery not clearly good).`,
    },
  ];
  const chosen = raw.find((s) => s.applies && s.step >= startAt)?.step ?? null;

  return raw.map((s) =>
    explain<TriageStep>({ ...s, chosen: s.step === chosen }, `stall.triage.${s.step}`, {
      exercise,
      startAt,
      ...(s.step === 1 ? { sleepH: input.sleepH ?? null, readinessBand: band, proteinGPerKg: input.proteinGPerKg ?? null, rateStatus: input.rateStatus ?? null } : {}),
      ...(s.step === 2 ? { fatigued, weeksToDeload: away ?? null, recovery: input.recovery ?? null, jointAches: input.jointAches ?? null } : {}),
      ...(s.step === 3 ? { weeksToMesocycleEnd: input.weeksToMesocycleEnd ?? null } : {}),
      ...(s.step === 4 ? { muscle: m, fatigued, recoveryGood } : {}),
    }, {
      threshold:
        s.step === 1
          ? { sleepH: STALL.sleepH, proteinGPerKg: STALL.proteinGPerKg, readiness: 'watch or low' }
          : s.step === 2
            ? { deloadWeeksAway: STALL.deloadWeeksAway, poorRecovery: STALL.poorRecovery }
            : s.step === 4
              ? { step: STALL.volumeStep, upAtOrUnder: STALL.volumeUpMax }
              : undefined,
      note: joinNotes(s.step === 1 && unknown.length > 0 && `Not known: ${unknown.join(', ')}.`, s.step < startAt && `Skipped: last week's letter reached step ${startAt}.`),
      ...(input.from ? { from: input.from } : {}),
    }),
  );
}
