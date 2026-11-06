// The welcome card's checklist on Today: the five steps of a first cycle,
// each ticked from the files (never from a click): the intake wrote
// Coach/profile.json, the plan wrote plan-data.json, and this cycle holds a
// morning check-in, a logged session and a Sunday check-in. The card goes
// once all five are done. Pure: the date is an input.

import type { VaultRead } from '../adapters/vault/read.ts';
import { COACH_COMMANDS } from '../core/coach-steps.ts';
import { isMorningDone } from '../core/morning.ts';
import { explain, type Result } from '../core/reason.ts';
import type { IsoDate } from '../core/schema.ts';
import { scopeInfo } from './cycle.ts';

export type WelcomeStepId = 'intake' | 'plan' | 'morning' | 'session' | 'sunday';

export interface WelcomeStep {
  id: WelcomeStepId;
  title: string;
  /** How to do it, in a few words. */
  how: string;
  /** The coach's command it needs (shown with Copy), when it's done in Claude Code. */
  command?: string;
  done: boolean;
}

export interface Welcome {
  steps: WelcomeStep[];
  done: number;
  /** All five done: the card is not drawn. */
  complete: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function welcomeSteps(read: VaultRead, date: IsoDate): Result<Welcome> {
  const { data } = read;
  const since = scopeInfo(data, date).since;
  const inCycle = (d: string) => d <= date && (!since || d >= since);
  const days = isObj(read.raw?.body) && isObj((read.raw!.body as Obj)['days']) ? ((read.raw!.body as Obj)['days'] as Obj) : {};
  // The one rule for a morning check-in (core/morning.ts): the intake's first entries (weight, the tape) and Health's numbers are not one.
  const morning = Object.entries(days).some(([d, v]) => inCycle(d) && isMorningDone(v));
  const steps: WelcomeStep[] = [
    { id: 'intake', title: 'Run the intake', how: 'In Claude Code, started in this vault: a few questions and your photos', command: COACH_COMMANDS.intake, done: data.coach.profile !== 'missing' },
    { id: 'plan', title: 'Get your plan', how: 'In Claude Code, after the intake', command: COACH_COMMANDS.plan, done: read.files.plan !== 'missing' },
    { id: 'morning', title: 'Answer your first morning check-in', how: 'Its card comes at your morning time, or open Check-in', done: morning },
    { id: 'session', title: 'Log your first session', how: 'Log session on Today, after training', done: data.sessions.some((s) => inCycle(s.date)) },
    { id: 'sunday', title: 'Do your first Sunday check-in', how: 'On Sunday in Check-in, then in Claude Code for the letter', command: COACH_COMMANDS.checkin, done: data.checkins.weekly.some((c) => typeof c.date === 'string' && inCycle(c.date)) },
  ];
  const done = steps.filter((s) => s.done).length;
  return explain<Welcome>({ steps, done, complete: done === steps.length }, 'help.welcome', { since, done: steps.filter((s) => s.done).map((s) => s.id) }, {
    title: 'Getting started',
    note: `${done} of ${steps.length} first steps done${since ? ` this cycle, since ${since}` : ''}: each one is read from the files.`,
  });
}
