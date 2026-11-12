// OK Filow: what Windows itself says is on a screen (names and rectangles), read when the screenshot is
// taken, so a point or a box lands on the real button instead of where a picture model guessed
// (apps/web/lib/buddy/ground.ts places them; measured in docs/OKF-POINTING.md).
//
// A small helper program (native/uia/okfilow-uia.cs, built into native/uia/bin/okfilow-uia.exe when the
// package is made) stays running as a child process, never elevated, and answers one line of JSON per
// request on its standard output. It only reads: no key or mouse input, no focus change. The
// list goes to Filow's own local server with the question and is never sent to a model or a service.
// Windows only; elsewhere, or when the helper is missing, slow or broken, scan() gives null and
// pointing works as before, from the model's own coordinates.

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const GRID = 1000;
const MAX_ELEMENTS = 600;
/** The helper may take this long per display before its answer is given up on (the screenshot itself takes 0.3 to 0.6 s). */
const SCAN_BUDGET_MS = 600;
const SCAN_TIMEOUT_MS = 900;
/** After this many starts (crashes, or a helper ended because it hung) it is left alone for the session. */
const MAX_STARTS = 4;
/** A helper that has not answered a timed-out request after this long is ended. */
const HUNG_MS = 10_000;
/** The longest reply: 600 elements of 80 characters, with room to spare. */
const MAX_LINE_CHARS = 400_000;

/**
 * The helper's rows ([name, type, x, y, width, height] in physical pixels) as elements on the 0-1000
 * grid of one display. `rect` is that display in the same physical pixels; `screen` its 1-based index
 * in the question (the order of the screenshots). Rows that are malformed or centred off the display are dropped.
 */
function toGridElements(rows, rect, screen) {
  if (!Array.isArray(rows) || !rect || !(rect.width > 0) || !(rect.height > 0)) return [];
  const out = [];
  const clamp = (v) => Math.max(0, Math.min(GRID, Math.round(v * 10) / 10));
  for (const row of rows) {
    if (out.length >= MAX_ELEMENTS) break;
    if (!Array.isArray(row) || typeof row[0] !== "string" || !row[0].trim()) continue;
    const [x, y, w, h] = row.slice(2, 6).map(Number);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    const cx = x + w / 2, cy = y + h / 2;
    if (cx < rect.x || cx >= rect.x + rect.width || cy < rect.y || cy >= rect.y + rect.height) continue;
    const e = {
      name: row[0].trim().slice(0, 80),
      type: typeof row[1] === "string" ? row[1].slice(0, 20) : "",
      screen,
      x1: clamp(((x - rect.x) / rect.width) * GRID),
      y1: clamp(((y - rect.y) / rect.height) * GRID),
      x2: clamp(((x + w - rect.x) / rect.width) * GRID),
      y2: clamp(((y + h - rect.y) / rect.height) * GRID),
    };
    if (e.x2 > e.x1 && e.y2 > e.y1) out.push(e);
  }
  return out;
}

/** Where the helper program is on disk: Windows cannot start a program inside app.asar, so it is unpacked (package.json asarUnpack). */
function helperPath(dir = __dirname) {
  return path.join(dir, "native", "uia", "bin", "okfilow-uia.exe").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

/**
 * @param {{
 *   spawn?: typeof childProcess.spawn,
 *   exe?: string,
 *   platform?: string,
 *   log?: (line: string) => void,
 *   exists?: (file: string) => boolean,
 *   now?: () => number,
 * }} [opts]
 */
function createElementReader(opts = {}) {
  const spawn = opts.spawn || childProcess.spawn;
  const platform = opts.platform || process.platform;
  const log = opts.log || (() => {});
  const exe = opts.exe || helperPath();
  const exists = opts.exists || fs.existsSync;
  let child = null;
  let ready = false;
  let starts = 0;
  let stopped = false;
  /** When the oldest unanswered request timed out (0: none is outstanding). */
  let staleSince = 0;
  const now = opts.now || Date.now;
  /** The request whose answer line is awaited, and how many late answers to throw away (their request timed out). */
  let waiting = null;
  let stale = 0;
  let chain = Promise.resolve();

  function onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg && msg.ready) { ready = true; return; }
    if (stale > 0) { stale--; if (!stale) staleSince = 0; return; }
    if (!waiting) return;
    const w = waiting;
    waiting = null;
    clearTimeout(w.timer);
    w.resolve(msg && Array.isArray(msg.elements) ? { elements: msg.elements, ms: Number(msg.ms) || 0, partial: msg.partial === true } : null);
  }

  function start() {
    if (platform !== "win32" || stopped || child || starts >= MAX_STARTS) return false;
    if (!exists(exe)) {
      // a build without the helper: pointing goes on from the model's own coordinates, and this is said once
      starts = MAX_STARTS;
      log(`okfilow: screen names helper not in this build (${exe}); pointing uses the model's coordinates`);
      return false;
    }
    starts++;
    try {
      child = spawn(exe, [], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    } catch (e) {
      child = null;
      log(`okfilow: screen names helper did not start (${String((e && e.message) || e)})`);
      return false;
    }
    const mine = child;
    let buffer = "";
    mine.stdout.setEncoding("utf8");
    mine.stdout.on("data", (chunk) => {
      if (child !== mine) return; // a helper that was replaced has nothing more to say
      buffer += chunk;
      if (buffer.length > MAX_LINE_CHARS && !buffer.includes("\n")) buffer = ""; // never a line this long: not ours
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line) onLine(line);
      }
    });
    const gone = (why) => {
      if (child !== mine) return;
      child = null;
      ready = false;
      stale = 0;
      staleSince = 0;
      if (waiting) { clearTimeout(waiting.timer); waiting.resolve(null); waiting = null; }
      if (!stopped) log(`okfilow: screen names helper ended (${why}); start ${starts} of ${MAX_STARTS}`);
    };
    mine.on("error", (e) => gone(String((e && e.message) || e)));
    mine.on("exit", (code) => gone(`exit ${code}`));
    if (mine.stdin && mine.stdin.on) mine.stdin.on("error", () => {});
    return true;
  }

  /**
   * The named things on one display. `rect`: the display in physical pixels (screen.dipToScreenRect).
   * Resolves null, never rejects, when there is no answer in time. Requests run one after the other.
   * @param {{x: number, y: number, width: number, height: number}} rect
   * @param {{budgetMs?: number, timeoutMs?: number, ownPid?: number}} [o]
   */
  function scan(rect, o = {}) {
    const run = () => new Promise((resolve) => {
      if (!child) start(); // a helper that ended comes back for the next question
      if (!child || !ready || !rect || !(rect.width > 0) || !(rect.height > 0)) return resolve(null);
      if (stale > 0) {
        // The helper is still busy with a request that timed out (an app that does not answer Windows):
        // nothing more is queued behind it, and one stuck this long is ended; the next question starts a new one.
        if (now() - staleSince >= HUNG_MS) {
          log("okfilow: screen names helper did not answer, ending it");
          const hung = child;
          child = null;
          ready = false;
          stale = 0;
          staleSince = 0;
          try { hung.kill(); } catch {}
        }
        return resolve(null);
      }
      const budget = Math.max(50, Math.round(o.budgetMs || SCAN_BUDGET_MS));
      const timer = setTimeout(() => {
        if (!waiting || waiting.resolve !== resolve) return;
        waiting = null;
        stale++; // its answer is still on its way: not the next request's
        if (!staleSince) staleSince = now();
        resolve(null);
      }, Math.max(budget, Math.round(o.timeoutMs || SCAN_TIMEOUT_MS)));
      waiting = { resolve, timer };
      try {
        child.stdin.write(`scan ${Math.round(rect.x)} ${Math.round(rect.y)} ${Math.round(rect.width)} ${Math.round(rect.height)} ${budget} ${Math.round(o.ownPid || 0)}\n`);
      } catch {
        clearTimeout(timer);
        waiting = null;
        resolve(null);
      }
    });
    const next = chain.then(run, run);
    chain = next.catch(() => null);
    return next;
  }

  function stop() {
    stopped = true;
    const c = child;
    child = null;
    ready = false;
    if (waiting) { clearTimeout(waiting.timer); waiting.resolve(null); waiting = null; }
    if (!c) return;
    try { c.stdin.write("quit\n"); } catch {}
    try { c.kill(); } catch {}
  }

  return { start, scan, stop, get ready() { return ready; }, get running() { return child !== null; } };
}

/**
 * The screenshot's companion: when pictures are taken, a scan of each display starts at once (beside
 * desktopCapturer.getSources, so it costs no extra wait when it is quicker); when they are not (the eye
 * closed, "Look at my screen" off, not Windows), nothing is scanned at all. `toRect` turns a display's
 * DIP bounds into physical pixels (screen.dipToScreenRect). The returned function takes the 1-based
 * index each display got among the screenshots (0: no picture of it) and gives the elements.
 * @param {{ scan(rect: object, o?: object): Promise<{elements: unknown[]} | null> } | null} reader
 * @param {Array<{ bounds: {x: number, y: number, width: number, height: number} }>} displays
 * @param {{ pictures: boolean, toRect?: (bounds: object) => {x: number, y: number, width: number, height: number}, ownPid?: number, platform?: string }} o
 */
function scanForShot(reader, displays, o) {
  const platform = o.platform || process.platform;
  if (!o.pictures || !reader || platform !== "win32" || typeof o.toRect !== "function") return async () => [];
  const rects = displays.map((d) => {
    try { return o.toRect(d.bounds); } catch { return null; }
  });
  const scans = rects.map((r) => (r ? reader.scan(r, { ownPid: o.ownPid }).catch(() => null) : Promise.resolve(null)));
  return async (indexes) => (await Promise.all(scans)).flatMap((s, i) => (s && indexes[i] ? toGridElements(s.elements, rects[i], indexes[i]) : []));
}

module.exports = { createElementReader, toGridElements, helperPath, scanForShot, SCAN_BUDGET_MS, SCAN_TIMEOUT_MS, MAX_ELEMENTS };
