/** Subscribe to the existing passive gesture hook only for the lifetime of speech or a bubble. */
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
  return (hook, key, mode, open) => {
    const next = mode === "speaking" || open ? hook : null;
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

module.exports = { createEscapeObserver };
