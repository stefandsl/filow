/** A second Escape within this long closes everything. */
const TWICE_MS = 700;

/**
 * What one Escape closes: "all" for a second press in time, else the topmost thing on screen:
 * "model" (the 3D window), "items" (pictures, slide, cards, marks), "bubble", or null for nothing.
 */
function escTarget({ model, items, bubble, lastAt = 0, now = Date.now() }) {
  const any = Boolean(model || items || bubble);
  if (!any) return null;
  if (now - lastAt <= TWICE_MS) return "all";
  return model ? "model" : items ? "items" : "bubble";
}

function overlayEscape(focused, event, input, close) {
  if (focused && input.type === "keyDown" && input.key === "Escape" && !input.isAutoRepeat) {
    event.preventDefault();
    close();
  }
}

module.exports = { TWICE_MS, escTarget, overlayEscape };
