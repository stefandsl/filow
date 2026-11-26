import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const bounds = { x: 0, y: 0, width: 100, height: 100 };
const action = { name: "click", args: { x: 100, y: 100 } };

async function fixture(mode = "ok") {
  const { createAgentDesktopDriver } = require("./agent-desktop-driver");
  const child = Object.assign(new EventEmitter(), { pid: 123, stdout: new PassThrough(), stdin: new PassThrough() as Writable });
  const tools: string[] = [];
  let written!: () => void;
  const dispatched = new Promise<void>((resolve) => { written = resolve; });
  child.stdin = new Writable({ write(chunk, _, done) {
    const { id, params } = JSON.parse(chunk.toString());
    const name = params.name;
    tools.push(name);
    let result;
    if (name === "desktop_snapshot") {
      expect(params.arguments.window_id).toBe("w-17");
      result = { ok: true, data: { complete: true, snapshot_id: "s12345678", window: { id: "w-17" }, tree: {
        name: "Next", role: "button", ref_id: "@s12345678:e1", available_actions: ["Click"], bounds: { x: 5, y: 5, width: 20, height: 20 },
      } } };
    } else {
      expect(params.arguments).toEqual({ ref_id: "@s12345678:e1" });
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
  const observer = { abort: vi.fn(), focusTarget: vi.fn(), checkTarget: vi.fn(async () => ({ ok: true })),
    captureTarget: async () => ({ hwnd: 17, info: { exe: "fixture.exe" }, bounds, snapshotId: "frame",
      elements: [{ name: "Next", x1: 50, y1: 50, x2: 250, y2: 250 }] }) };
  const driver = createAgentDesktopDriver({ observer, spawn, killTree, exe: "fixture.exe", stateDir: tmpdir(), makeState: () => "unused", clearState: vi.fn() });
  const shot = await driver.captureTarget(17);
  const context = { hwnd: 17, snapshotId: shot.snapshotId, targetRect: bounds };
  return { driver, context, tools, killTree, dispatched, spawn, observer };
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
  expect(f.spawn.mock.calls[0]).toEqual(["fixture.exe", ["mcp"], expect.anything()]);
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
