import { describe, expect, it } from "vitest";
import { hasLeadingPoints, parseScript, serializeScript, setTimeTargets, splitSectionMinutes } from "./script";
import { formatClock, overPlan, remoteNow, scheduleCue, sectionTimes, talkBudget, TalkClockTracker, timerView } from "./rehearsal-timer";

const MIN = 60_000;

describe("time targets in the script", () => {
  it("reads the talk target and the section targets in the five languages, and takes them off the titles", () => {
    const s = parseScript(["<!-- target: 20 min -->", "# Intro (3 min)", "- a", "# Dati (4 minuti)", "- b", "# Date [2,5 minute]", "# Итоги (5 мин)", "# まとめ（2分）", "# Plain", "- c"].join("\n"));
    expect(s.minutes).toBe(20);
    expect(s.sections.map((x) => [x.title, x.minutes])).toEqual([["Intro", 3], ["Dati", 4], ["Date", 2.5], ["Итоги", 5], ["まとめ", 2], ["Plain", undefined]]);
    expect(parseScript("# Pausa (1 minuto)\n# Q&A (3 min.)\n# 質疑（3分間）").sections.map((x) => [x.title, x.minutes])).toEqual([["Pausa", 1], ["Q&A", 3], ["質疑", 3]]);
  });

  it("keeps the targets on the right headings when points come before the first heading", () => {
    expect([hasLeadingPoints("- a\n# B\n- b"), hasLeadingPoints("<!-- x -->\n\n# B\n- b"), hasLeadingPoints("")]).toEqual([true, false, false]);
    const text = "- a\n# B\n- b";
    const out = setTimeTargets(text, { sections: [2, 5] }); // section 0 is the headingless "Untitled"
    expect(out).toBe("- a\n# B (5 min)\n- b");
    expect(parseScript(out).sections.map((s) => [s.title, s.minutes])).toEqual([["Untitled", undefined], ["B", 5]]);
  });

  it("leaves titles that only look like a target alone", () => {
    expect(splitSectionMinutes("(3 min)")).toEqual({ title: "(3 min)" });
    expect(splitSectionMinutes("Break (700 min)")).toEqual({ title: "Break (700 min)" });
    expect(splitSectionMinutes("Results (3 slides)")).toEqual({ title: "Results (3 slides)" });
    expect(parseScript("# A\n- x").minutes).toBeUndefined();
    expect(parseScript("# A\n- x").sections[0]).toEqual({ id: "s0", title: "A", bullets: [{ id: "s0b0", text: "x" }] });
  });

  // Review L7
  it("reads a hand-written talk target in the heading's units, and takes a zero target off the title", () => {
    expect([parseScript("<!-- target: 20 мин -->\n# A\n- x").minutes, parseScript("<!-- target: 20分 -->\n# A\n- x").minutes, parseScript("<!-- target: 2,5 minuti -->\n# A\n- x").minutes]).toEqual([20, 20, 2.5]);
    expect(parseScript("<!-- target: 0 min -->\n# A\n- x").minutes).toBeUndefined();
    expect(parseScript("<!-- target: 20 slides -->\n# A\n- x").minutes).toBeUndefined();
    expect(splitSectionMinutes("Break (0 min)")).toEqual({ title: "Break" });
    // saving from "Talk length" replaces the hand-written line instead of adding a second one
    expect(setTimeTargets("<!-- target: 20 мин -->\n# Break (0 min)\n- x", { minutes: 10, sections: [2] })).toBe("<!-- target: 10 min -->\n# Break (2 min)\n- x");
  });

  it("writes targets back without touching the rest of the text, and round-trips", () => {
    const text = "<!-- source: import -->\r\n# Intro (9 min)\r\n- a\r\n\r\nfree text\r\n# Body\r\n- b";
    const out = setTimeTargets(text, { minutes: 15, sections: [2, null] });
    expect(out).toBe("<!-- source: import -->\r\n<!-- target: 15 min -->\r\n# Intro (2 min)\r\n- a\r\n\r\nfree text\r\n# Body\r\n- b");
    const parsed = parseScript(out);
    expect([parsed.minutes, parsed.sections[0].minutes, parsed.sections[1].minutes, parsed.source]).toEqual([15, 2, undefined, "import"]);
    expect(setTimeTargets(out, { minutes: null, sections: [] })).toBe("<!-- source: import -->\r\n# Intro\r\n- a\r\n\r\nfree text\r\n# Body\r\n- b");
    expect(parseScript(serializeScript(parsed))).toEqual(parsed);
  });
});

describe("talk budget", () => {
  const script = (minutes: number | undefined, ...secs: Array<[number | undefined, number]>) => ({
    minutes,
    sections: secs.map(([m, n], i) => ({ id: `s${i}`, title: `S${i}`, minutes: m, bullets: Array.from({ length: n }, (_, k) => ({ id: `s${i}b${k}`, text: "p" })) })),
  });

  it("shares what is left of the talk among sections without a target, by their points", () => {
    expect(talkBudget(script(10, [2, 1], [undefined, 1], [undefined, 3]))).toEqual({ talkMs: 10 * MIN, sections: [2 * MIN, 2 * MIN, 6 * MIN] });
  });

  // Review M5: talk 5 min, sections 3 + 4 + one open gave no cue and no warning.
  it("keeps a full plan and says so when the sections add up to more than the talk", () => {
    const over = script(5, [3, 1], [4, 1], [undefined, 1]);
    expect(talkBudget(over)).toEqual({ talkMs: 5 * MIN, sections: [3 * MIN, 4 * MIN, 0] });
    expect(overPlan(over)).toEqual({ planned: 7, talk: 5 });
    expect([overPlan(script(10, [3, 1], [4, 1])), overPlan(script(undefined, [3, 1])), overPlan(script(7, [3, 1], [4, 1]))]).toEqual([null, null, null]);
    // second section reached at 4:00 instead of 3:00, now 4:30: one minute behind the sections' plan
    const view = timerView(over, { startedAt: 0, endedAt: null, entries: [{ idx: 0, at: 0 }, { idx: 1, at: 4 * MIN }] }, 1, 4.5 * MIN)!;
    expect(view.behindMs).toBe(MIN);
    expect(scheduleCue(view.behindMs)).toEqual({ kind: "behind", minutes: 1 });
    expect(view.remainingMs).toBe(0.5 * MIN);
  });

  it("sums the sections when each has a target, and has no plan when one is missing", () => {
    expect(talkBudget(script(undefined, [2, 1], [3, 1])).talkMs).toBe(5 * MIN);
    expect(talkBudget(script(undefined, [2, 1], [undefined, 1]))).toEqual({ talkMs: null, sections: [2 * MIN, null] });
  });
});

describe("talk clock and cue", () => {
  const sections = [0, 1, 2].map((i) => ({ id: `s${i}`, title: `S${i}`, minutes: 2, bullets: [{ id: `s${i}b0`, text: "p" }, { id: `s${i}b1`, text: "q" }] }));
  const script = { sections };

  it("follows a take from the engine's state", () => {
    const clock = new TalkClockTracker();
    expect(clock.observe({ sectionIdx: 0, engine: { recording: false } }, 0)).toBe(false);
    expect(clock.observe({ sectionIdx: 0, engine: { recording: true } }, 1000)).toBe(true);
    expect(clock.observe({ sectionIdx: 0, engine: { recording: true } }, 2000)).toBe(false);
    expect(clock.observe({ sectionIdx: 1, engine: { recording: true } }, 3000)).toBe(true);
    expect(clock.observe({ sectionIdx: 1, engine: { recording: false } }, 4000)).toBe(true);
    expect(clock.snapshot(5000)).toEqual({ startedAt: 1000, endedAt: 4000, entries: [{ idx: 0, at: 1000 }, { idx: 1, at: 3000 }], sentAt: 5000 });
    expect(sectionTimes(clock.snapshot(5000), 3, 9999)).toEqual([2000, 1000, 0]);
  });

  it("says behind when a section starts late or runs over, ahead when early, on time within half a minute", () => {
    const clock = { startedAt: 0, endedAt: null, entries: [{ idx: 0, at: 0 }] };
    expect(timerView(script, clock, 0, 1 * MIN)?.behindMs).toBe(0);
    expect(timerView(script, clock, 0, 3 * MIN)?.behindMs).toBe(1 * MIN); // 1 min over its 2
    const late = { ...clock, entries: [{ idx: 0, at: 0 }, { idx: 1, at: 3 * MIN }] };
    expect(timerView(script, late, 1, 3.5 * MIN)?.behindMs).toBe(1 * MIN); // started 1 min late
    const early = { ...clock, entries: [{ idx: 0, at: 0 }, { idx: 1, at: 1 * MIN }] };
    const v = timerView(script, early, 1, 2 * MIN, { s1b0: { status: "started" } });
    expect([v?.behindMs, v?.pointsLeft, v?.remainingMs, v?.sectionMs]).toEqual([-1 * MIN, 1, 4 * MIN, 2 * MIN]);
    expect(scheduleCue(20_000)).toEqual({ kind: "onTime", minutes: 0 });
    expect(scheduleCue(-20_000)).toEqual({ kind: "onTime", minutes: 0 });
    expect(scheduleCue(100_000)).toEqual({ kind: "behind", minutes: 2 });
    expect(scheduleCue(-40_000)).toEqual({ kind: "ahead", minutes: 1 });
    expect(scheduleCue(null).kind).toBe("none");
  });

  it("shows nothing before a take, and stays still after Stop", () => {
    expect(timerView(script, null, 0, 0)).toBeNull();
    expect(timerView(script, { startedAt: null, endedAt: null, entries: [] }, 0, 0)).toBeNull();
    const stopped = { startedAt: 0, endedAt: 5 * MIN, entries: [{ idx: 0, at: 0 }, { idx: 2, at: 4 * MIN }] };
    const v = timerView(script, stopped, 0, 60 * MIN);
    expect([v?.running, v?.elapsedMs, v?.sectionElapsedMs]).toEqual([false, 5 * MIN, 1 * MIN]);
  });

  it("has no cue without a plan, but still counts the time", () => {
    const v = timerView({ sections: sections.map((s) => ({ ...s, minutes: undefined })) }, { startedAt: 0, endedAt: null, entries: [{ idx: 0, at: 0 }] }, 0, 65_000);
    expect([v?.elapsedMs, v?.behindMs, v?.talkMs, formatClock(v?.elapsedMs ?? 0)]).toEqual([65_000, null, null, "1:05"]);
  });

  it("going back to an earlier section is time spent, not a restart of the talk", () => {
    // 0 -> 1 -> 2 on plan (2 min each), back to 0 at 4:30 to make a point again
    const back = { startedAt: 0, endedAt: null, entries: [{ idx: 0, at: 0 }, { idx: 1, at: 2 * MIN }, { idx: 2, at: 4 * MIN }, { idx: 0, at: 4.5 * MIN }] };
    expect(timerView(script, back, 0, 5 * MIN)?.behindMs).toBe(0);
    expect(timerView(script, back, 0, 7 * MIN)?.behindMs).toBe(1 * MIN); // one minute past the budget of section 2
    // and coming back to the furthest section keeps counting from when it was first reached
    const again = { ...back, entries: [...back.entries, { idx: 2, at: 5 * MIN }] };
    expect(timerView(script, again, 2, 5.5 * MIN)?.behindMs).toBe(0);
  });

  it("starts again when another script is loaded during the take", () => {
    const clock = new TalkClockTracker();
    clock.observe({ sectionIdx: 0, engine: { recording: true } }, 0);
    clock.observe({ sectionIdx: 2, engine: { recording: true } }, 60_000);
    clock.scriptLoading();
    expect(clock.observe({ sectionIdx: 0, engine: { recording: true } }, 90_000)).toBe(true);
    expect(clock.snapshot(90_000)).toMatchObject({ startedAt: 90_000, entries: [{ idx: 0, at: 90_000 }] });
    // a load outside a take changes nothing, and the flag does not linger
    clock.observe({ sectionIdx: 0, engine: { recording: false } }, 100_000);
    clock.scriptLoading();
    clock.observe({ sectionIdx: 0, engine: { recording: false } }, 110_000);
    expect(clock.observe({ sectionIdx: 0, engine: { recording: true } }, 120_000)).toBe(true);
    expect(clock.observe({ sectionIdx: 0, engine: { recording: true } }, 130_000)).toBe(false);
  });

  it("formats clocks and lines up a phone whose clock is off", () => {
    expect([formatClock(0), formatClock(59_999), formatClock(3_725_000), formatClock(-61_000)]).toEqual(["0:00", "0:59", "1:02:05", "-1:01"]);
    // the phone is 7 s ahead: it received a clock the prompter sent at 1000 when its own time was 8000
    expect(remoteNow({ sentAt: 1000 }, 8000, 9000)).toBe(2000);
  });
});
