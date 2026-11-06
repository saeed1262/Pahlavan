// The Food tab, as signed off in mockups/food-v2.html: the banner (the
// week's protein days on the ring), Your plan in a minute (the goal, the
// approach, the day's size, the protein floor and the meals, and why this
// plan with each reason's source in the intake), A day on your plan (the
// user's day as a timeline: each meal with its hand portions inline, its
// rough protein, today's idea and the others a click away, the lunch
// fallbacks, the lifting day's snack note, the drinks), Today (the protein
// tick and the light checks that pre-fill Sunday's pattern question),
// Coach's tips, and How it's going (this week's protein days, the waist and
// the weight trend with a Table view, the weekly pattern and the next
// adjustment check, in one card); and the empty state. The report is the
// engine's buildFood; a plan without the coach's words, times or ideas
// draws what it holds. Every number carries its Why (the report's `why`, by
// key) in the hover tooltip, the rule id only in data-rule. Each card has
// its section id (`data-sec`), for At a glance and its fold. Standard DOM only.

import { bodyFmt } from './units.ts';
import type { FoodDayRow, FoodReport, Why } from '../../../src/report/food.ts';
import { goingStatus, type Run } from '../../../src/report/glance.ts';
import { banner, phaseLabel, type BannerPhase, type RingSeg } from './banner.ts';
import { h, icon, s, type Child } from './dom.ts';
import { addDays, clean, daysBetween, fmt } from './format.ts';
import { niceTicks, path, scale, statusChip, table } from './progress.ts';
import { whyTip } from './tooltip.ts';

type Food = FoodReport;
type Planned = Extract<Food, { level: object }>;
type Plan = NonNullable<Planned['plan']>;
type Meal = Plan['meals'][number];

export interface FoodContext {
  phase: BannerPhase;
  /** The kicker's week and phase (the Today report's, as the other banners use). */
  planWeek: number | null;
  phaseOf: { index: number; name: string } | null;
  /** The page's width, for the charts. */
  width: number;
  tables: Set<string>;
  onTable(id: string): void;
  /** Ticks or unticks today's protein through the reminders (absent: read only). */
  onTick?: (done: boolean) => void;
  /** A tick on its way. */
  tickBusy: boolean;
  /** Copies the diet command (the empty state). */
  onCopy?: () => void;
  /** Today's light checks as kept (Coach/help.json): the slots tapped, by check id. */
  checks?: Readonly<Record<string, readonly number[]>>;
  /** Taps a light check's slot (absent: read only). */
  onCheck?: (id: string, slot: number) => void;
  /** How many ideas on from today's each meal shows (this session only, never saved). */
  ideaSteps?: Readonly<Record<string, number>>;
  onIdea?: (meal: string) => void;
}

const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const lower = (t: string) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const upper = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const signed = (v: number, dp = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(dp);
const and = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const kcal = (n: number) => n.toLocaleString('en-GB');
/** "07:30" reads "7:30" on the timeline. */
const time = (hhmm: string) => hhmm.replace(/^0(\d)/, '$1');
const gText = (g: readonly [number, number]) => (g[0] === g[1] ? `about ${g[0]} g` : `about ${g[0]} to ${g[1]} g`);
const runs = (xs: readonly Run[]): Child[] => xs.map((r) => (typeof r === 'string' ? r : h('b', {}, r.b)));

/** A number with its Why: the dotted underline, the tooltip, the rule id on the element. */
function whyEl(m: Food, key: string, child: Child, tag: 'b' | 'span' = 'b', cls = ''): HTMLElement {
  const w = (m.why as Record<string, Why>)[key];
  return h(tag, { class: `pv-fd-why${cls ? ` ${cls}` : ''}`, 'data-tip': whyTip(w), 'data-rule': w?.rule, 'data-why': key }, child);
}
/** The Why's attributes for an element that is not a number (a bar segment, a ring mark, a day). */
const whyAttrs = (m: Food, key: string) => {
  const w = (m.why as Record<string, Why>)[key];
  return w ? { 'data-tip': whyTip(w), 'data-rule': w.rule, 'data-why': key } : {};
};
/** The icon the plan names, or a plain one for a name the tab does not draw. */
const KNOWN = new Set(['target', 'palm', 'fist', 'cupped', 'thumb', 'heart', 'fish', 'box', 'fork', 'history', 'bowl', 'clock', 'flame', 'dumbbell', 'drop', 'moon', 'sun', 'info', 'calendar', 'pulse', 'review', 'alert']);
const planIcon = (name: string | undefined, fallback: string) => icon(name && KNOWN.has(name) ? name : fallback);

// ---------------------------------------------------------------- banner

function hero(m: Food, ctx: FoodContext): HTMLElement {
  const week = ctx.planWeek ?? m.week.planWeek;
  const ph = ctx.phaseOf ?? m.week.phase;
  const base = [week ? `Week ${week}` : '', phaseLabel(ph?.index, ph?.name)].filter(Boolean);
  if (!m.plan) {
    const tl = m.trend.weight.trend.value.latest;
    const last = m.trend.waist.value.last;
    const F = bodyFmt(m.units);
    return banner({
      phase: ctx.phase,
      kicker: base.join(' · '),
      title: 'Food',
      sub: `${fmt.dayLong(m.date)} · no eating plan yet`,
      chips: [
        { icon: 'tape', label: 'Waist', value: last ? `${F.len(last.waist)} ${F.l}, ${fmt.day(last.date)}` : 'no tape yet', tip: whyTip((m.why as Record<string, Why>)['waist']) },
        { icon: 'trend', label: 'Weight trend', value: tl ? `${F.wv(tl.trend).toFixed(1)} ${F.w}` : 'no weigh-in yet', tip: whyTip((m.why as Record<string, Why>)['trend']) },
      ],
      ring: { segs: [{ kind: 'empty' }], n: '–', label: 'NO PLAN', aria: 'No eating plan yet' },
      key: [],
    });
  }
  const p = m as Planned;
  const plan = p.plan!;
  const wk = p.protein.week.value;
  const segs: RingSeg[] = wk.days.map((d) => ({ kind: d.state === 'ticked' ? 'lift' : 'empty', now: d.state === 'open', future: d.state === 'future', tip: whyTip((m.why as Record<string, Why>)[`day-${d.date}`]) }));
  const check = p.adjust?.value.next ?? plan.review;
  return banner({
    phase: ctx.phase,
    kicker: [...base, p.level.label].join(' · '),
    title: 'Food',
    sub: `${fmt.dayLong(m.date)} · your eating plan of ${fmt.day(plan.updated)}`,
    chips: [
      { sw: 'lift', label: 'Protein days', value: `${wk.ticked} of 7`, tip: whyTip((m.why as Record<string, Why>)['weekdays']) },
      { icon: 'review', label: m.date === check ? 'Check' : 'Next check', value: m.date === check ? 'today' : fmt.wd(check), tip: whyTip((m.why as Record<string, Why>)[p.adjust?.value.next ? 'check' : 'review']) },
    ],
    ring: { segs, n: `${wk.ticked}/7`, label: 'PROTEIN DAYS', aria: `${wk.ticked} of 7 protein days this week` },
    key: [{ kind: 'lift', label: 'Ticked' }, { kind: 'empty', label: 'Not yet' }],
  });
}

// ---------------------------------------------------------------- 1. your plan in a minute

function planCard(m: Planned): HTMLElement {
  const plan = m.plan!;
  const pr = plan.protein;
  const W = m.words;
  const e = plan.energy;
  const hb = plan.habits;
  const target = plan.level !== 'light' && e?.targetKcal ? e.targetKcal : null;
  const facts: [string, Child[], string][] = [];
  if (e) facts.push(['flame', [whyEl(m, 'energy', target ? `${kcal(target[0])} to ${kcal(target[1])}` : `About ${kcal(e.maintenanceKcal)}`), ' kcal a day'], target ? 'The plan’s target, from what you burn' : plan.level === 'light' ? 'What you burn: no diet, no counting needed' : 'What you burn: the plan counts protein and calories']);
  facts.push(['palm', [whyEl(m, 'floor', `${pr.floorG} g`), ' protein or more'], `About ${pr.perMealG[0]} to ${pr.perMealG[1]} g at each meal: the one thing you tick`]);
  const meals = hb ? hb.meals : plan.meals.length;
  const sub = hb ? [hb.cooking ? `Cooking ${lower(hb.cooking)}` : '', ...(hb.avoid ?? []).map((x) => `no ${lower(x)}`)].filter(Boolean).join(', ') : '';
  facts.push(['bowl', [h('b', {}, `${meals} meals`), hb?.snacks ? ' and snacks' : ''], upper(sub) || `${plan.meals.length} on the day below`]);
  const reasons = W.reasons.length
    ? h('ul', { class: 'pv-fd-reasons' }, W.reasons.map((r) => {
        const said = r.source?.kind === 'said';
        return h('li', { class: 'pv-fd-reason' },
          h('span', { class: 'pv-fd-reason-i' }, planIcon(r.icon, 'info')),
          h('div', {},
            h('h4', {}, r.title),
            h('p', {}, r.text),
            r.source ? h('div', { class: 'pv-fd-src' }, icon(said ? 'said' : 'intake'), h('span', {}, h('em', {}, said ? 'You said:' : 'From your intake:'), ` ${r.source.text}.${r.source.aside ? ` ${r.source.aside}` : ''}`)) : null,
          ));
      }))
    : h('p', { class: 'pv-fd-reason-line' }, icon('info'), h('span', {}, W.reasonLine ?? ''));
  return h('section', { class: 'pv-card pv-fd-plan', 'data-sec': 'plan' },
    h('div', { class: 'pv-fd-plan-a' },
      h('div', { class: 'pv-kicker' }, 'Your plan in a minute'),
      h('h2', { class: 'pv-fd-plan-title' }, W.goal),
      h('p', { class: 'pv-fd-lead' }, W.summary),
      h('ul', { class: 'pv-fd-facts' }, facts.map(([ic, big, small]) => h('li', { class: 'pv-fd-fact' }, h('span', { class: 'pv-fd-fact-i' }, icon(ic)), h('div', {}, h('div', { class: 'pv-fd-fact-big' }, big), h('div', { class: 'pv-fd-fact-sub' }, small))))),
    ),
    h('div', { class: 'pv-fd-plan-b' }, h('div', { class: 'pv-fd-h' }, 'Why this plan'), reasons),
  );
}

// ---------------------------------------------------------------- 2. a day on your plan

/** A meal's hand portions inline: the hands drawn (a maybe hand open), the count, the foods. */
function handsRow(m: Planned, meal: Meal): HTMLElement | null {
  const plan = m.plan!;
  const por = meal.portions ? plan.portions?.[meal.portions] : undefined;
  const groups = plan.groups ?? [];
  if (!por || !groups.length) return null;
  const cells = groups.filter((g) => por[g.id]).map((g) => {
    const [lo, hi] = por[g.id]!;
    const n = lo === hi ? `${lo} ${lo === 1 ? g.hands[0] : g.hands[1]}` : `${lo} to ${hi} ${g.hands[1]}`;
    const foods = meal.foods?.[g.id] ?? (g.what ? lower(g.what) : '');
    return h('div', { class: 'pv-fd-hg' },
      h('span', { class: 'pv-fd-hg-icons' }, Array.from({ length: hi }, (_, i) => h('span', { class: `pv-fd-hand${i >= lo ? ' is-maybe' : ''}` }, icon(g.hand)))),
      h('span', { class: 'pv-fd-hg-t' }, whyEl(m, `plate-${meal.portions}-${g.id}`, n), foods ? h('span', {}, h('em', {}, `${upper(g.name)}:`), ` ${foods}`) : null));
  });
  return cells.length ? h('div', { class: 'pv-fd-hands' }, cells) : null;
}

function ideaBox(m: Planned, meal: Meal, row: Extract<FoodDayRow, { kind: 'meal' }>, ctx: FoodContext): HTMLElement | null {
  const ideas = meal.ideas ?? [];
  if (!row.idea || !ideas.length) return null;
  const n = ideas.length;
  const k = (((row.idea.index + (ctx.ideaSteps?.[meal.id] ?? 0)) % n) + n) % n;
  const idea = ideas[k]!;
  const names = (idea.counts ?? []).map((c) => m.plan!.pattern?.find((x) => x.id === c)?.name).filter((x): x is string => Boolean(x));
  return h('div', { class: 'pv-fd-idea' },
    h('div', { class: 'pv-fd-idea-main' },
      h('span', { class: 'pv-fd-idea-k' }, k === row.idea.index ? 'Today’s idea' : 'Another idea'),
      h('span', { class: 'pv-fd-idea-t' }, idea.text),
      names.length ? h('span', { class: 'pv-fd-counts' }, h('span', { class: 'pv-fd-counts-l' }, 'Counts for'), names.map((x) => h('span', { class: 'pv-fd-count' }, x))) : null),
    n > 1 ? h('button', { class: 'pv-fd-more', disabled: !ctx.onIdea, 'aria-label': `Another idea, ${k + 1} of ${n} shown`, 'data-tip': `${meal.name}: ${n} ideas|One a day from your plan; this one is not saved`, 'data-k': `fd-idea-${meal.id}`, onclick: () => ctx.onIdea?.(meal.id) }, icon('sync'), h('span', {}, 'Another idea'), h('small', {}, `· ${k + 1} of ${n}`)) : null,
  );
}

function fallbacks(m: Planned, meal: Meal): HTMLElement | null {
  const fb = m.plan!.fallbacks;
  if (!fb || fb.meal !== meal.id) return null;
  return h('div', { class: 'pv-fd-fb' },
    h('div', { class: 'pv-fd-fb-h' }, icon('alert'), h('b', {}, `If ${lower(meal.name)} is hard`)),
    fb.first ? h('div', { class: 'pv-fd-fb-first' }, icon('history'), h('span', {}, h('b', {}, 'First choice:'), ` ${lower(fb.first.name)}, ${lower(fb.first.text).replace(/\.$/, '')}.`)) : null,
    fb.quick.length ? [
      h('div', { class: 'pv-fd-fb-l' }, icon('clock'), h('span', {}, fb.minutes ? ['Or one of these, in ', whyEl(m, 'fb-min', `${fb.minutes} minutes`, 'span'), ':'] : 'Or one of these:')),
      h('div', { class: 'pv-fd-fb-quick' }, fb.quick.map((q) => h('span', { class: 'pv-fd-pill', 'data-tip': `${q.name}|${q.text}` }, q.name))),
    ] : null,
  );
}

function mealRow(m: Planned, row: Extract<FoodDayRow, { kind: 'meal' }>, ctx: FoodContext): HTMLElement | null {
  const meal = m.plan!.meals.find((x) => x.id === row.id);
  if (!meal) return null;
  const hands = handsRow(m, meal);
  const idea = ideaBox(m, meal, row, ctx);
  // The hands with their foods say what the meal's text says.
  const text = hands && meal.foods ? null : meal.text;
  return h('li', { class: `pv-fd-tl-row is-meal${!hands && !idea ? ' is-small' : ''}${row.hard ? ' is-hard' : ''}`, 'data-meal': meal.id },
    h('time', {}, row.at ? time(row.at) : ''),
    h('span', { class: 'pv-fd-tl-rail' }, h('span', { class: 'pv-fd-tl-dot' })),
    h('div', { class: 'pv-fd-tl-body' },
      h('div', { class: 'pv-fd-meal-head' },
        h('div', { class: 'pv-fd-meal-name' }, h('b', {}, meal.name), meal.tag ? h('span', { class: `pv-fd-tag${row.hard ? ' is-hard' : ''}` }, row.hard ? icon('alert') : null, meal.tag) : null),
        h('span', { class: 'pv-fd-g' }, whyEl(m, `meal-${meal.id}`, gText(meal.proteinG), 'span'), h('span', {}, ' protein'))),
      text ? h('p', { class: 'pv-fd-meal-text' }, text) : null,
      hands,
      row.note ? h('div', { class: 'pv-fd-tl-note' }, icon('dumbbell'), h('span', {}, row.note)) : null,
      idea,
      fallbacks(m, meal),
      meal.tip ? h('div', { class: 'pv-fd-tl-note is-quiet' }, icon('history'), h('span', {}, meal.tip)) : null,
    ),
  );
}

function markRow(at: string, ic: string, label: string, sub: string | null): HTMLElement {
  return h('li', { class: 'pv-fd-tl-row is-mark' },
    h('time', {}, time(at)),
    h('span', { class: 'pv-fd-tl-rail' }, h('span', { class: 'pv-fd-tl-dot' }, icon(ic))),
    h('div', { class: 'pv-fd-tl-body' }, h('b', {}, label), sub ? h('span', {}, sub) : null));
}

const minutesText = (n: number | null) => (n === null ? '' : n === 60 ? ', about an hour' : n === 90 ? ', about an hour and a half' : `, ${n} minutes`);

function dayCard(m: Planned, ctx: FoodContext): HTMLElement {
  const plan = m.plan!;
  const D = m.day;
  const P = m.protein.planned.value;
  const about = Math.round((P.lo + P.hi) / 2 / 5) * 5;
  const floor = plan.protein.floorG;
  const dayName = fmt.dayLong(m.date).split(' ')[0]!;
  const title = D.kind === 'lift' ? `${dayName}, a lifting day` : D.kind === 'short' ? `${dayName}, a short day` : dayName;
  // In the line, a whole hour reads "7" ("Up at 7, work 9 to 17, bed around 23:30"); the timeline keeps "7:00".
  const hour = (t: string) => time(t).replace(/:00$/, '');
  const times = [D.wake ? `Up at ${hour(D.wake)}` : '', D.work ? `work ${hour(D.work[0])} to ${hour(D.work[1])}` : '', D.bed ? `bed around ${hour(D.bed)}` : ''].filter(Boolean).join(', ');
  const rows = D.rows.map((r) => {
    if (r.kind === 'wake' || r.kind === 'bed') return r.kind === 'wake' ? markRow(r.at, 'sun', 'Up', null) : markRow(r.at, 'moon', 'Bed', null);
    if (r.kind === 'training') return markRow(r.at, r.session === 'lift' ? 'dumbbell' : 'pulse', `${r.session === 'lift' ? 'Lift' : 'Short session'}${minutesText(r.minutes)}`, clean(r.name));
    return mealRow(m, r, ctx);
  });
  const dk = D.drinks;
  const drinks = dk ? [dk.waterL ? `about ${dk.waterL} L of water` : '', dk.milkGlasses ? `${dk.milkGlasses} glass${dk.milkGlasses === 1 ? '' : 'es'} of milk` : '', dk.coffees ? `${dk.coffees[0] === dk.coffees[1] ? dk.coffees[0] : `${dk.coffees[0]} to ${dk.coffees[1]}`} coffees${dk.lastCoffee ? ` with the last by ${time(dk.lastCoffee)}` : ''}` : ''].filter(Boolean) : [];
  return h('section', { class: `pv-card pv-fd-day${D.timed ? '' : ' is-untimed'}`, 'data-sec': 'day' },
    h('div', { class: 'pv-card-head' }, h('div', {},
      h('div', { class: 'pv-kicker' }, 'A day on your plan'),
      h('h3', { class: 'pv-card-title' }, title),
      h('div', { class: 'pv-card-sub' }, times ? `${times}. ` : '', whyEl(m, 'planned', `About ${about} g of protein`, 'span'), ` planned, ${about >= floor ? 'over' : 'under'} your ${floor} g.`))),
    h('ol', { class: 'pv-fd-tl' }, rows),
    drinks.length ? h('div', { class: 'pv-fd-day-foot' }, icon('drop'), h('span', {}, `Through the day: ${and(drinks)}.`)) : null,
  );
}

// ---------------------------------------------------------------- 3. today

function todayCard(m: Planned, ctx: FoodContext): HTMLElement {
  const pr = m.plan!.protein;
  const on = m.protein.today?.state === 'ticked';
  const item = m.protein.item;
  const canTick = Boolean(ctx.onTick && item);
  const small = !item ? 'No protein item is tracked yet: the coach adds one.' : on ? 'Counted for this week' : `Tick it tonight if you got there.${m.protein.item?.tickAt ? ` The ${m.protein.item.tickAt} card asks too.` : ''}`;
  const checks = m.checks;
  return h('section', { class: 'pv-card pv-fd-today', 'data-sec': 'today' },
    h('div', { class: 'pv-kicker' }, 'Today'),
    h('h3', { class: 'pv-card-title' }, 'Protein, ', whyEl(m, 'floor', `${pr.floorG} g`, 'span'), ' or more'),
    h('button', { class: `pv-fd-tick${on ? ' is-on' : ''}`, 'aria-pressed': on ? 'true' : 'false', disabled: !canTick || ctx.tickBusy, 'data-k': 'fd-tick', ...whyAttrs(m, `day-${m.date}`), onclick: () => ctx.onTick?.(!on) },
      h('span', { class: `pv-nv-tick is-big${on ? ' is-on' : ''}` }, icon('check')),
      h('span', {}, h('b', {}, ctx.tickBusy ? 'Saving…' : on ? 'Reached today' : 'Not ticked yet'), h('small', {}, small))),
    checks.length ? h('div', { class: 'pv-fd-today-opt' },
      h('div', { class: 'pv-fd-h' }, 'Optional checks'),
      checks.map((c) => h('div', { class: 'pv-fd-opt' },
        h('span', { class: 'pv-fd-opt-l' }, c.label),
        h('span', { class: 'pv-fd-opt-s' }, c.slots.map((slot, i) => {
          const tapped = Boolean(ctx.checks?.[c.id]?.includes(i));
          return h('button', { class: `pv-fd-chk${tapped ? ' is-on' : ''}`, 'aria-pressed': tapped ? 'true' : 'false', disabled: !ctx.onCheck, 'data-k': `fd-chk-${c.id}-${i}`, onclick: () => ctx.onCheck?.(c.id, i) }, h('span', { class: 'pv-fd-chk-box' }, icon('check')), slot);
        })))),
      h('div', { class: 'pv-fd-opt-foot' }, 'They help you answer Sunday’s question. Skip them freely: nothing is scored.'),
    ) : null,
  );
}

// ---------------------------------------------------------------- 4. coach's tips

function tipsCard(m: Planned): HTMLElement | null {
  const tips = m.plan!.tips ?? [];
  if (!tips.length) return null;
  return h('section', { class: 'pv-card pv-fd-tips-card', 'data-sec': 'tips' },
    h('div', { class: 'pv-kicker' }, 'Coach’s tips'),
    h('h3', { class: 'pv-card-title' }, 'Making it easy'),
    h('ul', { class: 'pv-fd-tips' }, tips.map((t) => h('li', { class: 'pv-fd-tip' }, h('span', { class: 'pv-fd-tip-i' }, planIcon(t.icon, 'info')), h('div', {}, h('b', {}, t.title), h('p', {}, t.text))))),
  );
}

// ---------------------------------------------------------------- 5. how it's going: the charts

function dateAxis(m: Food, x: (d: string) => number, H: number, mg: { l: number; r: number; t: number; b: number }, W: number, out: SVGElement[]): void {
  const days = [m.trend.from, ...m.trend.tapeDays.filter((d) => d > m.trend.from)];
  for (const d of days) {
    if (d !== m.trend.from) out.push(s('line', { class: 'pv-fd-tapeday', x1: x(d), x2: x(d), y1: mg.t, y2: H - mg.b }));
    const anchor = d === m.trend.from ? 'start' : x(d) > W - mg.r - 20 ? 'end' : 'middle';
    out.push(s('text', { class: 'pv-ax', x: x(d), y: H - 5, 'text-anchor': anchor }, fmt.day(d)));
  }
  out.push(s('line', { class: 'pv-base', x1: mg.l, x2: W - mg.r, y1: H - mg.b, y2: H - mg.b }));
}

function weightSvg(m: Planned, W: number): SVGElement {
  const H = 112;
  const mg = { l: 34, r: 8, t: 14, b: 20 };
  // In the body unit: every kg value converted (a % band stays as it is).
  const F = bodyFmt(m.units);
  const pts = m.trend.weight.trend.value.points.map((p) => ({ ...p, weight: F.wv(p.weight), trend: F.wv(p.trend) }));
  const band0 = m.trend.weight.direction.value.band ?? { unit: 'pct' as const, lo: -0.005, hi: 0 };
  const band = band0.unit === 'pct' ? band0 : { ...band0, lo: F.wv(band0.lo), hi: F.wv(band0.hi) };
  const a = pts[0]!;
  const to = m.trend.to;
  const bandAt = (d: string, f: number) => (band.unit === 'pct' ? a.trend * (1 + f * (daysBetween(a.date, d) / 7)) : a.trend + f * (daysBetween(a.date, d) / 7));
  const vals = [...pts.map((p) => p.weight), ...pts.map((p) => p.trend), bandAt(to, band.lo), bandAt(to, band.hi), a.trend + F.wv(0.6)];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const x = (d: string) => scale(ms(m.trend.from), ms(to), mg.l, W - mg.r)(ms(d));
  const y = scale(lo, hi, H - mg.b, mg.t);
  const out: SVGElement[] = [];
  for (const t of niceTicks(lo, hi, 3)) out.push(s('line', { class: 'pv-grid', x1: mg.l, x2: W - mg.r, y1: y(t), y2: y(t) }), s('text', { class: 'pv-ax end', x: mg.l - 6, y: y(t) + 3 }, String(t)));
  dateAxis(m, x, H, mg, W, out);
  const wedge: [number, number][] = [[x(a.date), y(a.trend)], [x(to), y(bandAt(to, band.hi))], [x(to), y(bandAt(to, band.lo))]];
  out.push(s('path', { class: 'pv-c-wedge', d: `${path(wedge)}Z` }), s('path', { class: 'pv-c-wedge-edge', d: path([wedge[0]!, wedge[1]!]) }), s('path', { class: 'pv-c-wedge-edge', d: path([wedge[0]!, wedge[2]!]) }));
  const svg = s('svg', { class: 'pv-chart', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Weight trend since ${fmt.day(m.trend.from)}` });
  if (pts.length === 1) {
    out.push(s('circle', { class: 'pv-c-end', cx: x(a.date), cy: y(a.trend), r: 4, ...whyAttrs(m, 'trend') }));
    out.push(s('text', { class: 'pv-c-label strong', x: x(a.date) + 8, y: y(a.trend) - 7 }, `${a.trend.toFixed(1)} ${F.w}`));
    svg.append(...out);
    return svg;
  }
  for (const p of pts) out.push(s('circle', { class: 'pv-c-raw', cx: x(p.date), cy: y(p.weight), r: 2.4 }));
  out.push(s('path', { class: 'pv-c-line', d: path(pts.map((p) => [x(p.date), y(p.trend)])) }));
  const l = pts.at(-1)!;
  out.push(s('circle', { class: 'pv-c-end', cx: x(l.date), cy: y(l.trend), r: 4 }));
  out.push(s('text', { class: 'pv-c-label strong', x: x(l.date) - 8, y: y(l.trend) + 16, 'text-anchor': 'end' }, `${l.trend.toFixed(1)} ${F.w}`));
  const cross = s('line', { class: 'pv-c-cross', x1: 0, x2: 0, y1: mg.t, y2: H - mg.b });
  const hot = s('circle', { class: 'pv-c-hot', r: 4.5, cx: 0, cy: 0 });
  const hit = s('rect', { class: 'pv-c-hit', x: mg.l, y: mg.t, width: W - mg.r - mg.l, height: H - mg.b - mg.t });
  out.push(cross, hot, hit);
  svg.append(...out);
  const creatine = m.creatine?.start ?? null;
  hit.addEventListener('mousemove', (ev) => {
    const box = (svg as SVGSVGElement).getBoundingClientRect();
    const px = ((ev as MouseEvent).clientX - box.left) * (W / box.width);
    let best = pts[0]!;
    for (const p of pts) if (Math.abs(x(p.date) - px) < Math.abs(x(best.date) - px)) best = p;
    cross.setAttribute('x1', String(x(best.date)));
    cross.setAttribute('x2', String(x(best.date)));
    hot.setAttribute('cx', String(x(best.date)));
    hot.setAttribute('cy', String(y(best.trend)));
    cross.classList.add('is-on');
    hot.classList.add('is-on');
    const water = creatine && best.date >= creatine && best.date < addDays(creatine, 14) ? '¶In creatine’s first two weeks: some of it is water.' : '';
    hit.setAttribute('data-tip', [fmt.wd(best.date), `Weigh-in\t${best.weight.toFixed(1)} ${F.w}`, `Trend\t${best.trend.toFixed(2)} ${F.w}`, water].filter(Boolean).join('|'));
  });
  hit.addEventListener('mouseleave', () => {
    cross.classList.remove('is-on');
    hot.classList.remove('is-on');
  });
  return svg;
}

function waistSvg(m: Planned, W: number): SVGElement {
  const H = 78;
  const mg = { l: 34, r: 8, t: 8, b: 20 };
  // In the body unit: the tapes and the flat band converted; a label shows a cm as written, inches to one decimal.
  const F = bodyFmt(m.units);
  const show = (v: number) => (F.l === 'cm' ? String(v) : v.toFixed(1));
  const tapes = m.trend.waist.value.points.map((t) => ({ ...t, waist: F.lv(t.waist) }));
  const base = tapes[0]!.waist;
  const flat = F.lv(m.plan!.adjust?.flatCm ?? m.trend.waist.value.flatCm);
  const lo = Math.min(base - F.lv(1.4), ...tapes.map((t) => t.waist - F.lv(0.4)));
  const hi = Math.max(base + F.lv(1), ...tapes.map((t) => t.waist + F.lv(0.4)));
  const x = (d: string) => scale(ms(m.trend.from), ms(m.trend.to), mg.l, W - mg.r)(ms(d));
  const y = scale(lo, hi, H - mg.b, mg.t);
  const out: SVGElement[] = [];
  for (const t of niceTicks(lo, hi, 2)) out.push(s('line', { class: 'pv-grid', x1: mg.l, x2: W - mg.r, y1: y(t), y2: y(t) }), s('text', { class: 'pv-ax end', x: mg.l - 6, y: y(t) + 3 }, String(t)));
  out.push(s('rect', { class: 'pv-fd-flat', x: mg.l, y: y(base + flat), width: W - mg.r - mg.l, height: y(base - flat) - y(base + flat) }));
  dateAxis(m, x, H, mg, W, out);
  out.push(s('text', { class: 'pv-c-label', x: W - mg.r - 2, y: y(base + flat) - 3, 'text-anchor': 'end' }, `flat, ±${show(flat)} ${F.l}`));
  if (tapes.length > 1) out.push(s('path', { class: 'pv-c-line', d: path(tapes.map((t) => [x(t.date), y(t.waist)])) }));
  for (const t of tapes) out.push(s('circle', { class: 'pv-c-end', cx: x(t.date), cy: y(t.waist), r: 4, ...whyAttrs(m, `tape-${t.date}`) }));
  const l = tapes.at(-1)!;
  const one = tapes.length === 1;
  out.push(s('text', { class: 'pv-c-label strong', x: x(l.date) + (one ? 8 : -8), y: y(l.waist) + (one ? 4 : -8), 'text-anchor': one ? 'start' : 'end' }, `${show(l.waist)} ${F.l}`));
  return s('svg', { class: 'pv-chart', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Waist since ${fmt.day(m.trend.from)}` }, out);
}

const WANT: Record<string, { waist: string | null; weight: string }> = {
  recomposition: { waist: 'slowly down', weight: 'flat to slightly down' },
  'fat-loss': { waist: 'down', weight: 'down' },
  gain: { waist: null, weight: 'slowly up' },
  maintenance: { waist: 'flat', weight: 'flat' },
};

// ---------------------------------------------------------------- 5. how it's going

const MARK: Record<string, string> = { ticked: 'check', unticked: 'minus', open: '', future: '', before: '' };

function proteinSec(m: Planned): HTMLElement {
  const wk = m.protein.week.value;
  const open = wk.days.some((d) => d.state === 'open');
  const past = m.protein.weeks.value;
  return h('div', { class: 'pv-fd-sec' },
    h('div', { class: 'pv-fd-sec-h' }, h('span', {}, 'Protein days this week'), h('span', { class: 'pv-fd-sec-v' }, whyEl(m, 'weekdays', `${wk.ticked} of 7`), ` so far${open ? ', today open' : ''}`)),
    h('div', { class: 'pv-fd-week' }, wk.days.map((d) => h('div', { class: `pv-fd-wd${d.date === m.date ? ' is-today' : ''}`, ...whyAttrs(m, `day-${d.date}`) },
      h('span', { class: `pv-day-mark is-${d.state === 'before' ? 'none' : d.state}` }, MARK[d.state] ? icon(MARK[d.state]!) : null),
      h('span', {}, fmt.dow(d.date))))),
    h('div', { class: 'pv-fd-sec-note' }, `A day counts at ${m.plan!.protein.floorG} g or more, ticked in the evening.`, past.length ? [' Weeks before: ', past.map((w, i) => [i ? ', ' : '', `W${w.n} `, whyEl(m, `week-${w.n}`, String(w.checkin ?? w.ticked))]), '.'] : null),
  );
}

function trendSec(m: Planned, ctx: FoodContext, W: number): HTMLElement {
  const plan = m.plan!;
  const want = WANT[plan.goal] ?? { waist: null, weight: 'as the goal says' };
  const tr = m.trend.weight.trend.value;
  const tl = tr.latest;
  const rate = m.trend.weight.rate.value;
  const dir = m.trend.weight.direction.value.status;
  const waist = m.trend.waist.value;
  const F = bodyFmt(m.units);
  const on = ctx.tables.has('food-trend');
  const wVal: Child[] = !tl ? ['no weigh-in yet'] : rate ? [whyEl(m, 'trend', `${F.wv(tl.trend).toFixed(1)} ${F.w}`), ', ', whyEl(m, 'rate', `${signed(F.wv(rate.kgPerWeek), 2)} ${F.w} a week`, 'span')] : [whyEl(m, 'trend', `${F.wv(tl.trend).toFixed(1)} ${F.w}`), ', ', whyEl(m, 'rate', `${tr.points.length} weigh-in${tr.points.length === 1 ? '' : 's'}`, 'span')];
  const wChip = dir === 'early' ? statusChip('neutral', `Plan: ${want.weight}`, 'info') : dir === 'in' ? statusChip('in', 'In the plan’s direction') : statusChip('neutral', 'Out of the plan’s pace');
  const last = waist.last;
  const tVal: Child[] = !last ? ['no tape yet'] : waist.changeCm === null ? [whyEl(m, 'waist', `${F.len(last.waist)} ${F.l}`), `, ${fmt.day(last.date)}`] : [whyEl(m, 'waist', `${F.len(last.waist)} ${F.l}`), ', ', whyEl(m, 'waist-ch', `${signed(F.len(waist.changeCm))} ${F.l}`, 'span'), ` since ${fmt.day(waist.first!.date)}`];
  const tChip = waist.status === 'early' || waist.status === 'none' ? statusChip('neutral', want.waist ? `Plan: ${want.waist}` : 'No waist target', 'info') : waist.status === 'in' ? statusChip('in', 'In the plan’s direction') : waist.status === 'flat' ? statusChip('neutral', 'Flat so far') : statusChip('neutral', 'Not down yet');
  const next = m.trend.nextTapes.filter((d) => d <= m.trend.to);
  const creatine = m.creatine?.start && m.adjust?.value.creatine ? m.adjust.value.creatine : null;
  const note = !rate
    ? `${waist.points.length <= 1 && tr.points.length <= 1 ? 'One tape and one weigh-in so far. ' : `A rate needs 14 days and 8 weigh-ins. `}${next.length ? `Next tape${next.length === 1 ? '' : 's'}: ${and(next.map((d) => fmt.wd(d)))}.` : ''}`
    : creatine && creatine.from >= m.trend.from ? `Creatine from ${fmt.day(creatine.from)}: its water lifts the scale in the first weeks, and the rule takes no step for it.` : `The tape every second Sunday and the trend decide${next.length ? `; the next tape ${fmt.wd(next[0]!)}` : ''}.`;
  const dates = [...new Set([...tr.points.map((p) => p.date), ...waist.points.map((t) => t.date)])].sort().reverse();
  const rows = dates.map((d) => {
    const p = tr.points.find((q) => q.date === d);
    const t = waist.points.find((q) => q.date === d);
    return [fmt.wd(d), p ? F.wv(p.weight).toFixed(1) : '–', p ? F.wv(p.trend).toFixed(2) : '–', t ? String(F.len(t.waist)) : '–'] as Child[];
  });
  return h('div', { class: `pv-fd-sec${on ? ' is-table' : ''}`, 'data-card': 'food-trend' },
    h('div', { class: 'pv-fd-sec-h' }, h('span', {}, 'Waist and weight'), h('button', { class: `pv-btn-quiet pv-fd-sec-btn${on ? ' is-on' : ''}`, onclick: () => ctx.onTable('food-trend'), 'data-k': 'fd-table' }, icon(on ? 'chart' : 'table'), on ? 'Chart' : 'Table')),
    h('div', { class: 'pv-chart-area' },
      h('div', { class: 'pv-fd-mini' }, h('div', { class: 'pv-fd-mini-head' }, h('span', {}, h('b', {}, 'Waist'), ' ', tVal), tChip), last ? waistSvg(m, W) : h('p', { class: 'pv-calm' }, icon('info'), 'No tape this cycle yet.')),
      h('div', { class: 'pv-fd-mini' }, h('div', { class: 'pv-fd-mini-head' }, h('span', {}, h('b', {}, 'Weight trend'), ' ', wVal), wChip), tl ? weightSvg(m, W) : h('p', { class: 'pv-calm' }, icon('info'), 'No weigh-in this cycle yet.')),
      h('div', { class: 'pv-fd-sec-note' }, note)),
    h('div', { class: 'pv-table-area' }, table([{ t: 'Date' }, { t: `Weigh-in (${F.w})`, r: true }, { t: `Trend (${F.w})`, r: true }, { t: `Waist (${F.l})`, r: true }], rows)),
  );
}

function patternSec(m: Planned): HTMLElement | null {
  const pt = m.pattern;
  if (!pt) return null;
  const P = pt.value;
  const plan = m.plan!;
  const answered = P.records.filter(Boolean).length;
  const head = answered ? `Answered on ${answered} Sunday${answered === 1 ? '' : 's'}` : `First answer ${fmt.wd(P.sundays.at(-1)!)}`;
  return h('div', { class: 'pv-fd-sec' },
    h('div', { class: 'pv-fd-sec-h' }, h('span', {}, 'The weekly pattern'), h('span', { class: 'pv-fd-sec-v' }, head)),
    h('div', { class: 'pv-fd-pt' }, P.lines.map((l) => h('div', { class: 'pv-fd-pt-row' },
      h('span', {}, h('b', {}, l.name), ' ', whyEl(m, `pt-${l.id}`, l.target, 'span')),
      h('span', { class: 'pv-fd-pt-marks' }, P.sundays.map((d, i) => {
        const a = l.answers[i];
        const st = a === true ? 'ticked' : a === false ? 'unticked' : 'future';
        return h('span', { class: `pv-day-mark is-${st}`, ...whyAttrs(m, `pt-${l.id}-${d}`) }, a === true ? icon('check') : a === false ? icon('minus') : null);
      }))))),
    h('div', { class: 'pv-fd-sec-note' }, `Sunday’s check-in asks once a week: met or not.${plan.patternAlso ? ` Also: ${lower(plan.patternAlso)}` : ''}`),
  );
}

function checkSec(m: Planned): HTMLElement | null {
  const plan = m.plan!;
  const A = plan.adjust;
  const adj = m.adjust;
  if (!A || !adj) return null;
  const X = adj.value;
  const F = bodyFmt(m.units);
  const less = A.steps.find((x) => x.id === 'less');
  const back = A.steps.find((x) => x.id === 'back');
  const before = X.before.filter((d) => !X.next || d <= X.next);
  const value: Child[] = X.next ? [whyEl(m, 'check', fmt.wd(X.next)), before.length ? `, after the ${and(before.map((d) => fmt.day(d)))} tape${before.length === 1 ? '' : 's'}` : ''] : ['none planned'];
  let status: HTMLElement | null = null;
  if (X.checkedOn && X.status === 'checked') {
    const when = X.checkedOn === m.date ? 'today' : fmt.wd(X.checkedOn);
    const noteRest = (adj.reason.note ?? '').replace(/^Checked [^:]+: [^.]+\.\s*/, '').replace(/\s*Next check .*$/, '');
    const body: Child[] = X.why === 'waist-down' && X.span?.changeCm !== null && X.span?.changeCm !== undefined
      ? ['The waist is down ', whyEl(m, 'waist-ch', `${Math.abs(F.lv(X.span.changeCm)).toFixed(1)} ${F.l}`, 'span'), ` in ${Math.round((X.span.spanDays ?? 28) / 7)} weeks, so the portions stay.`]
      : [noteRest];
    status = h('div', { class: `pv-fd-status${X.step ? ' is-step' : ' is-checked'}`, ...whyAttrs(m, 'rule') }, icon(X.step ? 'alert' : 'inTarget'), h('div', {}, h('b', {}, X.step ? `Checked ${when}: ${lower(X.step.then)}` : `Checked ${when}: no change`), h('span', {}, body)));
  } else if (X.status === 'due') {
    status = h('div', { class: 'pv-fd-status', ...whyAttrs(m, 'rule') }, icon('clock'), h('div', {}, h('b', {}, 'The check is due'), h('span', {}, `It reads the tape of ${fmt.wd(X.next!)} once it is in.`)));
  }
  const tk = m.trend.weight.trend.value.latest?.trend ?? null;
  const pct = Math.abs((back?.pctPerWeek ?? -0.01) * 100);
  return h('div', { class: 'pv-fd-sec' },
    h('div', { class: 'pv-fd-sec-h' }, h('span', {}, X.checkedOn ? 'Next check' : 'First check'), h('span', { class: 'pv-fd-sec-v' }, value)),
    status,
    h('ul', { class: 'pv-fd-ifs' },
      less ? h('li', {}, icon('down'), h('span', {}, 'If the waist hasn’t moved in ', whyEl(m, 'flat', `${A.windowWeeks} weeks`, 'span'), ' and the weight trend isn’t falling: ', h('b', {}, `${lower(less.then)}.`))) : null,
      back ? h('li', {}, icon('up'), h('span', {}, 'If you’re losing faster than ', whyEl(m, 'onepct', `${pct} % a week`, 'span'), tk ? ` (about ${F.wt(Math.round(tk * pct) / 100)} ${F.w})` : '', ': ', h('b', {}, `${lower(back.then)}.`))) : null),
    h('div', { class: 'pv-fd-sec-note' }, 'One step at a time, then wait ', whyEl(m, 'wait', `${A.waitWeeks[0]} to ${A.waitWeeks[1]} weeks`, 'span'), '.', A.creatineKg ? [' Creatine adds ', whyEl(m, 'creatine', `${F.wt(A.creatineKg[0])} to ${F.wt(A.creatineKg[1])} ${F.w}`, 'span'), ' of water early on: no step for it.'] : null),
  );
}

function goingCard(m: Planned, ctx: FoodContext, W: number): HTMLElement {
  return h('section', { class: 'pv-card pv-fd-going', 'data-sec': 'going' },
    h('div', { class: 'pv-card-head' }, h('div', {}, h('div', { class: 'pv-kicker' }, 'How it’s going'), h('div', { class: 'pv-card-sub' }, runs(goingStatus(m))))),
    proteinSec(m),
    trendSec(m, ctx, W),
    patternSec(m),
    checkSec(m),
  );
}

// ---------------------------------------------------------------- no plan yet

function emptyCard(ctx: FoodContext): HTMLElement {
  const soon: [string, string, string][] = [
    ['target', 'Your plan in a minute', 'The goal, the day’s size, the protein floor and why this plan'],
    ['clock', 'A day on your plan', 'Your day with each meal’s hand portions and a meal idea'],
    ['check', 'Today', 'The protein tick and the light checks'],
    ['history', 'Coach’s tips', 'Small ways to make the plan easy'],
    ['trend', 'How it’s going', 'Protein days, the waist and the weight trend, the weekly pattern'],
    ['layers', 'The next check', 'When a portion changes, one step at a time'],
  ];
  return h('section', { class: 'pv-card' },
    h('div', { class: 'pv-fd-empty' },
      h('div', { class: 'pv-fd-empty-t' }, icon('bowl'),
        h('div', {}, h('b', {}, 'No eating plan yet'), h('p', {}, 'Run ', h('code', {}, '/fitness-coach diet'), ' to make one. The coach asks about your day and how you eat now, then writes the plan: the meals and their times, the protein floor, the hand portions and the rule that adjusts it. This tab draws it from there.')),
        ctx.onCopy ? h('button', { class: 'pv-btn-primary', onclick: () => ctx.onCopy!(), 'data-k': 'fd-copy' }, icon('clipboard'), 'Copy the command') : null),
      h('div', { class: 'pv-fd-soon' }, soon.map(([i, t, x]) => h('div', {}, h('span', { class: 'pv-rem-icon' }, icon(i)), h('div', {}, h('b', {}, t), h('span', {}, x))))),
    ),
  );
}

// ---------------------------------------------------------------- page

/** Builds the Food tab into `root` (its children are replaced). */
export function renderFood(root: HTMLElement, m: Food, ctx: FoodContext): void {
  const notes = m.notes.filter((n) => n.code !== 'no-plan');
  const calm = notes.length ? h('div', { class: 'pv-notes' }, notes.map((n) => h('div', { class: 'pv-note' }, icon('info'), h('span', {}, n.text)))) : null;
  if (!m.plan) {
    root.replaceChildren(hero(m, ctx), ...(calm ? [calm] : []), h('div', { class: 'pv-fd-grid' }, h('div', { class: 'pv-fd-wide' }, emptyCard(ctx))));
    return;
  }
  const p = m as Planned;
  const total = ctx.width || 1000;
  const narrow = total < 760;
  const gap = 18;
  // The side column is 5 of 12 parts beside the day's 7 (mockups/food-v2.css), its cards padded 22 px each side.
  const side = narrow ? total : ((total - gap) * 5) / 12;
  const W = Math.max(240, Math.floor(side - 46));
  root.replaceChildren(
    hero(m, ctx),
    ...(calm ? [calm] : []),
    planCard(p),
    h('div', { class: 'pv-fd-grid' },
      h('div', { class: 'pv-fd-main' }, dayCard(p, ctx)),
      h('div', { class: 'pv-fd-side' }, todayCard(p, ctx), tipsCard(p), goingCard(p, ctx, W)),
    ),
  );
}

export type { Plan as FoodPlan };
