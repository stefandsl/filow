// A prepared lesson owns one tab in a separate profile of the installed Windows browser.
// Neither the renderer nor the lesson document can supply a browser command or destination.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");

const LESSON_URL = "http://127.0.0.1:48764/lesson/cloud-lab";
const SAME_PAGE = ["browser", "window", "tab", "frame", "loader", "url", "entry"];
const SCOPE = ["teacher", "window", "tab", "turn", "action", "url"];
const matches = (a, b, keys) => a && b && keys.every(key => a[key] === b[key]);
const held = { phase: "held" };

function createLesson({ driver, focused, journal }) {
  let active = null;
  const view = () => active ? { phase: active.phase, turn: active.turn, decision: active.decision } : { phase: "idle" };
  const owns = (owner, turn) => active && active.owner === owner && active.turn === turn;
  function stop(owner, turn) {
    if (!owns(owner, turn)) return;
    const last = active;
    active = null;
    last.abort.abort();
    driver.close();
    journal.write(null);
  }
  async function prepare(owner) {
    if (active || !focused() || journal.read()) return held;
    const a = active = { owner, turn: randomUUID(), phase: "preparing", abort: new AbortController() };
    try {
      const origin = await driver.prepare(a.turn, a.abort.signal);
      if (active !== a) return held;
      a.origin = origin;
      a.phase = "ready";
    } catch { if (active === a) a.phase = "held"; }
    return view();
  }
  function request(owner, turn, words) {
    if (!owns(owner, turn) || active.phase !== "ready" || !focused()) return held;
    if (typeof words !== "string" || !/^(?:(?:(?:please )?open|apri|deschide|открой) cloud lab|cloud lab を開いて)[.!?。]?$/iu.test(words.trim())) return view();
    const { origin } = active;
    active.decision = { teacher: owner, turn, window: origin.window, tab: origin.tab, action: "open", url: LESSON_URL };
    active.expires = Date.now() + 120_000;
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
      if (a.phase !== "checking" || Date.now() >= a.expires || !focused() || !matches(a.origin, target, SAME_PAGE)) {
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
  function blur() {
    if (active && ["approval", "checking"].includes(active.phase)) active.phase = "held";
  }
  function interrupt() {
    const last = active;
    active = null;
    last?.abort.abort();
    driver.close();
  }
  return { prepare, request, approve, stop, blur, interrupt, view };
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
  return { id: route.slice(route.lastIndexOf("/") + 1), send, close };
}

function edgeDriver(userData) {
  const dir = path.join(userData, "lesson-browser");
  let connection, session, tab;
  const page = (method, params) => connection.send(method, params, session);
  async function current() {
    const [{ windowId }, { frameTree }, history] = await Promise.all([
      connection.send("Browser.getWindowForTarget", { targetId: tab }),
      page("Page.getFrameTree"), page("Page.getNavigationHistory"),
    ]);
    const frame = frameTree.frame;
    const entry = history.entries[history.currentIndex];
    return { browser: connection.id, tab, window: windowId, frame: frame.id, loader: frame.loaderId, url: entry.url, entry: entry.id };
  }
  function close() {
    connection?.close();
    connection = session = tab = null;
  }
  async function prepare(turn, signal) {
    const exe = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles].filter(Boolean)
      .map(root => path.join(root, "Microsoft", "Edge", "Application", "msedge.exe")).find(file => fs.existsSync(file));
    if (process.platform !== "win32" || !exe) throw Error("Edge unavailable");
    const start = "about:blank#filow-" + turn;
    const child = spawn(exe, ["--user-data-dir=" + dir, "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
      "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-background-networking", "--app=" + start],
      { stdio: "ignore", detached: true, windowsHide: false,
        env: Object.fromEntries(Object.entries(process.env).filter(([name]) =>
          /^(SystemRoot|SystemDrive|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|ProgramFiles(?:\(x86\))?|PATH|ComSpec)$/i.test(name))) });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
    for (let attempt = 0; attempt < 40; attempt++) {
      await delay(200, undefined, { signal });
      let client;
      try {
        client = await connectBrowser(dir, signal);
        const { targetInfos } = await client.send("Target.getTargets");
        const target = targetInfos.find(t => t.type === "page" && t.url === start);
        if (!target) throw Error("waiting for page");
        const attached = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
        signal.throwIfAborted();
        connection = client;
        tab = target.targetId;
        session = attached.sessionId;
        await page("Network.enable");
        await page("Network.setCacheDisabled", { cacheDisabled: true });
        await page("Network.setBypassServiceWorker", { bypass: true });
        return await current();
      } catch { client?.close(); }
    }
    throw Error("lesson browser unavailable");
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
  return { prepare, current, open, close };
}
const lessonReferrer = turn => new URL("/filow-turn/" + turn, LESSON_URL).href;
module.exports = { LESSON_URL, createLesson, lessonJournal, edgeDriver };
