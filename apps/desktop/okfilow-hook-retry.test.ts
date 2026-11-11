// Issue #6: the keyboard hook fails at launch and Filow must keep trying until Windows allows it.
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
type Down = { error: unknown; failures: number; delayMs: number; quick: boolean; fallback: boolean };
type Retry = { attempt(): boolean; nudge(): void; down(): void; stop(): void; up: boolean; failures: number; waiting: boolean };
const { createHookRetry, retryDelay, describeHookError } = require("./okfilow-hook-retry.js") as {
  createHookRetry(o: { start: () => void; onUp: (i: { failures: number }) => void; onDown: (i: Down) => void; quickFor?: (e: unknown) => boolean }): Retry;
  retryDelay(failures: number): number;
  describeHookError(e: unknown): string;
};

const refused = () => Object.assign(new Error("Failed to register low level windows hook."), { code: "UIOHOOK_ERROR_SET_WINDOWS_HOOK_EX" });

/** A hook that Windows refuses until `allow()` is called. */
function world(opts: { quickFor?: (e: unknown) => boolean } = {}) {
  let allowed = false;
  let tries = 0;
  const downs: Down[] = [];
  const ups: number[] = [];
  const r = createHookRetry({
    start: () => { tries++; if (!allowed) throw refused(); },
    onUp: (i) => ups.push(i.failures),
    onDown: (i) => downs.push(i),
    ...opts,
  });
  return { r, downs, ups, allow: () => { allowed = true; }, refuse: () => { allowed = false; }, tries: () => tries };
}

describe("keyboard hook: start, and start again until it works (issue #6)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a hook that starts at once needs no retry", () => {
    const w = world();
    w.allow();
    expect(w.r.attempt()).toBe(true);
    expect(w.ups).toEqual([0]);
    expect(w.r.waiting).toBe(false);
    vi.advanceTimersByTime(600_000);
    expect(w.tries()).toBe(1);
  });

  it("four quick tries, then a growing delay, capped at a minute", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 50].map(retryDelay)).toEqual([2000, 2000, 2000, 2000, 5000, 10_000, 20_000, 30_000, 60_000, 60_000, 60_000]);
  });

  it("does not give up after the quick tries: it is still trying an hour later, and says once that the fallback is needed", () => {
    const w = world();
    expect(w.r.attempt()).toBe(false);
    vi.advanceTimersByTime(8000);
    // The four quick tries of the old code end here; the old code then went silent.
    expect(w.tries()).toBe(5);
    expect(w.downs.map((d) => d.quick)).toEqual([true, true, true, true, false]);
    expect(w.downs.map((d) => d.fallback)).toEqual([false, false, false, false, true]);
    vi.advanceTimersByTime(3_600_000);
    expect(w.tries()).toBeGreaterThan(55);
    expect(w.r.waiting).toBe(true);
    expect(w.downs.filter((d) => d.fallback)).toHaveLength(1);
    expect(w.downs.at(-1)?.delayMs).toBe(60_000);
    expect(w.downs.at(-1)?.failures).toBe(w.tries());
  });

  it("the moment Windows allows the hook, the next try brings the hold keys back, with no restart", () => {
    const w = world();
    w.r.attempt();
    vi.advanceTimersByTime(200_000);
    expect(w.r.up).toBe(false);
    const failed = w.tries();
    w.allow();
    vi.advanceTimersByTime(60_000);
    expect(w.r.up).toBe(true);
    expect(w.ups).toEqual([failed]);
    expect(w.tries()).toBe(failed + 1);
    // Nothing more is tried once it works.
    vi.advanceTimersByTime(600_000);
    expect(w.tries()).toBe(failed + 1);
    expect(w.r.waiting).toBe(false);
  });

  it("unlock, wake-up or a display change tries again within a second instead of waiting out the minute", () => {
    const w = world();
    w.r.attempt();
    vi.advanceTimersByTime(300_000);
    const before = w.tries();
    w.allow();
    w.r.nudge();
    w.r.nudge(); // several events at once (unlock + displays) are one try
    vi.advanceTimersByTime(1000);
    expect(w.tries()).toBe(before + 1);
    expect(w.r.up).toBe(true);
  });

  it("a nudge that does not help starts the growing delay over, and is ignored while the hook works", () => {
    const w = world();
    w.r.attempt();
    vi.advanceTimersByTime(300_000);
    w.downs.length = 0;
    w.r.nudge();
    vi.advanceTimersByTime(1000);
    expect(w.downs.map((d) => d.delayMs)).toEqual([5000]);
    expect(w.downs[0].fallback).toBe(false); // already said
    vi.advanceTimersByTime(5000);
    expect(w.downs.map((d) => d.delayMs)).toEqual([5000, 10_000]);
    w.allow();
    vi.advanceTimersByTime(10_000);
    expect(w.r.up).toBe(true);
    const tries = w.tries();
    w.r.nudge();
    vi.advanceTimersByTime(5000);
    expect(w.tries()).toBe(tries);
  });

  it("an error that will not pass in seconds (a missing macOS permission) skips the quick tries", () => {
    const w = world({ quickFor: () => false });
    w.r.attempt();
    expect(w.downs).toHaveLength(1);
    expect(w.downs[0]).toMatchObject({ quick: false, fallback: true, delayMs: 5000 });
  });

  it("a hook lost later is retried the same way, and the fallback is offered again", () => {
    const w = world();
    w.allow();
    w.r.attempt();
    w.refuse();
    w.r.down();
    expect(w.r.attempt()).toBe(false);
    vi.advanceTimersByTime(8000);
    expect(w.downs.filter((d) => d.fallback)).toHaveLength(1);
    expect(w.downs[0].failures).toBe(1);
  });

  it("stop ends the retries (Filow is quitting)", () => {
    const w = world();
    w.r.attempt();
    w.r.stop();
    vi.advanceTimersByTime(600_000);
    expect(w.tries()).toBe(1);
    w.r.nudge();
    vi.advanceTimersByTime(5000);
    expect(w.tries()).toBe(1);
  });

  it("the log line carries the library's error code when there is one", () => {
    expect(describeHookError(refused())).toBe("Failed to register low level windows hook. [UIOHOOK_ERROR_SET_WINDOWS_HOOK_EX]");
    expect(describeHookError(new Error("no code"))).toBe("no code");
    expect(describeHookError("text")).toBe("text");
  });
});
