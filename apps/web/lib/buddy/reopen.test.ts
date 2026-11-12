import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REOPEN_GAP_MS, reopenAfterSpeech } from "./reopen";

describe("the quiet gap before hands-free listening resumes after speech (reopen.ts)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("the gap is 600 ms", () => {
    expect(REOPEN_GAP_MS).toBe(600);
  });

  it("does not listen before the gap, listens at it when still wanted", () => {
    const listen = vi.fn();
    reopenAfterSpeech(listen, () => true);
    vi.advanceTimersByTime(REOPEN_GAP_MS - 1);
    expect(listen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("does not listen when no longer wanted at the end of the gap (Stop, a new question, hands-free off)", () => {
    const listen = vi.fn();
    let wanted = true;
    reopenAfterSpeech(listen, () => wanted);
    vi.advanceTimersByTime(300);
    wanted = false;
    vi.advanceTimersByTime(1000);
    expect(listen).not.toHaveBeenCalled();
  });

  it("asks the predicate only at the end of the gap, and honours a custom delay", () => {
    const listen = vi.fn();
    const wanted = vi.fn(() => true);
    reopenAfterSpeech(listen, wanted, 50);
    expect(wanted).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(wanted).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledTimes(1);
  });
});

describe("the panel's hands-free reopen after speech goes through the gap", () => {
  const src = readFileSync(join(__dirname, "../../app/okfilow/panel/page.tsx"), "utf8").replace(/\r\n/g, "\n");
  const lines = src.split("\n");

  it("uses reopenAfterSpeech at the three sites that follow speech", () => {
    const calls = src.match(/reopenAfterSpeech\(\(\) => listenAgain\.current\(\), \(\) => handsFree\.current && modeRef\.current === "idle" && run\.current === id\)/g) ?? [];
    expect(calls.length).toBe(3);
  });

  it("no hands-free reopen right after a speak calls listenAgain.current() directly", () => {
    const bad: string[] = [];
    lines.forEach((line, i) => {
      if (!/listenAgain\.current\(\)/.test(line) || /reopenAfterSpeech/.test(line)) return;
      // the reopen sites of an answer are the ones that follow a `speak` / `voice.finish` within a few lines
      const before = lines.slice(Math.max(0, i - 6), i).join("\n");
      if (/await speak\(|await voice\.finish\(/.test(before) && /handsFree\.current/.test(line) && !/else/.test(line)) bad.push(`${i + 1}: ${line.trim()}`);
    });
    expect(bad).toEqual([]);
  });
});