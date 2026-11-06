// A reminder card in Obsidian: a Modal holding the card controller. Closing
// it (×, Esc, a click outside) tells the machine, which counts it as a
// snooze. The stand-up card can't be closed that way, only stood or
// snoozed (Habit Nudges' StandModal): Esc and the background do nothing
// until the machine lets it go. Enter is the main button (through the
// modal's scope, so nothing needs the focus when the card opens).
//
// No field here may shadow a Modal member (the guard test checks this file
// as it checks the view).

import { Modal, type App } from 'obsidian';
import type { CardView } from './reminders/card-model.ts';
import type { CardActions, CardHandle, CardUi } from './reminders/machine.ts';
import { CardController, type PhotoPick } from './ui/cards.ts';

export class CardModal extends Modal {
  private readonly card: CardController;
  private readonly actions: CardActions;
  /** Closable by the user (false for a stand-up that is due). */
  private userClose: boolean;
  /** The machine asked for the close. */
  private letGo = false;
  private gone = false;

  /** `start`: the preview opens a card with its Snooze menu open, or photos already chosen. */
  constructor(app: App, view: CardView, actions: CardActions, start: { menu?: boolean; photos?: Record<string, PhotoPick> } = {}) {
    super(app);
    this.actions = actions;
    this.userClose = view.closable;
    this.card = new CardController(view, { answer: (a) => actions.answer(a), close: () => this.close() }, start);
  }

  override onOpen(): void {
    this.modalEl.classList.add('pahlavan-modal');
    this.containerEl.classList.add('pahlavan-modal-container');
    this.modalEl.classList.toggle('is-stand', !this.userClose);
    this.contentEl.replaceChildren(this.card.el);
    this.scope.register([], 'Enter', (ev) => {
      const t = ev.target as HTMLElement | null;
      if (t && t.tagName === 'TEXTAREA') return true;
      this.card.submit();
      return false;
    });
  }

  override close(): void {
    if (!this.userClose && !this.letGo) return;
    super.close();
  }

  override onClose(): void {
    for (const u of this.card.urls()) URL.revokeObjectURL(u);
    this.contentEl.replaceChildren();
    if (this.gone) return;
    this.gone = true;
    this.actions.closed();
  }

  /** The handle the machine keeps. */
  handle(): CardHandle {
    return {
      update: (view) => {
        this.userClose = view.closable;
        this.modalEl.classList.toggle('is-stand', !this.userClose);
        this.card.update(view);
      },
      close: () => {
        this.letGo = true;
        this.close();
      },
      message: (text, opts) => this.card.message(text, opts),
      dirty: () => this.card.dirty(),
      focus: () => this.card.focus(),
    };
  }
}

/** The card UI the machine opens cards through. */
export function modalCards(app: App): CardUi {
  return {
    open(view, actions) {
      const m = new CardModal(app, view, actions);
      m.open();
      return m.handle();
    },
  };
}
