/** Map a practice element's CSS pixels into desktop DIP, including browser zoom. */
function practiceMark(rect, bounds, zoom = 1) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height, zoom].every(Number.isFinite) || zoom <= 0) return null;
  if (rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || (rect.x + rect.width) * zoom > bounds.width + 1 || (rect.y + rect.height) * zoom > bounds.height + 1) return null;
  return { kind: "box", x1: bounds.x + rect.x * zoom, y1: bounds.y + rect.y * zoom,
    x2: bounds.x + (rect.x + rect.width) * zoom, y2: bounds.y + (rect.y + rect.height) * zoom, label: "" };
}
/**
 * The practice mark's lifetime. It owns only its own mark: the tour page clears it when the window
 * loses focus, scrolls or resizes, the shell when the window moves, hides or navigates, and none of
 * those may wipe what a real answer drew. `forget` is for that: something else now owns the overlay.
 */
function createPractice({ draw, clear }) {
  let mark = null;
  return {
    mark: () => mark,
    show(next) { mark = next; draw([next]); },
    forget() { mark = null; },
    clear() {
      if (!mark) return false;
      mark = null;
      clear();
      return true;
    },
  };
}
module.exports = { practiceMark, createPractice };
