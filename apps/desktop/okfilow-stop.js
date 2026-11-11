// Stopping an answer, and the two small rules around it that the main process applies
// (okfilow.js). Kept here, without Electron, so they can be tested.

/** An answer is in progress: OK Filow is thinking, or speaking, drawing and pointing. */
const answering = (mode) => mode === "thinking" || mode === "speaking";

/**
 * What an overlay window does with the mouse. The overlays are click-through, except: while the
 * talk keys are held (`caught`: a drag marks the screen), and while the pointer is on the Stop button
 * of an answer in progress (`hover`). During an answer the mouse moves are forwarded to the page so
 * it can tell when the pointer reaches the button; at any other time nothing is forwarded.
 */
function overlayMouse({ caught, hover, mode }) {
  if (caught || (hover && answering(mode))) return { ignore: false, forward: false };
  return { ignore: true, forward: answering(mode) };
}

/** "Look at my screen": "on" or "off" once the user chose, "auto" until then (the setup decides). */
const seeChoice = (v) => (v === "on" || v === "off" ? v : "auto");

module.exports = { answering, overlayMouse, seeChoice };
