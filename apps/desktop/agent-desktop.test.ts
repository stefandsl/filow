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
  let written!: () => void;
  const dispatched = new Promise<void>((resolve) => { written = resolve; });
  const state = { duplicate: false, ref: "@s12345678:e1", owned: true, livePid: 42, panelFocused: false };
  child.stdin = new Writable({ write(chunk, _, done) {
    const { id, params } = JSON.parse(chunk.toString());
    const name = params.name;
    tools.push(name);
    let result;
    if (name === "desktop_snapshot") {
      expect(params.arguments.window_id).toBe("w-17");
      const button = { name: "Next", role: "button", ref_id: state.ref, available_actions: ["Click"], bounds: { x: 5, y: 5, width: 20, height: 20 } };
      const tree = { children: state.duplicate ? [button, { ...button, ref_id: "@s12345678:e2" }] : [button] };
      result = { ok: true, data: { complete: true, snapshot_id: "s12345678", window: { id: "w-17" }, tree } };
    } else {
      expect(params.arguments).toEqual({ ref_id: state.ref });
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
        expect(data).toEqual({ action: "check_ref_target", hwnd: 17, bounds, pid: 42 });
        return { ok: data.pid === state.livePid, error: "target_changed" };
      }
      throw new Error("Unexpected helper command " + cmd);
    },
    abort: vi.fn(), inspectTarget: async () => ({ hwnd: 17, bounds }),
    readBack: async () => ({ text: "Next" }),
    captureTarget: async () => ({ hwnd: 17, info: { exe: "fixture.exe", pid: 42 }, bounds, snapshotId: "frame",
      elements: [{ name: "Next", x1: 50, y1: 50, x2: 250, y2: 250 }] }),
  });
  for (const method of ["abort", "focusTarget", "ownProcessTree"]) vi.spyOn(observer, method);
  const driver = createAgentDesktopDriver({ observer, spawn, killTree, exe: "fixture.exe", stateDir: tmpdir(), makeState: () => "unused", clearState: vi.fn() });
  return { driver, tools, killTree, dispatched, spawn, observer, state };
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

it("hides the unsigned upstream download and refuses installation", async () => {
  const asset = require("./agent-desktop-asset").agentDesktopAsset(tmpdir());
  expect(asset.status().available).toBe(false);
  await expect(asset.change("install")).rejects.toThrow("agent_desktop_unavailable");
});
