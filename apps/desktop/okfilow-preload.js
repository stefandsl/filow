// OK Filow windows (panel + overlays): the only bridge they get. No secrets beyond the LAN
// access password the engine pages already have.
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (fn) => {
  const h = (_e, ...args) => fn(...args);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld("okFilow", {
  accessPassword: process.env.ACCESS_PASSWORD || "",
  /** The session server mints the engine token the spend endpoints need while ACCESS_PASSWORD is set. */
  sessionUrl: process.env.FILOW_SESSION_URL || `http://127.0.0.1:${process.env.SESSION_PORT || 4748}`,
  status: () => ipcRenderer.invoke("okfilow:status"),
  configure: (patch) => ipcRenderer.invoke("okfilow:configure", patch),
  capture: (opts) => ipcRenderer.invoke("okfilow:capture", opts),
  setMode: (mode, extra) => ipcRenderer.invoke("okfilow:setMode", mode, extra),
  level: (v) => ipcRenderer.send("okfilow:level", v),
  text: (t) => ipcRenderer.send("okfilow:text", t),
  point: (points, avoid) => ipcRenderer.send("okfilow:point", points, avoid),
  draw: (marks, from, avoid) => ipcRenderer.send("okfilow:draw", marks, from, avoid),
  stroke: (points) => ipcRenderer.send("okfilow:stroke", points),
  cards: (list) => ipcRenderer.send("okfilow:cards", list),
  showModel: (model) => ipcRenderer.send("okfilow:model:show", model),
  modelReady: () => ipcRenderer.send("okfilow:model:ready"),
  overlayReady: () => ipcRenderer.send("okfilow:overlay:ready"),
  modelHover: (active) => ipcRenderer.send("okfilow:model:hover", active),
  closeModel: () => ipcRenderer.send("okfilow:model:close"),
  askAbout: (text) => ipcRenderer.send("okfilow:askAbout", text),
  showWhiteboard: (topic) => ipcRenderer.send("okfilow:whiteboard:show", String(topic || "")),
  whiteboardReady: () => ipcRenderer.send("okfilow:whiteboard:ready"),
  closeWhiteboard: () => ipcRenderer.send("okfilow:whiteboard:close"),
  typeText: (text, language, phrase) => ipcRenderer.invoke("okfilow:typeText", text, language, phrase === true),
  handsFreeOff: () => ipcRenderer.send("okfilow:handsfreeOff"),
  agents: {
    start: (text, context) => ipcRenderer.invoke("okfilow:agent:start", text, context),
    list: () => ipcRenderer.invoke("okfilow:agent:list"),
    stop: (id) => ipcRenderer.invoke("okfilow:agent:stop", id),
    remove: (id) => ipcRenderer.invoke("okfilow:agent:remove", id),
    open: (p) => ipcRenderer.invoke("okfilow:agent:open", p),
    onChange: on("okfilow:jobs"),
    onDone: on("okfilow:jobDone"),
  },
  /** "Going outside": the panel reports each send that carries the user's content, main shows it everywhere. */
  outbound: {
    begin: (id, kind, names) => ipcRenderer.send("okfilow:outbound:begin", id, kind, names),
    end: (id, opts) => ipcRenderer.send("okfilow:outbound:end", id, opts),
    onChange: on("okfilow:outbound"),
    ready: () => ipcRenderer.send("okfilow:panel:ready"),
  },
  /** A first-send notice is open (the panel must be seen and stay) or closed. */
  notice: {
    open: () => ipcRenderer.send("okfilow:notice:open"),
    close: () => ipcRenderer.send("okfilow:notice:close"),
  },
  hidePanel: () => ipcRenderer.send("okfilow:hidePanel"),
  clearVisuals: () => ipcRenderer.send("okfilow:clearVisuals"),
  answerLog: (entry) => ipcRenderer.invoke("okfilow:answerLog", entry),
  pickAnswerDir: () => ipcRenderer.invoke("okfilow:pickAnswerDir"),
  openAnswers: () => ipcRenderer.invoke("okfilow:openAnswers"),
  deleteAnswers: () => ipcRenderer.invoke("okfilow:deleteAnswers"),
  /** Stops the answer in progress; main tells the panel (onStop), which ends the request, the voice and the pointing. */
  stopAnswer: (source) => ipcRenderer.send("okfilow:stopAnswer", source),
  onStop: on("okfilow:stop"),
  /** Overlay -> main: the pointer is on (or off) the Stop button, so this overlay takes the mouse meanwhile. */
  overlayHover: (on, onBubble) => ipcRenderer.send("okfilow:overlay:hover", on === true, onBubble === true),
  /** The answer bubble: its close button (overlay -> main), main's word that it goes away now, and the sentence the voice is on. */
  closeBubble: () => ipcRenderer.send("okfilow:bubble:close"),
  onBubbleClose: on("okfilow:bubble:close"),
  spoken: (index) => ipcRenderer.send("okfilow:spoken", index),
  onSpoken: on("okfilow:spoken"),
  /** A control of the pill: "eye", "pause", "resume" or "stop". Main passes it to the panel (onControl), which acts. */
  control: (action) => ipcRenderer.send("okfilow:control", action),
  onControl: on("okfilow:control"),
  /** Panel -> main -> overlays: what the pill shows now ({ sees, paused, resumable }). */
  pill: (state) => ipcRenderer.send("okfilow:pill", state),
  onPill: on("okfilow:pill"),
  press: () => ipcRenderer.send("okfilow:press"),
  release: () => ipcRenderer.send("okfilow:release"),
  /** Test builds with FILOW_OKF_QA_KEYS=1 only (ignored otherwise): a key press for the gestures. */
  qaKey: (type, key) => ipcRenderer.send("okfilow:qa:key", type, key),
  /** The speed baseline's marks of one answer ({ run, kind, end, marks }): main logs numbers and fixed names only (okfilow-timings.js). */
  timings: (payload) => ipcRenderer.send("okfilow:timings", payload),
  /** How long the microphone took to open ({ ms, state, fallback }): main logs the slow ones and keeps the numbers for Report a problem (okfilow-mic.js). */
  micOpened: (payload) => ipcRenderer.send("okfilow:mic", payload),
  onPress: on("okfilow:press"),
  onRelease: on("okfilow:release"),
  onCancel: on("okfilow:cancel"),
  onConfig: on("okfilow:config"),
  onMode: on("okfilow:mode"),
  onState: on("okfilow:state"),
  onCursor: on("okfilow:cursor"),
  onLevel: on("okfilow:level"),
  onText: on("okfilow:text"),
  onPoint: on("okfilow:point"),
  onDraw: on("okfilow:draw"),
  onClear: on("okfilow:clear"),
  onCards: on("okfilow:cards"),
  onModel: on("okfilow:model"),
  onAskText: on("okfilow:askText"),
  /** How many paired phones' questions wait in the inbox (0 during a slide show): the badge, never their text. */
  onPhoneCount: on("okfilow:phoneCount"),
  phoneCount: () => ipcRenderer.invoke("okfilow:phoneCount"),
  /** The presenter opened the badge: the oldest question ({ key, text, device, peer, fp }) or null. */
  phoneOpen: () => ipcRenderer.invoke("okfilow:phoneOpen"),
  /** The question on screen left the inbox (its device was revoked or lost the right to ask): its key. */
  onPhoneWithdraw: on("okfilow:phoneWithdraw"),
  /** The presenter answered the notice: "yes", "no" (Ignore, or it timed out) or "dropped" (closed unseen). */
  phoneAskDone: (key, outcome) => ipcRenderer.send("okfilow:phoneAskDone", { key: String(key ?? ""), outcome: outcome === "yes" || outcome === "no" ? outcome : "dropped" }),
  onWhiteboard: on("okfilow:whiteboard"),
  onStrokes: on("okfilow:strokes"),
  onHandsFree: on("okfilow:handsfree"),
  onQuickAsk: on("okfilow:quickAsk"),
  onWelcome: on("okfilow:welcome"),
  stt: {
    status: () => ipcRenderer.invoke("okfilow:stt:status"),
    start: (language) => ipcRenderer.invoke("okfilow:stt:start", language),
    feed: (samples) => ipcRenderer.send("okfilow:stt:feed", samples),
    stop: () => ipcRenderer.invoke("okfilow:stt:stop"),
    onResult: on("okfilow:stt:result"),
  },
  // The natural voice on this PC (tts.js).
  tts: {
    status: () => ipcRenderer.invoke("okfilow:tts:status"),
    download: () => ipcRenderer.invoke("okfilow:tts:download"),
    remove: () => ipcRenderer.invoke("okfilow:tts:remove"),
    /** Stop the download of the voice; the part on disk is deleted. */
    stopDownload: () => ipcRenderer.invoke("okfilow:tts:stopDownload"),
    warm: () => ipcRenderer.invoke("okfilow:tts:warm"),
    speak: (req) => ipcRenderer.invoke("okfilow:tts:speak", req),
    cancel: (id) => ipcRenderer.invoke("okfilow:tts:cancel", id),
    played: (info) => ipcRenderer.send("okfilow:tts:played", info),
    onChunk: on("okfilow:tts:chunk"),
    onStatus: on("okfilow:tts:status"),
  },
});
