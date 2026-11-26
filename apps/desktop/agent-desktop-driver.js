// Only the fixed semantic tools below are reachable from the grant loop.
const fs = require("node:fs");
const cp = require("node:child_process");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { elementAtCoords } = require("./action-gate");
const { mapNormalizedToPhysical } = require("./action-driver");

function killWindowsTree(pid) {
  const taskkill = path.join(process.env.SystemRoot, "System32", "taskkill.exe");
  cp.execFileSync(taskkill, ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
}

function createAgentDesktopDriver({ exe, observer, stateDir, makeState = fs.mkdtempSync, clearState = dir => fs.rmSync(dir, { recursive: true, force: true }), spawn = cp.spawn, killTree = killWindowsTree }) {
  let child, ownership, pending, frame, privateState;
  let generation = 0, seq = 0;

  function end(reason, kill) {
    const mine = child;
    child = null;
    frame = null;
    generation++;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      pending = null;
    }
    if (kill && mine?.pid) {
      try { killTree(mine.pid); } catch { /* The server may already have exited. */ }
    }
    observer.abort(); // Closing the helper releases the job, including orphaned tool workers.
    if (privateState) {
      clearState(privateState);
      privateState = null;
    }
  }

  function start() {
    if (child) return;
    // Inherit only OS paths. Parent planner credentials and upstream global flags stay out.
    fs.mkdirSync(stateDir, { recursive: true });
    privateState = makeState(path.join(stateDir, "turn-"));
    // v1.3.1 creates the state root with its own private Windows DACL.
    const env = { AGENT_DESKTOP_HOME: path.join(privateState, "refs") };
    for (const k of ["SystemRoot", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "SystemDrive"]) {
      if (process.env[k]) env[k] = process.env[k];
    }
    const mine = spawn(exe, ["mcp"], { env, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    child = mine;
    ownership = observer.ownProcessTree(mine.pid);
    const gone = () => { if (child === mine) end("driver_ended", false); };
    mine.once("exit", gone);
    mine.once("error", gone);
    mine.stdin.on("error", () => { if (child === mine) end("driver_pipe", true); });
    let buffer = "";
    mine.stdout.setEncoding("utf8");
    mine.stdout.on("data", chunk => {
      if (child !== mine) return;
      buffer += chunk;
      if (buffer.length > 8 * 1024 * 1024) return end("driver_protocol", true);
      let boundary;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        let msg;
        try { msg = JSON.parse(buffer.slice(0, boundary)); } catch { return end("driver_protocol", true); }
        buffer = buffer.slice(boundary + 1);
        if (!pending || pending.id !== msg.id) continue;
        const request = pending;
        pending = null;
        clearTimeout(request.timer);
        const envelope = msg.result?.structuredContent;
        if (!msg.error && !msg.result?.isError && envelope?.ok === true) request.resolve(envelope.data);
        else {
          const code = envelope?.error?.code;
          request.reject(new Error(/^[A-Z_]{2,48}$/.test(code) ? code : "driver_refused"));
        }
      }
    });
  }

  async function call(name, args) {
    start();
    const mine = child;
    const owned = await ownership;
    if (!mine || mine !== child || !owned?.ok) throw new Error("driver_ownership_failed");
    if (pending) throw new Error("driver_busy");
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending = { id, resolve, reject, timer: setTimeout(() => end("driver_timeout", true), 12000) };
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
    });
  }

  async function captureTarget(hwnd, opts) {
    frame = null;
    const epoch = generation;
    const shot = await observer.captureTarget(hwnd, opts);
    if (generation !== epoch || shot.hwnd !== hwnd) throw new Error("target_changed");
    const windowId = "w-" + hwnd;
    const tree = await call("desktop_snapshot", { app: shot.info.exe, window_id: windowId, include_bounds: true });
    if (generation !== epoch || tree.window?.id !== windowId || tree.identity_unproven || !tree.complete ||
        !/^s[a-zA-Z0-9]+$/.test(tree.snapshot_id)) throw new Error("unbound_snapshot");
    frame = { ...shot, tree, snapshotId: randomUUID() };
    return { ...shot, snapshotId: frame.snapshotId };
  }

  async function execute(action, ctx) {
    const shot = frame;
    frame = null;
    const epoch = generation;
    try {
      if (!shot || shot.snapshotId !== ctx.snapshotId || shot.hwnd !== ctx.hwnd ||
          ["x", "y", "width", "height"].some(k => shot.bounds[k] !== ctx.targetRect?.[k])) throw new Error("STALE_REF");
      if (ctx.signal?.aborted) throw new Error("aborted");
      if (["wait", "take_screenshot"].includes(action.name)) return await observer.execute(action, ctx);
      const hit = elementAtCoords(action, shot.elements);
      if (!hit || hit.isPassword) throw new Error("unbound_target");
      const rect = shot.bounds;
      const point = mapNormalizedToPhysical(action.args.x, action.args.y, rect);
      const matches = [];
      const stack = [shot.tree.tree];
      while (stack.length) {
        const n = stack.pop();
        if (Array.isArray(n.children)) stack.push(...n.children);
        const b = n.bounds;
        if (!b || !n.ref_id || n.name !== hit.name || !hit.name) continue;
        const edges = [(b.x - rect.x) / rect.width, (b.y - rect.y) / rect.height,
          (b.x + b.width - rect.x) / rect.width, (b.y + b.height - rect.y) / rect.height];
        if (edges.every((v, i) => Math.abs(v * 1000 - [hit.x1, hit.y1, hit.x2, hit.y2][i]) <= 0.06)) matches.push(n);
      }
      if (matches.length !== 1) throw new Error(matches.length ? "AMBIGUOUS_TARGET" : "unbound_target");
      const n = matches[0];
      if (!new RegExp("^@" + shot.tree.snapshot_id + ":e[0-9]+$").test(n.ref_id)) throw new Error("STALE_REF");
      const args = { ref_id: n.ref_id };
      let tool;
      if (action.name === "click" && n.available_actions?.includes("Click")) tool = "desktop_click";
      else if (action.name === "type" && !action.args.press_enter && !hit.value && !n.value && n.available_actions?.includes("SetValue")) {
        tool = "desktop_set_value";
        args.value = action.args.text;
      } else if (action.name === "scroll" && n.available_actions?.includes("Scroll") &&
          ["up", "down", "left", "right"].includes(action.args.direction)) {
        tool = "desktop_scroll";
        args.direction = action.args.direction;
        args.amount = 1;
      } else throw new Error("unsupported_action");
      const check = await observer.checkTarget(ctx.hwnd, rect, point);
      if (!check?.ok) throw new Error(check?.error || "target_changed");
      if (epoch !== generation || ctx.signal?.aborted) throw new Error("aborted");
      await call(tool, args);
      return { ok: true, sent: 1 };
    } catch (err) { return { ok: false, refused: true, reason: err.message }; }
  }

  return { inspectTarget: observer.inspectTarget, captureTarget, readBack: observer.readBack, execute,
    finishTurn() { end("turn_ended", true); }, focusTarget: async () => ({ ok: true }), abort() { end("aborted", true); } };
}

module.exports = { createAgentDesktopDriver };
