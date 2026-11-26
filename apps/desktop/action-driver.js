// X-14 ActionDriver interface and Windows driver implementation.
// Pure coordinate mapping (DPI + multi-monitor + virtual desktop SendInput) and strict action dispatch.
// Unknown or unsupported actions are always refused; never guessed.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");

const COORD_MIN = 0;
const COORD_MAX = 999;
const COORD_SPAN = 1000;
const MAX_WAIT_SECONDS = 10;

const SUPPORTED_DESKTOP_ACTIONS = new Set([
  "click",
  "double_click",
  "triple_click",
  "middle_click",
  "right_click",
  "mouse_down",
  "mouse_up",
  "move",
  "type",
  "drag_and_drop",
  "wait",
  "press_key",
  "key_down",
  "key_up",
  "hotkey",
  "take_screenshot",
  "scroll",
]);

const POINT_ACTIONS = new Set([
  "click",
  "double_click",
  "triple_click",
  "middle_click",
  "right_click",
  "mouse_down",
  "mouse_up",
  "move",
]);

/**
 * Converts a DIP rectangle on a display into physical pixels, handling mixed DPI and negative offsets.
 * `display`: `{ bounds: { x, y, width, height }, scaleFactor, physicalOrigin?: { x, y } }`.
 */
function dipRectToPhysical(dipRect, display) {
  if (!dipRect || typeof dipRect !== "object") throw new Error("Invalid DIP rectangle");
  const scale = display && Number.isFinite(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1;
  const originDipX = display?.bounds && Number.isFinite(display.bounds.x) ? display.bounds.x : 0;
  const originDipY = display?.bounds && Number.isFinite(display.bounds.y) ? display.bounds.y : 0;
  const originPhysX = display?.physicalOrigin && Number.isFinite(display.physicalOrigin.x)
    ? display.physicalOrigin.x
    : Math.round(originDipX * scale);
  const originPhysY = display?.physicalOrigin && Number.isFinite(display.physicalOrigin.y)
    ? display.physicalOrigin.y
    : Math.round(originDipY * scale);
  const { x, y, width, height } = dipRect;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error("Invalid DIP rectangle dimensions");
  }
  return {
    x: Math.round(originPhysX + (x - originDipX) * scale),
    y: Math.round(originPhysY + (y - originDipY) * scale),
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Maps Gemini normalized coordinates (0-999) into physical pixel coordinates inside `targetRect`.
 * Rejects any out-of-range or non-finite coordinate.
 */
function mapNormalizedToPhysical(normX, normY, targetRect) {
  if (typeof normX !== "number" || typeof normY !== "number" || !Number.isFinite(normX) || !Number.isFinite(normY)) {
    throw new Error("Coordinates must be finite numbers");
  }
  if (normX < COORD_MIN || normX > COORD_MAX || normY < COORD_MIN || normY > COORD_MAX) {
    throw new Error(`Coordinates out of 0-999 range: (${normX}, ${normY})`);
  }
  if (!targetRect || ![targetRect.x, targetRect.y, targetRect.width, targetRect.height].every(Number.isFinite) || targetRect.width <= 0 || targetRect.height <= 0) {
    throw new Error("Invalid target rectangle");
  }
  const rawX = Math.round(targetRect.x + (normX / COORD_SPAN) * targetRect.width);
  const rawY = Math.round(targetRect.y + (normY / COORD_SPAN) * targetRect.height);
  return {
    x: Math.min(targetRect.x + targetRect.width - 1, Math.max(targetRect.x, rawX)),
    y: Math.min(targetRect.y + targetRect.height - 1, Math.max(targetRect.y, rawY)),
  };
}

/**
 * Maps physical desktop coordinates into Win32 SendInput virtual-desktop absolute space (0..65535),
 * supporting multi-monitor setups with negative secondary monitor coordinates.
 */
function physicalToVirtualAbsolute(physX, physY, virtualScreen) {
  if (![physX, physY].every(Number.isFinite)) throw new Error("Physical coordinates must be finite");
  if (!virtualScreen || ![virtualScreen.x, virtualScreen.y, virtualScreen.width, virtualScreen.height].every(Number.isFinite) || virtualScreen.width < 2 || virtualScreen.height < 2) {
    throw new Error("Invalid virtual screen bounds");
  }
  const clamp = (v) => Math.max(0, Math.min(65535, Math.round(v)));
  return {
    dx: clamp(((physX - virtualScreen.x) * 65535) / (virtualScreen.width - 1)),
    dy: clamp(((physY - virtualScreen.y) * 65535) / (virtualScreen.height - 1)),
  };
}

/**
 * Gentle snapping inspired by the OmniParser pilot: if a normalized click point is just beside
 * a small UIA interactive element (and not already inside any element), nudge onto its center.
 */
function snapToUiaElement(normX, normY, elements, maxRadius = 24) {
  if (!Array.isArray(elements) || !elements.length) return { x: normX, y: normY, snapped: false };
  const inside = elements.some((e) => e && normX >= e.x1 && normX <= e.x2 && normY >= e.y1 && normY <= e.y2);
  if (inside) return { x: normX, y: normY, snapped: false };
  let best = null;
  let bestDist = maxRadius;
  for (const e of elements) {
    if (!e || e.isPassword) continue;
    const w = e.x2 - e.x1;
    const h = e.y2 - e.y1;
    if (w <= 0 || h <= 0 || w > 350 || h > 220) continue;
    const cx = (e.x1 + e.x2) / 2;
    const cy = (e.y1 + e.y2) / 2;
    const d = Math.hypot(normX - cx, normY - cy);
    if (d < bestDist) {
      bestDist = d;
      best = { x: Math.min(COORD_MAX, Math.max(COORD_MIN, Math.round(cx))), y: Math.min(COORD_MAX, Math.max(COORD_MIN, Math.round(cy))), snapped: true, element: e.name || "" };
    }
  }
  return best || { x: normX, y: normY, snapped: false };
}

function snapAction(action, elements) {
  if (!POINT_ACTIONS.has(action.name)) return action;
  const { x, y, snapped } = snapToUiaElement(action.args.x, action.args.y, elements);
  return snapped ? { ...action, args: { ...action.args, x, y } } : action;
}

function helperPath(dir = __dirname) {
  return path.join(dir, "native", "action", "bin", "filow-action.exe").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

function waitAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Generic ActionDriver factory implementing the single X-14 ActionDriver interface.
 * Accepts an injectable `sendCommand` transport for unit testing or native helper wrapping.
 */
function createActionDriver(transport = {}) {
  const sendCommand = transport.sendCommand;
  const abortTransport = transport.abort || (() => {});
  const sleep = transport.sleep || waitAbortable;

  async function inspectTarget(hwnd = 0) {
    if (typeof transport.inspectTarget === "function") return transport.inspectTarget(hwnd);
    if (typeof sendCommand !== "function") throw new Error("ActionDriver transport unavailable");
    return sendCommand("inspect", { hwnd: Number(hwnd) || 0 });
  }

  async function captureTarget(hwnd = 0, opts = {}) {
    if (typeof transport.captureTarget === "function") return transport.captureTarget(hwnd, opts);
    if (typeof sendCommand !== "function") throw new Error("ActionDriver transport unavailable");
    const res = await sendCommand("capture", { hwnd: Number(hwnd) || 0, maxWidth: opts.maxWidth || 1280 });
    if (!res || !res.ok) throw new Error(res?.error || "capture_failed");
    return {
      hwnd: res.hwnd,
      pngBase64: res.pngBase64,
      width: res.width,
      height: res.height,
      bounds: res.bounds,
      info: res.info,
      elements: Array.isArray(res.elements) ? res.elements : [],
      snapshotId: crypto.randomUUID(),
    };
  }

  async function readBack(hwnd = 0) {
    if (typeof transport.readBack === "function") return transport.readBack(hwnd);
    if (typeof sendCommand !== "function") throw new Error("ActionDriver transport unavailable");
    return sendCommand("readback", { hwnd: Number(hwnd) || 0 });
  }

  async function execute(action, context = {}) {
    const start = Date.now();
    if (!action || typeof action !== "object" || typeof action.name !== "string" || !SUPPORTED_DESKTOP_ACTIONS.has(action.name)) {
      return { ok: false, refused: true, reason: "unsupported_action", latencyMs: Date.now() - start };
    }
    if (context.signal?.aborted) {
      return { ok: false, refused: true, reason: "aborted", latencyMs: Date.now() - start };
    }
    const args = action.args && typeof action.args === "object" ? action.args : {};
    const targetRect = context.targetRect;

    if (action.name === "take_screenshot") {
      return { ok: true, action: "take_screenshot", latencyMs: Date.now() - start };
    }
    if (action.name === "wait") {
      const secs = Number.isFinite(args.seconds) ? Math.max(0, Math.min(MAX_WAIT_SECONDS, Number(args.seconds))) : 1;
      try {
        await sleep(Math.round(secs * 1000), context.signal);
        return { ok: true, action: "wait", latencyMs: Date.now() - start };
      } catch {
        return { ok: false, refused: true, reason: "aborted", latencyMs: Date.now() - start };
      }
    }
    if (typeof sendCommand !== "function") {
      return { ok: false, refused: true, reason: "driver_unavailable", latencyMs: Date.now() - start };
    }

    const payload = { action: action.name, hwnd: Number(context.hwnd) || 0, bounds: targetRect };

    if (POINT_ACTIONS.has(action.name)) {
      const pt = mapNormalizedToPhysical(args.x, args.y, targetRect);
      payload.physX = pt.x;
      payload.physY = pt.y;
    } else if (action.name === "drag_and_drop") {
      const s = mapNormalizedToPhysical(args.start_x, args.start_y, targetRect);
      const e = mapNormalizedToPhysical(args.end_x, args.end_y, targetRect);
      payload.startPhysX = s.x;
      payload.startPhysY = s.y;
      payload.endPhysX = e.x;
      payload.endPhysY = e.y;
    } else if (action.name === "scroll") {
      const pt = mapNormalizedToPhysical(args.x, args.y, targetRect);
      payload.physX = pt.x;
      payload.physY = pt.y;
      payload.direction = args.direction;
      payload.magnitude = Number.isFinite(args.magnitude_in_pixels) ? Math.round(args.magnitude_in_pixels) : 300;
    } else if (action.name === "type") {
      payload.text = String(args.text);
      payload.pressEnter = args.press_enter === true;
      if (typeof args.x === "number" && typeof args.y === "number") {
        const pt = mapNormalizedToPhysical(args.x, args.y, targetRect);
        payload.physX = pt.x;
        payload.physY = pt.y;
      }
    } else if (action.name === "press_key" || action.name === "key_down" || action.name === "key_up") {
      payload.key = String(args.key);
    } else if (action.name === "hotkey") {
      payload.keys = args.keys.map(String);
    }

    const res = await sendCommand("exec", payload, context.signal);
    return {
      ok: Boolean(res && res.ok),
      refused: Boolean(res && res.refused),
      reason: res && !res.ok ? String(res.error || "exec_failed") : undefined,
      sent: res?.sent,
      latencyMs: Number.isFinite(res?.latencyMs) ? res.latencyMs : Date.now() - start,
    };
  }

  function abort() {
    abortTransport();
  }

  function focusTarget(hwnd) {
    return sendCommand("focus", { hwnd });
  }

  function checkRefTarget(hwnd, bounds, pid) {
    return sendCommand("exec", { action: "check_ref_target", hwnd, bounds, pid });
  }

  return { ownProcessTree: pid => sendCommand("own_tree", { pid }), checkRefTarget, focusTarget, inspectTarget, captureTarget, readBack, execute, abort };
}

/**
 * Real Windows ActionDriver backed by the native C# helper (native/action/bin/filow-action.exe).
 * Uses Per-Monitor DPI v2, PrintWindow target-window capture, SendInput, and UIA read-back.
 */
function createWindowsActionDriver(opts = {}) {
  const spawn = opts.spawn || childProcess.spawn;
  const exe = opts.exe || helperPath();
  const exists = opts.exists || fs.existsSync;
  const parentPid = opts.parentPid ?? process.pid;
  const log = opts.log || (() => {});

  let child = null;
  let ready = false;
  let pending = null;
  let readyWaiters = [];
  let chain = Promise.resolve();

  function failPending(reason) {
    if (pending) {
      clearTimeout(pending.timer);
      const p = pending;
      pending = null;
      p.reject(new Error(reason));
    }
    for (const w of readyWaiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(new Error(reason));
    }
  }

  function killChild() {
    const c = child;
    child = null;
    ready = false;
    failPending("aborted");
    if (!c) return;
    try { c.stdin.write("quit\n"); } catch {}
    try { c.kill(); } catch {}
  }

  function ensureStarted() {
    if (process.platform !== "win32") return Promise.reject(new Error("Windows ActionDriver requires win32"));
    if (child && ready) return Promise.resolve();
    if (!child) {
      if (!exists(exe)) return Promise.reject(new Error("Windows action helper binary not found"));
      child = spawn(exe, [], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
      const mine = child;
      let buf = "";
      mine.stdout.setEncoding("utf8");
      mine.stdout.on("data", (chunk) => {
        if (child !== mine) return;
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg && msg.ready) {
            ready = true;
            for (const w of readyWaiters.splice(0)) { clearTimeout(w.timer); w.resolve(); }
            continue;
          }
          if (pending) {
            const p = pending;
            pending = null;
            clearTimeout(p.timer);
            p.resolve(msg);
          }
        }
      });
      const onGone = (why) => {
        if (child !== mine) return;
        child = null;
        ready = false;
        failPending(`action_helper_ended:${why}`);
        log(`action-driver: helper ended (${why})`);
      };
      mine.on("error", (e) => onGone(e.message));
      mine.on("exit", (code) => onGone(`exit_${code}`));
      mine.stdin.on("error", () => {});
    }
    return new Promise((resolve, reject) => {
      if (ready) return resolve();
      const timer = setTimeout(() => {
        readyWaiters = readyWaiters.filter((w) => w.resolve !== resolve);
        reject(new Error("action_helper_start_timeout"));
      }, 8000);
      readyWaiters.push({ resolve, reject, timer });
    });
  }

  function sendCommand(cmd, data = {}, signal) {
    const run = async () => {
      if (signal?.aborted) throw new Error("aborted");
      await ensureStarted();
      if (signal?.aborted) throw new Error("aborted");
      let line;
      if (cmd === "inspect") line = `inspect ${Number(data.hwnd) || 0} ${parentPid}`;
      else if (cmd === "capture") line = `capture ${Number(data.hwnd) || 0} ${Number(data.maxWidth) || 1280} ${parentPid}`;
      else if (cmd === "readback") line = `readback ${Number(data.hwnd) || 0}`;
      else if (cmd === "own_tree") line = `own_tree ${data.pid}`;
      else if (cmd === "focus") line = `focus ${Number(data.hwnd) || 0}`;
      else if (cmd === "exec") line = `exec ${JSON.stringify(data)}`;
      else throw new Error(`unknown_driver_command:${cmd}`);

      return new Promise((resolve, reject) => {
        if (!child || !ready) return reject(new Error("action_helper_not_ready"));
        const timer = setTimeout(() => {
          if (pending && pending.resolve === resolve) {
            pending = null;
            killChild();
            reject(new Error("action_helper_timeout"));
          }
        }, 12_000);
        pending = { resolve, reject, timer };
        try {
          child.stdin.write(`${line}\n`);
        } catch (err) {
          clearTimeout(timer);
          pending = null;
          reject(err);
        }
      });
    };
    const next = chain.then(run, run);
    chain = next.catch(() => {});
    return next;
  }

  return createActionDriver({ sendCommand, abort: killChild });
}

module.exports = {
  COORD_MIN,
  COORD_MAX,
  COORD_SPAN,
  SUPPORTED_DESKTOP_ACTIONS,
  dipRectToPhysical,
  mapNormalizedToPhysical,
  physicalToVirtualAbsolute,
  snapToUiaElement,
  snapAction,
  helperPath,
  createActionDriver,
  createWindowsActionDriver,
};
