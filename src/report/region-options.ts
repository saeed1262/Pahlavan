// The catalogue movements a person can do to cover a muscle region: one
// answer for the plan check's region options and the Progress and Plan
// screens' "no option with your equipment". A movement that biases the
// region counts when the profile's equipment allows it (bodyweight always),
// no Ledger constraint active on the date rules it out, the person does not
// dislike it, and no finding acting in full rules it out (a confirmed
// limited overhead reach leaves the overhead presses out for the side
// delts, as it does in the plan). Options come in the one display order
// (catalogue.ts, `rankMovements`); `blocked` says what ruled each other
// biasing movement out.

import type { VaultData } from '../adapters/vault/convert.ts';
import { CATALOGUE, type CatalogueEntry, type Level } from '../core/data/exercises.ts';
import { findingExclusions, normalizeEquipment, toExercise } from '../core/plan/context.ts';
import { screenExercise } from '../core/safety.ts';
import type { Experience, IsoDate } from '../core/schema.ts';
import { rankMovements } from './catalogue.ts';
import { ledgerConstraints } from './review.ts';

/** A training level as the catalogue's levels read it. */
const LEVEL_OF: Readonly<Record<Experience, Level>> = { novice: 'beginner', intermediate: 'intermediate', advanced: 'advanced' };

export interface RegionOptions {
  /** The movements that fit, best first. */
  options: CatalogueEntry[];
  /** Each biasing movement that does not fit, with what ruled it out ("Leg extension (needs machine)"). */
  blocked: string[];
}

/** The region options for a person on a date; a function so a screen judging several regions reads the profile once. */
export function regionOptionsFor(data: VaultData, date: IsoDate): (region: string) => RegionOptions {
  const profile = data.profile;
  const equipment = normalizeEquipment(profile?.equipment ?? []).equipment;
  const dislikes = new Set(profile?.preferences?.dislikes ?? []);
  const constraints = ledgerConstraints(data);
  const findings = profile ? findingExclusions(profile) : new Map<string, string>();
  const level = profile?.experience ? LEVEL_OF[profile.experience] : undefined;
  const memo = new Map<string, RegionOptions>();
  return (region) => {
    const had = memo.get(region);
    if (had) return had;
    const biasing = CATALOGUE.filter((e) => (e.regions ?? []).includes(region) && e.load !== 'cardio' && e.pattern !== 'mobility');
    const screened = Object.fromEntries(biasing.map((e) => [e.id, toExercise(e, 'kg')]));
    const blocked: string[] = [];
    const fits: CatalogueEntry[] = [];
    for (const e of biasing) {
      const missing = e.equipment.filter((q) => q !== 'bodyweight' && !equipment.has(q));
      const ledger = screenExercise(e.id, constraints, date, screened).value;
      if (missing.length) blocked.push(`${e.name} (needs ${missing.join(' and ')})`);
      else if (!ledger.allowed) blocked.push(`${e.name} (ruled out by ${ledger.blockedBy.join(', ')})`);
      else if (dislikes.has(e.id)) blocked.push(`${e.name} (disliked)`);
      else if (findings.has(e.id)) blocked.push(`${e.name} (a finding rules it out)`);
      else fits.push(e);
    }
    const out = { options: rankMovements(fits, { region, ...(level ? { level } : {}) }).map((r) => r.entry), blocked };
    memo.set(region, out);
    return out;
  };
}
