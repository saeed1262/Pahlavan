// The free/Pro seam. The caller (the plugin, from a licence) passes the
// features it has locked; everything is enabled by default. Which features go
// in Pro is decided later. Safety features can never be locked: they are left
// out of the lockable type, and isEnabled ignores them at run time.

import { explain, type Result } from './reason.ts';

/** Safety rules: never gated, whatever a caller passes. */
export const SAFETY_FEATURES = [
  'safety.red-flags',
  'safety.screening',
  'safety.ledger',
  'safety.load-cap',
  'safety.readiness-flags',
] as const;

/** Coaching rules that a later decision may put in Pro. */
export const COACHING_FEATURES = [
  'units',
  'e1rm',
  'progression',
  'volume',
  'readiness-score',
  'weight',
  'adherence',
  'stall',
  'triage',
  'deload',
  'missed-time',
  'concurrent',
] as const;

export type SafetyFeature = (typeof SAFETY_FEATURES)[number];
export type CoachingFeature = (typeof COACHING_FEATURES)[number];
export type FeatureId = SafetyFeature | CoachingFeature;

/** The features a caller has locked. Only coaching features can appear. */
export interface FeatureSet {
  locked?: readonly CoachingFeature[];
}

/** Features currently planned for Pro: none yet (a later decision). */
export const PRO_FEATURES: readonly CoachingFeature[] = [];

export const ALL_ENABLED: FeatureSet = {};

export function isSafetyFeature(id: string): id is SafetyFeature {
  return (SAFETY_FEATURES as readonly string[]).includes(id);
}

export function isEnabled(features: FeatureSet, id: FeatureId): boolean {
  if (isSafetyFeature(id)) return true;
  return !(features.locked ?? []).includes(id);
}

/** The result itself when the feature is enabled, otherwise a locked result that says why. */
export function gate<T>(features: FeatureSet, id: FeatureId, result: Result<T>): Result<T | null> {
  if (isEnabled(features, id)) return result;
  return explain<T | null>(null, 'features.locked', { feature: id, rule: result.reason.rule }, {
    note: `"${id}" is not enabled in this edition.`,
  });
}
