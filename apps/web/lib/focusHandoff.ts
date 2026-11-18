// When the control the keyboard was on goes away (Start becomes Stop when a take begins, and back),
// the browser drops the focus to the page body and a keyboard or screen-reader user starts over from
// the top of the page (WCAG 2.4.3 focus order). This moves the focus to the control that took its
// place, but only when the focus was really lost: someone who moved on elsewhere keeps their place.

type Focusable = { focus(): void };
type FocusDocument = { activeElement: unknown; body: unknown };

/** Focuses `next` when nothing has the focus (it is on the body); true when it moved the focus. */
export function refocusIfLost(next: Focusable | null | undefined, doc: FocusDocument): boolean {
  if (!next) return false;
  const active = doc.activeElement;
  if (active !== null && active !== undefined && active !== doc.body) return false;
  next.focus();
  return true;
}
