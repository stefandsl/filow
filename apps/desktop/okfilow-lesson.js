// Each prepared lesson owns one sandboxed Electron window.
// Neither the renderer nor the lesson document can supply a browser command or destination.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const { serveCloudLab, LESSON_URL } = require("./cloud-lab");
const SAME_PAGE = ["browser", "window", "tab", "frame", "loader", "url", "frameUrl", "entry"];
const SCOPE = ["teacher", "presenter", "confirmation", "window", "tab", "turn", "action", "url"];
const matches = (a, b, keys) => a && b && keys.every(key => a[key] === b[key]);
const held = { phase: "held" };
const lessonReferrer = turn => new URL("/filow-turn/" + turn, LESSON_URL).href;

function arrived(origin, live, turn, sentAt) {
  return Boolean(matches(origin, live, ["browser", "window", "tab", "frame"])
    && typeof origin.instance === "string" && origin.instance === live.instance
    && live.loader !== origin.loader && live.entry !== origin.entry && live.previous === origin.entry
    && live.url === LESSON_URL && live.frameUrl === LESSON_URL && live.documentUrl === LESSON_URL
    && live.referrer === lessonReferrer(turn) && live.started >= sentAt && live.redirects === 0
    && live.navigation === "navigate" && live.status === 200 && live.complete);
}
function cooled(first, next) {
  return Boolean(first && next && next.focused && next.input > first.input && next.inputValue === next.temperature
    && next.dew === first.dew && first.temperature > first.dew && next.temperature < next.dew);
}

function createLessonDraft() {
  let entry = null;
  return {
    begin(turn, receive) { entry = { turn, receive }; },
    get turn() { return entry?.turn ?? null; },
    clear() { entry = null; },
    submit(local, turn, words) {
      if (!entry || !local || turn !== entry.turn || typeof words !== "string" || !words.trim() || words.length > 300) return false;
      const { receive } = entry;
      entry = null;
      receive(words.trim());
      return true;
    },
  };
}

function createLesson({ driver, focused, journal, speakerAvailable = () => true }) {
  let active = null;
  function expire() {
    if (active && ["presenter", "speaker", "approval"].includes(active.phase) && Date.now() >= active.expires) {
      active.phase = "ready";
      delete active.decision;
      delete active.challenge;
      active.expired = true;
    }
  }
  function view() {
    expire();
    return active ? { phase: active.phase, turn: active.turn, expired: active.expired, confirmation: active.phase === "presenter" ? active.challenge : undefined, decision: active.decision && { ...active.decision }, reading: active.reading } : { phase: "idle" };
  }
  const owns = (owner, turn) => active && active.owner === owner && active.turn === turn;
  function stop(owner, turn) {
    if (!owns(owner, turn)) return;
    const last = active;
    active = null;
    driver.close();
    last.abort.abort();
    journal.write(null);
  }
  async function prepare(owner) {
    if (active || !focused()) return held;
    const a = active = { owner, turn: randomUUID(), phase: "preparing", abort: new AbortController() };
    try {
      const record = journal.read();
      if (record) {
        if (record.phase !== "dispatched" || !/^[a-f0-9-]{36}$/.test(record.turn) || !record.origin
            || record.origin.url !== "about:blank#filow-" + record.turn || !Number.isFinite(record.sentAt)) {
          a.phase = "held";
        } else {
          Object.assign(a, { turn: record.turn, origin: record.origin, sentAt: record.sentAt, phase: "interrupted" });
        }
        return view();
      }
      const origin = await driver.prepare(a.turn, a.abort.signal);
      if (active !== a) return held;
      a.origin = origin;
      a.phase = "ready";
    } catch { if (active === a) { driver.close(); a.phase = "held"; } }
    return view();
  }
  function request(owner, turn, words) {
    if (!owns(owner, turn) || active.phase !== "ready" || !focused()) return held;
    if (typeof words !== "string" || !/^(?:(?:(?:please )?open|apri|deschide|открой) cloud lab|cloud lab を開いて)[.!?。]?$/iu.test(words.trim())) return { ...view(), unmatched: true };
    active.challenge = randomUUID();
    active.expires = Date.now() + 120_000;
    active.expired = false;
    active.phase = speakerAvailable() ? "speaker" : "presenter";
    return view();
  }
  function challenge() {
    expire();
    return active?.phase === "speaker" && focused() && Date.now() < active.expires ? active.challenge : null;
  }
  function confirmSpeaker(id) {
    if (!id || id !== challenge()) return held;
    return decisionFor("enrolled-wake/" + id);
  }
  function confirmPresenter(owner, turn, confirmation) {
    expire();
    if (!owns(owner, turn) || active.phase !== "presenter" || confirmation !== active.challenge || !focused()) return held;
    return decisionFor("presenter-click");
  }
  function decisionFor(teacher) {
    const { owner, origin, turn } = active;
    active.decision = { presenter: owner, teacher, confirmation: active.challenge, turn, window: origin.window,
      tab: origin.tab, action: "open", url: LESSON_URL };
    active.phase = "approval";
    return view();
  }
  async function approve(owner, decision) {
    if (!owns(owner, decision?.turn) || active.phase !== "approval") return held;
    const a = active;
    a.phase = "checking";
    if (!matches(a.decision, decision, SCOPE) || !focused()) { a.phase = "held"; return view(); }
    try {
      const target = await driver.current();
      if (active !== a) return held;
      if (a.phase !== "checking" || Date.now() >= a.expires || !focused() || target?.selected !== true || !matches(a.origin, target, SAME_PAGE)) {
        a.phase = "held";
        return view();
      }
      a.phase = "dispatched";
      a.sentAt = Date.now();
      journal.write({ phase: a.phase, turn: a.turn, origin: a.origin, sentAt: a.sentAt });
      await driver.open(LESSON_URL, a.turn, a.abort.signal);
    } catch { if (active === a) a.phase = "held"; }
    return view();
  }
  async function reconcile(owner, turn) {
    if (!owns(owner, turn) || active.phase !== "interrupted" || !focused()) return held;
    const a = active;
    a.phase = "checking";
    try {
      await driver.attach(a.origin, a.abort.signal);
      const live = await driver.observe();
      if (active !== a) return held;
      if (a.phase !== "checking" || !arrived(a.origin, live, a.turn, a.sentAt)) { a.phase = "held"; return view(); }
      a.phase = "dispatched";
      await driver.show();
    } catch { if (active === a) a.phase = "held"; }
    return view();
  }
  async function observe(owner, turn) {
    if (!owns(owner, turn) || !["dispatched", "guiding"].includes(active.phase) || active.busy) return view();
    const a = active;
    a.busy = true;
    try {
      const live = await driver.observe();
      if (active !== a) return held;
      if (!arrived(a.origin, live, turn, a.sentAt)) {
        if (a.first || Date.now() - a.sentAt > 15_000) a.phase = "held";
        return view();
      }
      const next = live.slider;
      if (!next?.focused) {
        if (a.first) a.phase = "held";
        return view();
      }
      if (!a.first) {
        await driver.point(next.rect);
        if (active !== a) return held;
        a.document = live.loader;
        a.first = next;
        a.reading = { temperature: next.temperature, dew: next.dew };
        a.phase = "guiding";
      } else if (a.document !== live.loader || a.first.control !== next.control) {
        a.phase = "held";
      } else if (cooled(a.first, next)) {
        a.reading = { temperature: next.temperature, dew: next.dew };
        a.phase = "explained";
      }
    } catch { if (active === a) a.phase = "held"; }
    finally {
      a.busy = false;
      if (active === a && (a.phase === "held" || a.phase === "explained")) driver.close();
    }
    return view();
  }
  function blur() {
    if (active && ["speaker", "presenter", "approval", "checking"].includes(active.phase)) active.phase = "held";
  }
  function interrupt() {
    const last = active;
    active = null;
    if (last && !["dispatched", "guiding"].includes(last.phase)) driver.close();
    last?.abort.abort();
  }
  return { prepare, request, approve, observe, reconcile, stop, blur, interrupt, challenge, confirmSpeaker, confirmPresenter, view };
}

function lessonJournal(dir) {
  const file = path.join(dir, "prepared-lesson.json");
  return {
    read() {
      try { return JSON.parse(fs.readFileSync(file, "utf8")); }
      catch (err) { return err.code === "ENOENT" ? null : held; }
    },
    write(record) {
      if (!record) { fs.rmSync(file, { force: true }); return; }
      const temp = file + ".new";
      fs.writeFileSync(temp, JSON.stringify(record), { flush: true, mode: 0o600 });
      fs.renameSync(temp, file);
    },
  };
}

// Executed in a named isolated world of the exact top-level lesson document. Read DOM state
// and trusted range events only. The learner remains the sole source of pointer and key input.
function readDocument() {
  const { document, location } = globalThis;
  const nav = performance.getEntriesByType("navigation")[0];
  const result = { instance: document.querySelector('meta[name="filow-instance"]')?.content, documentUrl: location.href, referrer: document.referrer, started: performance.timeOrigin,
    redirects: nav?.redirectCount, navigation: nav?.type, status: nav?.responseStatus, complete: document.readyState === "complete" };
  const ranges = Array.from(document.querySelectorAll('input[type="range"]')).filter(node =>
    (node.getAttribute("aria-label") || Array.from(node.labels || []).map(label => label.textContent.trim()).join(" ")) === "Air temperature");
  const readCelsius = text => {
    const match = /^(-?\d+(?:[.,]\d+)?)\s*°C$/.exec(text?.trim() || "");
    return match ? Number(match[1].replace(",", ".")) : NaN;
  };
  if (ranges.length !== 1) return result;
  const range = ranges[0];
  const temperature = readCelsius(range.getAttribute("aria-valuetext"));
  const dew = readCelsius(document.querySelector('output[aria-label="Dew point"]')?.textContent);
  if (!Number.isFinite(temperature) || temperature !== range.valueAsNumber || !Number.isFinite(dew) || range.disabled) return result;
  const rect = range.getBoundingClientRect();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  if (!rect.width || !rect.height || document.elementFromPoint(x, y) !== range) return result;
  let watch = globalThis.filowTemperature;
  if (watch?.range !== range) {
    watch = { range, id: crypto.randomUUID(), input: 0, value: null };
    globalThis.filowTemperature = watch;
    range.addEventListener("input", event => {
      if (event.isTrusted && document.hasFocus() && event.target === range) {
        watch.input++;
        watch.value = range.valueAsNumber;
      }
    });
  }
  return { ...result, slider: { control: watch.id, input: watch.input, inputValue: watch.value, temperature, dew,
    focused: document.hasFocus() && document.visibilityState === "visible",
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } };
}

function checkLessonResponse(params, frame, instance, send) {
  const { requestId, frameId, request, responseStatusCode, responseHeaders } = params;
  const approved = frameId === frame && request.url === LESSON_URL && responseStatusCode === 200
    && responseHeaders?.some(h => h.name.toLowerCase() === "x-filow-instance" && h.value === instance);
  return approved ? send("Fetch.continueRequest", { requestId }) : send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
}

function electronDriver() {
  let win, service;
  const browser = randomUUID();
  const page = (method, params) => win.webContents.debugger.sendCommand(method, params);
  async function current() {
    const [{ frameTree }, history] = await Promise.all([page("Page.getFrameTree"), page("Page.getNavigationHistory")]);
    const frame = frameTree.frame;
    const entry = history.entries[history.currentIndex];
    return { browser, tab: String(win.webContents.id), window: win.id, frame: frame.id, loader: frame.loaderId,
      url: entry.url, entry: entry.id, selected: !win.isMinimized(), previous: history.entries[history.currentIndex - 1]?.id,
      frameUrl: frame.url + (frame.urlFragment || "") };
  }
  function attach(origin, signal) {
    signal.throwIfAborted();
    if (!win || win.isDestroyed() || origin.browser !== browser || origin.window !== win.id ||
        origin.tab !== String(win.webContents.id)) throw Error("Lesson window unavailable");
  }
  async function observe() {
    const target = await current();
    if (target.frameUrl !== LESSON_URL || target.url !== LESSON_URL) return target;
    const { executionContextId } = await page("Page.createIsolatedWorld", { frameId: target.frame, worldName: "Filow prepared lesson" });
    const reply = await page("Runtime.evaluate", { contextId: executionContextId, expression: "(" + readDocument.toString() + ")()", returnByValue: true });
    const after = await current();
    if (reply.exceptionDetails || !matches(target, after, SAME_PAGE)) throw Error("document changed");
    return { ...after, ...reply.result.value };
  }
  function point(rect) {
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    return page("Overlay.highlightQuad", { quad: [x, y, x + 9, y - 22, x + 18, y - 15, x, y],
      color: { r: 255, g: 184, b: 0, a: 1 }, outlineColor: { r: 32, g: 32, b: 32, a: 1 } });
  }
  function close() {
    if (win && !win.isDestroyed()) win.destroy();
    service?.close();
    win = service = null;
  }
  async function prepare(turn, signal) {
    signal.throwIfAborted();
    const server = await serveCloudLab(turn, signal);
    signal.throwIfAborted();
    service = server;
    const { BrowserWindow, session } = require("electron");
    const isolated = session.fromPartition("lesson-" + turn, { cache: false });
    isolated.webRequest.onBeforeRequest((request, done) => done({ cancel: request.url !== LESSON_URL && !request.url.startsWith("about:blank") }));
    isolated.setPermissionRequestHandler((_contents, _permission, done) => done(false));
    const window = win = new BrowserWindow({ show: false, autoHideMenuBar: true,
      webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.on("closed", () => server.close());
    const start = "about:blank#filow-" + turn;
    await window.loadURL(start);
    signal.throwIfAborted();
    window.webContents.debugger.attach();
    await page("DOM.enable");
    await page("Overlay.enable");
    const prepared = await current();
    if (prepared.url !== start || prepared.frameUrl !== start) throw Error("Unexpected lesson window");
    const send = (method, params) => window.webContents.debugger.sendCommand(method, params);
    window.webContents.debugger.on("message", (_event, method, params) => {
      if (method === "Fetch.requestPaused") void checkLessonResponse(params, prepared.frame, server.instance, send).catch(() => {});
    });
    await page("Fetch.enable", { patterns: [{ urlPattern: LESSON_URL, resourceType: "Document", requestStage: "Response" }] });
    return { ...prepared, instance: server.instance };
  }
  async function open(url, turn, signal) {
    if (url !== LESSON_URL) throw Error("unexpected destination");
    // A same-origin referrer distinguishes this navigation from an old tab or a manual reload.
    // It contains a random operation ID and no script, speech or presenter identity.
    const { errorText, loaderId } = await page("Page.navigate", { url, referrer: lessonReferrer(turn), referrerPolicy: "sameOrigin" });
    signal.throwIfAborted();
    if (errorText || !loaderId) throw Error("navigation unresolved");
    win.show();
    win.focus();
  }
  return { prepare, current, open, observe, attach, point, close, show: () => { win.show(); win.focus(); } };
}
module.exports = { LESSON_URL, createLesson, createLessonDraft, lessonJournal, electronDriver, checkLessonResponse, arrived, cooled };
