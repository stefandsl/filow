// Stopping an answer, and the two small rules around it that the main process applies
// (okfilow.js). Kept here, without Electron, so they can be tested.

/** An answer is in progress: OK Filow is thinking, or speaking, drawing and pointing. */
const answering = (mode) => mode === "thinking" || mode === "speaking";

/**
 * What an overlay window does with the mouse. The overlays are click-through, except: while the
 * talk keys are held (`caught`: a drag marks the screen), and while the pointer is on the Stop button
 * of an answer in progress (`hover`: the overlay page says so from the pointer position main sends
 * it; mouse events forwarded by Electron made the window flap between the two states and lose the click).
 */
function overlayMouse({ caught, hover, mode }) {
  return { ignore: !(caught || (hover && answering(mode))) };
}

/** "Look at my screen": "on" or "off" once the user chose, "auto" until then (the setup decides). */
const seeChoice = (v) => (v === "on" || v === "off" ? v : "auto");

/** Recipient ids as stored: strings only, at most twenty, each of a sane length. */
const wordsOnlyList = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x && x.length <= 200))].slice(-20) : []);

module.exports = { answering, overlayMouse, seeChoice, wordsOnlyList };
