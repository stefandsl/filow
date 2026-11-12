// What Windows names on a screen, read by a helper process: the wrapper must never hang a question,
// never mix up answers, and map physical pixels to the grid of the display.
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
type Scan = { elements: unknown[]; ms: number; partial: boolean } | null;
type Reader = { start(): boolean; scan(rect: { x: number; y: number; width: number; height: number }, o?: { budgetMs?: number; timeoutMs?: number; ownPid?: number }): Promise<Scan>; stop(): void; ready: boolean; running: boolean };
const { createElementReader, toGridElements, helperPath } = require("./okfilow-uia.js") as {
  createElementReader(o: { spawn?: unknown; script?: string; platform?: string; log?: (l: string) => void; powershell?: string }): Reader;
  toGridElements(rows: unknown, rect: { x: number; y: number; width: number; height: number }, screen: number): Array<{ name: string; type: string; screen: number; x1: number; y1: number; x2: number; y2: number }>;
  helperPath(dir?: string): string;
};

/** A stand-in for the PowerShell helper: records what it is sent and says what the test tells it to. */
function fakeHelper() {
  const sent: string[] = [];
  const procs: Array<EventEmitter & { stdout: EventEmitter & { setEncoding(): void }; stdin: { write(s: string): void; on(): void }; kill: ReturnType<typeof vi.fn> }> = [];
  const args: string[][] = [];
  const spawn = vi.fn((_exe: string, a: string[]) => {
    args.push(a);
    const p = Object.assign(new EventEmitter(), {
      stdout: Object.assign(new EventEmitter(), { setEncoding() {} }),
      stdin: { write: (s: string) => { sent.push(s); }, on() {} },
      kill: vi.fn(),
    });
    procs.push(p);
    return p;
  });
  const say = (line: string, i = procs.length - 1) => procs[i].stdout.emit("data", line);
  return { spawn, sent, procs, args, say };
}
const RECT = { x: 1920, y: 0, width: 1360, height: 768 };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("the helper's rows become elements on the display's grid", () => {
  it("maps physical pixels of a second screen to 0-1000 and drops what is malformed or centred off the display", () => {
    const got = toGridElements([
      ["Start", "Button", 1920, 720, 43, 48],
      ["  Firefox - 1 finestra  ", "Button", 2010, 720, 34, 48],
      ["off screen", "Button", 100, 100, 40, 40],
      ["", "Button", 2000, 10, 40, 40],
      ["flat", "Button", 2000, 10, 0, 40],
      ["text numbers", "Button", "a", 10, 40, 40],
      "nonsense",
    ], RECT, 2);
    expect(got).toEqual([
      { name: "Start", type: "Button", screen: 2, x1: 0, y1: 937.5, x2: 31.6, y2: 1000 },
      { name: "Firefox - 1 finestra", type: "Button", screen: 2, x1: 66.2, y1: 937.5, x2: 91.2, y2: 1000 },
    ]);
    // a display at 150%: the same physical arithmetic, whatever the scaling
    expect(toGridElements([["OK", "Button", 2880, 1620, 96, 54]], { x: 0, y: 0, width: 3840, height: 2160 }, 1)[0]).toMatchObject({ x1: 750, y1: 750, x2: 775, y2: 775 });
    expect(toGridElements("x", RECT, 1)).toEqual([]);
    expect(toGridElements(Array.from({ length: 700 }, (_, i) => [`n${i}`, "Button", 1930, 10, 20, 20]), RECT, 1)).toHaveLength(600);
  });
});

describe("the reader", () => {
  it("does nothing off Windows: no process, scan gives null", async () => {
    const h = fakeHelper();
    const r = createElementReader({ spawn: h.spawn, platform: "darwin" });
    expect(r.start()).toBe(false);
    await expect(r.scan(RECT)).resolves.toBeNull();
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("starts PowerShell on the script without a profile or a window, and answers a scan with the helper's rows", async () => {
    const h = fakeHelper();
    const r = createElementReader({ spawn: h.spawn, platform: "win32", script: "C:\\app\\okfilow-uia.ps1" });
    expect(r.start()).toBe(true);
    expect(h.args[0]).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "C:\\app\\okfilow-uia.ps1"]);
    // not ready yet: no request is written, the question goes on without a list
    await expect(r.scan(RECT)).resolves.toBeNull();
    expect(h.sent).toEqual([]);
    h.say('{"ready":true}\n');
    const p = r.scan(RECT, { budgetMs: 500, ownPid: 4242 });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toEqual(["scan 1920 0 1360 768 500 4242\n"]);
    // the answer may arrive in two chunks
    h.say('{"ms":210,"partial":false,"elements":[["Start","Button",');
    h.say('1920,720,43,48]]}\n');
    await expect(p).resolves.toEqual({ ms: 210, partial: false, elements: [["Start", "Button", 1920, 720, 43, 48]] });
  });

  it("gives up after the timeout, and the late answer is not taken for the next request's", async () => {
    const h = fakeHelper();
    const r = createElementReader({ spawn: h.spawn, platform: "win32" });
    r.start();
    h.say('{"ready":true}\n');
    const first = r.scan(RECT, { budgetMs: 100, timeoutMs: 300 });
    await vi.advanceTimersByTimeAsync(300);
    await expect(first).resolves.toBeNull();
    const second = r.scan({ ...RECT, x: 0 }, { budgetMs: 100, timeoutMs: 300 });
    await vi.advanceTimersByTimeAsync(0);
    h.say('{"ms":400,"partial":false,"elements":[["late","Button",1,1,9,9]]}\n');
    h.say('{"ms":50,"partial":true,"elements":[["mine","Button",2,2,9,9]]}\n');
    await expect(second).resolves.toEqual({ ms: 50, partial: true, elements: [["mine", "Button", 2, 2, 9, 9]] });
  });

  it("runs requests one after the other", async () => {
    const h = fakeHelper();
    const r = createElementReader({ spawn: h.spawn, platform: "win32" });
    r.start();
    h.say('{"ready":true}\n');
    const a = r.scan(RECT), b = r.scan({ ...RECT, x: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toHaveLength(1);
    h.say('{"ms":1,"partial":false,"elements":[]}\n');
    await a;
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toHaveLength(2);
    h.say('{"ms":2,"partial":false,"elements":[]}\n');
    await expect(b).resolves.toMatchObject({ ms: 2 });
  });

  it("a helper that dies answers null, is started again for a later question, and is left alone after four starts", async () => {
    const h = fakeHelper();
    const lines: string[] = [];
    const r = createElementReader({ spawn: h.spawn, platform: "win32", log: (l) => lines.push(l) });
    r.start();
    h.say('{"ready":true}\n');
    const p = r.scan(RECT);
    await vi.advanceTimersByTimeAsync(0);
    h.procs[0].emit("exit", 1);
    await expect(p).resolves.toBeNull();
    expect(lines.join("\n")).toContain("screen names helper ended (exit 1)");
    for (let i = 1; i < 4; i++) {
      await expect(r.scan(RECT)).resolves.toBeNull(); // started again, not ready yet
      expect(h.spawn).toHaveBeenCalledTimes(i + 1);
      h.procs[i].emit("exit", 1);
    }
    await expect(r.scan(RECT)).resolves.toBeNull();
    expect(h.spawn).toHaveBeenCalledTimes(4);
  });

  it("a broken reply or a spawn that throws is null, never an exception; stop ends the process", async () => {
    const h = fakeHelper();
    const r = createElementReader({ spawn: h.spawn, platform: "win32" });
    r.start();
    h.say('{"ready":true}\n');
    const p = r.scan(RECT);
    await vi.advanceTimersByTimeAsync(0);
    h.say("not json\n");
    h.say('{"error":"scan failed"}\n');
    await expect(p).resolves.toBeNull();
    r.stop();
    expect(h.procs[0].kill).toHaveBeenCalled();
    expect(h.sent.at(-1)).toBe("quit\n");
    await expect(r.scan(RECT)).resolves.toBeNull();
    const bad = createElementReader({ spawn: () => { throw new Error("ENOENT"); }, platform: "win32" });
    expect(bad.start()).toBe(false);
    await expect(bad.scan(RECT)).resolves.toBeNull();
  });
});

describe("packaging", () => {
  it("the script is found outside app.asar, is shipped, and is unpacked", () => {
    expect(helperPath("/opt/Filow/resources/app.asar/apps/desktop").replace(/\\/g, "/")).toBe("/opt/Filow/resources/app.asar.unpacked/apps/desktop/okfilow-uia.ps1");
    // in development there is no archive: the script beside the module
    expect(helperPath("/src/apps/desktop").replace(/\\/g, "/")).toBe("/src/apps/desktop/okfilow-uia.ps1");
    expect(existsSync(new URL("./okfilow-uia.ps1", import.meta.url))).toBe(true);
    const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { build: { files: string[]; asarUnpack: string[] } };
    expect(pkg.build.files).toEqual(expect.arrayContaining(["okfilow-uia.js", "okfilow-uia.ps1"]));
    expect(pkg.build.asarUnpack).toContain("okfilow-uia.ps1");
  });

  it("the helper only reads: no input, focus or window calls in the script", () => {
    const ps = readFileSync(new URL("./okfilow-uia.ps1", import.meta.url), "utf8");
    expect(ps).not.toMatch(/SendInput|SendKeys|keybd_event|mouse_event|SetCursorPos|SetForegroundWindow|SetFocus|InvokePattern|PostMessage|SendMessage|ShowWindow|SetWindowPos/i);
    expect(ps).not.toMatch(/Invoke-WebRequest|Net\.WebClient|Invoke-RestMethod|Start-BitsTransfer/i);
  });
});
