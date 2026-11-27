import { createRequire } from "node:module";
import path from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const bounds = { x: 0, y: 0, width: 100, height: 100 };
const action = { name: "click", args: { x: 100, y: 100 } };

function server(mode = "ok") {
  const { createAgentDesktopDriver } = require("./agent-desktop-driver");
  const child = Object.assign(new EventEmitter(), { pid: 123, stdout: new PassThrough(), stdin: new PassThrough() as Writable });
  const tools: string[] = [];
  const requests: object[] = [];
  const node = { states: [] as string[], available_actions: ["Click"], value: "" };
  let written!: () => void;
  const dispatched = new Promise<void>((resolve) => { written = resolve; });
  const state = { duplicate: false, ref: "@s12345678:e1", owned: true, livePid: 42, panelFocused: false, covered: false, focusedName: "Next" };
  child.stdin = new Writable({ write(chunk, _, done) {
    const { id, params } = JSON.parse(chunk.toString());
    const name = params.name;
    tools.push(name);
    let result;
    if (name === "desktop_snapshot") {
      expect(params.arguments.window_id).toBe("w-17");
      const button = { name: "Next", role: "button", ref_id: state.ref, ...node, bounds: { x: 5, y: 5, width: 20, height: 20 } };
      const tree = { children: state.duplicate ? [button, { ...button, ref_id: "@s12345678:e2" }] : [button] };
      result = { ok: true, data: { complete: true, snapshot_id: "s12345678", window: { id: "w-17" }, tree } };
    } else {
      requests.push(params.arguments);
      written();
      if (mode === "crash") { queueMicrotask(() => child.emit("exit", 1)); done(); return; }
      if (mode === "stall") { done(); return; }
      result = mode === "ok" ? { ok: true } : { ok: false, error: { code: mode } };
    }
    child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: { structuredContent: result, isError: !result.ok } }) + "\n");
    done();
  } });
  const spawn = vi.fn(() => child);
  const killTree = vi.fn();
  const observer = require("./action-driver").createActionDriver({
    sendCommand: (cmd: string, data: { action?: string; hwnd: number; pid?: number; bounds?: typeof bounds }) => {
      if (cmd === "own_tree") return { ok: state.owned };
      if (cmd === "exec" && data.action === "check_target") return { ok: !state.panelFocused, error: "target_not_foreground" };
      if (cmd === "exec" && data.action === "check_ref_target") {
        expect(data).toMatchObject({ action: "check_ref_target", hwnd: 17, bounds, pid: 42 });
        if (state.covered && "physX" in data && "physY" in data) return { ok: false, error: "target_not_foreground" };
        return { ok: data.pid === state.livePid, error: "target_changed" };
      }
      throw new Error("Unexpected helper command " + cmd);
    },
    abort: vi.fn(), inspectTarget: async () => ({ hwnd: 17, bounds }),
    readBack: async () => ({ text: "Next" }),
    captureTarget: async () => ({ hwnd: 17, info: { exe: "fixture.exe", pid: 42, focusedElement: { name: state.focusedName } }, bounds, snapshotId: "frame",
      elements: [{ name: "Next", x1: 50, y1: 50, x2: 250, y2: 250 }] }),
  });
  for (const method of ["abort", "focusTarget", "ownProcessTree"]) vi.spyOn(observer, method);
  const driver = createAgentDesktopDriver({ observer, spawn, killTree, exe: "fixture.exe", stateDir: tmpdir(), makeState: () => "unused", clearState: vi.fn() });
  return { driver, node, requests, tools, killTree, dispatched, spawn, observer, state };
}

async function fixture(mode = "ok") {
  const f = server(mode);
  const { driver } = f;
  const shot = await driver.captureTarget(17);
  const context = { hwnd: 17, snapshotId: shot.snapshotId, targetRect: bounds };
  return { ...f, context };
}

it.each(["AMBIGUOUS_TARGET", "STALE_REF"])("ends on %s with no fallback input", async (code) => {
  const f = await fixture(code);
  expect(await f.driver.execute(action, f.context)).toMatchObject({ refused: true, reason: code });
  expect(f.tools).toEqual(["desktop_snapshot", "desktop_click"]);
});
it("rejects replay and uses only a headless ref without focusing", async () => {
  const f = await fixture();
  await f.driver.focusTarget(17);
  expect(f.observer.focusTarget).not.toHaveBeenCalled();
  expect(f.spawn.mock.calls[0]).toEqual(["fixture.exe", ["mcp"], expect.objectContaining({ env: expect.objectContaining({ AGENT_DESKTOP_HOME: path.join("unused", "refs") }) })]);
  expect(await f.driver.execute(action, f.context)).toMatchObject({ ok: true });
  expect(await f.driver.execute(action, f.context)).toMatchObject({ refused: true });
  expect(f.tools).toEqual(["desktop_snapshot", "desktop_click"]);
  expect(f.requests).toEqual([{ ref_id: f.state.ref }]);
});
it("Stop cancels a dispatched call and kills its process tree", async () => {
  const f = await fixture("stall");
  const pending = f.driver.execute(action, f.context);
  await f.dispatched;
  f.driver.abort();
  expect(await pending).toMatchObject({ refused: true });
  expect(f.killTree).toHaveBeenCalledWith(123);
});
it("refuses on child crash without replay", async () => {
  const f = await fixture("crash");
  expect(await f.driver.execute(action, f.context)).toMatchObject({ refused: true });
  expect(f.tools).toEqual(["desktop_snapshot", "desktop_click"]);
});

it("binds the process tree before MCP and closes the owner on server death", async () => {
  const f = await fixture("crash");
  expect(f.observer.ownProcessTree).toHaveBeenCalledWith(123);
  await f.driver.execute(action, f.context);
  expect(f.observer.abort).toHaveBeenCalled();
});

it.each([
  ["two matching nodes", "AMBIGUOUS_TARGET"],
  ["foreign ref prefix", "STALE_REF"],
  ["different process", "target_changed"],
  ["moved bounds", "STALE_REF"],
  ["different frame", "STALE_REF"],
])("refuses %s before input and accepts a fresh bound ref behind the panel", async (change, reason) => {
  const f = server();
  f.state.panelFocused = true;
  f.state.duplicate = change === "two matching nodes";
  if (change === "foreign ref prefix") f.state.ref = "@sOTHER:e1";
  if (change === "different process") f.state.livePid = 43;
  const shot = await f.driver.captureTarget(17);
  const context = { hwnd: 17, snapshotId: change === "different frame" ? "older" : shot.snapshotId,
    targetRect: change === "moved bounds" ? { ...bounds, x: 1 } : bounds };
  expect(await f.driver.execute(action, context)).toMatchObject({ refused: true, reason });
  expect(f.tools).toEqual(["desktop_snapshot"]);
  Object.assign(f.state, { duplicate: false, ref: "@s12345678:e1", livePid: 42 });
  const fresh = await f.driver.captureTarget(17);
  expect(await f.driver.execute(action, { hwnd: 17, snapshotId: fresh.snapshotId, targetRect: bounds })).toMatchObject({ ok: true });
  expect(f.tools).toEqual(["desktop_snapshot", "desktop_snapshot", "desktop_click"]);
  f.driver.abort();
});

it("terminates a child denied job ownership before its first tool request", async () => {
  const f = server();
  f.state.owned = false;
  await expect(f.driver.captureTarget(17)).rejects.toThrow("driver_ownership_failed");
  expect(f.tools).toEqual([]);
  expect(f.killTree).toHaveBeenCalledWith(123);
});

it("completes a granted ref action through the loop with the panel focused", async () => {
  const f = server();
  f.state.panelFocused = true;
  const planner = {
    start: async () => ({ ok: true, calls: [{ ...action, safetyDecision: { decision: "require_confirmation" } }] }),
    continueWithResult: async () => ({ ok: true, calls: [] }),
  };
  const { createComputerUseController } = require("./action-loop");
  const result = await createComputerUseController({ driver: f.driver, planner }).run({
    enabled: true, consentGranted: true, targetHwnd: 17, restoreFocusAtStart: true, task: "Choose Next",
    confirmStep: ({ nonce }: { nonce: string }) => ({ nonce, clicked: true, confirmed: true }),
  });
  expect(result).toMatchObject({ ok: true, steps: 1, refusals: [] });
  expect(f.tools).toEqual(["desktop_snapshot", "desktop_click", "desktop_snapshot"]);
  expect(f.observer.focusTarget).not.toHaveBeenCalled();
});

it.each([
  ["type", { text: "note" }, "desktop_set_value", { ref_id: "@s12345678:e1", value: "note" }],
  ["hotkey", { keys: ["ctrl", "s"] }, "desktop_press", { app: "fixture.exe", window_id: "w-17", combo: "ctrl+s" }],
  ["press_key", { key: "tab" }, "desktop_press", { app: "fixture.exe", window_id: "w-17", combo: "tab" }],
  ["scroll", { ...action.args, direction: "down", magnitude_in_pixels: 650 }, "desktop_scroll",
    { ref_id: "@s12345678:e1", direction: "down", amount: 7 }],
])("binds %s to the captured control or window", async (name, args, tool, expected) => {
  const f = server();
  Object.assign(f.node, { states: ["focused"], available_actions: ["SetValue", "Scroll"] });
  const shot = await f.driver.captureTarget(17);
  const res = await f.driver.execute({ name, args }, { hwnd: 17, snapshotId: shot.snapshotId, targetRect: bounds });
  expect(res.ok).toBe(true);
  expect(f.tools).toEqual(["desktop_snapshot", tool]);
  expect(f.requests).toEqual([expected]);
});

it("refuses to replace a nonempty value during typing", async () => {
  const f = server();
  Object.assign(f.node, { states: ["focused"], available_actions: ["SetValue"], value: "existing" });
  const shot = await f.driver.captureTarget(17);
  const result = await f.driver.execute({ name: "type", args: { text: "note" } },
    { hwnd: 17, snapshotId: shot.snapshotId, targetRect: bounds });
  expect(result.reason).toBe("unsupported_action");
  expect(f.requests).toEqual([]);
});

it.each(["filow", "agent-desktop"])("blocks an unknown observer scan in the %s arm", async arm => {
  const f = server();
  const driver = arm === "filow" ? f.observer : f.driver;
  vi.spyOn(driver, "inspectTarget").mockResolvedValue({ hwnd: 17, passwordUnknown: true });
  const capture = vi.spyOn(driver, "captureTarget");
  const execute = vi.spyOn(driver, "execute");
  const planner = { start: vi.fn() };
  const result = await require("./action-loop").createComputerUseController({ driver, planner }).run({
    enabled: true, consentGranted: true, targetHwnd: 17, task: "Write a note",
  });
  expect(result).toMatchObject({ reason: "password_field", bytesSent: 0 });
  expect(capture).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(planner.start).not.toHaveBeenCalled();
});

it("hides the unsigned upstream download and refuses installation", async () => {
  const asset = require("./agent-desktop-asset").agentDesktopAsset(tmpdir());
  expect(asset.status().available).toBe(false);
  await expect(asset.change("install")).rejects.toThrow("agent_desktop_unavailable");
});

it("refuses a covered point before calling the headless tool", async () => {
  const f = await fixture();
  f.state.covered = true;
  expect(await f.driver.execute(action, f.context)).toMatchObject({ refused: true, reason: "target_not_foreground" });
  expect(f.tools).toEqual(["desktop_snapshot"]);
});

it("refuses an edit without a headless click action before calling focus", async () => {
  const f = await fixture();
  f.node.available_actions = ["SetValue"];
  const shot = await f.driver.captureTarget(17);
  expect(await f.driver.execute(action, { ...f.context, snapshotId: shot.snapshotId })).toMatchObject({
    refused: true, reason: "unsupported_action",
  });
  expect(f.tools).toEqual(["desktop_snapshot", "desktop_snapshot"]);
});

it("refuses point-free typing if the observer and scoped snapshot disagree on focus", async () => {
  const f = server();
  f.state.focusedName = "Bottom Action";
  Object.assign(f.node, { states: ["focused"], available_actions: ["SetValue"] });
  const shot = await f.driver.captureTarget(17);
  const result = await f.driver.execute({ name: "type", args: { text: "Saved note 42" } },
    { hwnd: 17, snapshotId: shot.snapshotId, targetRect: bounds });
  expect(result.reason).toBe("unbound_target");
  expect(f.requests).toEqual([]);
});
