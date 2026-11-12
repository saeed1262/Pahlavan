// The Pahlavan view: a tab with the section tabs (Home, Today, Progress,
// Plan, Check-in, Food, Movements) and their screens. The clock, the hour and the body's classes
// come in through `ViewDeps`, so the static preview can drive the same view.

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { PAHLAVAN_ICON_ID } from './brand-icon.ts';
import { sessionKey } from '../../src/adapters/vault/log-write.ts';
import type { SessionMode } from '../../src/core/variant.ts';
import { customLogForm, logFormFor, logFormFromEntry, soreChanges, withSwaps, type LogForm } from '../../src/report/log-form.ts';
import { isDeloadDate } from '../../src/adapters/vault/log-write.ts';
import { checkinWeek, tapeDay } from '../../src/report/banners.ts';
import type { DueToday } from '../../src/core/nudges.ts';
import type { BodyRecordSchedule, MorningReminder, TrackedItem } from '../../src/core/schema.ts';
import type { TrackingOp } from '../../src/adapters/vault/tracking-write.ts';
import { acceptOps, bodyScheduleOps, bringOverOps, dismissOps, formFromItem, itemFromForm, morningOps, newForm, pausedItem, resumedItem, saveOps } from '../../src/report/item-form.ts';
import { planLinks, checklistTargets, choiceFromChecklist, chosenChecklist, dashboardReminders, dashChecklist, followChoice, guideFor, planText, recentSessions, recordsIn, sessionsThisMonth, todayChecklistOf, toggledChecklist } from '../../src/report/dashboard.ts';
import type { CheckinWriter } from './checkin-writer.ts';
import type { CheckinModel, FoodModel, HabitsModel, PahlavanData, ProgressModel, ProgressMoreModel, SessionModel, TodayModel } from './data-source.ts';
import type { LogWriter } from './log-writer.ts';
import type { Reminders } from './reminders/machine.ts';
import { applyPatternChecks, refreshCheckinState, renderCheckin, type CheckinState } from './ui/checkin.ts';
import { freshPanelState, previewEntry, renderLogPanel, type LogPanelState } from './ui/log-panel.ts';
import { phaseNow, type PhaseId } from './phase.ts';
import { rebuildForm } from './log-rebuild.ts';
import { choosePick, chooseSwap, pickFor, swapsFor } from './pick.ts';
import type { Scope } from '../../src/core/cycle.ts';
import { logFrom } from '../../src/report/cycle.ts';
import { logTracking, progressScope, setLogTracking, setProgressScope, type DeviceStore, type PahlavanSettings, type Section } from './settings.ts';
import { h, icon, placeFixed } from './ui/dom.ts';
import { clean, fmt, weekOfText } from './ui/format.ts';
import { renderPlan, type PlanModel } from './ui/plan.ts';
import { renderProgress, type VolumeView } from './ui/progress.ts';
import { photoSetDates, POSES, renderMore, sectionNav, type MoreContext, type PhotoFiles } from './ui/progress-more.ts';
import { keepPlace } from './ui/scroll.ts';
import { renderToday, weekRing } from './ui/today.ts';
import { homeMove, renderHome } from './ui/home.ts';
import { buildHome, type HomeGo } from '../../src/report/home.ts';
import type { TrackingWriter } from './tracking-writer.ts';
import type { BodyRecordUi, MorningBellUi } from './ui/body-record.ts';
import { dueTodayCard, sittingBar } from './ui/due-today.ts';
import { renderHabits, todayCard, type HabitsContext, type HabitsUi } from './ui/habits.ts';
import { renderFood } from './ui/food.ts';
import { freshMovementsUi, renderMovements, type MovementsUi } from './ui/movements.ts';
import { checksPrefill, type PatternCheck } from '../../src/report/food.ts';
import { attachTooltip } from './ui/tooltip.ts';
import { lightWords } from './ui/terms.ts';
import { helpMenu, tipBubble, welcomeCard } from './ui/help.ts';
import { applyHelp, earlyVisit, FRESH_HELP, nextTip, panelOpen, sectionFolded, TIPS, type GlanceTab, type HelpChange, type HelpState, type HelpStore, type TipId } from './help.ts';
import { checkinGlance, foodGlance, moreSections, overviewSections, planGlance, PROGRESS_VIEWS, progressSums, todayGlance, type Glance } from '../../src/report/glance.ts';
import { strengthChange } from '../../src/report/banners.ts';
import { flash, foldCard, glancePanel, type PanelRow } from './ui/glance.ts';
import { targetRows } from './ui/plan.ts';
import { bodyFmt } from './ui/units.ts';
import { welcomeSteps } from '../../src/report/welcome.ts';
import { bodyUnitsOf, type BodyUnits } from '../../src/core/units.ts';
import { COACH_COMMANDS } from '../../src/core/coach-steps.ts';
import type { Result } from '../../src/core/reason.ts';
import { yourDay, type YourDay } from '../../src/report/your-day.ts';
import { yourDayStrip } from './ui/your-day.ts';
import { nodeOk, type CoachState, type SetupResult } from './coach-setup.ts';
import type { CoachVersion } from '../../src/core/version.ts';
import { paths } from '../../src/adapters/vault/layout.ts';

export const VIEW_TYPE = 'pahlavan-view';

// The view's stored state and its defaults live with the rest of the settings.
export { DEFAULT_SETTINGS, type PahlavanSettings, type Section } from './settings.ts';

export interface ViewDeps {
  data: PahlavanData;
  settings: PahlavanSettings;
  saveSettings(): void;
  /** The coach skill (the welcome card's first step, and Home's "Update the coach"): where it stands, and setting it up. */
  coach?: { state(): Promise<CoachState & { node: { path: string; version: string } | null }>; setUp(): Promise<SetupResult> };
  /** Today's local date, YYYY-MM-DD: the only clock the view reads. */
  today(): string;
  hour(): number;
  /** Now, as minutes since local midnight (the Sunday check-in's protein question: is today's tick still ahead?); absent: the whole day counts. */
  minutes?: () => number;
  bodyClasses(): DOMTokenList;
  /** The writer for the fitness files (null: read-only, as in a preview without one). */
  writer: LogWriter | null;
  /** A short message (Obsidian's Notice). */
  notify(message: string): void;
  /** Re-read soon: the plugin's debounced reload, the same one the file watcher triggers. */
  requestReload(): void;
  /** A vault image's URL (Obsidian's resource path); absent in the preview, which draws placeholders. */
  resourcePath?: (path: string) => string;
  /** The writer for the check-ins (body-data.json's morning fields, Coach/checkins.json); null: read-only. */
  checkinWriter?: CheckinWriter | null;
  /** Opens a vault note in a tab (the letter, the plan's notes, the session history); absent in the preview. */
  openNote?: (path: string) => void;
  /** Now, as an ISO timestamp (the morning check-in's checkedAt, as Habit Nudges writes it). */
  nowIso?: () => string;
  /** Copies text to the clipboard (absent: copying is not offered). */
  copy?: (text: string) => Promise<void>;
  /**
   * The reminder machinery (absent in a preview without it): what is due
   * today, ticks and amounts from a screen, a card by its key, the stand-up
   * counts, sitting today and "Standing now". Due today and the Habits
   * section use it.
   */
  reminders?: Reminders | null;
  /** The writer for what is tracked (Coach/tracking.json: item edits, suggestions, the bring-over, the morning time, the body-record schedule); null: read-only. */
  trackingWriter?: TrackingWriter | null;
  /** The local zone, minutes east of UTC (the work timer's desk-time history in the Habits stats). */
  offsetMinutes?: () => number;
  /** Opens Obsidian's settings on Pahlavan's tab (Due today's gear); absent: not offered. */
  openSettings?: () => void;
  /** A moment as local HH:MM (Due today's "standing since"). */
  clockText?: (ms: number) => string;
  /** The help's memory (Coach/help.json: the tips seen, the welcome card hidden); absent: no tips, the welcome card can't hide. */
  help?: HelpStore | null;
  /** Opens the user guide (the vault note when it exists, else the published page); absent: not offered. */
  openGuide?: () => void;
  /** This vault's local storage on this Mac (the Log panel's last tracking); absent: a new log starts Standard unless the profile asks for every set. */
  device?: DeviceStore;
}

const SECTIONS: readonly { id: Section; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'today', label: 'Today', icon: 'sun' },
  { id: 'progress', label: 'Progress', icon: 'trend' },
  { id: 'plan', label: 'Plan', icon: 'layers' },
  { id: 'checkin', label: 'Check-in', icon: 'clipboard' },
  { id: 'food', label: 'Food', icon: 'bowl' },
  { id: 'movements', label: 'Movements', icon: 'dumbbell' },
];

export class PahlavanView extends ItemView {
  private model: TodayModel | null = null;
  private session: SessionModel | null = null;
  private date = '';
  private phase: { id: PhaseId; isfahan: boolean } = { id: 'workday', isfahan: false };
  /** Which Why panels are expanded. (Not `open`: that name is View.open(), which Obsidian calls to start the view.) */
  private openWhy = new Set<string>();
  private page: HTMLElement | null = null;
  private meta: HTMLElement | null = null;
  private failure: string | null = null;
  /** Progress from the cycle start (every view's default range). */
  private progressModel: ProgressModel | null = null;
  /** Progress over everything on record, for a view switched to All: built on first use after each read. */
  private allModels: { progress: ProgressModel | null; more: ProgressMoreModel | null } | null = null;
  /** The body map's range, and which Progress cards show their table. */
  private volumeView: VolumeView = 'week';
  private progressTables = new Set<string>();
  /** The rest of Progress: its report, its controls and the photo files found. */
  private moreModel: ProgressMoreModel | null = null;
  private moreUi: { sessionsView: 'weeks' | 'months'; health: 'rhr' | 'sleep' | 'steps'; photo: MoreContext['photo'] } = { sessionsView: 'weeks', health: 'rhr', photo: { a: null, b: null, pose: 'front', mode: 'slider', pos: 50, opacity: 55 } };
  private photoFiles: PhotoFiles | null = null;
  private lastWidth = 0;
  /** The Log panel: its layer over the view, the form it edits and its state. */
  private logLayer: HTMLElement | null = null;
  private logForm: LogForm | null = null;
  private logState: LogPanelState = freshPanelState();
  /** Which movement guides are open (Today, the Log panel, the Plan, Skills), kept across redraws. */
  private openGuides = new Set<string>();
  /** The Check-in screen: its report and the answers being edited. */
  private checkinModel: CheckinModel | null = null;
  private checkinState: CheckinState | null = null;
  /** Due today from the reminder machinery (this Mac's counts), the latest fetch, and the items with a write on the way. */
  private dueModel: DueToday | null = null;
  private dueSeq = 0;
  private dueTimer: number | null = null;
  private duePending = new Set<string>();
  /** The Habits section: its report and its state (the form, the toggles), kept across redraws. */
  private habitsModel: HabitsModel | null = null;
  private habitsUi: HabitsUi | null = null;
  /** Check-in's Body record card and the morning card's reminder time. */
  private bodyUi: BodyRecordUi = { edit: false, busy: false, error: null };
  private bellUi: MorningBellUi = { open: false, on: true, at: '07:30', busy: false };
  /** The Food tab: its report, which of its cards show their table, a protein tick on its way, and how far each meal's idea was stepped today (never saved). */
  private foodModel: FoodModel | null = null;
  private foodTables = new Set<string>();
  private foodBusy = false;
  private ideas: { date: string; steps: Record<string, number> } = { date: '', steps: {} };
  /** The help: its state as last read, the tip bubble on screen, and whether the next tip scrolls into view. */
  private helpState: HelpState | null = null;
  /** The coach skill's state for the welcome card and Home, once looked up (null: not yet). */
  private coachStatus: { state: 'missing' | 'old' | 'newer' | 'ok'; node: boolean; direction: CoachVersion; installed: string | null; bundled: string } | null = null;
  private coachAsked = false;
  private tipEl: HTMLElement | null = null;
  private tipScroll = false;
  /** At a glance: whether this visit to each tab is one of its first (the panel starts open), the first read's visit counted, and the changes to Coach/help.json on their way. */
  private early: Partial<Record<GlanceTab, boolean>> = {};
  private visited = false;
  private helpPending: HelpChange[] = [];
  /** The Plan as last drawn (its At a glance reads it). */
  private planModel: PlanModel | null = null;
  /** The Movements tab: the search, the filters and the open guides, kept across redraws (never saved). */
  private movesUi: MovementsUi = freshMovementsUi();

  private readonly deps: ViewDeps;

  constructor(leaf: WorkspaceLeaf, deps: ViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  override getViewType(): string {
    return VIEW_TYPE;
  }

  override getDisplayText(): string {
    return 'Pahlavan';
  }

  override getIcon(): string {
    return PAHLAVAN_ICON_ID;
  }

  override async onOpen(): Promise<void> {
    try {
      await this.openView();
    } catch (e) {
      this.showError('Pahlavan could not open', e);
    }
  }

  /** Puts an error in the tab itself, so a failure is visible without the developer console. */
  private showError(title: string, e: unknown, target: HTMLElement = this.contentEl): void {
    console.error(`[Pahlavan] ${title}`, e);
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const stack = e instanceof Error && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : '';
    const box = activeDocument.createElement('div');
    box.className = 'pv-error';
    box.textContent = `${title}\n\n${msg}${stack ? `\n\n${stack}` : ''}`;
    target.replaceChildren(box);
  }

  /** The photo compare's keys, as the dashboard's: ← → step the After set, 1 to 4 pick the pose. */
  private photoKey(ev: KeyboardEvent): void {
    if (this.deps.settings.lastTab !== 'progress' || (this.deps.settings.progressSection ?? 'overview') !== 'body' || this.logForm) return;
    const target = ev.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const body = this.modelsFor(this.progressRange()).more?.body;
    // Only while this view is on screen and nothing else (an editor in another pane) has the focus.
    const active = this.contentEl.ownerDocument.activeElement;
    const ours = active === this.contentEl.ownerDocument.body || this.contentEl.contains(active);
    if (!body || !ours || this.contentEl.offsetParent === null) return;
    const dates = photoSetDates(body.photos, inRange(this.photoFiles ?? {}, body.cycleStart));
    if (dates.length < 2) return;
    const P = this.moreUi.photo;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      const cur = dates.indexOf(P.b ?? dates.at(-1)!);
      const next = Math.max(0, Math.min(dates.length - 1, (cur < 0 ? dates.length - 1 : cur) + (ev.key === 'ArrowLeft' ? -1 : 1)));
      P.b = dates[next]!;
    } else if (/^[1-4]$/.test(ev.key)) P.pose = POSES[Number(ev.key) - 1]![0];
    else return;
    ev.preventDefault();
    this.render();
  }

  private async openView(): Promise<void> {
    const root = this.contentEl;
    root.replaceChildren();
    root.classList.add('pahlavan-view');
    const tabs = h('nav', { class: 'pv-sections', 'aria-label': 'Sections' },
      SECTIONS.map((s) => h('button', { class: s.id === this.deps.settings.lastTab ? 'is-on' : '', 'data-section': s.id, onclick: () => this.show(s.id) }, icon(s.icon), s.label)),
    );
    this.meta = h('div', { class: 'pv-top-meta' });
    this.page = h('div', { class: 'pv-page' });
    // The "?" at the right of the tab bar, before the week and the date.
    // Your routine is built when it opens, from the files as last read; "Did you train?" at the machinery's time.
    const help = helpMenu({ onGuide: () => this.openGuide(), onTips: () => void this.resetTips(), routine: () => this.deps.data.routine(this.date, this.dueModel ? { on: this.dueModel.train.on, at: this.dueModel.train.at } : undefined) });
    root.append(h('div', { class: 'pv' }, h('div', { class: 'pv-top' }, tabs, h('div', { class: 'pv-top-r' }, help, this.meta)), this.page));
    this.register(attachTooltip(root));
    this.registerDomEvent(activeDocument, 'keydown', (ev: KeyboardEvent) => this.photoKey(ev));

    this.phase = phaseNow(this.deps.bodyClasses(), this.deps.hour());
    const observer = new MutationObserver(() => this.syncPhase());
    observer.observe(activeDocument.body, { attributes: true, attributeFilter: ['class'] });
    this.register(() => observer.disconnect());
    this.registerInterval(window.setInterval(() => this.tick(), 60_000));
    // The reminder machinery's changes (a count, a write, Standing now, sitting every 30 s) patch Due today
    // and today's reminders in place; sitting.json is not a watched file, so it never reloads the screen.
    const rem = this.deps.reminders;
    if (rem) this.register(rem.onChange(() => this.dueChanged()));
    await this.reload();
  }

  override async onClose(): Promise<void> {
    this.contentEl.replaceChildren();
  }

  /** Reads the source files again and redraws (the plugin calls this when one changes). */
  async reload(): Promise<void> {
    this.date = this.deps.today();
    if (this.deps.settings.pick && pickFor(this.deps.settings.pick, this.date) === null) {
      // Yesterday's pick: the day moved on, so the rotation's suggestion is back.
      this.deps.settings.pick = null;
      this.deps.saveSettings();
    }
    try {
      await this.deps.data.load(this.date);
      this.model = await this.deps.data.today(this.date, this.mode(), { type: this.pickedType() });
      this.session = this.model.session;
      this.progressModel = await this.deps.data.progress(this.date, 'cycle');
      this.moreModel = this.deps.data.progressMore(this.date, 'cycle');
      this.allModels = null;
      this.checkinModel = this.deps.data.checkin(this.date, this.deps.minutes ? { minutes: this.deps.minutes() } : {});
      this.checkinState = this.checkinModel ? refreshCheckinState(this.checkinState, this.checkinModel) : null;
      this.habitsModel = this.deps.data.habits(this.date, { offsetMinutes: this.deps.offsetMinutes?.() ?? 0 });
      this.foodModel = this.deps.data.food(this.date, { type: this.pickedType() });
      this.dueModel = await this.fetchDue(true);
      // A re-read keeps the help's changes still on their way; without the store, the screens' memory lives here.
      if (this.deps.help) this.helpState = this.helpPending.reduce(applyHelp, await this.deps.help.read());
      if (!this.visited) {
        this.visited = true;
        this.countVisit(this.deps.settings.lastTab);
      }
      this.photoFiles = null;
      this.failure = null;
    } catch (e) {
      this.model = null;
      this.progressModel = null;
      this.failure = e instanceof Error ? e.message : String(e);
    }
    this.render();
  }

  /** Obsidian calls this when the pane changes size: the Progress charts are laid out for its width. */
  override onResize(): void {
    this.placeLog();
    const w = this.page?.clientWidth ?? 0;
    if ((this.deps.settings.lastTab === 'progress' || this.deps.settings.lastTab === 'plan' || this.deps.settings.lastTab === 'food') && w && Math.abs(w - this.lastWidth) > 8) this.render();
  }

  /** Switches to a screen (also from the Settings tab's links). */
  showSection(section: Section): void {
    this.show(section);
  }

  /** Today with the Log panel open on today's session ("Log session" on "Did you train today?"). */
  async startLog(): Promise<void> {
    if (this.deps.settings.lastTab !== 'today') this.show('today');
    if (!this.session || this.date !== this.deps.today()) await this.reload();
    await this.openLog();
  }

  private show(section: Section): void {
    const moved = section !== this.deps.settings.lastTab;
    if (moved) this.countVisit(section);
    if (moved && section === 'home') this.homeIntro = true;
    this.deps.settings.lastTab = section;
    this.deps.saveSettings();
    this.contentEl.querySelectorAll('.pv-sections button').forEach((b) => b.classList.toggle('is-on', b.getAttribute('data-section') === section));
    // Another tab starts at the top (the redraws keep their place, so they would carry this tab's over).
    if (moved) this.contentEl.scrollTop = 0;
    this.render();
  }

  private render(): void {
    this.draw();
    this.drawGlance();
    this.placeTip();
  }

  private draw(): void {
    if (!this.page) return;
    const section = this.deps.settings.lastTab;
    const w = this.model?.review?.week;
    this.meta?.replaceChildren(...(w?.planWeek ? [h('span', {}, weekOfText(w.planWeek, w.planWeeks)), h('span', { class: 'dot' }), h('span', {}, fmt.wd(this.date))] : [h('span', {}, fmt.wd(this.date))]));
    if (section === 'home') {
      if (!this.model) {
        this.page.replaceChildren(h('div', { class: 'pv-placeholder' }, h('div', { class: 'pv-kicker' }, 'Pahlavan'), h('h1', { class: 'pv-serif-title' }, 'Home'), h('p', {}, this.failure ? `The fitness files could not be read: ${this.failure}` : 'Reading the fitness files…')));
        return;
      }
      try {
        keepPlace(this.contentEl, this.page, () => this.drawHome());
      } catch (e) {
        this.showError('The Home tab could not be drawn', e, this.page);
      }
      return;
    }
    if (section === 'progress') {
      if (!this.progressModel) {
        this.page.replaceChildren(h('div', { class: 'pv-placeholder' }, h('div', { class: 'pv-kicker' }, 'Pahlavan'), h('h1', { class: 'pv-serif-title' }, 'Progress'), h('p', {}, this.failure ? `The fitness files could not be read: ${this.failure}` : 'Reading the fitness files\u2026')));
        return;
      }
      try {
        // The scroll position and the focused control survive the redraw (the Habits form is far down the page).
        const top = this.contentEl.scrollTop;
        const focused = (this.contentEl.ownerDocument.activeElement as HTMLElement | null)?.getAttribute?.('data-k') ?? null;
        this.drawProgress();
        this.contentEl.scrollTop = top;
        if (focused) this.page.querySelector<HTMLElement>(`[data-k="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
      } catch (e) {
        this.showError('The Progress screen could not be drawn', e, this.page);
      }
      return;
    }
    if (section === 'plan') {
      const pm = this.model ? this.deps.data.plan(this.date) : null;
      this.planModel = pm;
      if (!pm) {
        this.page.replaceChildren(h('div', { class: 'pv-placeholder' }, h('div', { class: 'pv-kicker' }, 'Pahlavan'), h('h1', { class: 'pv-serif-title' }, 'Plan'), h('p', {}, this.failure ? `The fitness files could not be read: ${this.failure}` : 'Reading the fitness files…')));
        return;
      }
      try {
        this.lastWidth = this.page.clientWidth;
        const raw = this.deps.data.current?.raw;
        // The scroll position survives the redraw (a guide, a Why or a table opened far down).
        const page = this.page;
        keepPlace(this.contentEl, page, () => renderPlan(page, pm, {
          view: this.volumeView,
          ...(this.deps.copy ? { onCopy: (text: string) => this.copyCommand(text) } : {}),
          tables: this.progressTables,
          units: this.bodyUnits(),
          onView: () => {},
          onTable: (id) => { if (this.progressTables.has(id)) this.progressTables.delete(id); else this.progressTables.add(id); this.render(); },
          guide: (name) => guideFor(raw?.plan, raw?.log, name),
          openGuides: this.openGuides,
          onToggleGuide: (key) => { if (this.openGuides.has(key)) this.openGuides.delete(key); else this.openGuides.add(key); this.render(); },
          links: planLinks(this.deps.data.fitnessFiles),
          ...(this.deps.openNote ? { onOpenNote: this.deps.openNote } : {}),
          onBrowse: () => this.show('movements'),
          hero: { phase: this.phase, phaseOf: this.model?.phase ?? null, weekTarget: this.model?.review?.adherence.value.target ?? null },
          desk: (() => {
            const dm = this.deps.data.deskCard(this.date);
            return dm ? { model: dm, onChange: (id: string | null) => this.openHabitsEditor(id, 'desk') } : null;
          })(),
          openWhy: this.openWhy,
          onToggleWhy: (key) => { if (this.openWhy.has(key)) this.openWhy.delete(key); else this.openWhy.add(key); this.render(); },
          folded: (() => {
            const g = this.glanceOf('plan');
            return (id: string) => {
              const sp = g?.glance.sections.find((x) => x.id === id);
              return sp ? sectionFolded(this.helpState, 'plan', sp, this.date) : false;
            };
          })(),
        }));
      } catch (e) {
        this.showError('The Plan screen could not be drawn', e, this.page);
      }
      return;
    }
    if (section === 'food') {
      if (!this.foodModel) {
        this.page.replaceChildren(h('div', { class: 'pv-placeholder' }, h('div', { class: 'pv-kicker' }, 'Pahlavan'), h('h1', { class: 'pv-serif-title' }, 'Food'), h('p', {}, this.failure ? `The fitness files could not be read: ${this.failure}` : 'Reading the fitness files…')));
        return;
      }
      try {
        this.drawFood();
      } catch (e) {
        this.showError('The Food tab could not be drawn', e, this.page);
      }
      return;
    }
    if (section === 'movements') {
      // The catalogue is the engine's own, so the tab draws before the files are read; the plan's marks follow the read.
      try {
        keepPlace(this.contentEl, this.page, () => this.drawMovements());
        this.revealMovement();
      } catch (e) {
        this.showError('The Movements tab could not be drawn', e, this.page);
      }
      return;
    }
    if (section === 'checkin') {
      if (!this.checkinModel || !this.checkinState) {
        this.page.replaceChildren(h('div', { class: 'pv-placeholder' }, h('div', { class: 'pv-kicker' }, 'Pahlavan'), h('h1', { class: 'pv-serif-title' }, 'Check-in'), h('p', {}, this.failure ? `The fitness files could not be read: ${this.failure}` : 'Reading the fitness files…')));
        return;
      }
      try {
        this.drawCheckin();
      } catch (e) {
        this.showError('The Check-in screen could not be drawn', e, this.page);
      }
      return;
    }
    if (!this.model) {
      this.page.replaceChildren(h('div', { class: 'pv-placeholder' }, h('div', { class: 'pv-kicker' }, 'Pahlavan'), h('h1', { class: 'pv-serif-title' }, 'Today'), h('p', {}, this.failure ? `The fitness files could not be read: ${this.failure}` : 'Reading the fitness files…')));
      return;
    }
    try {
      // The scroll position survives the redraw (a guide, a Why or a tick far down the session).
      keepPlace(this.contentEl, this.page, () => this.drawToday());
    } catch (e) {
      this.showError('The Today screen could not be drawn', e, this.page);
    }
  }

  /** Home: the overview from the reports already loaded; each part opens its tab. */
  /** Home's next draw is its first since it opened (the view, or a switch to Home): its cards rise in once. */
  private homeIntro = true;

  private drawHome(): void {
    if (!this.page || !this.model) return;
    const read = this.deps.data.current;
    if (!read) return;
    const due = this.dueModel && this.dueModel.date === this.date ? this.dueModel : null;
    const items = this.deps.data.tracking?.tracking?.items ?? [];
    this.lookAtCoach();
    const c = this.coachStatus;
    const coach = c ? { direction: c.direction, installed: c.installed, bundled: c.bundled } : null;
    const home = buildHome({ read, today: this.model, session: this.session, progress: this.progressModel, due, food: this.foodModel, day: this.yourDayModel()?.value ?? null, items, coach });
    const r = this.model.review;
    renderHome(this.page, home, this.model, {
      phase: this.phase,
      ring: r ? weekRing(this.model, r) : null,
      onLog: () => void this.openLog(),
      onGo: (go) => this.homeGo(go),
      welcome: this.welcomeEl(),
      intro: this.homeIntro,
    });
    this.homeIntro = false;
  }

  /** Where a part of Home leads: its tab, a Progress view, Today's Due today, the morning card, or Pahlavan's settings. */
  private homeGo(go: HomeGo): void {
    homeMove(go, {
      tab: (section) => this.show(section),
      due: () => {
        this.show('today');
        this.goToSection('today', 'due');
      },
      // The morning card through the machinery; without it, the Check-in screen holds the same questions.
      morning: () => (this.deps.reminders ? void this.openDueKey('morning') : this.show('checkin')),
      progress: (view) => {
        this.deps.settings.progressSection = view;
        this.show('progress');
      },
      ...(this.deps.openSettings ? { settings: this.deps.openSettings } : {}),
      notify: (message) => this.deps.notify(message),
    });
  }

  /** The Food tab; the scroll position survives the redraw (a tick, a table switch). */
  private drawFood(): void {
    if (!this.page || !this.foodModel) return;
    const top = this.contentEl.scrollTop;
    this.lastWidth = this.page.clientWidth;
    const w = this.model?.review?.week;
    const item = this.foodModel.plan ? this.foodModel.protein?.item ?? null : null;
    const rem = this.deps.reminders;
    renderFood(this.page, this.foodModel, {
      phase: this.phase,
      planWeek: w?.planWeek ?? null,
      phaseOf: this.model?.phase ?? null,
      width: this.page.clientWidth,
      tables: this.foodTables,
      onTable: (id) => {
        if (this.foodTables.has(id)) this.foodTables.delete(id);
        else this.foodTables.add(id);
        this.render();
      },
      ...(rem && item ? { onTick: (done: boolean) => void this.foodTick(item.id, done) } : {}),
      tickBusy: this.foodBusy,
      ...(this.deps.copy ? { onCopy: () => void this.deps.copy!('/fitness-coach diet').then(() => this.deps.notify('Copied: /fitness-coach diet'), () => this.deps.notify('Couldn’t copy the command')) } : {}),
      checks: this.helpState?.foodChecks?.[this.date] ?? {},
      ...(this.deps.help ? { onCheck: (id: string, slot: number) => void this.foodCheck(id, slot) } : {}),
      ideaSteps: this.ideaSteps(),
      onIdea: (meal) => {
        const st = this.ideaSteps();
        st[meal] = (st[meal] ?? 0) + 1;
        this.render();
      },
    });
    this.contentEl.scrollTop = top;
  }

  /** The Movements tab, for the search and filters as they stand. */
  private drawMovements(): void {
    if (!this.page) return;
    const ui = this.movesUi;
    renderMovements(this.page, this.deps.data.movements(ui.query), { ui, build: (q) => this.deps.data.movements(q), onChange: () => this.render() });
    // A redraw while typing (a file changed) puts the focus back in the box: the caret goes to the end, where it was.
    const box = this.page.querySelector<HTMLInputElement>('[data-k="mv-search"]');
    if (box && box.ownerDocument.activeElement === box) box.setSelectionRange?.(box.value.length, box.value.length);
  }

  /** A step followed on the Movements tab: its row comes to the top and lights up once. */
  private revealMovement(): void {
    const id = this.movesUi.reveal;
    if (!id || !this.page) return;
    this.movesUi.reveal = null;
    const row = this.page.querySelector<HTMLElement>(`[data-mv-id="${CSS.escape(id)}"]`);
    if (!row) return;
    row.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    flash(row);
  }

  /** Each meal's ideas stepped on today, in this session only: a new day starts from the day's own. */
  private ideaSteps(): Record<string, number> {
    if (this.ideas.date !== this.date) this.ideas = { date: this.date, steps: {} };
    return this.ideas.steps;
  }

  /** A light check's slot from the Food tab: shown at once, then kept in Coach/help.json (it pre-fills Sunday's pattern question; never a score). */
  private async foodCheck(id: string, slot: number): Promise<void> {
    const st = this.helpState;
    if (!st || !this.deps.help) return;
    const on = !(st.foodChecks?.[this.date]?.[id] ?? []).includes(slot);
    await this.helpNow({ op: 'check', date: this.date, id, slot, on });
  }

  /** Today's protein tick from the Food tab: through the reminders' tickItem (Coach/tracking.json and the linked habit), then a re-read. */
  private async foodTick(id: string, done: boolean): Promise<void> {
    const rem = this.deps.reminders;
    if (!rem || this.foodBusy) return;
    this.foodBusy = true;
    this.render();
    const ok = await rem.tickItem(id, done);
    this.foodBusy = false;
    if (!ok) this.deps.notify('The protein tick was not saved; try again in a moment.');
    else this.deps.notify(done ? 'Protein ticked for today, in Pahlavan and its habit.' : 'Today’s protein tick undone.');
    await this.reload();
    void this.refreshDue(false);
  }

  /** The Check-in screen; the scroll position and the focused control survive the redraw. */
  private drawCheckin(): void {
    if (!this.page || !this.checkinModel || !this.checkinState) return;
    const scroller = this.contentEl;
    const top = scroller.scrollTop;
    const focused = (this.contentEl.ownerDocument.activeElement as HTMLElement | null)?.getAttribute?.('data-k') ?? null;
    const w = this.model?.review?.week;
    const read = this.deps.data.current;
    if (!read) return;
    const writer = this.deps.checkinWriter ?? null;
    const tr = this.deps.data.tracking;
    const body = this.deps.data.bodyRecord(this.date);
    const tw = this.trackingWritable();
    const rem = this.deps.reminders;
    renderCheckin(this.page, this.checkinModel, this.checkinState, {
      canWrite: Boolean(writer),
      hero: { phase: this.phase, phaseOf: this.model?.phase ?? null, planWeek: w?.planWeek ?? null, phaseNo: w?.phase ?? null, week: checkinWeek(read, this.date), tape: tapeDay(read, tr, this.date) },
      onChange: () => this.render(),
      onSaveMorning: (force) => void this.saveMorning(force ?? false),
      onSaveSunday: (record) => void this.saveSunday(record),
      ...(this.deps.openNote ? { onOpenNote: this.deps.openNote } : {}),
      bodyRecord: body
        ? {
            model: body,
            ui: this.bodyUi,
            canWrite: tw && body.canWrite,
            onChange: () => this.render(),
            onOpen: (part) => (rem ? void rem.openCard(part) : this.deps.notify('The reminder cards are not running in this window.')),
            onSchedule: (next) => void this.saveBodySchedule(next),
          }
        : null,
      bell: tr ? { current: tr.tracking?.morning ?? null, ui: this.bellUi, canWrite: tw, onSave: (next) => void this.saveMorningTime(next) } : null,
      units: this.bodyUnits(),
      patternChecks: this.patternPrefill(),
      ...(this.deps.copy ? { onCopy: (text: string) => this.copyCommand(text) } : {}),
    });
    scroller.scrollTop = top;
    if (focused) this.page.querySelector<HTMLElement>(`[data-k="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  /**
   * The Sunday check-in's pattern lines from the Food tab's light checks of
   * the week it reviews: a line met on most days starts as met, while the
   * answers are untouched and no record is saved yet; the counts show either way.
   */
  private patternPrefill(): Record<string, PatternCheck> | undefined {
    const st = this.checkinState;
    const sun = this.checkinModel?.sunday;
    const plan = this.foodModel?.plan;
    if (!st?.sunday || !sun || !this.checkinModel || !plan?.today?.optional?.length) return undefined;
    const out = checksPrefill(plan, this.helpState?.foodChecks ?? {}, sun.weekStart, this.foodModel?.cycle.since ?? null);
    applyPatternChecks(st, this.checkinModel, out);
    return out;
  }

  private async saveMorning(force: boolean): Promise<void> {
    const st = this.checkinState;
    const writer = this.deps.checkinWriter;
    if (!st || !writer) return;
    const m = st.morning;
    const values: Partial<Record<keyof typeof m.values, number | null>> = {};
    for (const k of Object.keys(m.values) as (keyof typeof m.values)[]) if (m.values[k] !== m.baseline[k]) values[k] = m.values[k];
    const sore: Record<string, 'mild' | 'sore' | null> = {};
    for (const k of new Set([...Object.keys(m.sore), ...Object.keys(m.soreFrom)])) if ((m.sore[k] ?? null) !== (m.soreFrom[k] ?? null)) sore[k] = m.sore[k] ?? null;
    m.busy = true;
    m.error = null;
    this.render();
    const illness = (m.ill ?? false) !== (m.illFrom ?? false) ? { illness: m.ill } : {};
    const out = await writer.saveMorning(st.date, { values, baseline: m.baseline, sore, ...illness, force, ...(this.deps.nowIso ? { checkedAt: this.deps.nowIso() } : {}) });
    m.busy = false;
    if (out.status === 'conflict') m.conflicts = out.conflicts;
    else if (out.status === 'failed') m.error = `Not saved: ${out.error}.`;
    else {
      m.dirty = false;
      m.conflicts = null;
      this.deps.notify(out.status === 'unchanged' ? 'Nothing to save: body-data.json already holds these answers.' : `Saved the morning check-in for ${fmt.wd(st.date)} in body-data.json.`);
      this.deps.requestReload();
    }
    this.render();
  }

  /** A coach command to the clipboard ("Ask the coach", the Sunday check-in's next step). */
  private copyCommand(text: string): void {
    this.deps.copy?.(text).then(() => this.deps.notify(`Copied: ${text}. Paste it in Claude Code, started in your vault.`), () => this.deps.notify('Couldn’t copy the command'));
  }

  private async saveSunday(record: Record<string, unknown>): Promise<void> {
    const st = this.checkinState?.sunday;
    const writer = this.deps.checkinWriter;
    const read = this.deps.data.current;
    if (!st || !writer || !read) return;
    st.busy = true;
    st.error = null;
    this.render();
    const out = await writer.saveSunday(record, this.date, read.data);
    st.busy = false;
    if (out.status === 'failed') st.error = `Not saved: ${out.error}.`;
    else {
      st.dirty = false;
      st.editSaved = false;
      st.warnings = out.warnings.map((w) => w.message);
      // The coach step after it, as the screen names it.
      const next = this.checkinModel?.coach.now?.value.command ?? COACH_COMMANDS.checkin;
      this.deps.notify(out.action === 'unchanged' ? 'Nothing new to save: checkins.json already holds these answers.' : `Saved the Sunday check-in for ${fmt.wd(st.date)} in Coach/checkins.json. Next, ask the coach: ${next}.`);
      this.deps.requestReload();
    }
    this.render();
  }

  /** A ladder's level, as the Skills card's hint suggests (mergeLadder's write, as `engine log ladder` makes it); `start`: the plan's start logged as the first level. */
  private async moveLadder(id: string, level: number, how?: 'start'): Promise<void> {
    const read = this.deps.data.current;
    if (!this.deps.writer || !read) return;
    const out = await this.deps.writer.saveLadder({ id, level, date: this.date, plan: read.raw?.plan });
    if (out.status === 'failed') this.deps.notify(`The level was not saved: ${out.error}.`);
    else {
      this.deps.notify(out.status === 'already' ? `Already at level ${level} (${clean(out.name)}).` : how === 'start' ? `Logged level ${level}, ${clean(out.name)}, the plan’s start, from ${fmt.wd(this.date)}.` : `Moved to level ${level}, ${clean(out.name)}, from ${fmt.wd(this.date)}.`);
      this.deps.requestReload();
    }
  }

  /** Today's pick of session, or null (a pick from another day is ignored). */
  private pickedType(): string | null {
    return this.choice().type ?? pickFor(this.deps.settings.pick, this.date);
  }

  /** Today's record in the log (todayChecklist, shared with the dashboard and Isfahan): the session it chooses and its Express flag. */
  private choice(): { type: string | null; express: boolean | null; picked: boolean } {
    const read = this.deps.data.current;
    if (!read) return { type: null, express: null, picked: false };
    const plan = read.raw?.plan as { shortTypes?: string[] } | undefined;
    const rec = choiceFromChecklist(read.raw?.log, plan, this.date);
    const suggested = rec ? (this.deps.data.session(this.date, 'full', {})?.session?.type ?? null) : null;
    return { ...followChoice(rec, plan?.shortTypes ?? [], suggested), picked: rec?.picked === true };
  }

  /** The session's version: the record's Express flag for today wins over the remembered setting. */
  private mode(): SessionMode {
    const c = this.choice();
    const m = this.deps.settings.mode;
    // The record's flag is the dashboard's Express, which only a lifting day has; a short day keeps Pahlavan's own (Express halves it).
    const plan = this.deps.data.current?.raw?.plan as { liftTypes?: string[] } | undefined;
    const shown = c.type ?? this.deps.data.session(this.date, 'full', { type: pickFor(this.deps.settings.pick, this.date) })?.session?.type ?? null;
    if (!shown || !(plan?.liftTypes ?? []).includes(shown)) return m;
    if (c.express === true) return 'express';
    if (c.express === false && m === 'express') return 'full';
    return m;
  }

  /** Writes today's record (the dashboard's savePlanChoice), then re-reads. */
  private async saveChoice(type: string, express: boolean, picked: boolean): Promise<void> {
    const read = this.deps.data.current;
    if (!this.deps.writer || !read) return;
    const plan = read.raw?.plan;
    const len = dashChecklist(plan, type, express, isDeloadDate(plan, read.raw?.log, this.date)).length;
    const out = await this.deps.writer.saveChecklist((log) => chosenChecklist(log, this.date, type, express, len, picked) as unknown as Record<string, unknown>);
    if (out.status === 'failed') this.deps.notify(`Today’s choice was not saved: ${out.error}.`);
    await this.reload();
  }

  /** Today's checklist for the session shown: the dashboard's lines, today's ticks and which row each line ticks. */
  private checklist(sess: SessionModel | null, mode: SessionMode) {
    const read = this.deps.data.current;
    if (!read || !sess?.session) return null;
    const plan = read.raw?.plan as { liftTypes?: string[] } | undefined;
    const log = read.raw?.log;
    const type = sess.session.type;
    const express = mode === 'express' && (plan?.liftTypes ?? []).includes(type);
    const deload = isDeloadDate(plan, log, this.date);
    const lines = dashChecklist(plan, type, express, deload);
    if (!lines.length) return null;
    return { type, express, deload, lines, checked: todayChecklistOf(log, this.date, type, express, lines.length).checked, targets: checklistTargets(lines, sess.items, sess.finisher?.name ?? null), canTick: Boolean(this.deps.writer) };
  }

  /** The profile's body units (kg and cm without a profile): every screen shows weights and lengths in them. */
  private bodyUnits(): BodyUnits {
    return bodyUnitsOf(this.deps.data.current?.data.profile ?? null).value;
  }

  /** The open Progress view's range: this cycle unless the user chose All for it (Habits: each item's start). */
  private progressRange(): Scope {
    return progressScope(this.deps.settings, this.deps.settings.progressSection ?? 'overview');
  }

  /** The Progress reports for a range: the cycle's from the last read, everything built on first use. */
  private modelsFor(range: Scope): { progress: ProgressModel | null; more: ProgressMoreModel | null } {
    if (range === 'cycle') return { progress: this.progressModel, more: this.moreModel };
    this.allModels ??= { progress: this.deps.data.progressNow(this.date, 'all'), more: this.deps.data.progressMore(this.date, 'all') };
    return this.allModels;
  }

  private drawProgress(): void {
    if (!this.page || !this.progressModel) return;
    this.lastWidth = this.page.clientWidth;
    const section = this.deps.settings.progressSection ?? 'overview';
    const range = this.progressRange();
    const models = this.modelsFor(range);
    const pm = models.progress ?? this.progressModel;
    const base = {
      view: this.volumeView,
      tables: this.progressTables,
      units: this.bodyUnits(),
      onView: (view: VolumeView) => {
        this.volumeView = view;
        this.render();
      },
      onTable: (id: string) => {
        if (this.progressTables.has(id)) this.progressTables.delete(id);
        else this.progressTables.add(id);
        this.render();
      },
    };
    const nav = sectionNav(section, models.more, (next) => {
      this.deps.settings.progressSection = next;
      this.deps.saveSettings();
      this.render();
    }, {
      scope: range,
      cycle: pm.cycle,
      onScope: (next) => {
        if (section === 'habits') return;
        setProgressScope(this.deps.settings, section, next);
        this.deps.saveSettings();
        this.render();
      },
    });
    const more = models.more;
    // The banner follows the open view's range: its strength, weight, waist and weeks count from the same day.
    const hero = { phase: this.phase, phaseOf: this.model?.phase ?? null, waist: more?.body?.tape.measures.find((x) => x.key === 'waist') ?? null };
    if (section === 'overview' || !more) {
      renderProgress(this.page, pm, base, { hero, nav });
      return;
    }
    if (section === 'body' && more.body && this.photoFiles === null) {
      this.photoFiles = {};
      // Every set's files, whatever the range: switching to All needs no second read.
      const sets = (this.deps.data.current?.data.body.photos ?? []).map((x) => ({ date: x.date, folder: x.folder ?? `Progress Photos/${x.date}/` }));
      void this.deps.data.photoFiles(sets).then((files) => {
        this.photoFiles = files;
        if ((this.deps.settings.progressSection ?? 'overview') === 'body') this.render();
      });
    }
    const ui = this.moreUi;
    const ctx: MoreContext = {
      ...base,
      sessionsView: ui.sessionsView,
      onSessionsView: (v) => {
        ui.sessionsView = v;
        this.render();
      },
      health: ui.health,
      onHealth: (k) => {
        ui.health = k;
        this.render();
      },
      photo: ui.photo,
      onPhoto: () => this.render(),
      // Photo folders before the range's first day are left out, like the index's sets.
      photoFiles: inRange(this.photoFiles ?? {}, more.body?.cycleStart ?? null),
      resourcePath: this.deps.resourcePath ?? null,
      ...(this.deps.writer ? { onMoveLadder: (id: string, level: number, how?: 'start') => void this.moveLadder(id, level, how) } : {}),
      guide: (name: string) => guideFor(this.deps.data.current?.raw?.plan, this.deps.data.current?.raw?.log, name),
      openGuides: this.openGuides,
      onToggleGuide: (key: string) => { if (this.openGuides.has(key)) this.openGuides.delete(key); else this.openGuides.add(key); this.render(); },
    };
    if (section === 'habits') {
      const ctx = this.habitsCtx();
      renderProgress(this.page, pm, base, {
        hero,
        nav,
        section: (grid, total) => (ctx ? renderHabits(grid, total, ctx) : grid.replaceChildren(h('p', { class: 'pv-calm pv-span-12' }, icon('info'), 'The tracking files could not be read.'))),
      });
      return;
    }
    const inputs = this.model?.inputs ?? [];
    renderProgress(this.page, pm, base, {
      hero,
      nav,
      section: (grid, total) => renderMore(grid, section, more, total, ctx, (k) => {
        const i = inputs.find((x) => x.signal === k);
        return i && i.mean !== null && i.sd !== null ? { mean: i.mean, sd: i.sd, days: i.days } : null;
      }),
    });
  }

  private drawToday(): void {
    if (!this.page || !this.model) return;
    const read = this.deps.data.current;
    const plan = read?.raw?.plan;
    const log = read?.raw?.log;
    const mode = this.mode();
    const ck = this.checklist(this.session, mode);
    const guides = new Map<string, ReturnType<typeof guideFor>>();
    const guide = (name: string) => {
      if (!guides.has(name)) guides.set(name, guideFor(plan, log, name));
      return guides.get(name)!;
    };
    const monthName = new Date(Number(this.date.slice(0, 4)), Number(this.date.slice(5, 7)) - 1, 1).toLocaleDateString(undefined, { month: 'long' });
    renderToday(this.page, this.model, {
      mode,
      session: this.session,
      pick: this.pickedType(),
      phase: this.phase,
      open: this.openWhy,
      onMode: (next) => {
        this.deps.settings.mode = next;
        this.deps.saveSettings();
        this.openWhy.clear();
        const type = this.session?.session?.type;
        const lifting = ((plan as { liftTypes?: string[] } | undefined)?.liftTypes ?? []).includes(type ?? '');
        // The dashboard's savePlanChoice: the version is part of today's record (Hotel is Pahlavan's own, saved as the full session).
        if (type && this.deps.writer) void this.saveChoice(type, next === 'express' && lifting, this.choice().picked);
        else {
          this.session = this.deps.data.session(this.date, next, { type: this.pickedType() });
          this.render();
        }
      },
      onPick: (type) => {
        // The pick lives in today's record now (shared with the dashboard and Isfahan's briefing); the old setting goes.
        this.deps.settings.pick = this.deps.writer ? null : choosePick(type, this.date);
        this.deps.saveSettings();
        this.openWhy.clear();
        const target = type ?? this.deps.data.session(this.date, 'full', {})?.session?.type ?? null;
        const lifting = ((plan as { liftTypes?: string[] } | undefined)?.liftTypes ?? []).includes(target ?? '');
        if (target && this.deps.writer) void this.saveChoice(target, mode === 'express' && lifting, type !== null);
        else {
          this.session = this.deps.data.session(this.date, mode, { type });
          this.render();
        }
      },
      checklist: ck,
      onTick: (i) => {
        if (!ck || !this.deps.writer) return;
        void this.deps.writer.saveChecklist((l) => toggledChecklist(l, this.date, ck.type, ck.express, ck.lines.length, i) as unknown as Record<string, unknown>).then((out) => {
          if (out.status === 'failed') this.deps.notify(`The tick was not saved: ${out.error}.`);
          else if (out.checklist && read?.raw?.log && typeof read.raw.log === 'object') (read.raw.log as Record<string, unknown>)['todayChecklist'] = out.checklist;
          this.render();
        });
      },
      guide,
      openGuides: this.openGuides,
      onToggleGuide: (key) => {
        if (this.openGuides.has(key)) this.openGuides.delete(key);
        else this.openGuides.add(key);
        this.render();
      },
      ...(this.deps.copy && ck ? { onCopy: () => {
        const shortDay = (d: string) => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        const dayLabel = new Date(Number(this.date.slice(0, 4)), Number(this.date.slice(5, 7)) - 1, Number(this.date.slice(8, 10))).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
        const text = lightWords(planText({ plan, log, date: this.date, type: ck.type, express: ck.express, deload: ck.deload, dayLabel, shortDay, ...(this.session ? { session: this.session } : {}) }));
        this.deps.copy!(text).then(() => this.deps.notify('Today’s plan copied'), () => this.deps.notify('Couldn’t copy the plan'));
      } } : {}),
      // The month's count and the recent list start at the cycle start, like Progress.
      month: { name: monthName, count: sessionsThisMonth(logFrom(log, this.model.cycle.start), this.date) },
      recent: recentSessions(logFrom(log, this.model.cycle.start), plan),
      historyNote: this.deps.data.fitnessFiles.some((f) => f === paths().sessionHistory || `${paths().fitness}/${f}` === paths().sessionHistory),
      totalSessions: Array.isArray((log as { sessions?: unknown[] } | undefined)?.sessions) ? (log as { sessions: unknown[] }).sessions.length : 0,
      dashReminders: dashboardReminders({ plan, log, date: this.date, focusType: this.session?.session?.type ?? null, deload: ck?.deload ?? isDeloadDate(plan, log, this.date) }),
      ...(this.deps.openNote ? { onOpenNote: this.deps.openNote } : {}),
      onToggleWhy: (id) => {
        if (this.openWhy.has(id)) this.openWhy.delete(id);
        else this.openWhy.add(id);
        this.render();
      },
      onLog: () => void this.openLog(),
      onEditSession: (date, s) => void this.openEdit(date, s),
      dueCard: this.dueCardEl(),
      yourDay: this.yourDayEl(),
      welcome: this.welcomeEl(),
      swaps: swapsFor(this.deps.settings.swaps, this.date),
      onSwap: (item, to) => {
        this.deps.settings.swaps = chooseSwap(this.deps.settings.swaps, this.date, item, to);
        this.deps.saveSettings();
        if (to) this.deps.notify(`Today: ${to} in place of ${item}. The Log panel starts with it.`);
        this.render();
      },
      ...(this.deps.copy ? { onCopyCommand: (text: string) => this.copyCommand(text) } : {}),
    });
    if (this.openWhy.size === 0 && this.session) {
      // The first time: open the Why of a row the Ledger changed, so the reason is in view.
      const k = this.session.items.findIndex((it) => it.adjustments.some((a) => a.rule === 'safety.ledger') && it.replaces);
      if (k >= 0 && !this.openedOnce) {
        this.openedOnce = true;
        this.openWhy.add(`${k}:${this.session.items[k]!.exercise}`);
        this.render();
      }
    }
  }

  private openedOnce = false;

  // ---------------------------------------------------------------- the Log panel

  /** A new log, from the session Today shows (the pick, if any). */
  private async openLog(): Promise<void> {
    const read = this.deps.data.current;
    if (!read || !this.session) return;
    // No planned session today: the panel opens on "Something else" (a custom session).
    // Today's swaps chosen on the chips come along.
    const planned = logFormFor(read, this.session, this.date, this.deps.device ? { tracking: logTracking(this.deps.device) } : {});
    const form = planned ? withSwaps(planned, swapsFor(this.deps.settings.swaps, this.date)) : customLogForm(read, this.date);
    await this.showLog(form);
  }

  /** An edit of a logged session, read from the file as it is now. */
  private async openEdit(date: string, s: { type: string; label?: string }): Promise<void> {
    const read = this.deps.data.current;
    if (!read || !this.deps.writer) return;
    const log = await this.deps.writer.readLog();
    const list = (log?.['sessions'] as Record<string, unknown>[] | undefined) ?? [];
    const key = sessionKey({ date, type: s.type, label: s.type === 'custom' ? s.label : undefined });
    const entry = list.find((x) => sessionKey(x) === key) ?? list.find((x) => x['date'] === date && x['type'] === s.type);
    if (!entry) {
      this.deps.notify(`That session is not in fitness-log-data.json any more.`);
      return;
    }
    await this.showLog(logFormFromEntry(read, entry));
  }

  private async showLog(form: LogForm): Promise<void> {
    this.logForm = form;
    this.logState = freshPanelState();
    this.logState.habitTicked = this.deps.writer ? await this.deps.writer.habitTicked(form.date) : null;
    if (!this.logLayer) {
      this.logLayer = activeDocument.createElement('div');
      this.logLayer.className = 'pv-log-layer';
      this.contentEl.appendChild(this.logLayer);
      this.registerDomEvent(activeDocument, 'keydown', (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape' || !this.logForm) return;
        if (this.logState.menu) this.logState.menu = null;
        else this.logForm = null;
        this.drawLog();
      });
    }
    this.drawLog();
  }

  /** The layer covers the view's pane, wherever the page has scrolled. */
  private placeLog(): void {
    if (!this.logLayer) return;
    const r = this.contentEl.getBoundingClientRect();
    const win = this.contentEl.ownerDocument.defaultView;
    const top = Math.max(0, r.top);
    const bottom = Math.min(r.bottom, win?.innerHeight ?? r.bottom);
    Object.assign(this.logLayer.style, { width: `${r.width}px`, height: `${Math.max(0, bottom - top)}px` });
    placeFixed(this.logLayer, r.left, top);
  }

  private drawLog(): void {
    if (!this.logLayer) return;
    const form = this.logForm;
    this.logLayer.classList.toggle('is-open', Boolean(form));
    // A tip never shows over the Log panel: it goes while the panel is open and comes back after.
    this.placeTip();
    if (!form) {
      this.logLayer.replaceChildren();
      return;
    }
    this.placeLog();
    const read = this.deps.data.current;
    renderLogPanel(this.logLayer, {
      form,
      state: this.logState,
      plan: read?.raw?.plan,
      log: read?.raw?.log,
      today: this.date,
      onChange: () => this.drawLog(),
      onClose: () => {
        this.logForm = null;
        this.drawLog();
      },
      onRebuild: (type, mode) => void this.rebuildLog(form, { type, mode }),
      onDate: (date) => void this.rebuildLog(form, { date }),
      onSave: (force) => void this.saveLog(force ?? false),
      onDelete: () => void this.deleteLog(),
      onEditExisting: (entry) => {
        const r = this.deps.data.current;
        if (r) void this.showLog(logFormFromEntry(r, entry));
      },
      guide: (name) => guideFor(read?.raw?.plan, read?.raw?.log, name),
      onTracking: (tracking) => {
        if (this.deps.device) setLogTracking(this.deps.device, tracking);
      },
      onUseDisk: (entry) => {
        const r = this.deps.data.current;
        if (r) void this.showLog(logFormFromEntry(r, entry));
      },
    });
  }

  /**
   * The Log panel's form after a change of session, version or date, from
   * the plan as of the form's date (rebuildForm); a session already logged
   * on a new date opens as its edit.
   */
  private async rebuildLog(form: LogForm, change: { type?: string; mode?: SessionMode; date?: string }): Promise<void> {
    const date = change.date ?? form.date;
    const read = await this.deps.data.readAsOf(date);
    if (this.logForm !== form) return;
    const next = rebuildForm(read, form, change);
    if (!next) return;
    this.logForm = next;
    if (date !== form.date) {
      const st = this.logState;
      Object.assign(st, { already: null, conflict: null, error: null, confirmDelete: false, menu: null, guide: null });
      st.habitTicked = this.deps.writer ? await this.deps.writer.habitTicked(date) : null;
    }
    this.drawLog();
  }

  private async saveLog(force: boolean): Promise<void> {
    const form = this.logForm;
    const read = this.deps.data.current;
    if (!form || !read) return;
    const st = this.logState;
    if (!this.deps.writer) {
      st.error = 'This view cannot write the fitness files.';
      this.drawLog();
      return;
    }
    const r = previewEntry({ form, plan: read.raw?.plan, log: read.raw?.log, today: this.date });
    if (!r.ok) {
      st.error = `Not saved: ${r.error}.`;
      st.summary = true;
      this.drawLog();
      return;
    }
    st.busy = true;
    st.error = null;
    st.already = null;
    st.conflict = null;
    this.drawLog();
    // The dashboard's recordsIn: the records this new session sets against everything logged before it.
    const records = form.edit ? [] : recordsIn(r.entry, logFrom(read.raw?.log, this.model?.cycle.start ?? null), read.raw?.plan);
    const out = await this.deps.writer.save({ mode: form.edit ? 'edit' : 'add', entry: r.entry, original: form.original ? { key: form.original.key, json: form.original.json } : null, force, date: form.date, sore: form.edit ? {} : soreChanges(form), ticks: { plan: read.raw?.plan, today: this.date } });
    st.busy = false;
    if (out.status === 'already') st.already = out.existing;
    else if (out.status === 'conflict') st.conflict = { disk: out.disk };
    else if (out.status === 'failed') st.error = out.error;
    else {
      const habit = out.habit === 'ticked' ? ' Workout ticked.' : out.habit === 'already' ? ' Workout was already ticked.' : out.habit === 'failed' ? ' The Workout habit could not be ticked.' : '';
      this.deps.notify(`${out.result === 'added' ? 'Logged' : 'Updated'} ${form.typeName} for ${fmt.wd(form.date)}.${habit}`);
      if (out.result === 'added' && records.length) this.deps.notify(`New record: ${records.join(' · ')}`);
      this.logForm = null;
      this.deps.requestReload();
    }
    this.drawLog();
  }

  private async deleteLog(): Promise<void> {
    const form = this.logForm;
    if (!form || !form.original || !this.deps.writer) return;
    const out = await this.deps.writer.save({ mode: 'delete', entry: null, original: { key: form.original.key, json: form.original.json }, date: form.date });
    if (out.status === 'saved') {
      this.deps.notify(`Deleted ${form.typeName} of ${fmt.wd(form.date)}. The Workout tick stays.`);
      this.logForm = null;
      this.deps.requestReload();
    } else if (out.status === 'conflict') this.logState.conflict = { disk: out.disk };
    else if (out.status === 'failed') this.logState.error = out.error;
    this.logState.confirmDelete = false;
    this.drawLog();
  }

  // ---------------------------------------------------------------- Due today and the reminders

  /** Due today from the machinery; `reread` reads the files first (after a reload). Null without it. */
  private async fetchDue(reread: boolean): Promise<DueToday | null> {
    const rem = this.deps.reminders;
    if (!rem) return null;
    return (await rem.dueToday({ reread }))?.value ?? null;
  }

  /** The machinery changed something: fetch Due today again (debounced) and patch it in place. */
  private dueChanged(): void {
    if (this.dueTimer !== null) window.clearTimeout(this.dueTimer);
    this.dueTimer = window.setTimeout(() => {
      this.dueTimer = null;
      void this.refreshDue(false);
    }, 150);
  }

  private async refreshDue(reread: boolean): Promise<void> {
    const seq = ++this.dueSeq;
    const due = await this.fetchDue(reread);
    if (seq !== this.dueSeq) return;
    this.dueModel = due;
    this.patchLive();
  }

  /** Redraws only the live parts: Due today on Today; today's reminders and the sitting row in Habits. */
  private patchLive(): void {
    if (!this.page) return;
    const tab = this.deps.settings.lastTab;
    if (tab === 'home') {
      // Home counts the same ticks and the morning check-in: it is small, so it is drawn again whole.
      if (this.model) keepPlace(this.contentEl, this.page, () => this.drawHome());
      return;
    }
    if (tab === 'today') {
      const old = this.page.querySelector('[data-live="due"]');
      const next = this.dueCardEl();
      if (old && next) old.replaceWith(next);
      // Your day counts the same ticks and amounts.
      const strip = this.page.querySelector('[data-live="yourday"]');
      const day = strip ? this.yourDayEl() : null;
      if (strip && day) strip.replaceWith(day);
      // The new card folds as the old one did, and the panel's lines follow what is due.
      this.drawGlance();
      this.placeTip();
      return;
    }
    if (tab === 'progress' && (this.deps.settings.progressSection ?? 'overview') === 'habits') {
      const ctx = this.habitsCtx();
      if (!ctx) return;
      this.page.querySelector('[data-live="reminders"]')?.replaceWith(todayCard(ctx));
      this.drawGlance();
      const row = this.page.querySelector('[data-live="sitting-row"]');
      const it = this.habitsModel?.items.find((x) => x.kind === 'sitting');
      if (row && it?.sitting && ctx.sittingLive) row.replaceChildren(sittingBar({ minutes: ctx.sittingLive.minutes, longest: ctx.sittingLive.longest, limit: it.sitting.limit, stretchMax: it.sitting.stretchMax }));
    }
  }

  private trackingWritable(): boolean {
    return Boolean(this.deps.trackingWriter) && this.deps.data.tracking?.files.tracking !== 'invalid';
  }

  /** Your day from Today's reports, Due today and the Food tab's (null without a plan). */
  private yourDayModel(): Result<YourDay> | null {
    if (!this.model) return null;
    const due = this.dueModel && this.dueModel.date === this.date ? this.dueModel : null;
    return yourDay(this.model, { session: this.session, due, food: this.foodModel, items: this.deps.data.tracking?.tracking?.items ?? [], ...(this.deps.clockText ? { clock: this.deps.clockText } : {}) });
  }

  private yourDayEl(): HTMLElement | null {
    const day = this.yourDayModel();
    if (!day) return null;
    return yourDayStrip({
      day,
      // The morning card through the machinery; without it, the Check-in screen holds the same questions.
      onMorning: () => (this.deps.reminders ? void this.openDueKey('morning') : this.show('checkin')),
      onLog: () => void this.openLog(),
      onDue: () => this.goToSection('today', 'due'),
      onFood: () => this.show('food'),
      onCheckin: () => this.show('checkin'),
      ...(this.deps.copy ? { onCopyCommand: (text: string) => this.copyCommand(text) } : {}),
    });
  }

  /** The Due today card, or null without the reminder machinery. */
  private dueCardEl(): HTMLElement | null {
    const rem = this.deps.reminders;
    const due = this.dueModel;
    if (!rem || !due || due.date !== this.date) return null;
    const read = this.deps.data.current;
    return dueTodayCard({
      due,
      items: this.deps.data.tracking?.tracking?.items ?? [],
      activity: rem.activity(),
      stand: rem.standStatus(),
      sitting: rem.sittingNow(),
      standing: rem.standingNow(),
      sundayDone: read ? checkinWeek(read, this.date).sunday.done : false,
      coachFirst: (() => {
        const c = this.model?.coach.now?.value;
        return c?.state === 'answer-first' ? { line: c.line, command: c.command } : null;
      })(),
      canWrite: true,
      busy: this.duePending,
      onTick: (id, done) => void this.dueTick(id, done),
      onAdd: (id, delta) => void this.dueAdd(id, delta),
      onOpen: (key) => void this.openDueKey(key),
      onStanding: (on) => rem.setStandingNow(on),
      onHabits: () => this.openHabitsEditor(undefined),
      ...(this.deps.openSettings ? { onSettings: this.deps.openSettings } : {}),
      ...(this.deps.clockText ? { clock: this.deps.clockText } : {}),
      phone: this.deps.data.inboxRefused,
    });
  }

  /** A tick from Due today: shown at once, then written (tracking.json and the linked habit). */
  private async dueTick(id: string, done: boolean): Promise<void> {
    const rem = this.deps.reminders;
    const due = this.dueModel;
    if (!rem || !due) return;
    for (const sl of due.habits.slots) for (const x of sl.items) if (x.id === id && x.done !== done) {
      x.done = done;
      due.habits.done += done ? 1 : -1;
    }
    this.duePending.add(id);
    this.patchLive();
    const ok = await rem.tickItem(id, done);
    this.duePending.delete(id);
    if (!ok) this.deps.notify('The tick was not saved; try again in a moment.');
    await this.refreshDue(false);
  }

  /** A quick amount from Due today or the Habits list: shown at once, then added (and to the linked habit). */
  private async dueAdd(id: string, delta: number): Promise<void> {
    const rem = this.deps.reminders;
    if (!rem) return;
    const a = this.dueModel?.amounts.find((x) => x.id === id);
    if (a) {
      a.value += delta;
      a.met = a.value >= a.target;
    }
    const row = this.habitsModel?.items.find((x) => x.id === id);
    if (row?.measure) row.measure.value += delta;
    this.duePending.add(id);
    this.habitsUi?.pending.add(id);
    if (this.deps.settings.lastTab === 'today') this.patchLive();
    else this.render();
    const ok = await rem.addAmount(id, delta);
    this.duePending.delete(id);
    this.habitsUi?.pending.delete(id);
    if (!ok) this.deps.notify('The amount was not saved; try again in a moment.');
    await this.refreshDue(false);
    if (this.deps.settings.lastTab !== 'today') this.deps.requestReload();
  }

  /** A row's card by its reminder key: the card when due, else the one that can open by hand. */
  private async openDueKey(key: string): Promise<void> {
    const rem = this.deps.reminders;
    if (!rem) return;
    if (rem.cardOpen) {
      await rem.openKey(key);
      this.deps.notify('A reminder card is open: finish it first.');
      return;
    }
    const [kind, item] = key.split(':') as [string, string | undefined];
    if (kind === 'standup') {
      if (rem.standAskNow()) {
        void rem.fastTick();
        this.deps.notify('The stand-up card comes on the next step, within 30 seconds.');
      } else this.deps.notify(rem.activity().readable === false ? 'Stand-ups need keyboard and mouse activity, which this computer can’t read.' : 'No stand-up is counting on this Mac right now.');
      return;
    }
    if (kind === 'morning' || kind === 'tape' || kind === 'photos' || kind === 'tests') {
      await rem.openCard(kind);
      return;
    }
    if ((kind === 'amount' || kind === 'desk') && item) {
      await rem.openCard(kind, item);
      return;
    }
    if (!(await rem.openKey(key))) this.deps.notify('That card is not due now: it comes at its time.');
  }

  // ---------------------------------------------------------------- the Habits section

  private freshHabitsUi(): HabitsUi {
    return { table: false, form: newForm('supplement', this.date), base: null, confirmRemove: false, busy: false, error: null, conflict: null, bring: null, bringLater: false, pending: new Set() };
  }

  private habitsCtx(): HabitsContext | null {
    const model = this.habitsModel;
    if (!model) return null;
    if (!this.habitsUi) this.habitsUi = this.freshHabitsUi();
    const ui = this.habitsUi;
    const rem = this.deps.reminders;
    const live = rem?.sittingNow();
    return {
      model,
      due: this.dueModel && this.dueModel.date === this.date ? this.dueModel : null,
      ui,
      canWrite: this.trackingWritable(),
      onChange: () => this.render(),
      onSave: (force) => void this.saveItem(force ?? false),
      onCancel: () => {
        this.habitsUi = { ...this.freshHabitsUi(), table: ui.table, bring: ui.bring, bringLater: ui.bringLater };
        this.render();
      },
      onEdit: (id) => this.editItem(id, true),
      onAdd: () => this.openHabitsEditor(null),
      onPause: () => {
        const base = ui.base;
        if (base) void this.writeTracking(saveOps(pausedItem(base, this.date), base), `Paused ${base.name} from today; its history stays.`);
      },
      onResume: (id) => {
        const it = this.trackedItem(id);
        if (it) void this.writeTracking(saveOps(resumedItem(it, this.date), it), `Resumed ${it.name} from today; the paused days stay paused.`, id);
      },
      onRemove: () => {
        const base = ui.base;
        if (base) void this.writeTracking([{ op: 'remove-item', id: base.id, baseline: base }], `Removed ${base.name} and its history.`, undefined, true);
      },
      onAccept: (id) => {
        const sg = this.deps.data.tracking?.tracking?.suggestions?.find((x) => x.id === id);
        if (sg) void this.writeTracking(acceptOps(sg, { today: this.date, ids: this.trackedIds() }), `Added ${sg.item.name} with your coach’s settings; change them in its form.`, `s:${id}`);
      },
      onDismiss: (id) => {
        const sg = this.deps.data.tracking?.tracking?.suggestions?.find((x) => x.id === id);
        if (sg) void this.writeTracking(dismissOps(sg, this.date), `Dismissed ${sg.item.name}; the coach won’t suggest it again unless something changes.`, `s:${id}`);
      },
      onBring: () => {
        const b = model.bringOver;
        if (!b || !ui.bring) return;
        const chosen = b.items.filter((x) => !x.already && ui.bring!.has(x.id)).map((x) => x.item);
        void this.writeTracking(bringOverOps(chosen, b, this.deps.data.tracking?.tracking ?? null, this.date), `Brought over ${chosen.length} item${chosen.length === 1 ? '' : 's'} from Habit Nudges.`, undefined, false, true);
      },
      onBringLater: () => {
        ui.bringLater = true;
        this.render();
      },
      onBringNever: () => void this.writeTracking([{ op: 'settings', key: 'bringOver', value: { on: this.date, items: [] }, baseline: null }], 'Nothing brought over; the offer won’t come back. Add items yourself or take your coach’s suggestions.'),
      onAmount: (id, delta) => void this.dueAdd(id, delta),
      ...(rem ? { onOpenKey: (key: string) => void this.openDueKey(key) } : {}),
      sittingLive: live ? { minutes: live.today.minutes, longest: live.today.longest } : null,
      ...(this.deps.clockText ? { clock: this.deps.clockText } : {}),
    };
  }

  private trackedIds(): string[] {
    return (this.deps.data.tracking?.tracking?.items ?? []).map((x) => x.id);
  }

  private trackedItem(id: string): TrackedItem | null {
    return this.deps.data.tracking?.tracking?.items.find((x) => x.id === id) ?? null;
  }

  /** The editor on an item as it is on disk now. */
  private editItem(id: string, scroll: boolean): void {
    const it = this.trackedItem(id);
    if (!it) return;
    const ui = this.habitsUi ?? this.freshHabitsUi();
    this.habitsUi = { ...ui, form: formFromItem(it, this.date), base: it, confirmRemove: false, busy: false, error: null, conflict: null };
    this.render();
    if (scroll) this.scrollToEditor();
  }

  /** Progress, Habits: an item's form (Plan's "Change in Habits"), the Add form (null; `kind` for a new one), or just the list (undefined). */
  private openHabitsEditor(id: string | null | undefined, kind?: TrackedItem['kind']): void {
    this.deps.settings.progressSection = 'habits';
    this.deps.saveSettings();
    if (!this.habitsUi) this.habitsUi = this.freshHabitsUi();
    if (id === null) this.habitsUi = { ...this.habitsUi, form: newForm(kind ?? 'supplement', this.date), base: null, confirmRemove: false, error: null, conflict: null };
    if (this.deps.settings.lastTab !== 'progress') this.show('progress');
    if (id) this.editItem(id, true);
    else {
      this.render();
      if (id === null) this.scrollToEditor();
    }
  }

  private scrollToEditor(): void {
    const el = this.page?.querySelector('[data-card="editor"]') as HTMLElement | null;
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  private async saveItem(force: boolean): Promise<void> {
    const ui = this.habitsUi;
    const writer = this.deps.trackingWriter;
    if (!ui || !writer) return;
    const { item, errors } = itemFromForm(ui.form, ui.base, { today: this.date, ids: this.trackedIds() });
    if (errors.length) {
      ui.error = errors.join(' ');
      this.render();
      return;
    }
    ui.busy = true;
    ui.error = null;
    this.render();
    const out = await writer.apply(saveOps(item, ui.base), { force });
    ui.busy = false;
    if (out.status === 'conflict') ui.conflict = out.conflicts;
    else if (out.status === 'failed') ui.error = `Not saved: ${out.error}`;
    else {
      this.deps.notify(out.status === 'unchanged' ? `Nothing to save: ${item.name} is as it was.` : ui.base ? `Saved ${item.name}; the change applies from today.` : `Added ${item.name}; it joins today’s reminders at its time.`);
      this.habitsUi = { ...this.freshHabitsUi(), table: ui.table, bring: ui.bring, bringLater: ui.bringLater };
      this.deps.requestReload();
    }
    this.render();
  }

  /**
   * A change to Coach/tracking.json from the Habits section (pause, resume,
   * remove, a suggestion, the bring-over), through the tracking writer;
   * `pending` marks the button that waits, `reset` closes the form after.
   */
  private async writeTracking(ops: TrackingOp[], done: string, pending?: string, reset = false, bring = false): Promise<void> {
    const ui = this.habitsUi;
    const writer = this.deps.trackingWriter;
    if (!ui || !writer) return;
    if (pending) ui.pending.add(pending);
    ui.busy = true;
    ui.error = null;
    this.render();
    const out = await writer.apply(ops);
    ui.busy = false;
    if (pending) ui.pending.delete(pending);
    if (out.status === 'failed') {
      ui.error = `Not saved: ${out.error}`;
      if (!ui.base) this.deps.notify(ui.error);
    } else if (out.status === 'conflict') {
      ui.conflict = out.conflicts;
      this.deps.notify('Coach/tracking.json changed elsewhere since it was read; it reads again now. Try once more.');
      this.deps.requestReload();
    } else {
      this.deps.notify(done);
      if (reset || (ui.base && ops.some((o) => o.op === 'put-item' && o.item.id === ui.base!.id))) {
        const keep = { table: ui.table, bring: ui.bring, bringLater: ui.bringLater };
        const editing = !reset && ui.base ? ui.base.id : null;
        this.habitsUi = { ...this.freshHabitsUi(), ...keep };
        if (editing) {
          // Pause and resume keep the item's form open, on the version just written.
          const put = ops.find((o): o is Extract<TrackingOp, { op: 'put-item' }> => o.op === 'put-item' && o.item.id === editing);
          if (put) this.habitsUi = { ...this.habitsUi, form: formFromItem(put.item, this.date), base: put.item };
        }
      }
      if (bring) ui.bring = null;
      this.deps.requestReload();
    }
    this.render();
  }

  private async saveBodySchedule(next: BodyRecordSchedule): Promise<void> {
    const writer = this.deps.trackingWriter;
    if (!writer) return;
    const cur = this.deps.data.tracking?.tracking?.bodyRecord ?? null;
    this.bodyUi.busy = true;
    this.bodyUi.error = null;
    this.render();
    const out = await writer.apply(bodyScheduleOps(next, cur));
    this.bodyUi.busy = false;
    if (out.status === 'failed') this.bodyUi.error = `Not saved: ${out.error}`;
    else if (out.status === 'conflict') this.bodyUi.error = 'The schedule changed elsewhere since it was read; it reads again now.';
    else this.deps.notify(next.schedule === 'plan' ? 'The body record follows your plan now.' : `The tape and photos every ${next.tapeEvery} days from ${fmt.day(next.tapeFrom!)}, the tests every ${next.testsEvery} from ${fmt.day(next.testsFrom!)}.`);
    this.deps.requestReload();
    this.render();
  }

  private async saveMorningTime(next: MorningReminder): Promise<void> {
    const writer = this.deps.trackingWriter;
    if (!writer) return;
    const cur = this.deps.data.tracking?.tracking?.morning ?? null;
    this.bellUi.busy = true;
    this.render();
    const out = await writer.apply(morningOps(next, cur));
    this.bellUi.busy = false;
    if (out.status === 'failed' || out.status === 'conflict') this.deps.notify(out.status === 'failed' ? `The reminder time was not saved: ${out.error}` : 'The reminder time changed elsewhere; it reads again now.');
    else {
      this.bellUi.open = false;
      this.deps.notify(next.on ? `The morning card comes at ${next.at} on each Mac with reminders on.` : 'No morning card from now on; check in here when you like.');
    }
    this.deps.requestReload();
    this.render();
  }

  // ---------------------------------------------------------------- At a glance and the folds

  /** A visit to a tab: one of its first while fewer than three are counted (Coach/help.json, shared by both Macs). */
  private countVisit(section: Section): void {
    // Home and Movements have no At a glance: their visits are not counted.
    if (section === 'home' || section === 'movements') return;
    const tab: GlanceTab = section;
    this.early[tab] = earlyVisit(this.helpState, tab);
    if (this.early[tab]) void this.helpNow({ op: 'visit', tab }, false);
  }

  /**
   * A change to the screens' memory: shown at once, then written to
   * Coach/help.json (read, apply, write, read back, one after another); a
   * change still on its way stays applied over what the file returns.
   */
  private async helpNow(ch: HelpChange, redraw = true): Promise<void> {
    this.helpState = applyHelp(this.helpState ?? { ...FRESH_HELP, tips: {} }, ch);
    if (redraw) this.render();
    const store = this.deps.help;
    if (!store) return;
    this.helpPending.push(ch);
    const before = JSON.stringify(this.helpState);
    try {
      const st = await store.apply(ch);
      this.helpPending.splice(this.helpPending.indexOf(ch), 1);
      this.helpState = this.helpPending.reduce(applyHelp, st);
    } catch (e) {
      this.helpPending.splice(this.helpPending.indexOf(ch), 1);
      this.deps.notify(`Couldn’t save it in Coach/help.json: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (redraw && JSON.stringify(this.helpState) !== before) this.render();
  }

  /** The open tab's At a glance: its lines, the heading of its list, Progress's other views and the prefix of its sections' ids. */
  private glanceOf(tab: Section): { glance: Glance; heading: string; prefix: string | null; views: { label: string; items: { id: string; label: string; line: string }[] } | null } | null {
    const read = this.deps.data.current;
    // Home is the overview itself, and Movements a list to search: no At a glance there.
    if (tab === 'home' || tab === 'movements') return null;
    if (tab === 'today') {
      if (!this.model?.review || !read) return null;
      const log = read.raw?.log;
      const plan = read.raw?.plan;
      const recent = recentSessions(logFrom(log, this.model.cycle.start), plan).map((x) => ({ name: x.name, date: x.date }));
      const total = Array.isArray((log as { sessions?: unknown[] } | undefined)?.sessions) ? (log as { sessions: unknown[] }).sessions.length : 0;
      const dash = dashboardReminders({ plan, log, date: this.date, focusType: this.session?.session?.type ?? null, deload: isDeloadDate(plan, log, this.date) }).length;
      const due = this.dueModel && this.dueModel.date === this.date ? this.dueModel : null;
      return { glance: todayGlance(this.model, { session: this.session, due, recent, totalSessions: total, dashReminders: dash, day: this.yourDayModel()?.value ?? null }), heading: 'What’s on this tab', prefix: null, views: null };
    }
    if (tab === 'progress') {
      const section = this.deps.settings.progressSection ?? 'overview';
      const models = this.modelsFor(this.progressRange());
      const pm = models.progress ?? this.progressModel;
      if (!pm) return null;
      const F = bodyFmt(this.bodyUnits());
      const waist = models.more?.body?.tape.measures.find((x) => x.key === 'waist') ?? null;
      const x = { today: this.model, waist, units: { weight: F.w, length: F.l }, wv: F.wv, lv: F.lv };
      const sums = progressSums(pm, x, strengthChange(pm.lifts));
      const label = PROGRESS_VIEWS.find((v) => v.id === section)?.label ?? 'Overview';
      // The other views' sections from their cards as drawn: the name, the line under it.
      const cards = this.page ? [...this.page.querySelectorAll('.pv-prog-grid [data-sec]')].map((c) => ({ id: c.getAttribute('data-sec')!, title: c.querySelector('.pv-kicker')?.textContent?.trim() ?? '', sub: c.querySelector('.pv-card-sub')?.textContent?.trim() ?? '' })) : [];
      const sections = section === 'overview' ? overviewSections(pm, x).map((sp) => ({ ...sp, id: `overview.${sp.id}` })) : moreSections(section, cards);
      return { glance: { sums, sections }, heading: `What’s on ${label}`, prefix: section, views: { label: section === 'overview' ? 'Also on Progress' : 'Other views', items: PROGRESS_VIEWS.filter((v) => v.id !== section).map((v) => ({ ...v })) } };
    }
    if (tab === 'plan') {
      const pm = this.planModel;
      if (!pm) return null;
      const dm = this.deps.data.deskCard(this.date);
      const p = dm?.plan ?? null;
      const rows = 'templates' in pm ? targetRows(pm, this.bodyUnits()) : [];
      const targets = rows.length ? { ok: rows.filter((r) => r.status[0] === 'in').length, total: rows.length, others: rows.filter((r) => r.status[0] !== 'in').map((r) => ({ name: r.name, status: r.status[1] })) } : null;
      const desk = dm ? (p ? `${p.times.length} a day, every ${p.every} min from ${p.from} to ${p.to}, ${p.daysText}` : 'None in this plan') : null;
      return { glance: planGlance(pm, { weekTarget: this.model?.review?.adherence.value.target ?? null, targets, desk, links: planLinks(this.deps.data.fitnessFiles).length }), heading: 'What’s on this tab', prefix: null, views: null };
    }
    if (tab === 'checkin') {
      if (!this.checkinModel) return null;
      const body = this.deps.data.bodyRecord(this.date);
      return { glance: checkinGlance(this.checkinModel, { body: body ? body.parts : null }), heading: 'What’s on this tab', prefix: null, views: null };
    }
    if (!this.foodModel) return null;
    return { glance: foodGlance(this.foodModel, { early: this.early.food ?? true }), heading: 'What’s on this tab', prefix: null, views: null };
  }

  /** At a glance under the banner, and each section's fold, on the tab as drawn. */
  private drawGlance(): void {
    const page = this.page;
    if (!page) return;
    page.querySelector('[data-glance]')?.remove();
    const tab = this.deps.settings.lastTab;
    if (tab === 'home' || tab === 'movements') return;
    const hero = page.querySelector('.pv-hero');
    let g: ReturnType<PahlavanView['glanceOf']> = null;
    try {
      g = hero ? this.glanceOf(tab) : null;
    } catch (e) {
      console.error('[Pahlavan] At a glance could not be built', e);
    }
    if (!g || !hero) return;
    const rows: (PanelRow & { card: HTMLElement })[] = [];
    for (const sp of g.glance.sections) {
      const key = g.prefix && sp.id.startsWith(`${g.prefix}.`) ? sp.id.slice(g.prefix.length + 1) : sp.id;
      const card = page.querySelector<HTMLElement>(`[data-sec="${CSS.escape(key)}"]`);
      if (!card) continue;
      const folded = sectionFolded(this.helpState, tab, sp, this.date);
      foldCard(card, { id: sp.id, title: sp.title, status: sp.status, folded, onToggle: (fold) => this.setFolds(tab, { [sp.id]: fold }, fold ? null : sp.id) });
      rows.push({ id: sp.id, title: sp.title, line: sp.line, folded, card });
    }
    // The rows follow the page: top to bottom, then left to right (as laid out; the given order otherwise).
    const at = new Map(rows.map((r) => [r, r.card.getBoundingClientRect()]));
    if (rows.every((r) => at.get(r)!.width > 0)) rows.sort((a, b) => Math.round(at.get(a)!.top / 8) - Math.round(at.get(b)!.top / 8) || at.get(a)!.left - at.get(b)!.left);
    const panel = glancePanel({
      sums: g.glance.sums,
      rows,
      // Home now gives the overview, so Today's panel starts folded; the user's own open or fold still wins.
      open: panelOpen(this.helpState, tab, tab === 'today' ? false : (this.early[tab] ?? true)),
      heading: g.heading,
      views: g.views ? { ...g.views, onView: (id) => {
        this.deps.settings.progressSection = id as never;
        this.deps.saveSettings();
        this.render();
      } } : null,
      onPanel: (open) => void this.helpNow({ op: 'panel', tab, open }),
      onAll: (fold) => this.setFolds(tab, Object.fromEntries(rows.map((r) => [r.id, fold])), null),
      onGo: (id) => this.goToSection(tab, id),
    });
    // Under the banner; on Today under Your day, which sits right under the banner.
    const after = (tab === 'today' ? page.querySelector('[data-live="yourday"]') : null) ?? hero;
    after.parentNode?.insertBefore(panel, after.nextSibling);
  }

  /** Sections folded or opened by the user; one opened by its bar comes into view (a packed layout may move it). */
  private setFolds(tab: GlanceTab, sections: Record<string, boolean>, opened: string | null): void {
    void this.helpNow({ op: 'fold', tab, sections, on: this.date });
    if (opened) this.secEl(opened)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  private secEl(id: string): HTMLElement | null {
    const dot = id.indexOf('.');
    return (this.page?.querySelector(`[data-sec="${CSS.escape(dot >= 0 ? id.slice(dot + 1) : id)}"]`) as HTMLElement | null) ?? null;
  }

  /** A row of What's on this tab: the section opens if it was folded, comes to the top and lights up once. */
  private goToSection(tab: GlanceTab, id: string): void {
    if (this.secEl(id)?.classList.contains('is-folded')) this.setFolds(tab, { [id]: false }, null);
    const el = this.secEl(id);
    if (!el) return;
    el.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    flash(el);
  }

  // ---------------------------------------------------------------- the help

  /** The welcome card on Today: until its five steps are done, or hidden (Coach/help.json). */
  private welcomeEl(): HTMLElement | null {
    const read = this.deps.data.current;
    if (!read || this.helpState?.welcomeHidden) return null;
    const w = welcomeSteps(read, this.date).value;
    if (w.complete) return null;
    const coach = this.deps.coach;
    this.lookAtCoach();
    return welcomeCard({
      welcome: w,
      ...(coach ? { coach: { state: this.coachStatus?.state ?? 'checking', node: this.coachStatus ? this.coachStatus.node : null, onSetUp: () => void this.setUpCoach() } } : {}),
      ...(this.deps.copy ? { onCopy: (text: string) => this.copyCommand(text) } : {}),
      onGuide: () => this.openGuide(),
      onTour: () => void this.tour(),
      onHide: () => void this.changeHelp({ op: 'hide-welcome', on: this.date }, 'The welcome card is hidden. The ? at the top keeps the guide and the tips.'),
    });
  }

  /**
   * The coach's state, looked up once (and again after setting it up): the
   * welcome card draws "checking" until then, and Home adds its need once it
   * is known. At the same version, files that differ are the user's own
   * edits, not a step to do; a newer coach is set up, and Pahlavan is the
   * one to update.
   */
  private lookAtCoach(): void {
    const coach = this.deps.coach;
    if (!coach || this.coachAsked) return;
    this.coachAsked = true;
    void coach.state().then((st) => {
      const state = st.direction === 'not-set-up' ? 'missing' : st.direction === 'coach-older' ? 'old' : st.direction === 'coach-newer' ? 'newer' : st.missing.length ? 'missing' : 'ok';
      this.coachStatus = { state, node: nodeOk(st.node?.version ?? null), direction: st.direction, installed: st.installed, bundled: st.bundled };
      this.render();
    }, () => undefined);
  }

  /** The coach was set up or updated from elsewhere (the settings, the command): look at it again. */
  coachChanged(): void {
    this.coachAsked = false;
    this.coachStatus = null;
    this.render();
  }

  /** The welcome card's Set up the coach: writes the skill, says so, and looks again. */
  private async setUpCoach(): Promise<void> {
    const coach = this.deps.coach;
    if (!coach) return;
    const r = await coach.setUp();
    this.deps.notify(r.ok ? `The coach is set up (${r.written.length} files). Start Claude Code in this vault and run /fitness-coach intake.` : `The coach was not set up: ${r.error}`);
    this.coachChanged();
  }

  private openGuide(): void {
    if (this.deps.openGuide) this.deps.openGuide();
    else this.deps.notify('The user guide opens from the Pahlavan app.');
  }

  /** A change to Coach/help.json, then the screen again. */
  private async changeHelp(ch: HelpChange, done?: string): Promise<void> {
    const store = this.deps.help;
    if (!store) return;
    try {
      this.helpState = await store.apply(ch);
      if (done) this.deps.notify(done);
    } catch (e) {
      this.deps.notify(`The help could not be saved: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.render();
  }

  /** "Show the tips again" (the ? menu, Settings): every tip once more, each when its screen opens. */
  async resetTips(): Promise<void> {
    this.tipScroll = true;
    await this.changeHelp({ op: 'reset' }, 'The tips show again, one at a time, as each screen opens.');
  }

  /** The help changed elsewhere (Settings): read it again. */
  async helpChanged(): Promise<void> {
    this.helpState = this.deps.help ? await this.deps.help.read() : null;
    this.render();
  }

  /** "Show me around": the tips from the start, on Today. */
  private async tour(): Promise<void> {
    this.tipScroll = true;
    if (this.deps.settings.lastTab !== 'today') this.show('today');
    await this.changeHelp({ op: 'reset' });
  }

  /** The screen's next tip beside its element, one at a time; none while a reminder card or the Log panel is open. */
  private placeTip(): void {
    this.tipEl?.remove();
    this.tipEl = null;
    const st = this.helpState;
    const page = this.page;
    if (!st || !page || !this.deps.help || this.logForm) return;
    if (this.deps.reminders?.cardOpen || page.ownerDocument.querySelector('.modal.isfahan-card, .modal.pv-card-modal')) return;
    const tab = this.deps.settings.lastTab;
    const screen = tab === 'today' ? 'today' : tab === 'checkin' ? 'checkin' : tab === 'progress' && (this.deps.settings.progressSection ?? 'overview') !== 'habits' ? 'progress' : null;
    if (!screen) return;
    // A tip waits while its element is in a folded section: the first match that is on show.
    const shown = (sel: string) => ([...page.querySelectorAll(sel)] as HTMLElement[]).find((el) => !el.closest('.pv-card.is-folded')) ?? null;
    const tip = nextTip(st, screen, (sel) => shown(sel) !== null);
    if (!tip) return;
    const target = shown(tip.at)!;
    const el = tipBubble({ tip, n: TIPS.indexOf(tip) + 1, total: TIPS.length, onGot: () => void this.seeTips([tip.id]), onSkip: () => void this.seeTips(TIPS.map((t) => t.id)) });
    // Beside a tall element when there is room on its right, else under it (clamped to the page).
    const pr = page.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    const W = 300;
    const right = tr.height > 140 && tr.right - pr.left + 14 + W <= pr.width;
    const left = right ? tr.right - pr.left + 14 : Math.max(0, Math.min(tr.left - pr.left, pr.width - W));
    const top = right ? tr.top - pr.top + 8 : tr.bottom - pr.top + 10;
    el.classList.add(right ? 'is-right' : 'is-below');
    Object.assign(el.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${W}px` });
    // Under an element the arrow points at its middle (or its start, for a wide one).
    if (!right) el.style.setProperty('--pv-tip-arrow', `${Math.round(Math.max(14, Math.min(W - 28, (tr.width > W ? tr.left + 24 : tr.left + tr.width / 2) - pr.left - left - 6)))}px`);
    page.appendChild(el);
    this.tipEl = el;
    if (this.tipScroll) {
      this.tipScroll = false;
      el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
  }

  private async seeTips(ids: TipId[]): Promise<void> {
    this.tipScroll = true;
    await this.changeHelp({ op: 'seen', tips: ids, on: this.date });
  }

  /** Re-themes the banner when Isfahan changes the phase (or the hour does, with Isfahan off). */
  private syncPhase(): void {
    const next = phaseNow(this.deps.bodyClasses(), this.deps.hour());
    if (next.id === this.phase.id && next.isfahan === this.phase.isfahan) return;
    this.phase = next;
    const hero = this.contentEl.querySelector('.pv-hero');
    if (!hero) return;
    hero.classList.remove('is-dawn', 'is-workday', 'is-evening', 'is-night');
    hero.classList.add(`is-${next.id}`);
    hero.classList.toggle('has-tile', next.isfahan);
  }

  /** The minute tick: a new day reloads; otherwise the hour may move the phase. */
  private tick(): void {
    if (this.deps.today() !== this.date) void this.reload();
    else this.syncPhase();
  }
}

/** The photo folders dated on or after `since` (all of them without one). */
function inRange(files: PhotoFiles, since: string | null): PhotoFiles {
  return since ? Object.fromEntries(Object.entries(files).filter(([d]) => d >= since)) : files;
}
