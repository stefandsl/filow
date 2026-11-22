// A prepared lesson owns one tab in a separate profile of the installed Windows browser.
// Neither the renderer nor the lesson document can supply a browser command or destination.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");

const { serveCloudLab, LESSON_URL } = require("./cloud-lab");
const SAME_PAGE = ["browser", "window", "tab", "frame", "loader", "url", "frameUrl", "entry"];
const SCOPE = ["teacher", "presenter", "window", "tab", "turn", "action", "url"];
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

function createLesson({ driver, focused, journal }) {
  let active = null;
  const view = () => active ? { phase: active.phase, turn: active.turn, decision: active.decision && { ...active.decision }, reading: active.reading } : { phase: "idle" };
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
    active.phase = "speaker";
    return view();
  }
  function challenge() {
    return active?.phase === "speaker" && focused() && Date.now() < active.expires ? active.challenge : null;
  }
  function confirmSpeaker(id) {
    if (!id || id !== challenge()) return held;
    const { owner, origin, turn } = active;
    active.decision = { presenter: owner, teacher: "enrolled-wake/" + id, turn, window: origin.window,
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
    if (active && ["speaker", "approval", "checking"].includes(active.phase)) active.phase = "held";
  }
  function interrupt() {
    const last = active;
    active = null;
    driver.detach?.();
    last?.abort.abort();
  }
  return { prepare, request, approve, observe, reconcile, stop, blur, interrupt, challenge, confirmSpeaker, view };
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

// Connect only to the browser endpoint published in the dedicated lesson profile.
async function connectBrowser(dir, signal) {
  const [port, route] = fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").trim().split(/\r?\n/);
  if (!/^\d{1,5}$/.test(port) || !/^\/devtools\/browser\/[a-f0-9-]{36}$/.test(route)) throw Error("browser unavailable");
  const socket = new WebSocket("ws://127.0.0.1:" + port + route);
  const pending = new Map();
  let onEvent = null;
  let seq = 0;
  const close = () => {
    socket.close();
    for (const fail of pending.values()) fail(null);
    pending.clear();
  };
  signal.addEventListener("abort", close, { once: true });
  socket.addEventListener("close", () => {
    signal.removeEventListener("abort", close);
    for (const fail of pending.values()) fail(null);
    pending.clear();
  });
  socket.addEventListener("message", event => {
    let response;
    try { response = JSON.parse(event.data); } catch { return; }
    if (response.method) { onEvent?.(response); return; }
    pending.get(response.id)?.(response);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { close(); reject(Error("browser timeout")); }, 2500);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(Error("browser unavailable")); }, { once: true });
  });
  function send(method, params = {}, sessionId) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const done = response => {
        clearTimeout(timer);
        pending.delete(id);
        if (!response || response.error) reject(Error("browser observation unavailable"));
        else resolve(response.result);
      };
      const timer = setTimeout(() => done(null), 3000);
      pending.set(id, done);
      try { socket.send(JSON.stringify({ id, method, params, sessionId })); } catch { done(null); }
    });
  }
  return { id: route.slice(route.lastIndexOf("/") + 1), send, close, listen(fn) { onEvent = fn; } };
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

function edgeDriver(userData) {
  const dir = path.join(userData, "lesson-browser");
  let connection, session, tab, service, child;
  const page = (method, params) => connection.send(method, params, session);
  async function current() {
    const [{ windowId, bounds }, { frameTree }, history] = await Promise.all([
      connection.send("Browser.getWindowForTarget", { targetId: tab }),
      page("Page.getFrameTree"), page("Page.getNavigationHistory"),
    ]);
    const frame = frameTree.frame;
    const entry = history.entries[history.currentIndex];
    let selected = false;
    if (entry.url.startsWith("about:blank#filow-") && bounds.windowState !== "minimized") {
      // The prepared Edge window has exactly one page. An added tab makes it ambiguous,
      // even if Chromium still answers queries addressed to the original background target.
      const { targetInfos } = await connection.send("Target.getTargets");
      const otherPages = targetInfos.filter(t => t.type === "page" && t.targetId !== tab);
      const windows = await Promise.all(otherPages.map(t => connection.send("Browser.getWindowForTarget", { targetId: t.targetId })));
      selected = windows.every(other => other.windowId !== windowId);
    }
    return { browser: connection.id, tab, window: windowId, frame: frame.id, loader: frame.loaderId, url: entry.url, entry: entry.id,
      selected, previous: history.entries[history.currentIndex - 1]?.id, frameUrl: frame.url + (frame.urlFragment || "") };
  }
  async function bind(client, targetId, signal) {
    const attached = await client.send("Target.attachToTarget", { targetId, flatten: true });
    signal.throwIfAborted();
    connection = client;
    tab = targetId;
    session = attached.sessionId;
    await page("DOM.enable");
    await page("Overlay.enable");
  }
  async function attach(origin, signal) {
    const client = await connectBrowser(dir, signal);
    try {
      if (client.id !== origin.browser) throw Error("different browser");
      await bind(client, origin.tab, signal);
    } catch (err) { client.close(); throw err; }
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
  function detach() {
    service?.close();
    service = null;
    connection?.close();
    connection = session = tab = null;
  }
  function close() {
    const client = connection;
    if (!client) { child?.kill(); detach(); return; }
    // Send before Stop aborts the CDP session. Edge shuts down its private profile.
    void client.send("Browser.close").catch(() => {}).finally(() => client.close());
    service?.close();
    service = connection = session = tab = child = null;
  }
  async function waitForStart(start, signal) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const target = await current();
      signal.throwIfAborted();
      if (target.url === start && target.frameUrl === start && target.selected) return target;
      // Chromium may expose the initial blank document before committing the fragment.
      if (![target.url, target.frameUrl].every(url => url === "about:blank" || url === start)) break;
      if (target.url === start && !target.selected) break;
      await delay(200, undefined, { signal });
    }
    throw Error("lesson start page unavailable");
  }
  async function prepare(turn, signal) {
    signal.throwIfAborted();
    service = await serveCloudLab(turn, signal);
    const exe = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles].filter(Boolean)
      .map(root => path.join(root, "Microsoft", "Edge", "Application", "msedge.exe")).find(file => fs.existsSync(file));
    if (process.platform !== "win32" || !exe) throw Error("Edge unavailable");
    const start = "about:blank#filow-" + turn;
    child = spawn(exe, ["--user-data-dir=" + dir, "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
      "--no-first-run", "--no-default-browser-check", "--disable-sync", "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost", "--disable-quic", "--disable-background-networking", "about:blank"],
      { stdio: "ignore", detached: true, windowsHide: false,
        env: Object.fromEntries(Object.entries(process.env).filter(([name]) =>
          /^(SystemRoot|SystemDrive|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|ProgramFiles(?:\(x86\))?|PATH|ComSpec)$/i.test(name))) });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
    let client;
    for (let attempt = 0; !client && attempt < 40; attempt++) {
      await delay(200, undefined, { signal });
      try { client = await connectBrowser(dir, signal); }
      catch { signal.throwIfAborted(); }
    }
    if (!client) throw Error("lesson browser unavailable");
    try {
      signal.throwIfAborted();
      // A lost create reply may already have opened the window. Never retry creation.
      const { targetId } = await client.send("Target.createTarget", { url: start, newWindow: true, background: true });
      signal.throwIfAborted();
      if (typeof targetId !== "string" || !targetId) throw Error("missing lesson target");
      await bind(client, targetId, signal);
      await page("Network.enable");
      await page("Network.setCacheDisabled", { cacheDisabled: true });
      await page("Network.setBypassServiceWorker", { bypass: true });
      const prepared = await waitForStart(start, signal);
      client.listen(event => {
        if (event.sessionId !== session || event.method !== "Fetch.requestPaused") return;
        const { requestId, frameId, request, responseStatusCode } = event.params;
        const approved = frameId === prepared.frame && request.url === LESSON_URL && responseStatusCode === 200
          && event.params.responseHeaders?.some(h => h.name.toLowerCase() === "x-filow-instance" && h.value === service?.instance);
        // A redirect response is stopped before Chromium follows its Location.
        void client.send(approved ? "Fetch.continueRequest" : "Fetch.failRequest",
          approved ? { requestId } : { requestId, errorReason: "Aborted" }, session).catch(() => {});
      });
      await page("Fetch.enable", { patterns: [{ urlPattern: LESSON_URL, resourceType: "Document", requestStage: "Response" }] });
      signal.throwIfAborted();
      return { ...prepared, instance: service.instance };
    } catch (err) {
      if (connection === client) close();
      else client.close();
      throw err;
    }
  }
  async function open(url, turn, signal) {
    if (url !== LESSON_URL) throw Error("unexpected destination");
    // A same-origin referrer distinguishes this navigation from an old tab or a manual reload.
    // It contains a random operation ID and no script, speech or presenter identity.
    const { errorText, loaderId } = await page("Page.navigate", { url, referrer: lessonReferrer(turn), referrerPolicy: "sameOrigin" });
    signal.throwIfAborted();
    if (errorText || !loaderId) throw Error("navigation unresolved");
    await page("Page.bringToFront");
  }
  return { prepare, current, open, observe, attach, point, close, detach, show: () => page("Page.bringToFront") };
}
module.exports = { LESSON_URL, createLesson, createLessonDraft, lessonJournal, edgeDriver, arrived, cooled };
