// Step 5's volume: weekly fractional sets per muscle inside the bands, in every
// week layout of the rotation (an A/B/A week and a B/A/B week both count).
// Bands: priority muscles 10-16, the 10 from direct sets near failure when
// the slots' effort is known (rules.md, "Volume"); the major muscles at least 6 (4 for a
// minimum-dose template) and about 12 at most (4-8 for hybrid endurance); nothing over 20; at most 8
// direct sets for one muscle in one session; pull at least twice push when the
// posture emphasis is on. One set moves at a time, deterministically. A
// priority muscle still short of its direct sets near failure when no set can
// move swaps an accessory or core slot for one that trains it directly; what
// stays short is reported with what blocked it (`shortfalls`). A major muscle
// under its minimum dose that no set can reach swaps a free accessory slot
// for one that trains or helps it, when the catalogue offers one.

import { MAJOR_MUSCLES, MUSCLES } from '../data/muscles.ts';
import { explain, joinNotes, type Result } from '../reason.ts';
import { PULL_PATTERNS, PULL_PUSH, PUSH_PATTERNS } from '../volume.ts';
import { competing, dropSlot, DOSE, minSetsFor, setMinutes, type BuiltSlot, type BuiltTemplate } from './dose.ts';

export const BANDS = { priority: [10, 16], major: 6, majorMinimumDose: 4, soft: 12, hybridSoft: 8, cap: 20, perSessionDirect: 8, pullPush: PULL_PUSH.target } as const;

/** A priority muscle the fit left short of its direct sets near failure, and why no set or swap reached it. */
export interface PriorityShortfall {
  muscle: string;
  /** Direct sets near failure in its weakest week layout, and the minimum. */
  have: number;
  need: number;
  /** What stopped each way of adding them, in words. */
  blocked: string[];
}

/** The fitted sessions, the swaps made for a priority muscle's minimum, and the priority muscles still short. */
export interface VolumeFit {
  templates: BuiltTemplate[];
  /** Each swap made: the session, the movement out and the one in, the muscle it was for, and why (a priority muscle's direct sets near failure, or a major muscle's minimum dose). */
  swaps: { template: string; from: string; to: string; muscle: string; for: 'priority' | 'minimum' }[];
  shortfalls: PriorityShortfall[];
}

export interface VolumeFitInput {
  templates: BuiltTemplate[];
  /** Week layouts: template ids per week. */
  layouts: string[][];
  priority: readonly string[];
  /** The pull-to-push ratio to keep (its target), and whether it's the posture finding's 2 to 1; null without one. */
  pullPush: { target: number; why: 'finding' | 'goal' } | null;
  minimumDose: boolean;
  /** Hybrid endurance: 4-8 sets per muscle (planning.md), a lower floor and soft top. */
  hybrid?: boolean;
  /**
   * Whether a slot's sets are near failure (volume.ts's effort rule; unknown
   * counts). Given, a priority muscle's low side (10, its hard floor too) is
   * held on its direct sets near failure, so helping sets and easy sets
   * cannot fill it; absent, on the fractional total as before.
   */
  hard?: (s: BuiltSlot) => boolean;
  /**
   * With `hard`: the slots that could take the place of accessory slot `s` of
   * `t` and train `muscle` as a main muscle, best first (the generator builds
   * them from the catalogue with the slot's own screening: equipment, level,
   * dislikes, the Ledger, the self-check). Absent, no swaps.
   */
  swaps?: (t: BuiltTemplate, s: BuiltSlot, muscle: string) => BuiltSlot[];
  /**
   * The slots that could take the place of accessory slot `s` of `t` and
   * train or help `muscle`, best first (the same screening as `swaps`), for a
   * major muscle under its minimum dose that no set can reach. Absent, no
   * such swaps.
   */
  cover?: (t: BuiltTemplate, s: BuiltSlot, muscle: string) => BuiltSlot[];
  /** The concurrent-training problems of the planned week these sessions make: a swap may add none. */
  concurrent?: (templates: readonly BuiltTemplate[]) => string[];
}

export function slotMuscles(s: BuiltSlot): [string, number][] {
  if (s.entry.load === 'cardio') return [];
  return [...s.entry.muscles.main.map((m): [string, number] => [m, 1]), ...s.entry.muscles.helps.map((m): [string, number] => [m, 0.5])];
}

export function layoutVolume(templates: readonly BuiltTemplate[], layout: readonly string[]): Record<string, number> {
  const v: Record<string, number> = {};
  for (const id of layout) {
    const t = templates.find((x) => x.blueprint.id === id);
    for (const s of t?.slots ?? []) for (const [m, w] of slotMuscles(s)) v[m] = (v[m] ?? 0) + w * s.sets;
  }
  return v;
}

/** Direct sets near failure per muscle in one week layout: each slot `hard` says is, once for each of its main muscles. */
export function hardDirectVolume(templates: readonly BuiltTemplate[], layout: readonly string[], hard: (s: BuiltSlot) => boolean): Record<string, number> {
  const v: Record<string, number> = {};
  for (const id of layout) {
    for (const s of templates.find((x) => x.blueprint.id === id)?.slots ?? []) {
      if (s.entry.load === 'cardio' || !hard(s)) continue;
      for (const m of s.entry.muscles.main) v[m] = (v[m] ?? 0) + s.sets;
    }
  }
  return v;
}

export function pullPush(templates: readonly BuiltTemplate[], layout: readonly string[]): { pull: number; push: number } {
  let pull = 0;
  let push = 0;
  for (const id of layout) {
    for (const s of templates.find((x) => x.blueprint.id === id)?.slots ?? []) {
      if (PULL_PATTERNS.includes(s.entry.pattern)) pull += s.sets;
      if (PUSH_PATTERNS.includes(s.entry.pattern)) push += s.sets;
    }
  }
  return { pull, push };
}

export function fitVolume(input: VolumeFitInput): Result<VolumeFit> {
  const templates = input.templates.map((t) => ({ ...t, slots: t.slots.map((s) => ({ ...s })) }));
  const priority = new Set(input.priority);
  const low = (m: string) => (priority.has(m) ? BANDS.priority[0] : MAJOR_MUSCLES.includes(m) ? (input.minimumDose || input.hybrid ? BANDS.majorMinimumDose : BANDS.major) : 0);
  const soft = input.hybrid ? BANDS.hybridSoft : BANDS.soft;
  /** The hard floor: the minimum dose for major muscles, the priority tier for priority ones. */
  const floor = (m: string) => (priority.has(m) ? BANDS.priority[0] : MAJOR_MUSCLES.includes(m) ? BANDS.majorMinimumDose : 0);
  // With the posture finding's 2 to 1 the pulling muscles may run up to the cap, so pull can stay at twice push,
  // priority muscles or not (16 would hold pull under it); a posture goal alone needs no more than the priority band.
  const postureMuscle = (m: string) => input.pullPush?.why === 'finding' && (m === 'upper-back' || m === 'lats');
  const high = (m: string) => (postureMuscle(m) ? BANDS.cap : priority.has(m) ? BANDS.priority[1] : soft);
  const muscles = [...new Set([...MAJOR_MUSCLES, ...priority, ...templates.flatMap((t) => t.slots.flatMap((s) => slotMuscles(s).map(([m]) => m)))])].sort();
  const vols = () => input.layouts.map((l) => layoutVolume(templates, l));
  const minVol = (m: string, vs: Record<string, number>[]) => Math.min(...vs.map((v) => v[m] ?? 0));
  /** Held on direct sets near failure: a priority muscle's low side, when the slots' effort is known. */
  const byHard = (m: string) => input.hard !== undefined && priority.has(m);
  const hardVols = () => (input.hard ? input.layouts.map((l) => hardDirectVolume(templates, l, input.hard!)) : []);
  /** The volume a muscle's low side is held on, in its weakest layout. */
  const lowVol = (m: string, vs: Record<string, number>[], hs: Record<string, number>[]) => minVol(m, byHard(m) ? hs : vs);
  const maxVol = (m: string, vs: Record<string, number>[]) => Math.max(...vs.map((v) => v[m] ?? 0));
  /** The session's set minutes with the given set changes applied (supersets counted by round). */
  const usedWith = (t: BuiltTemplate, ...changes: [BuiltSlot, number][]) => {
    for (const [s, d] of changes) s.sets += d;
    const m = setMinutes(t);
    for (const [s, d] of changes) s.sets -= d;
    return m;
  };
  const direct = (t: BuiltTemplate, m: string) => t.slots.reduce((a, s) => a + (s.entry.muscles.main.includes(m) ? s.sets : 0), 0);
  const aim = input.pullPush;
  const ratioOk = () => !aim || input.layouts.every((l) => {
    const r = pullPush(templates, l);
    return r.push === 0 || r.pull >= aim.target * r.push;
  });
  const slotsOf = () => templates.flatMap((t) => t.slots.map((s) => ({ t, s })));

  const cap = (m: string) => (priority.has(m) && !postureMuscle(m) ? BANDS.priority[1] : BANDS.cap);
  /** Helping sets per muscle in each week layout, at half credit. */
  const helpVols = () =>
    input.layouts.map((l) => {
      const v: Record<string, number> = {};
      for (const id of l) for (const s of templates.find((x) => x.blueprint.id === id)?.slots ?? []) if (s.entry.load !== 'cardio') for (const m of s.entry.muscles.helps) v[m] = (v[m] ?? 0) + 0.5 * s.sets;
      return v;
    });
  /**
   * A muscle's top in one layout: the soft top (`high`) or the hard one (`cap`). A priority muscle
   * held on direct sets near failure tops out at 16, or at its minimum of 10 plus the half credit its
   * helping lifts give it when that is more (never past the cap of 20): the minimum counts only direct
   * sets, so the half credit must not put it out of reach.
   */
  const topIn = (m: string, help: Record<string, number>, hard: boolean) =>
    byHard(m) && !postureMuscle(m) ? Math.max(BANDS.priority[1], Math.min(BANDS.cap, BANDS.priority[0] + (help[m] ?? 0))) : hard ? cap(m) : high(m);
  /** How far a muscle is over its top in its worst layout (0 or less: within it). */
  const over = (m: string, vs: Record<string, number>[], hv: Record<string, number>[], hard: boolean) => Math.max(...vs.map((v, i) => (v[m] ?? 0) - topIn(m, hv[i]!, hard)));
  /**
   * One more set on this slot keeps the bands for the muscles it trains (the
   * soft top, or the hard cap when fixing a deficit under the hard floor), the
   * session cap and the ratio. For a priority muscle's minimum (`forMinimum`)
   * the ratio stops only a push set, the one kind of set that can lower it.
   */
  const canAdd = (t: BuiltTemplate, s: BuiltSlot, ignoreTime = false, toFloor = false, forMinimum = false): boolean => {
    if (s.sets >= DOSE.maxSets || s.entry.load === 'cardio') return false;
    if (!ignoreTime && usedWith(t, [s, 1]) > t.capacity + 1e-9) return false;
    if (s.entry.muscles.main.some((m) => direct(t, m) + 1 > BANDS.perSessionDirect)) return false;
    s.sets++;
    const vs = vols();
    const hv = helpVols();
    const ok = slotMuscles(s).every(([m]) => over(m, vs, hv, toFloor) <= 1e-9) && ((forMinimum && !PUSH_PATTERNS.includes(s.entry.pattern)) || ratioOk());
    s.sets--;
    return ok;
  };
  /** Sets in the same session that can go without creating a deficit, to make time for another, best first. */
  const donors = (t: BuiltTemplate, target: BuiltSlot, toFloor: boolean, forMinimum = false): BuiltSlot[] =>
    t.slots
      .filter((d) => d !== target && d.entry.load !== 'cardio' && canRemove(d, false, toFloor, forMinimum) && usedWith(t, [d, -1], [target, 1]) <= t.capacity + 1e-9)
      .sort((a, b) => (a.role === 'accessory' ? 0 : 1) - (b.role === 'accessory' ? 0 : 1) || b.sets - a.sets || b.slotIndex - a.slotIndex);
  /**
   * One set fewer keeps every muscle the slot trains at its soft low (or, `toFloor`, its hard floor) and
   * the ratio (for a priority muscle's minimum, `forMinimum`, only a pull set can lower it).
   */
  const owner = (s: BuiltSlot) => templates.find((t) => t.slots.includes(s))!;
  const canRemove = (s: BuiltSlot, hard: boolean, toFloor = false, forMinimum = false): boolean => {
    if (s.sets <= minSetsFor(owner(s), s)) return false;
    if (hard) return true;
    s.sets--;
    const vs = vols();
    const hs = hardVols();
    const ok = slotMuscles(s).every(([m]) => lowVol(m, vs, hs) >= (toFloor ? floor(m) : low(m)) - 1e-9) && ((forMinimum && !PULL_PATTERNS.includes(s.entry.pattern)) || ratioOk());
    s.sets++;
    return ok;
  };
  /** Pull over push in each layout (no pushing: no limit). */
  const ratios = () => input.layouts.map((l) => {
    const r = pullPush(templates, l);
    return r.push === 0 ? Infinity : r.pull / r.push;
  });
  const order = (a: { t: BuiltTemplate; s: BuiltSlot }, b: { t: BuiltTemplate; s: BuiltSlot }) =>
    (a.s.role === 'accessory' ? 0 : 1) - (b.s.role === 'accessory' ? 0 : 1) || a.s.sets - b.s.sets || templates.indexOf(a.t) - templates.indexOf(b.t) || a.s.slotIndex - b.s.slotIndex;

  // The swap for a priority muscle short of its direct sets near failure, when no set can move: an
  // accessory or core slot that trains no priority muscle near failure and was not set by an emphasis
  // or the self-check, for one that trains the muscle directly near failure. It keeps the session's
  // minutes and its 8-set cap, every other muscle in its band (and none past the cap), pull:push and
  // the concurrent-training checks.
  const swapped: VolumeFit['swaps'] = [];
  /** Per muscle: the free slots a swap looked at and the movements it tried in them. */
  const swapsTried = new Map<string, { slots: number; candidates: number }>();
  let muscleList = muscles;
  const trainsPriorityHard = (s: BuiltSlot) => input.hard !== undefined && input.hard(s) && s.entry.muscles.main.some((x) => priority.has(x));
  const swappable = (s: BuiltSlot) => s.role === 'accessory' && !s.fixed && !s.pinned && s.entry.load !== 'cardio' && !trainsPriorityHard(s);
  const bandsNow = () => {
    const vs = vols();
    const hs = hardVols();
    const hv = helpVols();
    const all = [...new Set([...muscleList, ...templates.flatMap((t) => t.slots.flatMap((s) => slotMuscles(s).map(([x]) => x)))])];
    return new Map(all.map((x) => [x, { lo: lowVol(x, vs, hs), soft: over(x, vs, hv, false), hard: over(x, vs, hv, true) }]));
  };
  /**
   * `priority`: a movement that trains m directly near failure (input.swaps). `minimum`: one that
   * trains or helps m (input.cover), for a major muscle under its minimum dose.
   */
  const swapFor = (m: string, why: 'priority' | 'minimum' = 'priority'): boolean => {
    const vs = vols();
    const hv = helpVols();
    const excess = (s: BuiltSlot) => Math.max(0, ...slotMuscles(s).map(([x]) => over(x, vs, hv, false)));
    const pool = slotsOf()
      .filter(({ s }) => swappable(s))
      .sort((a, b) => excess(b.s) - excess(a.s) || templates.indexOf(b.t) - templates.indexOf(a.t) || b.s.slotIndex - a.s.slotIndex);
    const before = bandsNow();
    const ratioBefore = ratios();
    const concurrentBefore = new Set(input.concurrent?.(templates) ?? []);
    const tried = { slots: 0, candidates: 0 };
    swapsTried.set(m, tried);
    for (const { t, s } of pool) {
      tried.slots++;
      const at = t.slots.indexOf(s);
      const next = t.slots[at + 1];
      const nextPaired = next?.pair === true;
      for (const c of why === 'priority' ? input.swaps!(t, s, m) : input.cover!(t, s, m)) {
        const trains = why === 'priority' ? c.entry.muscles.main.includes(m) : slotMuscles(c).some(([x]) => x === m);
        if (!trains || t.slots.some((x) => x !== s && x.entry.id === c.entry.id)) continue;
        const repl: BuiltSlot = { ...c, role: 'accessory', slotIndex: s.slotIndex, sets: Math.min(DOSE.maxSets, Math.max(DOSE.minSets, s.sets)) };
        delete repl.pair;
        if (why === 'priority' && !input.hard!(repl)) continue;
        tried.candidates++;
        // A superset partner that competes with the new movement is done as straight sets instead.
        if (s.pair === true && !competing(t.slots[at - 1]!.entry, repl.entry)) repl.pair = true;
        t.slots[at] = repl;
        if (nextPaired && competing(next.entry, repl.entry)) delete next.pair;
        const after = bandsNow();
        const kept = [...after].every(([x, a]) => {
          const b = before.get(x) ?? { lo: 0, soft: -Infinity, hard: -Infinity };
          if (a.hard > Math.max(0, b.hard) + 1e-9) return false;
          if (x === m) return a.lo > b.lo + 1e-9;
          // A minimum is the volume check's floor, a soft top only a guide: for it, another muscle may pass its soft top (never the cap).
          return (why === 'minimum' || a.soft <= Math.max(0, b.soft) + 1e-9) && a.lo >= Math.min(b.lo, low(x)) - 1e-9;
        });
        const ratioAfter = ratios();
        const ok =
          kept &&
          setMinutes(t) <= t.capacity + 1e-9 &&
          repl.entry.muscles.main.every((x) => direct(t, x) <= BANDS.perSessionDirect) &&
          (!aim || ratioAfter.every((r, i) => r >= Math.min(ratioBefore[i]!, aim.target) - 1e-9)) &&
          (input.concurrent?.(templates) ?? []).every((p) => concurrentBefore.has(p));
        if (ok) {
          swapped.push({ template: t.blueprint.id, from: s.entry.id, to: repl.entry.id, muscle: m, for: why });
          muscleList = [...after.keys()].sort();
          return true;
        }
        t.slots[at] = s;
        if (nextPaired) next.pair = true;
      }
    }
    return false;
  };

  // Hard: at most 8 direct sets for one muscle in one session. Trim accessory
  // sets, then main sets, then (last resort) drop the latest accessory.
  const dropped: string[] = [];
  for (const t of templates) {
    for (;;) {
      const over = [...new Set(t.slots.flatMap((s) => s.entry.muscles.main))].sort().find((m) => direct(t, m) > BANDS.perSessionDirect);
      if (!over) break;
      const hits = t.slots.filter((s) => s.entry.muscles.main.includes(over));
      const acc = hits.filter((s) => s.role === 'accessory' && s.sets > DOSE.minSets).sort((a, b) => b.sets - a.sets || b.slotIndex - a.slotIndex)[0];
      const main = hits.filter((s) => s.role === 'main' && s.sets > minSetsFor(t, s)).sort((a, b) => b.sets - a.sets || b.slotIndex - a.slotIndex)[0];
      const drop = hits.filter((s) => s.role === 'accessory').sort((a, b) => b.slotIndex - a.slotIndex)[0];
      if (acc) acc.sets--;
      else if (main) main.sets--;
      else if (drop) {
        dropSlot(t.slots, drop);
        dropped.push(`${t.blueprint.id}/${drop.entry.id}`);
      } else break;
    }
  }

  let moves = 0;
  for (let iter = 0; iter < 400; iter++) {
    let moved = false;
    const vs = vols();

    // 1. Excess: over the hard cap first, then over the soft top when it costs no deficit.
    // A priority muscle held on direct sets near failure loses its easy sets first.
    const hv1 = helpVols();
    for (const m of muscleList) {
      const hard = over(m, vs, hv1, true) > 1e-9;
      if (!hard && over(m, vs, hv1, false) <= 1e-9) continue;
      const easyFirst = (x: BuiltSlot) => (byHard(m) && input.hard!(x) ? 1 : 0);
      const pool = slotsOf().filter(({ s }) => s.entry.muscles.main.includes(m) && canRemove(s, hard));
      const c = (pool.length || !hard ? pool : slotsOf().filter(({ s }) => s.entry.muscles.helps.includes(m) && canRemove(s, true)))
        .sort((a, b) => easyFirst(a.s) - easyFirst(b.s) || (a.s.role === 'accessory' ? 0 : 1) - (b.s.role === 'accessory' ? 0 : 1) || b.s.sets - a.s.sets || templates.indexOf(b.t) - templates.indexOf(a.t) || b.s.slotIndex - a.s.slotIndex)[0];
      if (c) {
        c.s.sets--;
        moved = true;
        break;
      }
      if (hard) {
        // Last resort: drop an accessory that trains it directly: an easy one first (above), with the posture
        // emphasis not a pull (pull must stay at twice push), then one that trains only this muscle (a lateral raise), then the latest.
        const keepsRatio = (x: BuiltSlot) => (aim && PULL_PATTERNS.includes(x.entry.pattern) ? 1 : 0);
        const only = (x: BuiltSlot) => (x.entry.muscles.main.length === 1 ? 0 : 1);
        const d = slotsOf().filter(({ s }) => s.role === 'accessory' && s.entry.muscles.main.includes(m)).sort((a, b) => easyFirst(a.s) - easyFirst(b.s) || keepsRatio(a.s) - keepsRatio(b.s) || only(a.s) - only(b.s) || templates.indexOf(b.t) - templates.indexOf(a.t) || b.s.slotIndex - a.s.slotIndex)[0];
        if (d) {
          dropSlot(d.t.slots, d.s);
          dropped.push(`${d.t.blueprint.id}/${d.s.entry.id}`);
          moved = true;
          break;
        }
      }
    }
    if (moved) {
      moves++;
      continue;
    }

    // 2. Deficits, the largest first: a direct slot if there is one, else a helping slot
    // (a priority muscle held on direct sets near failure: only its direct slots near failure).
    const hs = hardVols();
    const short = muscleList.filter((m) => lowVol(m, vs, hs) < low(m) - 1e-9).sort((a, b) => low(b) - lowVol(b, vs, hs) - (low(a) - lowVol(a, vs, hs)) || (a < b ? -1 : 1));
    /** Adds a set to s, taking a donor set in the same session when time is short; true when done. */
    const addWithDonor = (t: BuiltTemplate, s: BuiltSlot, underFloor: boolean, forMinimum = false): boolean => {
      if (canAdd(t, s, false, underFloor, forMinimum)) {
        s.sets++;
        return true;
      }
      if (!canAdd(t, s, true, underFloor, forMinimum)) return false;
      for (const d of donors(t, s, underFloor, forMinimum)) {
        d.sets--;
        if (canAdd(t, s, false, underFloor, forMinimum)) {
          s.sets++;
          return true;
        }
        d.sets++;
      }
      return false;
    };
    for (const m of short) {
      const underFloor = lowVol(m, vs, hs) < floor(m) - 1e-9;
      const direct = slotsOf().filter(({ s }) => s.entry.muscles.main.includes(m) && (!byHard(m) || input.hard!(s))).sort(order);
      const helping = byHard(m) ? [] : slotsOf().filter(({ s }) => !s.entry.muscles.main.includes(m) && s.entry.muscles.helps.includes(m)).sort(order);
      // A priority muscle's minimum (direct sets near failure): only a push set is held back by the ratio.
      const forMinimum = byHard(m);
      if ([...direct, ...helping].some(({ t, s }) => addWithDonor(t, s, underFloor, forMinimum))) {
        moved = true;
        break;
      }
      // Posture: a push set blocked by the 2:1 ratio. First cut a push set that does
      // not train this muscle; failing that, add pull sets first (up to 4, all or nothing).
      if (aim && direct.some(({ s }) => PUSH_PATTERNS.includes(s.entry.pattern))) {
        const pushes = direct.filter(({ s }) => PUSH_PATTERNS.includes(s.entry.pattern));
        const others = slotsOf().filter(({ t, s }) => PUSH_PATTERNS.includes(s.entry.pattern) && !s.entry.muscles.main.includes(m) && s.sets > minSetsFor(t, s));
        for (const o of others) {
          o.s.sets--;
          const vs2 = vols();
          const hs2 = hardVols();
          if (slotMuscles(o.s).every(([x]) => lowVol(x, vs2, hs2) >= floor(x) - 1e-9) && pushes.some(({ t, s }) => addWithDonor(t, s, underFloor, forMinimum))) {
            moved = true;
            break;
          }
          o.s.sets++;
        }
        if (moved) break;
        const added: BuiltSlot[] = [];
        while (added.length < 4) {
          const p = slotsOf().filter(({ t, s }) => PULL_PATTERNS.includes(s.entry.pattern) && canAdd(t, s, false, true)).sort(order)[0];
          if (!p) break;
          p.s.sets++;
          added.push(p.s);
          if (pushes.some(({ t, s }) => addWithDonor(t, s, underFloor, forMinimum))) {
            moved = true;
            break;
          }
        }
        if (moved) break;
        added.forEach((x) => x.sets--);
      }
    }
    if (moved) {
      moves++;
      continue;
    }

    // 3. Posture: pull at least twice push. A pull set may take a muscle past the soft top up to the cap.
    if (!ratioOk()) {
      const add = slotsOf().filter(({ t, s }) => PULL_PATTERNS.includes(s.entry.pattern) && canAdd(t, s, false, true)).sort(order)[0];
      if (add) {
        add.s.sets++;
        moved = true;
      } else {
        const cut = slotsOf()
          .filter(({ t, s }) => PUSH_PATTERNS.includes(s.entry.pattern) && s.sets > minSetsFor(t, s))
          .sort((a, b) => (a.s.role === 'accessory' ? 0 : 1) - (b.s.role === 'accessory' ? 0 : 1) || b.s.sets - a.s.sets || a.s.slotIndex - b.s.slotIndex)[0];
        if (cut) {
          cut.s.sets--;
          moved = true;
        }
      }
    }

    // 4. A priority muscle still short of its direct sets near failure, with no set left to add: a swap
    // (above), the largest shortfall first; the fit then adds sets to the new slot where time allows.
    if (!moved && input.swaps && input.hard) {
      const hs4 = hardVols();
      const shortP = muscleList.filter((m) => byHard(m) && lowVol(m, vs, hs4) < BANDS.priority[0] - 1e-9).sort((a, b) => lowVol(a, vs, hs4) - lowVol(b, vs, hs4) || (a < b ? -1 : 1));
      moved = shortP.some((m) => swapFor(m));
    }

    // 5. A major muscle under its minimum dose (the volume check's floor) with no set left to add: a swap
    // for a movement that trains or helps it (above), the largest shortfall first.
    if (!moved && input.cover) {
      const hs5 = hardVols();
      const shortM = muscleList.filter((m) => MAJOR_MUSCLES.includes(m) && !byHard(m) && lowVol(m, vs, hs5) < BANDS.majorMinimumDose - 1e-9).sort((a, b) => lowVol(a, vs, hs5) - lowVol(b, vs, hs5) || (a < b ? -1 : 1));
      moved = shortM.some((m) => swapFor(m, 'minimum'));
    }
    if (!moved) break;
    moves++;
  }

  const final = vols();
  const finalHard = hardVols();
  const finalHelp = helpVols();
  const misses = muscleList.filter((m) => lowVol(m, final, finalHard) < low(m) - 1e-9 || over(m, final, finalHelp, false) > 1e-9);
  const shortfalls = muscleList.filter((m) => byHard(m) && lowVol(m, final, finalHard) < BANDS.priority[0] - 1e-9).map((m) => shortfall(m, final, finalHard));
  const swapText = swapped.map((x) => `${x.template}/${x.from} -> ${x.to} (${x.muscle})`);
  const swapsFor = (why: 'priority' | 'minimum') => swapped.filter((x) => x.for === why).map((x) => `${x.template}/${x.from} -> ${x.to} (${x.muscle})`);
  return explain<VolumeFit>({ templates, swaps: swapped, shortfalls }, 'plan.volume-fit', { layouts: input.layouts, priority: [...priority], pullPush: aim ? aim.target : null, moves, nearFailure: input.hard !== undefined, ...(swapped.length ? { swaps: swapText } : {}) }, {
    threshold: BANDS,
    note: joinNotes(
      dropped.length > 0 && `Dropped to keep 8 direct sets per muscle per session: ${dropped.join(', ')}.`,
      swapsFor('priority').length > 0 && `Swapped for a priority muscle's direct sets near failure: ${swapsFor('priority').join(', ')}.`,
      swapsFor('minimum').length > 0 && `Swapped for a major muscle's minimum of ${BANDS.majorMinimumDose} sets: ${swapsFor('minimum').join(', ')}.`,
      misses.length > 0 && `Outside the soft bands: ${misses.map((m) => `${m} ${minVol(m, final)}-${maxVol(m, final)}${byHard(m) ? ` (${minVol(m, finalHard)} direct near failure)` : ''}`).join(', ')}.`,
      ...shortfalls.map((f) => `${labelOf(f.muscle)}: ${f.have} direct sets near failure of the ${f.need}; ${f.blocked.join('; ')}.`),
    ),
  });

  /** Why a priority muscle stays short: what stops a set on each of its direct slots near failure, and why no swap reached it. */
  function shortfall(m: string, vs: Record<string, number>[], hs: Record<string, number>[]): PriorityShortfall {
    const blocked = new Set<string>();
    const slots = slotsOf().filter(({ s }) => s.entry.muscles.main.includes(m) && input.hard!(s));
    if (slots.length === 0) blocked.add('no slot trains it directly near failure');
    const hv = helpVols();
    const helping = Math.max(...hv.map((v) => v[m] ?? 0));
    const top = Math.max(...hv.map((v) => topIn(m, v, true)));
    for (const { t, s } of slots) {
      if (s.sets >= DOSE.maxSets) blocked.add(`${s.entry.name} in ${t.blueprint.name} is at ${DOSE.maxSets} sets`);
      else if (s.entry.muscles.main.some((x) => direct(t, x) + 1 > BANDS.perSessionDirect)) blocked.add(`${t.blueprint.name} is at ${BANDS.perSessionDirect} direct sets for one muscle`);
      else if (over(m, vs, hv, true) + 1 > 1e-9) blocked.add(`another direct set would take ${labelOf(m).toLowerCase()} past its top of ${top} sets in all (${helping} of them half credit from the lifts it helps)`);
      else if (usedWith(t, [s, 1]) > t.capacity + 1e-9) blocked.add(`${t.blueprint.name} has no minutes left for another set`);
      else if (!canAdd(t, s, true, true)) blocked.add(aim ? `another set would push another muscle past its cap or pull under ${aim.target} times push` : 'another set would push another muscle past its cap');
    }
    const tried = swapsTried.get(m) ?? { slots: 0, candidates: 0 };
    if (input.swaps) {
      blocked.add(
        tried.slots === 0
          ? 'no accessory or core slot is free to swap (each trains a priority muscle near failure or is set by an emphasis or the self-check)'
          : tried.candidates === 0
            ? 'no movement that trains it directly near failure fits a free slot (equipment, level, dislikes, the Ledger, the self-check)'
            : 'every swap would push another muscle out of its band, or break the minutes, the 8-set session cap, pull:push or the concurrent-training checks',
      );
    }
    return { muscle: m, have: Math.round(lowVol(m, vs, hs) * 100) / 100, need: BANDS.priority[0], blocked: [...blocked] };
  }
}

const labelOf = (m: string) => MUSCLES.find((x) => x.id === m)?.label ?? m;
