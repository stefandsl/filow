const { answering } = require("./okfilow-stop");

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

/** Subscribe to the existing passive gesture hook while Escape has an active target. */
function createEscapeObserver(press) {
  let subscribed = null;
  let escapeKey;
  let held = false;
  function down(event) {
    if (event.keycode === escapeKey && !held) {
      held = true;
      press();
    }
  }
  function up(event) {
    if (event.keycode === escapeKey) held = false;
  }
  return (hook, key, mode, open, { model, items, dictating } = {}) => {
    const next = answering(mode) || mode === "listening" || dictating || open || model || items ? hook : null;
    if (next === subscribed) return;
    if (subscribed) {
      subscribed.off("keydown", down);
      subscribed.off("keyup", up);
    }
    held = false;
    subscribed = next;
    escapeKey = key;
    if (next) {
      next.on("keydown", down);
      next.on("keyup", up);
    }
  };
}

module.exports = { createEscapeObserver, escTarget, TWICE_MS };
