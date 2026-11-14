// A stand-in for window.okFilow (apps/desktop/okfilow-preload.js) in the hidden media driver: the overlay
// page registers its listeners on it, the driver emits what main would send (window.__qa.emit), and the
// calls the page makes back (overlayRects, overlayHover) are recorded. Test only: never loaded by the app.
const { contextBridge } = require("electron");

const listeners = {};
const calls = { overlayRects: [], overlayHover: [], modelHover: [], modelRects: [], modelMove: [], resetLayout: [] };
const on = (ch) => (fn) => {
  (listeners[ch] = listeners[ch] || []).push(fn);
  return () => { listeners[ch] = (listeners[ch] || []).filter((f) => f !== fn); };
};
const noop = () => {};
contextBridge.exposeInMainWorld("okFilow", {
  accessPassword: "",
  sessionUrl: "",
  status: async () => ({ color: "#f5c518", eyeKey: "", pauseKey: "" }),
  onConfig: on("config"), onPill: on("pill"), onStrokes: on("strokes"), onState: on("state"), onText: on("text"),
  onBubbleClose: on("bubbleClose"), onSpoken: on("spoken"), onLevel: on("level"), onCursor: on("cursor"), onDraw: on("draw"),
  onCards: on("cards"), onMedia: on("media"), onClear: on("clear"), onPoint: on("point"),
  outbound: { onChange: on("outbound"), begin: noop, end: noop, ready: noop },
  overlayReady: noop, stroke: noop, closeBubble: noop, control: noop, stopAnswer: noop,
  onModel: on("model"), onResetLayout: on("resetLayout"), onModelBounds: on("modelBounds"),
  modelReady: () => { (listeners.modelReady || []).forEach((f) => f()); },
  modelHover: (a) => { calls.modelHover.push(a); },
  modelRects: (r) => { calls.modelRects.push(r); },
  modelMove: (d) => { calls.modelMove.push(d); },
  resetLayout: () => { calls.resetLayout.push(1); },
  closeModel: noop, askAbout: noop,
  overlayHover: (a, b) => { calls.overlayHover.push([a, b]); },
  overlayRects: (r) => { calls.overlayRects.push(r); },
});
contextBridge.exposeInMainWorld("__qa", {
  emit: (ch, p) => { (listeners[ch] || []).forEach((f) => f(p)); },
  calls: () => JSON.parse(JSON.stringify(calls)),
});
