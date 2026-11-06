// Small numeric helpers.

/** Compensated (Neumaier) sum: close to exact, like Python's statistics module. */
export function sum(values: readonly number[]): number {
  let total = 0;
  let carry = 0;
  for (const v of values) {
    const t = total + v;
    carry += Math.abs(total) >= Math.abs(v) ? total - t + v : v - t + total;
    total = t;
  }
  return total + carry;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('mean of no values');
  return sum(values) / values.length;
}

/** Sample standard deviation (n - 1), as Python's statistics.stdev. */
export function stdev(values: readonly number[]): number {
  if (values.length < 2) throw new RangeError('stdev needs at least two values');
  const m = mean(values);
  return Math.sqrt(sum(values.map((v) => (v - m) ** 2)) / (values.length - 1));
}

export function clip(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}
