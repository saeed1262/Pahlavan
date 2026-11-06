// A redraw that keeps the reader's place. A screen is rebuilt from scratch
// (its children replaced), which drops the scroll to the top and the focus
// to the page, so both are put back after it: opening a guide or a Why far
// down Today stays where it was opened. Standard DOM only.

/** Runs `draw`, then puts back the scroll position and the focused control (found again by its data-k). */
export function keepPlace(scroller: HTMLElement, page: HTMLElement, draw: () => void): void {
  const top = scroller.scrollTop;
  const focused = (scroller.ownerDocument?.activeElement as HTMLElement | null | undefined)?.getAttribute?.('data-k') ?? null;
  draw();
  scroller.scrollTop = top;
  if (focused) page.querySelector<HTMLElement>(`[data-k="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}
