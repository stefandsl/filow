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
  createElementReader(o: { spawn?: unknown; exe?: string; platform?: string; log?: (l: string) => void; exists?: (f: string) => boolean }): Reader;
  toGridElements(rows: unknown, rect: { x: number; y: number; width: number; height: number }, screen: number): Array<{ name: string; type: string; screen: number; x1: number; y1: number; x2: number; y2: number }>;
  helperPath(dir?: string): string;
};

/** A stand-in for the helper program: records what it is sent and says what the test tells it to. */
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

  it("starts the helper program itself (no PowerShell, no arguments, no window), and answers a scan with its rows", async () => {
    const h = fakeHelper();
    const r = createElementReader({ spawn: h.spawn, exists: () => true, platform: "win32", exe: "C:\\app\\okfilow-uia.exe" });
    expect(r.start()).toBe(true);
    expect(h.spawn.mock.calls[0][0]).toBe("C:\\app\\okfilow-uia.exe");
    expect(h.args[0]).toEqual([]);
    expect((h.spawn.mock.calls[0] as unknown[])[2]).toMatchObject({ windowsHide: true });
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
    const r = createElementReader({ spawn: h.spawn, exists: () => true, platform: "win32" });
    r.start();
    h.say('{"ready":true}\n');
    const first = r.scan(RECT, { budgetMs: 100, timeoutMs: 300 });
    await vi.advanceTimersByTimeAsync(300);
    await expect(first).resolves.toBeNull();
    // while that answer is outstanding nothing more is queued behind it: the next question goes on without a list
    await expect(r.scan({ ...RECT, x: 0 }, { budgetMs: 100, timeoutMs: 300 })).resolves.toBeNull();
    expect(h.sent).toHaveLength(1);
    h.say('{"ms":400,"partial":false,"elements":[["late","Button",1,1,9,9]]}\n');
    const third = r.scan({ ...RECT, x: 0 }, { budgetMs: 100, timeoutMs: 300 });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toHaveLength(2);
    h.say('{"ms":50,"partial":true,"elements":[["mine","Button",2,2,9,9]]}\n');
    await expect(third).resolves.toEqual({ ms: 50, partial: true, elements: [["mine", "Button", 2, 2, 9, 9]] });
  });

  it("a helper stuck in an app that does not answer is ended after ten seconds and a new one starts for a later question", async () => {
    const h = fakeHelper();
    const lines: string[] = [];
    const r = createElementReader({ spawn: h.spawn, exists: () => true, platform: "win32", log: (l) => lines.push(l) });
    r.start();
    h.say('{"ready":true}\n');
    const first = r.scan(RECT, { timeoutMs: 900 });
    await vi.advanceTimersByTimeAsync(900);
    await expect(first).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(r.scan(RECT)).resolves.toBeNull();
    expect(h.procs[0].kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(r.scan(RECT)).resolves.toBeNull();
    expect(h.procs[0].kill).toHaveBeenCalledTimes(1);
    expect(lines.join("\n")).toContain("did not answer");
    // the old process's late words are not read by the new one
    await expect(r.scan(RECT)).resolves.toBeNull();
    expect(h.spawn).toHaveBeenCalledTimes(2);
    h.say('{"ready":true}\n', 1);
    const p = r.scan(RECT);
    await vi.advanceTimersByTimeAsync(0);
    h.say('{"ms":9000,"partial":false,"elements":[["old","Button",1,1,9,9]]}\n', 0);
    h.say('{"ms":40,"partial":false,"elements":[["new","Button",1,1,9,9]]}\n', 1);
    await expect(p).resolves.toMatchObject({ elements: [["new", "Button", 1, 1, 9, 9]] });
  });

  it("runs requests one after the other", async () => {
    const h = fakeHelper();
    const r = createElementReader({ spawn: h.spawn, exists: () => true, platform: "win32" });
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
    const r = createElementReader({ spawn: h.spawn, exists: () => true, platform: "win32", log: (l) => lines.push(l) });
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
    const r = createElementReader({ spawn: h.spawn, exists: () => true, platform: "win32" });
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
    const bad = createElementReader({ spawn: () => { throw new Error("ENOENT"); }, exists: () => true, platform: "win32" });
    expect(bad.start()).toBe(false);
    await expect(bad.scan(RECT)).resolves.toBeNull();
  });
});

describe("a build without the helper", () => {
  it("starts nothing, says so once, and every scan is null (pointing from the model's coordinates)", async () => {
    const h = fakeHelper();
    const lines: string[] = [];
    const r = createElementReader({ spawn: h.spawn, exists: () => false, platform: "win32", exe: "C:\\app\\okfilow-uia.exe", log: (l) => lines.push(l) });
    expect(r.start()).toBe(false);
    await expect(r.scan(RECT)).resolves.toBeNull();
    await expect(r.scan(RECT)).resolves.toBeNull();
    expect(h.spawn).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("not in this build");
  });
});

describe("packaging", () => {
  it("the program is found outside app.asar, is built by npm run vendor, is shipped, and is unpacked", () => {
    expect(helperPath("/opt/Filow/resources/app.asar/apps/desktop").replace(/\\/g, "/")).toBe("/opt/Filow/resources/app.asar.unpacked/apps/desktop/native/uia/bin/okfilow-uia.exe");
    // in development there is no archive: the program built beside the module
    expect(helperPath("/src/apps/desktop").replace(/\\/g, "/")).toBe("/src/apps/desktop/native/uia/bin/okfilow-uia.exe");
    expect(existsSync(new URL("./native/uia/okfilow-uia.cs", import.meta.url))).toBe(true);
    // the PowerShell helper that compiled C# into the user's temp folder at every start is gone
    expect(existsSync(new URL("./okfilow-uia.ps1", import.meta.url))).toBe(false);
    const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { scripts: Record<string, string>; build: { files: string[]; asarUnpack: string[] } };
    expect(pkg.scripts.vendor).toContain("node native/uia/build.mjs");
    expect(pkg.build.files).toEqual(expect.arrayContaining(["okfilow-uia.js", "native/uia/bin/okfilow-uia.exe"]));
    expect(pkg.build.files.join("\n")).not.toMatch(/okfilow-uia\.(cs|ps1)|native\/uia\/\*\*/);
    expect(pkg.build.asarUnpack).toContain("native/uia/bin/**");
  });

  it("the helper only reads: no input, focus, window or network calls in its source", () => {
    const cs = readFileSync(new URL("./native/uia/okfilow-uia.cs", import.meta.url), "utf8");
    expect(cs).not.toMatch(/SendInput|SendKeys|keybd_event|mouse_event|SetCursorPos|SetForegroundWindow|SetFocus|InvokePattern|PostMessage|SendMessage|ShowWindow|SetWindowPos|Process\.Start|System\.Net|WebClient|HttpClient|File\.Write|Registry/i);
  });

  it("is compiled by the .NET Framework's own csc.exe, for any CPU, against UI Automation and MSAA only", async () => {
    const { cscArgs, frameworkDir } = (await import("./native/uia/build.mjs")) as { cscArgs(fw: string, src: string, out: string): string[]; frameworkDir(windir: string, exists: (f: string) => boolean): string };
    const fw = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319";
    const a = cscArgs(fw, "okfilow-uia.cs", "bin\\okfilow-uia.exe");
    expect(a).toEqual(expect.arrayContaining(["/target:exe", "/platform:anycpu", "/out:bin\\okfilow-uia.exe", "okfilow-uia.cs"]));
    expect(a.filter((x) => x.startsWith("/r:")).map((x) => x.replace(/^.*[\\/]/, ""))).toEqual(["UIAutomationClient.dll", "UIAutomationTypes.dll", "WindowsBase.dll", "Accessibility.dll"]);
    // 64-bit framework first; none at all gives "" (the build then fails on Windows)
    const has = (files: string[]) => (f: string) => files.some((x) => f.replace(/\\/g, "/").endsWith(x));
    expect(frameworkDir("C:\\Windows", has(["Framework64/v4.0.30319/csc.exe", "Framework64/v4.0.30319/WPF/UIAutomationClient.dll", "Framework/v4.0.30319/csc.exe", "Framework/v4.0.30319/WPF/UIAutomationClient.dll"])).replace(/\\/g, "/")).toMatch(/Framework64\/v4\.0\.30319$/);
    expect(frameworkDir("C:\\Windows", has(["Framework/v4.0.30319/csc.exe", "Framework/v4.0.30319/WPF/UIAutomationClient.dll"])).replace(/\\/g, "/")).toMatch(/\/Framework\/v4\.0\.30319$/);
    expect(frameworkDir("C:\\Windows", has(["Framework64/v4.0.30319/csc.exe"]))).toBe("");
  });
});

// The real program, built here with the compiler that ships with Windows (into the repository's own tmp
// folder) and asked about a rectangle far off every display: it starts, answers in the protocol, reads
// nothing, and ends when asked. Windows only.
describe.runIf(process.platform === "win32")("the real helper on Windows", () => {
  beforeEach(() => { vi.useRealTimers(); });
  it("builds, says it is ready, answers a scan and a bad request, and quits", async () => {
    const path = require("node:path") as typeof import("node:path");
    const { build } = (await import("./native/uia/build.mjs")) as { build(o: { outDir: string; log?: (l: string) => void }): string };
    const exe = build({ outDir: path.resolve(__dirname, "../../tmp/uia-test"), log: () => {} });
    const r = createElementReader({ exe, platform: "win32" });
    expect(r.start()).toBe(true);
    for (let i = 0; i < 100 && !r.ready; i++) await new Promise((ok) => setTimeout(ok, 50));
    expect(r.ready).toBe(true);
    const got = await r.scan({ x: -100000, y: -100000, width: 10, height: 10 }, { budgetMs: 300, timeoutMs: 5000 });
    expect(got).toMatchObject({ partial: false, elements: [] });
    r.stop();
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const run = spawnSync(exe, [], { input: "scan 1 2\nhello\nquit\n", encoding: "utf8", timeout: 10_000 });
    expect(run.stdout.split("\n").filter(Boolean)).toEqual(['{"ready":true}', '{"error":"bad request"}', '{"error":"bad request"}']);
    expect(run.status).toBe(0);
  }, 30_000);
});

describe("the screenshot's companion (scanForShot, wired in okfilow.js capture)", () => {
  const { scanForShot } = require("./okfilow-uia.js") as { scanForShot(reader: unknown, displays: unknown[], o: { pictures: boolean; toRect?: (b: { x: number; y: number; width: number; height: number }) => { x: number; y: number; width: number; height: number }; ownPid?: number; platform?: string }): (indexes: number[]) => Promise<Array<{ name: string; screen: number }>> };
  const displays = [{ bounds: { x: 0, y: 0, width: 1280, height: 720 } }, { bounds: { x: 1280, y: 0, width: 1360, height: 768 } }];
  const at150 = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x * 1.5, y: b.y * 1.5, width: b.width * 1.5, height: b.height * 1.5 });
  const reader = () => ({ scan: vi.fn(async (r: { x: number }) => ({ elements: [[r.x === 0 ? "Save" : "Open", "Button", r.x + 15, 15, 30, 30]] })) });

  it("no picture, no scan: the eye closed or Look at my screen off reads nothing", async () => {
    const r = reader();
    await expect(scanForShot(r, displays, { pictures: false, toRect: at150, platform: "win32" })([1, 2])).resolves.toEqual([]);
    expect(r.scan).not.toHaveBeenCalled();
    // off Windows, or without the conversion to physical pixels, nothing either
    await expect(scanForShot(r, displays, { pictures: true, toRect: at150, platform: "darwin" })([1, 2])).resolves.toEqual([]);
    await expect(scanForShot(r, displays, { pictures: true, platform: "win32" })([1, 2])).resolves.toEqual([]);
    await expect(scanForShot(null, displays, { pictures: true, toRect: at150, platform: "win32" })([1, 2])).resolves.toEqual([]);
    expect(r.scan).not.toHaveBeenCalled();
  });

  it("scans every display at once in physical pixels, leaves out OK Filow's own windows, and gives each its screenshot's number", async () => {
    const r = reader();
    const finish = scanForShot(r, displays, { pictures: true, toRect: at150, ownPid: 77, platform: "win32" });
    // started before the picture is taken
    expect(r.scan).toHaveBeenCalledTimes(2);
    expect(r.scan.mock.calls[1]).toEqual([{ x: 1920, y: 0, width: 2040, height: 1152 }, { ownPid: 77 }]);
    const got = await finish([1, 2]);
    expect(got.map((e) => [e.name, e.screen])).toEqual([["Save", 1], ["Open", 2]]);
    // a display with no picture (0) names nothing; a failed or missing scan is just no names
    expect((await scanForShot(r, displays, { pictures: true, toRect: at150, platform: "win32" })([0, 1])).map((e) => [e.name, e.screen])).toEqual([["Open", 1]]);
    const broken = { scan: vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(null) };
    await expect(scanForShot(broken, displays, { pictures: true, toRect: at150, platform: "win32" })([1, 2])).resolves.toEqual([]);
    const badRect = scanForShot(r, displays, { pictures: true, toRect: () => { throw new Error("no"); }, platform: "win32" });
    await expect(badRect([1, 2])).resolves.toEqual([]);
  });

  it("okfilow.js starts the helper with OK Filow, scans only when pictures are taken, sends the names with the shot, and stops it at quit", () => {
    const main = readFileSync(new URL("./okfilow.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const capture = main.slice(main.indexOf("async function capture("), main.indexOf("function status()"));
    expect(capture).toMatch(/scanForShot\(uia, ordered, \{ pictures: wantImages, toRect: [^\n]*dipToScreenRect\(null, b\)\), ownPid: process\.pid \}\)/);
    // the scan starts before getSources, so the two run together
    expect(capture.indexOf("scanForShot(")).toBeLessThan(capture.indexOf("screenSources("));
    expect(capture).toMatch(/pictured\[at\] = index;/);
    expect(capture).toMatch(/out\.elements = await named\(pictured\);\n\s*return out;/);
    const start = main.slice(main.indexOf("  function start() {"), main.indexOf("  function dispose() {"));
    expect(start).toMatch(/if \(cfg\(\)\.enabled && cfg\(\)\.seeScreen !== "off"\) uia\?\.start\(\);/);
    const dispose = main.slice(main.indexOf("  function dispose() {"), main.indexOf("const releaseStt"));
    expect(dispose).toContain("uia?.stop()");
  });
});
