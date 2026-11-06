// Body numbers on the screens in the profile's units (`units.body`: kg and
// cm, or lb and in). The files keep kg and cm; every screen converts on
// display through these, and the forms convert back on entry. Metric is the
// identity, so a metric vault reads exactly as before.

import { inLength, inWeight, lengthCm, METRIC, weightKg, type BodyUnits } from '../../../src/core/units.ts';

export { METRIC, type BodyUnits };

export interface BodyFmt {
  units: BodyUnits;
  /** The weight unit's label ("kg", "lb") and the length's ("cm", "in"). */
  w: string;
  l: string;
  /** A kg value in the body unit (unrounded), a cm value likewise. */
  wv: (kg: number) => number;
  lv: (cm: number) => number;
  /** A typed value back to kg and cm. */
  kg: (v: number) => number;
  cm: (v: number) => number;
  /** A stored length as shown: as written in cm, to one decimal in inches. */
  len: (cm: number) => number;
  /** A stored weight as shown: as written in kg, to one decimal in lb. */
  wt: (kg: number) => number;
}

const dp1 = (n: number) => Math.round(n * 10) / 10;

export function bodyFmt(units: BodyUnits | null | undefined): BodyFmt {
  const u = units ?? METRIC;
  return {
    units: u,
    w: u.weight,
    l: u.length,
    wv: (kg) => inWeight(kg, u),
    lv: (cm) => inLength(cm, u),
    kg: (v) => weightKg(v, u),
    cm: (v) => lengthCm(v, u),
    len: (cm) => (u.length === 'cm' ? cm : dp1(inLength(cm, u))),
    wt: (kg) => (u.weight === 'kg' ? kg : dp1(inWeight(kg, u))),
  };
}
