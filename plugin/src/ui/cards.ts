// The reminder cards, drawn as signed off in mockups/reminders.html: the
// head (icon, kicker, title, the line under it, × or "Stays open"), the
// body for each kind, the Why line, and the foot (Skip today or Not today,
// the Snooze menu with "Skip this photo day", Save or Done). One controller
// draws a CardView into a plain element and keeps what is typed or ticked
// between redraws, so the Obsidian modal and the preview share it. Standard
// DOM only; the answers go to the machine through `controls`.

import { TAPE_FIELDS, TEST_FIELDS, type MorningKey, type RecordValues } from '../../../src/adapters/vault/body-write.ts';
import { hm } from '../../../src/core/sitting.ts';
import type { CardField, CardView } from '../reminders/card-model.ts';
import { morningValues, recordValues } from '../reminders/inputs.ts';
import type { CardAnswer, CardPayload } from '../reminders/machine.ts';
import type { PhotoIn } from '../reminders/writer.ts';
import { h, icon, type Child } from './dom.ts';
import { fmt } from './format.ts';

export interface CardControls {
  answer(a: CardAnswer): Promise<void>;
  /** The ×: closing, which counts as a snooze. */
  close(): void;
}

/** A photo on a pose's drop zone: its name, and the file (null in the preview, which has only names). */
export interface PhotoPick {
  name: string;
  file: Blob | null;
  url: string | null;
}

interface Draft {
  scales: Partial<Record<MorningKey, number | null>>;
  /** The morning card's quick sore-areas pick, by area id. */
  sore: Record<string, 'mild' | 'sore' | null>;
  fields: Partial<Record<MorningKey, string>>;
  tape: Record<string, string>;
  tests: Record<string, string>;
  ticks: Record<string, boolean>;
  added: number;
  another: string;
  photos: Record<string, PhotoPick>;
}

const n = (v: number) => v.toLocaleString('en-GB');
const isHeic = (name: string) => /\.hei[cf]$/i.test(name);
const isImage = (f: { name: string; type?: string }) => /^image\//.test(f.type ?? '') || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(f.name);

export class CardController {
  readonly el: HTMLElement;
  private view: CardView;
  private draft: Draft;
  private readonly controls: CardControls;
  private menu = false;
  private msg: { text: string; conflict: boolean } | null = null;
  private saving = false;
  private touched = false;
  private conflict = false;

  constructor(view: CardView, controls: CardControls, opts: { menu?: boolean; photos?: Record<string, PhotoPick> } = {}) {
    this.view = view;
    this.controls = controls;
    this.draft = freshDraft(view);
    if (opts.photos) this.draft.photos = { ...opts.photos };
    this.menu = opts.menu === true;
    this.el = h('div', { class: 'pahlavan-view pv-nv' });
    this.el.addEventListener('click', (ev) => {
      if (!this.menu) return;
      const t = ev.target as HTMLElement | null;
      if (t && t.closest('.pv-nv-snooze')) return;
      this.menu = false;
      this.draw();
    });
    this.draw();
  }

  /** A new view of the same card keeps what is typed; another card starts afresh. */
  update(view: CardView): void {
    const same = view.key === this.view.key && view.body.kind === this.view.body.kind && (view.body.kind !== 'morning' || (this.view.body.kind === 'morning' && Boolean(view.body.tape) === Boolean(this.view.body.tape)));
    const keepPhotos = this.draft.photos;
    if (!same) {
      this.draft = freshDraft(view);
      if (view.key === this.view.key) this.draft.photos = keepPhotos;
      this.touched = false;
    } else if (view.body.kind === 'morning' && !view.body.tape) this.draft.tape = {};
    this.view = view;
    this.saving = false;
    this.draw();
  }

  message(text: string | null, opts: { conflict?: boolean } = {}): void {
    this.msg = text ? { text, conflict: opts.conflict === true } : null;
    this.conflict = opts.conflict === true;
    this.saving = false;
    this.draw();
  }

  dirty(): boolean {
    return this.touched;
  }

  focus(): void {
    this.el.querySelector<HTMLElement>('.pv-btn-primary, .pv-nv-choice')?.focus();
  }

  /** Enter on the card: the main button. */
  submit(): void {
    if (this.view.primary && !this.saving) void this.primary();
  }

  /** Object URLs made for the photo thumbnails, to free on close. */
  urls(): string[] {
    return Object.values(this.draft.photos).map((p) => p.url).filter((u): u is string => Boolean(u));
  }

  // ------------------------------------------------------------ drawing

  private draw(): void {
    const v = this.view;
    this.el.className = `pahlavan-view pv-nv is-${v.kind}${v.kind === 'standup' && !v.closable ? ' is-stand' : ''}`;
    this.el.replaceChildren(...[
      this.head(),
      h('div', { class: 'pv-nv-body' }, this.body()),
      this.msg ? h('div', { class: `pv-nv-msg${this.msg.conflict ? ' is-conflict' : ''}`, role: 'alert' }, icon('alert'), h('span', {}, this.msg.text)) : null,
      // The rule id is internal: on the element and in its hover title, never in the text.
      h('div', { class: 'pv-nv-why', 'data-rule': v.why.rule, title: `Rule ${v.why.rule}` }, icon('info'), h('div', {}, h('span', {}, v.why.note))),
      this.foot(),
    ].filter((x): x is HTMLElement => x !== null));
  }

  private head(): HTMLElement {
    const v = this.view;
    return h('div', { class: 'pv-nv-head' },
      h('span', { class: 'pv-nv-icon' }, icon(v.icon)),
      h('div', { class: 'pv-nv-head-t' }, h('div', { class: 'pv-kicker' }, v.kicker), h('h3', { class: 'pv-nv-title' }, v.title), h('div', { class: 'pv-nv-sub' }, v.sub)),
      v.closable ? h('button', { class: 'pv-nv-x', 'aria-label': 'Close', title: v.manual ? 'Close' : 'Close (a snooze)', onclick: () => this.controls.close() }, icon('x')) : h('span', { class: 'pv-tag', title: 'This card stays until you stand or snooze' }, 'Stays open'),
    );
  }

  private foot(): HTMLElement {
    const v = this.view;
    const left: Child[] = [];
    if (v.manual) left.push(h('button', { class: 'pv-btn-quiet', onclick: () => this.controls.close() }, 'Cancel'));
    if (v.body.kind === 'standup' && v.body.standing) left.push(h('button', { class: 'pv-btn-quiet', onclick: () => void this.send({ do: 'end-stand' }) }, 'End this stand'));
    if (v.skip) left.push(h('button', { class: 'pv-btn-quiet', disabled: this.saving, onclick: () => void this.send({ do: v.skip!.action }) }, v.skip.label));
    if (v.snooze || v.skipPeriod) left.push(this.snooze());
    let primary: Child = null;
    if (v.primary) {
      const label = v.body.kind === 'photos' ? photoLabel(Object.keys(this.draft.photos).length) : v.primary;
      const off = this.saving || (v.body.kind === 'photos' && !Object.keys(this.draft.photos).length);
      primary = h('button', { class: 'pv-btn-primary', disabled: off, onclick: () => void this.primary() }, icon('check'), this.saving ? 'Saving…' : this.conflict ? `${label}: keep mine` : label);
    } else if (v.body.kind === 'standup' && v.body.standing) {
      primary = h('button', { class: 'pv-btn-primary', onclick: () => this.controls.close() }, 'Close');
    }
    return h('div', { class: 'pv-nv-foot' }, h('div', { class: 'pv-nv-foot-l' }, left), primary);
  }

  private snooze(): HTMLElement {
    const v = this.view;
    const items: Child[] = (v.snooze ?? []).map((e) => h('button', { role: 'menuitem', onclick: () => void this.send({ do: 'snooze', choice: e.choice }) }, h('span', {}, e.label), e.isDefault ? h('span', { class: 'pv-faint' }, 'default') : null));
    if (v.skipPeriod) {
      if (items.length) items.push(h('div', { class: 'pv-nv-menu-sep' }));
      items.push(h('button', { role: 'menuitem', onclick: () => void this.send({ do: 'skip-period' }) }, h('span', {}, v.skipPeriod.label), h('span', { class: 'pv-faint' }, v.skipPeriod.next ? `next: ${v.skipPeriod.next}` : 'none planned')));
    }
    return h('div', { class: 'pv-nv-snooze' },
      h('button', { class: `pv-btn-quiet${this.menu ? ' is-on' : ''}`, 'aria-haspopup': 'menu', 'aria-expanded': this.menu ? 'true' : 'false', onclick: () => { this.menu = !this.menu; this.draw(); } }, icon('clock'), v.snooze ? 'Snooze' : 'More', icon('chevron')),
      this.menu ? h('div', { class: 'pv-nv-menu', role: 'menu' }, items) : null,
    );
  }

  private body(): Child {
    const b = this.view.body;
    switch (b.kind) {
      case 'morning':
        return [
          h('div', { class: 'pv-nv-taps' }, b.scales.map((sc) => this.tapRow(sc.key, sc.label, sc.lo, sc.hi))),
          h('div', { class: 'pv-nv-fields is-5' }, b.fields.map((f) => this.field(f, this.draft.fields as Record<string, string>))),
          b.tape ? this.tapeSection(b.tape.text, b.tape.fields) : null,
          this.soreRow(b.sore),
          h('div', { class: 'pv-nv-link' }, icon('body'), h('span', {}, 'Another muscle: the body map in the Check-in screen'), h('a', { href: '#', onclick: (ev: Event) => { ev.preventDefault(); void this.send({ do: 'open-checkin' }); } }, 'Open Check-in')),
        ];
      case 'tape':
        return this.tapeSection(b.tape.text, b.tape.fields, true);
      case 'habits':
        return [
          h('ul', { class: 'pv-nv-habits' }, b.items.map((it) => {
            const on = this.draft.ticks[it.id] === true;
            return h('li', {},
              h('button', { class: `pv-nv-tick is-big${on ? ' is-on' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'aria-label': it.name, onclick: () => { this.draft.ticks[it.id] = !on; this.touched = true; this.draw(); } }, on ? icon('check') : null),
              h('div', {}, h('b', {}, it.name), it.dose ? [' ', h('span', { class: 'pv-nv-dose' }, it.dose)] : null, ' ', h('span', { class: 'pv-nv-kind' }, it.kind === 'supplement' ? 'Supplement' : 'Tick'), it.note ? h('div', { class: 'pv-faint' }, it.note) : null),
              it.habit ? h('span', { class: 'pv-tag', title: 'Ticks its linked habit too' }, icon('link'), it.habit) : h('span', {}),
            );
          })),
          h('div', { class: 'pv-nv-row-actions' }, h('button', { class: 'pv-btn-quiet', onclick: () => { for (const it of b.items) this.draft.ticks[it.id] = true; this.touched = true; this.draw(); } }, icon('check'), 'Tick all'), h('span', { class: 'pv-faint' }, 'Untick anything you didn’t take; linked ones tick the linked habit too.')),
        ];
      case 'amount': {
        const value = b.value + this.draft.added;
        const pct = Math.min(100, (value / b.target) * 100);
        const addAnother = () => {
          const v = Number(this.draft.another.replace(',', '.'));
          if (Number.isFinite(v) && v > 0) {
            this.draft.added += v;
            this.draft.another = '';
            this.touched = true;
            this.draw();
          }
        };
        return [
          h('div', { class: 'pv-nv-amt is-big' },
            h('div', { class: 'pv-nv-amt-top' }, h('span', {}, h('b', {}, n(value)), ` / ${n(b.target)} ${b.unit}`), h('span', { class: 'pv-faint' }, value >= b.target ? 'target met' : `${n(b.target - value)} to go`)),
            h('div', { class: 'pv-nv-bar', role: 'img', 'aria-label': `${value} of ${b.target} ${b.unit}` }, h('i', { style: `width:${pct}%` })),
            b.quick.length ? h('div', { class: 'pv-nv-quick' }, b.quick.map((q) => h('button', { class: 'pv-btn-quiet', onclick: () => { this.draft.added += q; this.touched = true; this.draw(); } }, `+${n(q)} ${b.unit}`))) : null,
          ),
          h('div', { class: 'pv-nv-more' },
            h('label', { class: 'pv-field pv-nv-field' }, h('span', {}, 'Another amount'), h('span', { class: 'pv-field-in' }, h('input', { type: 'number', inputmode: 'decimal', placeholder: b.placeholder ? String(b.placeholder) : '', value: this.draft.another, oninput: (ev: Event) => { this.draft.another = (ev.target as HTMLInputElement).value; this.touched = true; }, onkeydown: (ev: Event) => { if ((ev as KeyboardEvent).key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); addAnother(); } } }), h('em', {}, b.unit))),
            h('button', { class: 'pv-btn-quiet', onclick: addAnother }, icon('plus'), 'Add'),
            this.draft.added ? h('span', { class: 'pv-nv-added' }, `+${n(this.draft.added)} ${b.unit} on Done`) : null,
          ),
          h('div', { class: 'pv-nv-note' }, icon('clock'), h('span', {}, `${b.next ? `Next card at ${b.next} if you’re still under ${n(b.target)} ${b.unit}.` : `No more cards today after this one.`} ${b.unit.toLowerCase() === 'ml' ? 'Water' : 'An amount'} logged on Today restarts the count.`)),
        ];
      }
      case 'standup': {
        if (b.standing) {
          const pct = Math.min(100, (b.standing.stood / b.standMinutes) * 100);
          return h('div', { class: 'pv-nv-stand' },
            h('div', { class: 'pv-nv-stand-n' }, h('b', {}, String(b.standing.left)), h('span', {}, b.standing.left === 1 ? 'minute to go' : 'minutes to go')),
            h('div', { class: 'pv-nv-stand-t' },
              h('div', { class: 'pv-nv-bar is-big' }, h('i', { style: `width:${pct}%` })),
              h('p', {}, 'Standing for ', h('b', {}, `${b.standMinutes} minutes`), '. The count goes on with this card closed; the status bar shows it. With no keyboard or mouse for a few minutes it ends uncounted.'),
            ),
          );
        }
        return h('div', { class: 'pv-nv-stand' },
          h('div', { class: 'pv-nv-stand-n' }, h('b', {}, String(b.satMinutes)), h('span', {}, 'minutes sitting')),
          h('div', { class: 'pv-nv-stand-t' },
            h('div', { class: 'pv-nv-bar is-big' }, h('i', { class: 'is-full' })),
            h('p', {}, 'Stand for ', h('b', {}, `${b.standMinutes} minutes`), ': take the next call standing, or raise the desk. The count is minutes you were actually at the keyboard or mouse; time away resets it.'),
          ),
        );
      }
      case 'sitting': {
        const over = b.longest > b.stretchMax;
        const top = b.stretch !== null
          ? h('div', { class: 'pv-nv-amt-top' }, h('span', {}, h('b', {}, `${b.stretch} min`), ' this stretch'), h('span', { class: 'pv-faint' }, `today ${hm(b.minutes)} of ${hm(b.limit)}`))
          : h('div', { class: 'pv-nv-amt-top' }, h('span', {}, h('b', {}, hm(b.minutes)), ` of ${hm(b.limit)}`), h('span', { class: 'pv-faint' }, 'longest stretch ', h('b', { class: over ? 'is-over' : '' }, over ? icon('alert') : null, `${b.longest} min`), ` / ${b.stretchMax}`));
        const pct = b.stretch !== null ? Math.min(100, (b.stretch / b.stretchMax) * 100) : Math.min(100, (b.minutes / b.limit) * 100);
        return [
          h('div', { class: 'pv-nv-amt is-limit is-big' }, top, h('div', { class: 'pv-nv-bar', role: 'img', 'aria-label': `${hm(b.minutes)} sitting of ${hm(b.limit)}` }, h('i', { style: `width:${pct}%` }))),
          h('p', { class: 'pv-nv-lead' }, b.lead),
          h('ul', { class: 'pv-nv-ideas' }, b.ideas.map((x) => h('li', {}, icon(x.icon), x.text))),
        ];
      }
      case 'desk':
        return h('ol', { class: 'pv-nv-steps' }, b.steps.map((st, i) => h('li', {}, h('span', { class: 'pv-nv-step-n' }, String(i + 1)), h('div', {}, h('b', {}, st.name), ' ', h('span', { class: 'pv-nv-dose' }, st.dose), st.how ? h('div', { class: 'pv-faint' }, st.how) : null))));
      case 'photos':
        return [
          h('div', { class: 'pv-nv-poses' }, b.poses.map((p) => this.pose(p))),
          h('div', { class: 'pv-nv-note' }, icon('camera'), h('span', {}, `iPhone photos (HEIC) are fine: they’re converted to JPEG and resized to 1600 px. Drop several at once to fill the empty ones in order.${b.last ? ` Same light, place and time of day as last time (${fmt.wd(b.last)}).` : ''}`)),
        ];
      case 'tests':
        return h('div', { class: 'pv-nv-fields is-2' }, b.fields.map((f) => this.field(f, this.draft.tests)));
      case 'coach':
        return [
          h('p', { class: 'pv-nv-lead' }, b.lead),
          h('div', { class: 'pv-nv-cmd' },
            h('code', {}, b.command),
            h('button', { class: 'pv-btn-quiet', 'aria-label': `Copy ${b.command}`, onclick: () => void this.send({ do: 'copy', text: b.command }) }, icon('copy'), 'Copy')),
          h('div', { class: 'pv-nv-note' }, icon('clock'), h('span', {}, 'OK hides this card for today; Copy keeps it open.')),
        ];
      case 'train':
        return [
          h('p', { class: 'pv-nv-lead' }, b.lead),
          h('div', { class: 'pv-nv-choices' },
            this.choice('plus', 'Log session', b.session ? `Opens the log with ${b.session} filled in` : 'Opens the log for today', 'logged', true),
            this.choice('moon', 'Rest day', 'Marks it rest; the week’s count stays honest', 'rest'),
            this.choice('x', 'Not today', 'No answer now; Sunday’s check-in asks about it', 'not-today'),
          ),
        ];
    }
  }

  private choice(ic: string, title: string, sub: string, choice: 'logged' | 'rest' | 'not-today', main = false): HTMLElement {
    return h('button', { class: `pv-nv-choice${main ? ' is-main' : ''}`, disabled: this.saving, onclick: () => void this.send({ do: 'train', choice }) }, icon(ic), h('div', {}, h('b', {}, title), h('span', {}, sub)));
  }

  /** Sore today: one tap per area, none to mild to sore, as the body map's taps go. */
  private soreRow(areas: readonly { id: string; label: string; level: 'mild' | 'sore' | null }[]): HTMLElement {
    const next = { none: 'mild', mild: 'sore', sore: null } as const;
    return h('div', { class: 'pv-nv-sore' },
      h('span', { class: 'pv-tap-label' }, 'Sore today'),
      h('div', { class: 'pv-nv-sore-chips', role: 'group', 'aria-label': 'Sore today: tap for mild, again for sore' }, areas.map((a) => {
        const v = this.draft.sore[a.id] ?? null;
        return h('button', { class: `pv-nv-sore-chip${v ? ` is-${v}` : ''}`, 'aria-pressed': v ? 'true' : 'false', 'aria-label': `${a.label}: ${v ?? 'not sore'}`, 'data-area': a.id, onclick: () => { this.draft.sore[a.id] = next[v ?? 'none']; this.touched = true; this.draw(); } }, a.label, v ? h('em', {}, v === 'sore' ? 'sore' : 'mild') : null);
      })),
    );
  }

  private tapRow(key: MorningKey, label: string, lo: string, hi: string): HTMLElement {
    const v = this.draft.scales[key] ?? null;
    return h('div', { class: 'pv-tap-row is-compact' },
      h('span', { class: 'pv-tap-label' }, label),
      h('div', { class: 'pv-tap5' }, [1, 2, 3, 4, 5].map((k) => h('button', { class: `pv-tap${v === k ? ' is-on' : ''}`, 'aria-label': `${label} ${k}`, 'aria-pressed': v === k ? 'true' : 'false', onclick: () => { this.draft.scales[key] = v === k ? null : k; this.touched = true; this.draw(); } }, String(k)))),
      h('span', { class: 'pv-tap-anchor' }, `${lo} to ${hi}`),
    );
  }

  private field(f: CardField, into: Record<string, string>): HTMLElement {
    const val = into[f.id] ?? f.value;
    return h('label', { class: 'pv-field pv-nv-field', 'data-field': f.id },
      h('span', {}, f.label),
      h('span', { class: 'pv-field-in' },
        h('input', { type: 'text', inputmode: f.text ? 'text' : 'decimal', autocomplete: 'off', spellcheck: 'false', value: val, placeholder: f.placeholder, oninput: (ev: Event) => { into[f.id] = (ev.target as HTMLInputElement).value; this.touched = true; (ev.target as HTMLElement).closest('.pv-nv-field')?.classList.remove('is-bad'); } }),
        f.unit ? h('em', {}, f.unit) : null),
      f.hint ? h('small', {}, f.hint) : null,
    );
  }

  private tapeSection(text: string, fields: CardField[], alone = false): HTMLElement {
    return h('div', { class: `pv-nv-sec${alone ? ' is-alone' : ''}` },
      alone ? null : h('div', { class: 'pv-nv-sec-h' }, icon('tape'), 'Tape day ', text ? h('span', { class: 'pv-faint' }, text) : null),
      h('div', { class: 'pv-nv-fields is-4' }, fields.map((f) => this.field(f, this.draft.tape))),
    );
  }

  private pose(p: { id: string; name: string }): HTMLElement {
    const pick = this.draft.photos[p.id];
    const input = h('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'pv-nv-file', 'aria-label': `${p.name} photo` });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) this.put(p.id, f);
    });
    const box = h('div', { class: 'pv-nv-pose-box', role: 'button', tabindex: '0', onclick: () => input.click() },
      pick
        ? [pick.url ? h('img', { class: 'pv-nv-thumb-img', src: pick.url, alt: p.name }) : h('div', { class: 'pv-nv-thumb' }, icon('body')), h('span', { class: 'pv-nv-pose-ok' }, icon('check'))]
        : [icon('upload'), h('span', {}, 'Drop a photo', h('br'), 'or choose')],
    );
    box.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      box.classList.add('is-over');
    });
    box.addEventListener('dragleave', () => box.classList.remove('is-over'));
    box.addEventListener('drop', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      box.classList.remove('is-over');
      this.fill([...(ev.dataTransfer?.files ?? [])], p.id);
    });
    const out = pick ? `${pick.name} → ${p.id}.jpeg` : 'not added';
    return h('div', { class: `pv-nv-pose${pick ? ' is-filled' : ''}` }, box, input, h('b', {}, p.name), h('small', { title: out }, out));
  }

  /** Files dropped on a zone: the first there, the rest into the empty zones in pose order (Habit Nudges' fill). */
  private fill(files: File[], first: string | null): void {
    const list = files.filter((f) => isImage(f));
    if (first && list.length) this.put(first, list.shift()!, false);
    if (this.view.body.kind === 'photos') {
      for (const p of this.view.body.poses) {
        if (!list.length) break;
        if (!this.draft.photos[p.id]) this.put(p.id, list.shift()!, false);
      }
    }
    this.draw();
  }

  private put(pose: string, file: File, redraw = true): void {
    const old = this.draft.photos[pose];
    if (old?.url) URL.revokeObjectURL(old.url);
    // Chromium can't draw HEIC; it is converted on save, so the zone shows a tick and the name.
    const url = isHeic(file.name) ? null : URL.createObjectURL(file);
    this.draft.photos[pose] = { name: file.name, file, url };
    this.touched = true;
    if (redraw) this.draw();
  }

  // ------------------------------------------------------------ answers

  private async send(a: CardAnswer): Promise<void> {
    if (this.saving) return;
    this.menu = false;
    await this.controls.answer(a);
  }

  private async primary(): Promise<void> {
    const v = this.view;
    if (v.body.kind === 'standup') {
      await this.send({ do: 'stand' });
      return;
    }
    const payload = await this.payload();
    if (!payload) return;
    this.saving = true;
    this.msg = null;
    this.draw();
    try {
      await this.controls.answer({ do: 'save', payload });
    } finally {
      if (this.saving) {
        this.saving = false;
        this.draw();
      }
    }
  }

  /** What Save sends, or null (with the reason on the card) when a field does not read. */
  private async payload(): Promise<CardPayload | null> {
    const v = this.view;
    const b = v.body;
    const force = this.conflict;
    const bad = (ids: string[], errors: string[]) => {
      this.msg = { text: errors.join('; '), conflict: false };
      this.draw();
      for (const id of ids) this.el.querySelector(`[data-field="${id}"]`)?.classList.add('is-bad');
      this.el.querySelector<HTMLInputElement>(`[data-field="${ids[0]}"] input`)?.focus();
      return null;
    };
    switch (b.kind) {
      case 'morning': {
        const startScales = Object.fromEntries(b.scales.map((s) => [s.key, s.value])) as Partial<Record<MorningKey, number | null>>;
        const startFields = Object.fromEntries(b.fields.map((f) => [f.id, f.value])) as Partial<Record<MorningKey, string>>;
        const now = morningValues(this.draft.scales, { ...startFields, ...this.draft.fields }, v.units);
        if (now.errors.length) return bad(now.bad, now.errors);
        const base = morningValues(startScales, startFields, v.units).values;
        // The areas changed on the card: each of their muscles at the area's new level (null clears).
        const sore: Record<string, 'mild' | 'sore' | null> = {};
        for (const a of b.sore) {
          const v = this.draft.sore[a.id] ?? null;
          if (v !== a.level) for (const m of a.muscles) sore[m] = v;
        }
        const out: CardPayload = { kind: 'morning', values: now.values, baseline: base, ...(Object.keys(sore).length ? { sore } : {}), ...(force ? { force: true } : {}) };
        if (b.tape) {
          const t = recordValues(TAPE_FIELDS, { ...Object.fromEntries(b.tape.fields.map((f) => [f.id, f.value])), ...this.draft.tape }, v.units);
          if (t.errors.length) return bad(t.bad, t.errors);
          const tb = recordValues(TAPE_FIELDS, Object.fromEntries(b.tape.fields.map((f) => [f.id, f.value])), v.units).values;
          const changed = onlyChanged(t.values, tb);
          out.tape = changed.values;
          out.tapeBaseline = changed.baseline;
        }
        return out;
      }
      case 'tape':
      case 'tests': {
        const defs = b.kind === 'tape' ? TAPE_FIELDS : TEST_FIELDS;
        const fields = b.kind === 'tape' ? b.tape.fields : b.fields;
        const typed = b.kind === 'tape' ? this.draft.tape : this.draft.tests;
        const start = Object.fromEntries(fields.map((f) => [f.id, f.value]));
        const r = recordValues(defs, { ...start, ...typed }, v.units);
        if (r.errors.length) return bad(r.bad, r.errors);
        if (!Object.values(r.values).some((x) => x !== null)) return bad([fields[0]!.id], [b.kind === 'tests' ? 'Enter at least one test, or choose Not today' : 'Enter at least one measurement, or choose Not today']);
        const changed = onlyChanged(r.values, recordValues(defs, start, v.units).values);
        return { kind: b.kind, values: changed.values, baseline: changed.baseline, ...(force ? { force: true } : {}) };
      }
      case 'habits':
        return { kind: 'habits', ticks: { ...this.draft.ticks } };
      case 'amount':
        return { kind: 'amount', add: this.draft.added };
      case 'photos': {
        const files: PhotoIn[] = [];
        for (const [pose, p] of Object.entries(this.draft.photos)) {
          if (!p.file) continue;
          files.push({ pose, name: p.name, data: await p.file.arrayBuffer() });
        }
        return { kind: 'photos', files };
      }
      case 'desk':
        return { kind: 'desk' };
      case 'sitting':
        return { kind: 'sitting' };
      case 'coach':
        return { kind: 'coach' };
      default:
        return null;
    }
  }
}

function freshDraft(v: CardView): Draft {
  const d: Draft = { scales: {}, sore: {}, fields: {}, tape: {}, tests: {}, ticks: {}, added: 0, another: '', photos: {} };
  const b = v.body;
  if (b.kind === 'morning') {
    for (const s of b.scales) d.scales[s.key] = s.value;
    for (const a of b.sore) d.sore[a.id] = a.level;
  }
  if (b.kind === 'habits') for (const it of b.items) d.ticks[it.id] = it.done;
  return d;
}

/** Only the fields changed on the card go to the field-by-field merge: one changed on disk meanwhile, and not here, stays. */
function onlyChanged(values: RecordValues, baseline: RecordValues): { values: RecordValues; baseline: RecordValues } {
  const out = { values: {} as RecordValues, baseline: {} as RecordValues };
  for (const k of Object.keys(values)) {
    if ((values[k] ?? null) === (baseline[k] ?? null)) continue;
    out.values[k] = values[k] ?? null;
    out.baseline[k] = baseline[k] ?? null;
  }
  return out;
}

const photoLabel = (k: number) => (k ? `Save ${k} photo${k === 1 ? '' : 's'}` : 'Save photos');
