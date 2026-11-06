// Today's "Due today" card, as signed off in mockups/today.html: the
// morning check-in, the habits due with tick boxes, each amount's progress
// with its quick-add buttons, sitting today with the Standing now switch,
// the stand-ups so far, the desk breaks, the body record when due (else in
// "Coming up" with its date), "Did you train today?" when it applies, and
// the phone's entries the import refused ("1 phone entry needs a look").
// While a Sunday's answers wait, the Sunday check-in's line in Coming up
// says the coach step that follows them, with its command.
// Every row opens its card. From the engine's dueToday through the reminder
// machinery (this Mac's stand-up counts and sitting); standard DOM only, the
// view passes the callbacks.

import type { DueToday } from '../../../src/core/nudges.ts';
import type { TrackedItem } from '../../../src/core/schema.ts';
import { type RefusedEntry } from '../../../src/report/inbox.ts';
import { hm, type SittingDay } from '../../../src/core/sitting.ts';
import { inDaysText, sundayOf } from '../../../src/report/habits-screen.ts';
import type { ActivityStatus, StandStatus } from '../reminders/machine.ts';
import { ACTIVITY_UNAVAILABLE } from '../reminders/machine.ts';
import { commandChip } from './coach.ts';
import { h, icon, type Child } from './dom.ts';
import { fmt } from './format.ts';
import { tip } from './progress.ts';
import { paths } from '../../../src/adapters/vault/layout.ts';

export interface DueTodayContext {
  due: DueToday;
  /** Coach/tracking.json's items (doses, quick amounts, the sitting limits when activity can't be read). */
  items: readonly TrackedItem[];
  activity: ActivityStatus;
  stand: readonly StandStatus[];
  sitting: { today: SittingDay; current: { start: number; minutes: number } | null } | null;
  standing: { on: boolean; since: number | null };
  /** The Sunday check-in is saved for this week. */
  sundayDone: boolean;
  /** The coach step after a Sunday whose answers are not saved yet (answer first): its line and command; null otherwise. */
  coachFirst?: { line: string; command: string } | null;
  canWrite: boolean;
  /** Item ids with a write on the way (their buttons wait). */
  busy: ReadonlySet<string>;
  onTick: (id: string, done: boolean) => void;
  onAdd: (id: string, delta: number) => void;
  /** Opens a card by its reminder key (morning, slot:09:00, amount:water, desk:desk-breaks, sitting:sitting, train, tape, photos, tests). */
  onOpen: (key: string) => void;
  onStanding: (on: boolean) => void;
  /** Progress, Habits. */
  onHabits: () => void;
  /** The Settings tab (absent: not offered). */
  onSettings?: () => void;
  /** A moment as local HH:MM (the morning's saved time, the Standing now line). */
  clock?(ms: number): string;
  /** The phone's entries the import refused (Coach/Inbox/refused.json): they wait in the inbox for a look. */
  phone?: readonly RefusedEntry[];
}

const BODY_ICON = { tape: 'tape', photos: 'camera', tests: 'flag' } as const;
const BODY_TITLE = { tape: 'Tape day', photos: 'Photo day', tests: 'Fitness tests' } as const;
const BODY_NAME = { tape: 'Tape', photos: 'Photos', tests: 'Tests' } as const;
const nfmt = (v: number) => Math.round(v * 100) / 100 >= 1000 ? Math.round(v).toLocaleString('en-GB') : String(Math.round(v * 100) / 100);

const row = (ic: string, body: Child[], end: Child = null, wide = false) =>
  h('li', { class: `pv-due-row${wide ? ' is-wide' : ''}` },
    h('span', { class: 'pv-rem-icon' }, icon(ic)),
    h('div', {}, body),
    wide ? null : h('span', { class: 'pv-due-end' }, end),
  );
/** A row's title: a link that opens its card. */
const title = (text: string, open?: () => void, tipText?: string) => (open ? h('button', { class: 'pv-due-title', onclick: open, ...(tipText ? { 'data-tip': tipText } : {}) }, text) : h('b', {}, text));
const sub = (...c: Child[]) => h('div', { class: 'pv-due-sub' }, c);
const time = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** An amount's bar against its target, with the quick-add buttons. */
export function amountBar(o: { value: number; target: number; unit: string; quick?: readonly number[]; id?: string; left?: boolean; big?: boolean; busy?: boolean; onAdd?: (id: string, delta: number) => void }): HTMLElement {
  const pct = Math.min(100, (o.value / Math.max(1, o.target)) * 100);
  return h('div', { class: `pv-amt${o.big ? ' is-big' : ''}` },
    h('div', { class: 'pv-amt-top' }, h('span', {}, h('b', {}, nfmt(o.value)), ` / ${nfmt(o.target)} ${o.unit}`), o.left === false ? null : h('span', { class: 'pv-faint' }, o.value >= o.target ? 'target met' : `${nfmt(o.target - o.value)} to go`)),
    h('div', { class: 'pv-amt-bar', role: 'img', 'aria-label': `${nfmt(o.value)} of ${nfmt(o.target)} ${o.unit}` }, h('i', { style: `width:${pct}%` })),
    o.quick?.length && o.onAdd && o.id ? h('div', { class: 'pv-amt-quick' }, o.quick.map((q) => h('button', { class: 'pv-btn-quiet', disabled: o.busy, onclick: () => o.onAdd!(o.id!, q), 'data-k': `add-${o.id}-${q}` }, `+${nfmt(q)} ${o.unit}`))) : null,
  );
}

/** Sitting today against its limit, the longest stretch beside it (a stretch over its limit marked, never by colour alone). */
export function sittingBar(o: { minutes: number; longest: number; limit: number; stretchMax: number; big?: boolean }): HTMLElement {
  const over = o.longest > o.stretchMax;
  return h('div', { class: `pv-amt is-limit${o.big ? ' is-big' : ''}` },
    h('div', { class: 'pv-amt-top' },
      h('span', {}, h('b', {}, hm(o.minutes)), ` of ${hm(o.limit)}`),
      h('span', { class: 'pv-faint' }, 'longest stretch ', h('b', { class: over ? 'is-over' : '' }, over ? icon('alert') : null, `${o.longest} min`), ` / ${o.stretchMax}`)),
    h('div', { class: 'pv-amt-bar', role: 'img', 'aria-label': `${hm(o.minutes)} sitting of ${hm(o.limit)}` }, h('i', { style: `width:${Math.min(100, (o.minutes / Math.max(1, o.limit)) * 100)}%` })),
  );
}

function morningRow(d: DueToday, ctx: DueTodayContext): HTMLElement | null {
  const m = d.morning;
  if (!m.on && !m.done) return null;
  const open = () => ctx.onOpen('morning');
  const at = m.checkedAt && ctx.clock && !Number.isNaN(Date.parse(m.checkedAt)) ? ctx.clock(Date.parse(m.checkedAt)) : time(m.checkedAt);
  const later = m.at !== null && m.at > d.now;
  return row('clipboard', [
    title('Morning check-in', open, tip('Morning check-in', m.done ? 'Open it to change an answer' : 'Opens its card')),
    sub(m.done ? `Saved${at ? ` at ${at}` : ''}, feeds today’s readiness` : later ? `A card at ${m.at}` : 'Due now: about 30 seconds, feeds today’s readiness'),
  ], m.done ? h('span', { class: 'pv-status is-in' }, icon('check'), 'Done') : later ? h('span', { class: 'pv-due-at' }, m.at) : h('button', { class: 'pv-btn-quiet', onclick: open, 'data-k': 'due-morning' }, 'Open'));
}

function habitsRow(d: DueToday, ctx: DueTodayContext): HTMLElement | null {
  const hb = d.habits;
  if (!hb.total) return null;
  const slots = hb.slots.map((sl) => {
    const label = sl.time ?? (sl.key === 'after-log' ? 'After training' : 'Any time');
    const key = sl.time ? `slot:${sl.time}` : sl.key === 'after-log' ? 'slot:after-log' : null;
    return h('div', { class: 'pv-due-slot' },
      key ? h('button', { class: 'pv-due-slot-t', onclick: () => ctx.onOpen(key), 'data-tip': tip(`The ${label} card`, 'Opens it while it is due') }, label) : h('span', { class: 'pv-due-slot-t' }, label),
      h('ul', {}, sl.items.map((x) => h('li', { class: x.later ? 'is-later' : '' },
        h('span', { class: 'pv-due-supp' }, h('b', {}, x.name), x.dose ? ` ${x.dose}` : ''),
        x.later && !x.done
          ? h('span', { class: 'pv-due-at', 'data-tip': tip(x.name, `Its card comes at ${sl.time}`, 'Tick it early on the card or in Habits') }, sl.time)
          : h('button', { class: `pv-ntick${x.done ? ' is-on' : ''}`, disabled: !ctx.canWrite || ctx.busy.has(x.id), 'aria-pressed': x.done ? 'true' : 'false', 'aria-label': `${x.name} done`, onclick: () => ctx.onTick(x.id, !x.done), 'data-k': `tick-${x.id}` }, x.done ? icon('check') : null),
      ))),
    );
  });
  return row('pill', [title('Habits'), sub(`${hb.done} of ${hb.total} done · tick here or on the card`), slots], null, true);
}

function amountRows(d: DueToday, ctx: DueTodayContext): HTMLElement[] {
  return d.amounts.map((a) => {
    const it = ctx.items.find((x) => x.id === a.id);
    const r = it?.reminder;
    return row('drop', [
      title(a.name, () => ctx.onOpen(`amount:${a.id}`), tip(a.name, 'Opens its card')),
      sub(a.met ? 'Target met: no more reminders today' : a.next ? `Next reminder at ${a.next}` : r ? 'No more reminders today' : 'No reminder: add it here'),
      amountBar({ value: a.value, target: a.target, unit: a.unit, quick: it?.amount?.quick ?? [], id: a.id, busy: !ctx.canWrite || ctx.busy.has(a.id), onAdd: ctx.onAdd }),
    ], null, true);
  });
}

function sittingRows(d: DueToday, ctx: DueTodayContext): HTMLElement[] {
  const sw = h('label', { class: 'pv-due-standing', 'data-tip': tip('Standing now', 'At a standing desk, typing is not sitting, and the desk time counts toward your stand-ups: each stand\u2019s worth of minutes is logged as a stand', 'This Mac only; off at midnight or after half an hour away') },
    h('button', { class: `pv-sw${ctx.standing.on ? ' is-on' : ''}`, role: 'switch', 'aria-checked': ctx.standing.on ? 'true' : 'false', 'aria-label': 'Standing now', onclick: () => ctx.onStanding(!ctx.standing.on), 'data-k': 'standing' }),
    'Standing now');
  if (ctx.activity.readable === false) {
    const items = ctx.items.filter((x) => x.kind === 'sitting');
    return items.slice(0, 1).map((it) => row('clock', [title(it.name), sub(ACTIVITY_UNAVAILABLE)], null, true));
  }
  return d.sitting.map((x) => {
    const since = ctx.standing.on && ctx.standing.since !== null && ctx.clock ? ctx.clock(ctx.standing.since) : null;
    return row('clock', [
      h('div', { class: 'pv-due-head' }, title('Sitting today', () => ctx.onOpen(`sitting:${x.id}`), tip('Sitting today', 'Opens its card while it is due', 'Counted from keyboard and mouse activity')), sw),
      sub(ctx.standing.on ? `Standing${since ? ` since ${since}` : ''}: not counted as sitting` : `Under ${hm(x.limit)} a day, no stretch over ${x.stretchMax} min`),
      sittingBar({ minutes: x.minutes, longest: x.longest, limit: x.limit, stretchMax: x.stretchMax }),
    ], null, true);
  });
}

/** The stands logged today, named: "1 stand-up so far", "18 stand-ups so far". */
export const standCount = (n: number): string => `${n} stand-up${n === 1 ? '' : 's'} so far`;

function standRows(d: DueToday, ctx: DueTodayContext): HTMLElement[] {
  return d.standups.map((x) => {
    const count = standCount(x.count);
    // The minutes against the target ("40 of 60 min standing"; once it's reached, "75 min standing (target 60)"), and the desk's share
    // when "Standing now" logged any (", 30 of them at the desk").
    const stood = x.minutes >= x.target ? `${x.minutes} min standing (target ${x.target})` : `${x.minutes} of ${x.target} min standing`;
    const desk = x.desk > 0 ? `, ${x.desk} of them at the desk` : '';
    if (ctx.activity.readable === false) return row('stand', [title(x.name), sub(`${count}, ${stood}${desk}`), sub(ACTIVITY_UNAVAILABLE)]);
    const live = ctx.stand.find((s) => s.id === x.id);
    const sat = live?.satMinutes ?? x.sitting;
    const now = live?.phase === 'standing' && live.standLeft !== null ? `standing now, ${live.standLeft} min left` : live?.deskLeft != null ? `standing at the desk, stand logged in ${live.deskLeft} min` : live?.phase === 'due' ? 'time to stand' : sat !== null && sat !== undefined && (live?.inHours ?? true) ? `sitting ${Math.round(sat)} of ${x.sitMinutes} min now` : live && !live.inHours ? 'outside its hours' : null;
    return row('stand', [
      title(x.name, () => ctx.onOpen(`standup:${x.id}`), tip(x.name, 'Ask me now: the card on the next step')),
      sub(`${count}, ${stood}${desk}${now ? ` · ${now}` : ''}`),
      // The stretch's bar, only while sitting counts (its hours), as the line above says it.
      sat !== null && sat !== undefined && (live?.inHours ?? true) ? h('div', { class: 'pv-sit-bar', 'data-tip': tip('This stretch', `${Math.round(sat)} min of active sitting`, `A stand-up card at ${x.sitMinutes} min`) }, h('i', { style: `width:${Math.min(100, (sat / Math.max(1, x.sitMinutes)) * 100)}%` })) : null,
    ]);
  });
}

function deskRows(d: DueToday, ctx: DueTodayContext): HTMLElement[] {
  return d.desk.map((x) => row('monitor', [
    title(x.name, () => ctx.onOpen(`desk:${x.id}`), tip(x.name, 'Opens the routine')),
    sub(`${x.done} of ${x.total} done${x.next ? ` · next at ${x.next}` : x.done >= x.total ? '' : ' · no more today'}`),
    h('div', { class: 'pv-due-pips' }, x.times.map((t, i) => h('i', { class: i < x.done ? 'is-done' : t === x.next ? 'is-next' : '', 'data-tip': tip(`Desk break ${i + 1} of ${x.total}`, `${t}${i < x.done ? ', done' : t === x.next ? ', next' : ''}`) }))),
  ], h('span', { class: 'pv-due-at' }, x.next ?? '')));
}

function bodyDueRows(d: DueToday, ctx: DueTodayContext): HTMLElement[] {
  return d.body.filter((b) => b.due).map((b) => row(BODY_ICON[b.part], [
    title(BODY_TITLE[b.part], () => ctx.onOpen(b.part), tip(BODY_TITLE[b.part], 'Opens its form')),
    sub(`${b.nextDate && b.nextDate < d.date ? `Due since ${fmt.wd(b.nextDate)}` : 'Due today'} · ${b.text.toLowerCase()}${b.source === 'plan' ? ', from your plan' : ''}`),
  ], h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onOpen(b.part), 'data-k': `due-${b.part}` }, 'Open')));
}

function trainRow(d: DueToday, ctx: DueTodayContext): HTMLElement | null {
  if (!d.train.needed || d.now < d.train.at) return null;
  return row('dumbbell', [title('Did you train today?', () => ctx.onOpen('train')), sub('Nothing logged, ticked or marked rest yet')], h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onOpen('train'), 'data-k': 'due-train' }, 'Answer'));
}

const PHONE_KIND = { session: 'Session', tick: 'Ticks', amount: 'Amount', morning: 'Morning check-in', trained: 'Did you train today?' } as const;

/** "1 phone entry needs a look", with what the first one was, its day and its reason; the Data notes list each with its file. */
function phoneRow(ctx: DueTodayContext): HTMLElement | null {
  const r = ctx.phone ?? [];
  if (!r.length) return null;
  const first = r[0]!;
  const what = [first.kind ? PHONE_KIND[first.kind] : 'An entry', first.date ? fmt.wd(first.date) : null].filter(Boolean).join(', ');
  return row('phone', [
    h('b', { 'data-tip': tip('From the phone', `Each refused entry stays in ${paths().inbox} and is tried again on every refresh`, 'Fix what it clashes with, or delete its file; Data notes at the foot of Today lists each one') }, `${r.length} phone ${r.length === 1 ? 'entry needs' : 'entries need'} a look`),
    sub(`${what}: ${first.reason}${r.length > 1 ? ` (and ${r.length - 1} more in Data notes)` : ''}`),
  ], null, true);
}

function comingUp(d: DueToday, ctx: DueTodayContext): HTMLElement {
  const rows: Child[] = [];
  for (const b of d.body.filter((x) => !x.due && x.nextDate)) {
    rows.push(h('button', { class: 'pv-due-c', onclick: () => ctx.onOpen(b.part), 'data-tip': tip(BODY_NAME[b.part], `${b.text}${b.source === 'plan' ? ', from your plan' : ', set on the Check-in screen'}`, 'Opens its form') },
      icon(BODY_ICON[b.part]), h('span', {}, BODY_NAME[b.part]), h('b', {}, fmt.wd(b.nextDate!)), h('em', {}, inDaysText(d.date, b.nextDate!))));
  }
  const sun = sundayOf(d.date);
  const first = ctx.coachFirst ?? null;
  rows.push(h('div', { class: 'pv-due-c', 'data-tip': tip('Sunday check-in', ctx.sundayDone ? 'Saved for this week' : 'Opens on Sunday morning, built from your log', first ? `Then ask the coach: ${first.command}` : null) }, icon('review'), h('span', {}, 'Sunday check-in'), h('b', {}, fmt.wd(sun)), h('em', {}, ctx.sundayDone ? 'saved' : inDaysText(d.date, sun)),
    first ? h('span', { class: 'pv-due-c-then', 'data-coach': 'answer-first' }, first.line, ' ', commandChip(first.command)) : null));
  if (!(d.train.needed && d.now >= d.train.at)) {
    rows.push(h('div', { class: 'pv-due-c', 'data-tip': tip('Did you train today?', d.train.on ? `A card at ${d.train.at} only when nothing is logged by then` : 'Off in the Settings tab', d.train.on ? (d.train.needed ? 'Due later today' : 'Not today: a session is logged, ticked or marked, or none was planned') : '') },
      icon('dumbbell'), h('span', {}, 'Did you train?'), h('b', {}, d.train.at), h('em', {}, !d.train.on ? 'off' : d.train.needed ? 'if needed' : 'not needed')));
  }
  return h('div', { class: 'pv-due-coming' }, h('div', { class: 'pv-due-h' }, 'Coming up'), rows);
}

/** The Due today card. */
export function dueTodayCard(ctx: DueTodayContext): HTMLElement {
  const d = ctx.due;
  const rows = [
    phoneRow(ctx),
    morningRow(d, ctx),
    ...bodyDueRows(d, ctx),
    habitsRow(d, ctx),
    ...amountRows(d, ctx),
    ...sittingRows(d, ctx),
    ...standRows(d, ctx),
    ...deskRows(d, ctx),
    trainRow(d, ctx),
  ].filter((x): x is HTMLElement => x !== null);
  const nothing = !ctx.items.length;
  return h('section', { class: 'pv-card pv-due', 'data-live': 'due', 'data-sec': 'due' },
    h('div', { class: 'pv-card-head' },
      h('div', {}, h('div', { class: 'pv-kicker' }, 'Due today'), h('div', { class: 'pv-card-sub' }, `${d.now} · what you track, and the coach’s check-ins`)),
      h('div', { class: 'pv-card-tools' },
        h('button', { class: 'pv-icon-btn', onclick: () => ctx.onHabits(), 'aria-label': 'Habits', 'data-tip': tip('Habits', 'What you track: add, change or pause') }, icon('pencil')),
        ctx.onSettings ? h('button', { class: 'pv-icon-btn', onclick: () => ctx.onSettings!(), 'aria-label': 'Reminder settings', 'data-tip': tip('Reminder settings', 'On or off, this Mac, notifications, snooze, quiet hours, sync') }, icon('settings')) : null,
      ),
    ),
    rows.length ? h('ul', { class: 'pv-due-list' }, rows) : null,
    nothing ? h('p', { class: 'pv-calm' }, icon('info'), h('span', {}, 'Nothing tracked yet. Add what you want reminded in ', h('button', { class: 'pv-link-btn', onclick: () => ctx.onHabits() }, 'Progress, Habits'), '.')) : null,
    comingUp(d, ctx),
  );
}
