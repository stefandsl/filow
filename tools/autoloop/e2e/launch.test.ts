import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findMainPid, launchFilow, lineTime, logLineCount, logLinesSince, stopTree, treeOf, waitForLine, wavData } from "./launch.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "launch-helper-"));
afterAll(() => { if (path.basename(dir).startsWith("launch-helper-") && path.dirname(dir) === path.resolve(os.tmpdir())) fs.rmSync(dir, { recursive: true, force: true }); });

describe("launch helpers (coldstart.mjs, take.mjs, tools/eval/latency.mjs)", () => {
  it("finds the samples of a WAV whatever the size of its fmt chunk", () => {
    const fmt18 = Buffer.alloc(8 + 18); fmt18.write("fmt ", 0); fmt18.writeUInt32LE(18, 4);
    const data = Buffer.alloc(8 + 6); data.write("data", 0); data.writeUInt32LE(6, 4);
    const head = Buffer.alloc(12); head.write("RIFF", 0); head.write("WAVE", 8);
    expect(wavData(Buffer.concat([head, fmt18, data]))).toEqual({ offset: 12 + 26 + 8, length: 6 });
    expect(() => wavData(Buffer.concat([head, fmt18]))).toThrow(/no data chunk/);
  });

  it("reads a growing log from a line on, and waits for a line with its own time stamp", async () => {
    const log = path.join(dir, "startup.log");
    expect(logLinesSince(log)).toEqual([]);
    fs.writeFileSync(log, "2026-11-13T03:00:00.000Z a\r\n2026-11-13T03:00:01.000Z b\n");
    expect(logLineCount(log)).toBe(2);
    expect(logLinesSince(log, 1)).toEqual(["2026-11-13T03:00:01.000Z b"]);
    setTimeout(() => fs.appendFileSync(log, "2026-11-13T03:00:02.500Z main window shown (900 ms after process start)\n"), 150);
    const got = await waitForLine(log, /main window shown/, { fromLine: 2, timeoutMs: 3000, everyMs: 20 });
    expect(got.at).toBe(Date.parse("2026-11-13T03:00:02.500Z"));
    expect(lineTime(got.line)).toBe(got.at);
    await expect(waitForLine(log, /never/, { timeoutMs: 100, everyMs: 20 })).rejects.toThrow(/timed out/);
  });

  it("knows a process tree and Filow's main process by its debugging port, never a Chromium child", () => {
    const table = [
      { pid: 10, ppid: 1, name: "Filow.exe", cmd: '"G:\\b\\win-unpacked\\Filow.exe" --remote-debugging-port=9361 --mute-audio' },
      { pid: 11, ppid: 10, name: "Filow.exe", cmd: '"G:\\b\\win-unpacked\\Filow.exe" --type=renderer --remote-debugging-port=9361' },
      { pid: 12, ppid: 11, name: "x.exe", cmd: "" },
      { pid: 20, ppid: 1, name: "Filow.exe", cmd: '"C:\\Program Files\\Filow\\Filow.exe"' },
    ];
    expect(treeOf(table, 10).sort()).toEqual([10, 11, 12]);
    expect(findMainPid(table, "G:\\b\\win-unpacked", 9361)).toBe(10);
    expect(findMainPid(table, "G:\\b\\win-unpacked", 9999)).toBeNull();
  });

  it("refuses what it must not do: no port to find the process by, no system PIDs", async () => {
    await expect(launchFilow({ exeDir: dir, profile: "", env: {}, args: [] })).rejects.toThrow(/remote-debugging-port/);
    await expect(launchFilow({ exeDir: dir, profile: "", env: {}, args: ["--remote-debugging-port=9361"], affinity: "zz" })).rejects.toThrow(/no Filow\.exe|affinity/);
    expect(() => stopTree(4)).toThrow(/refusing/);
    expect(() => stopTree(Number.NaN)).toThrow(/refusing/);
  });
});
