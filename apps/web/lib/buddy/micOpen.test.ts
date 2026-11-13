import { describe, expect, it, vi } from "vitest";
import { MIC_GIVE_UP_MS, MIC_NOTE_MS, MIC_SLOW_MS, abandonedNote, emptyRecordingNote, micSeconds, openMicrophone, type MicAbandoned } from "./micOpen";
import { OKF_TEXT } from "./text";

/** A microphone that opens when the test says so, on a clock the test moves. */
function fixture() {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let ids = 0;
  let resolve!: (s: string) => void;
  let reject!: (e: unknown) => void;
  const calls = { note: 0, closed: [] as string[], opened: [] as Array<[number, boolean]> };
  const open = vi.fn(() => new Promise<string>((res, rej) => { resolve = res; reject = rej; }));
  const opening = openMicrophone<string>({
    open,
    close: (s) => { calls.closed.push(s); },
    onNote: () => { calls.note++; },
    onOpened: (ms, used) => { calls.opened.push([ms, used]); },
    now: () => now,
    setTimer: (fn, ms) => { const id = ++ids; timers.push({ at: now + ms, fn, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  });
  /** Moves the clock, running the timers that come due, in order. */
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      now = due.at;
      due.fn();
      await Promise.resolve();
    }
    now = end;
    await Promise.resolve();
  };
  return { opening, open, calls, advance, timers, live: (s = "stream") => resolve(s), fail: (e: unknown) => reject(e) };
}

describe("opening the microphone", () => {
  it("a microphone that opens at once: live, no note, nothing left running", async () => {
    const f = fixture();
    await f.advance(90);
    f.live();
    expect(await f.opening.done).toEqual({ state: "live", stream: "stream", openMs: 90 });
    await f.advance(60_000);
    expect(f.calls.note).toBe(0);
    expect(f.calls.closed).toEqual([]);
    expect(f.calls.opened).toEqual([[90, true]]);
    expect(f.timers).toEqual([]);
  });

  it("says it is opening only once the open has taken longer than a glance", async () => {
    const f = fixture();
    await f.advance(MIC_NOTE_MS - 1);
    expect(f.calls.note).toBe(0);
    await f.advance(1);
    expect(f.calls.note).toBe(1);
    await f.advance(2600);
    f.live();
    // the keys are still down: what is said from here on is heard
    expect(await f.opening.done).toEqual({ state: "live", stream: "stream", openMs: 3000 });
    expect(f.calls.note).toBe(1);
  });

  it("the keys go up while a slow microphone is still opening: abandoned at once, and the late stream is closed", async () => {
    const f = fixture();
    await f.advance(3000);
    f.opening.release();
    expect(await f.opening.done).toEqual({ state: "abandoned", why: "released", waitedMs: 3000 });
    expect(f.calls.closed).toEqual([]);
    await f.advance(12_100);
    f.live("late");
    await f.advance(0);
    // never left open with nobody listening
    expect(f.calls.closed).toEqual(["late"]);
    expect(f.calls.opened).toEqual([[15_100, false]]);
    expect(f.timers).toEqual([]);
  });

  it("a short tap: the microphone that opens after the keys went up is closed at once, never listened to, and it is not called slow", async () => {
    const f = fixture();
    await f.advance(60);
    f.opening.release();
    await f.advance(60);
    f.live();
    const got = await f.opening.done;
    expect(got).toEqual({ state: "abandoned", why: "released", waitedMs: 120 });
    expect(f.calls.closed).toEqual(["stream"]);
    expect(f.calls.opened).toEqual([[120, false]]);
    // not the microphone's fault: the usual hint is said, not "the microphone was still not open"
    expect(abandonedNote(got as MicAbandoned)).toBeNull();
    expect(f.timers).toEqual([]);
  });

  it("a short tap on a microphone that then stays closed is abandoned as soon as the open counts as slow", async () => {
    const f = fixture();
    await f.advance(200);
    f.opening.release();
    let settled = false;
    void f.opening.done.then(() => { settled = true; });
    await f.advance(MIC_SLOW_MS - 201);
    expect(settled).toBe(false);
    await f.advance(1);
    expect(await f.opening.done).toEqual({ state: "abandoned", why: "released", waitedMs: MIC_SLOW_MS });
  });

  it("Escape ends the wait at once, whatever the time", async () => {
    const f = fixture();
    await f.advance(50);
    f.opening.cancel();
    expect(await f.opening.done).toEqual({ state: "abandoned", why: "cancelled", waitedMs: 50 });
    f.live("late");
    await f.advance(0);
    expect(f.calls.closed).toEqual(["late"]);
  });

  it("a microphone that never opens is given up on, keys down or not", async () => {
    const f = fixture();
    await f.advance(MIC_GIVE_UP_MS - 1);
    let settled = false;
    void f.opening.done.then(() => { settled = true; });
    await f.advance(0);
    expect(settled).toBe(false);
    await f.advance(1);
    expect(await f.opening.done).toEqual({ state: "abandoned", why: "gaveUp", waitedMs: MIC_GIVE_UP_MS });
  });

  it("a refused microphone is an error; one refused after the wait ended is not a second one", async () => {
    const f = fixture();
    f.fail(new Error("Permission denied"));
    await expect(f.opening.done).rejects.toThrow("Permission denied");
    const g = fixture();
    await g.advance(2000);
    g.opening.release();
    await g.opening.done;
    g.fail(new Error("late refusal"));
    await g.advance(0);
    expect(await g.opening.done).toEqual({ state: "abandoned", why: "released", waitedMs: 2000 });
  });

  it("release and cancel after the end change nothing", async () => {
    const f = fixture();
    f.live();
    const got = await f.opening.done;
    f.opening.release();
    f.opening.cancel();
    await f.advance(60_000);
    expect(await f.opening.done).toBe(got);
    expect(f.calls.closed).toEqual([]);
  });
});

describe("what the user is told", () => {
  it("whole seconds, never zero", () => {
    expect(micSeconds(15_100)).toBe(15);
    expect(micSeconds(2600)).toBe(3);
    expect(micSeconds(1000)).toBe(1);
    expect(micSeconds(40)).toBe(1);
  });

  it("an empty recording after a slow open is the microphone's doing; after a quick one the usual hint stays", () => {
    expect(emptyRecordingNote(15_100)).toEqual({ key: "micSlow", seconds: 15 });
    expect(emptyRecordingNote(MIC_SLOW_MS)).toEqual({ key: "micSlow", seconds: 1 });
    expect(emptyRecordingNote(MIC_SLOW_MS - 1)).toBeNull();
    expect(emptyRecordingNote(90)).toBeNull();
    expect(emptyRecordingNote(null)).toBeNull();
  });

  it("an abandoned open says how long it waited; a cancelled one says nothing", () => {
    expect(abandonedNote({ state: "abandoned", why: "released", waitedMs: 3004 })).toEqual({ key: "micNotOpen", seconds: 3 });
    expect(abandonedNote({ state: "abandoned", why: "gaveUp", waitedMs: 20_000 })).toEqual({ key: "micNotOpen", seconds: 20 });
    expect(abandonedNote({ state: "abandoned", why: "cancelled", waitedMs: 3004 })).toBeNull();
  });

  it("in all five languages the two messages give the time, say nothing was recorded, and never blame the hold", () => {
    for (const [lang, table] of Object.entries(OKF_TEXT)) {
      for (const key of ["micSlow", "micNotOpen"] as const) {
        expect(table[key], `${lang} ${key}`).toContain("{n}");
        expect(table[key], `${lang} ${key}`).not.toBe(OKF_TEXT.en.notHeard);
        expect(table[key], `${lang} ${key}`).not.toBe(table.notHeard);
        expect(table[key], `${lang} ${key}`).not.toContain("—");
        if (lang !== "en") expect(table[key], `${lang} ${key}`).not.toBe(OKF_TEXT.en[key]);
      }
      for (const key of ["micOpening", "micFallback", "mode_opening"] as const) {
        expect(table[key], `${lang} ${key}`).toBeTruthy();
        if (lang !== "en") expect(table[key], `${lang} ${key}`).not.toBe(OKF_TEXT.en[key]);
      }
    }
    expect(OKF_TEXT.en.micSlow).toMatch(/^The microphone took \{n\} s to open, so nothing was recorded\./);
    expect(OKF_TEXT.en.micSlow).not.toMatch(/hold the keys/i);
    expect(OKF_TEXT.en.micNotOpen).not.toMatch(/hold the keys/i);
  });
});
