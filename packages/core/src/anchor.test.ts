import { describe, expect, it } from "vitest";
import { clickerMove, currentPoint, spokenSection } from "./anchor";
import { Engine } from "./engine";
import { parseScript } from "./script";
import type { DecideRequest, DecideResponse } from "./api";

// s0: welcome everyone, agenda today / s1: pricing tiers, annual discount / s2: mobile app, offline mode
const SCRIPT = parseScript(`# Intro
- welcome everyone
- agenda today

# Pricing
- pricing tiers
- annual discount

# Roadmap
- mobile app
- offline mode
`);

/** A decision model that says a point is started when the window holds its exact words. */
function harness(script = SCRIPT, extra: Partial<ConstructorParameters<typeof Engine>[0]> = {}) {
  const calls: DecideRequest[] = [];
  const decide = async (r: DecideRequest): Promise<DecideResponse> => {
    calls.push(r);
    return {
      decisions: r.bullets.map((b) => {
        const said = r.transcript.toLowerCase().includes(b.text.toLowerCase());
        return { id: b.id, confidence: said ? 0.95 : 0, started: said };
      }),
      latencyMs: 10,
      cost: 0,
      model: "test",
    };
  };
  const e = new Engine({ decide, now: () => 1000, setInterval: () => 0, clearInterval: () => {}, ...extra });
  e.loadScript(script);
  const status = (id: string) => e.getState().points[id]?.status ?? "waiting";
  return { e, calls, status };
}

describe("anchor: where the presenter says they are", () => {
  it("a jump ticks nothing: passed points are missed, the target's are open", () => {
    const { e, status } = harness();
    expect(e.dispatch({ type: "anchor", idx: 2 })).toEqual({ ok: true });
    expect(e.getState().sectionIdx).toBe(2);
    expect(["s0b0", "s0b1", "s1b0", "s1b1"].map(status)).toEqual(["missed", "missed", "missed", "missed"]);
    expect(["s2b0", "s2b1"].map(status)).toEqual(["waiting", "waiting"]);
    expect(Object.values(e.getState().points).some((p) => p.status === "started")).toBe(false);
  });

  it("no false ticks: what was said before a jump is not asked about for the new place", async () => {
    const { e, calls, status } = harness();
    e.feed({ committed: "later on I will show the mobile app. " });
    e.dispatch({ type: "anchor", idx: 2 });
    await e.tick();
    expect(status("s2b0")).toBe("waiting");
    expect(calls.length).toBe(0); // nothing said since the jump: nothing to ask

    // The same words with a plain section move (no anchor) do tick: the fence is what stops them.
    const plain = harness();
    plain.e.feed({ committed: "later on I will show the mobile app. " });
    plain.e.dispatch({ type: "goToSection", idx: 2 });
    await plain.e.tick();
    expect(plain.status("s2b0")).toBe("started");
  });

  it("no lost ticks: what is said after a jump ticks the new place", async () => {
    const { e, calls, status } = harness();
    e.feed({ committed: "welcome everyone. " });
    e.dispatch({ type: "anchor", idx: 2 });
    e.feed({ committed: "the mobile app ships in May. " });
    await e.tick();
    expect(status("s2b0")).toBe("started");
    expect(calls.at(-1)?.transcript).toBe("the mobile app ships in May.");
    expect(calls.at(-1)?.sectionTitle).toBe("Roadmap");
  });

  it("words still being transcribed at the jump count for the new place", async () => {
    const { e, status } = harness();
    e.feed({ committed: "welcome everyone. " });
    e.feed({ partial: "and the offline" });
    e.dispatch({ type: "anchor", idx: 2 });
    e.feed({ committed: "and the offline mode works on a plane. ", partial: "" });
    await e.tick();
    expect(status("s2b1")).toBe("started");
  });

  it("going back reopens the points a move skipped and keeps the ticked ones", async () => {
    const { e, status } = harness();
    e.feed({ committed: "here is the agenda today. " });
    await e.tick();
    expect(status("s0b1")).toBe("started");
    e.dispatch({ type: "anchor", idx: 2 }); // skipped by mistake
    expect(status("s0b0")).toBe("missed");
    e.dispatch({ type: "anchor", idx: 0 });
    expect(status("s0b0")).toBe("waiting");
    expect(status("s0b1")).toBe("started");
    e.feed({ committed: "welcome everyone, sorry. " });
    await e.tick();
    expect(status("s0b0")).toBe("started");
  });

  it("a point anchor leaves the points before it open and asks from it first", async () => {
    const big = parseScript("# One\n- alpha\n- bravo\n- charlie\n- delta\n- echo\n- foxtrot\n");
    const { e, calls, status } = harness(big);
    e.dispatch({ type: "anchor", idx: 0, pointId: "s0b4" });
    expect(e.getState().here).toBe("s0b4");
    e.feed({ committed: "something about echo. " });
    await e.tick();
    expect(calls[0].bullets.map((b) => b.id)).toEqual(["s0b4", "s0b5", "s0b0", "s0b1"]);
    expect(status("s0b4")).toBe("started");
    expect(["s0b0", "s0b1", "s0b2", "s0b3"].map(status)).toEqual(["waiting", "waiting", "waiting", "waiting"]);
  });

  it("staying in the section keeps its words: a point said just before the click still ticks", async () => {
    const { e, status } = harness();
    e.dispatch({ type: "anchor", idx: 1 });
    e.feed({ committed: "we have three pricing tiers. " });
    e.dispatch({ type: "anchor", idx: 1, pointId: "s1b1" });
    await e.tick();
    expect(status("s1b0")).toBe("started");
  });

  it("Next keeps the words said just before it (keepRecent)", async () => {
    const { e, status } = harness();
    e.feed({ committed: "so, our pricing tiers. " });
    e.dispatch({ type: "anchor", idx: 1, keepRecent: true });
    await e.tick();
    expect(status("s1b0")).toBe("started");
  });

  it("a decision asked before the jump is dropped when it answers", async () => {
    let release: (r: DecideResponse) => void = () => {};
    const e = new Engine({
      decide: (r) => new Promise((res) => (release = () => res({ decisions: r.bullets.map((b) => ({ id: b.id, confidence: 0.99, started: true })), latencyMs: 5, cost: 0, model: "t" }))),
      now: () => 1000, setInterval: () => 0, clearInterval: () => {},
    });
    e.loadScript(SCRIPT);
    e.feed({ committed: "welcome everyone. " });
    const pending = e.tick();
    e.dispatch({ type: "anchor", idx: 1 });
    release({} as DecideResponse);
    await pending;
    expect(Object.values(e.getState().points).some((p) => p.status === "started")).toBe(false);
  });

  it("refuses a place that does not exist", () => {
    const { e } = harness();
    expect(e.dispatch({ type: "anchor", idx: 3 }).ok).toBe(false);
    expect(e.dispatch({ type: "anchor", idx: -1 }).ok).toBe(false);
    expect(e.dispatch({ type: "anchor", idx: 0, pointId: "s2b0" }).ok).toBe(false);
    expect(e.getState().sectionIdx).toBe(0);
  });
});

describe("currentPoint", () => {
  it("is the first open point at or after the anchor, else the first open point", () => {
    const { e } = harness();
    expect(currentPoint(e.getState())).toBe("s0b0");
    e.dispatch({ type: "anchor", idx: 0, pointId: "s0b1" });
    expect(currentPoint(e.getState())).toBe("s0b1");
    e.dispatch({ type: "markStarted", id: "s0b1" });
    expect(currentPoint(e.getState())).toBe("s0b0");
    e.dispatch({ type: "markStarted", id: "s0b0" });
    expect(currentPoint(e.getState())).toBeNull();
  });
});

describe("clickerMove", () => {
  it("reads PageDown, PageUp and the arrows as section moves", () => {
    expect(["PageDown", "ArrowRight", "PageUp", "ArrowLeft"].map((key) => clickerMove({ key }))).toEqual(["next", "next", "prev", "prev"]);
  });
  it("leaves B, period and shortcuts alone (black screen and the app's own keys keep working)", () => {
    for (const key of ["b", "B", ".", "w", "Escape", "F5", "ArrowUp", "ArrowDown", " "]) expect(clickerMove({ key })).toBeNull();
    expect(clickerMove({ key: "PageDown", ctrlKey: true })).toBeNull();
    expect(clickerMove({ key: "ArrowLeft", altKey: true })).toBeNull();
    expect(clickerMove({ key: "PageUp", metaKey: true })).toBeNull();
  });
});

describe("spokenSection", () => {
  const titles = ["Intro", "Pricing and plans", "Roadmap - What comes next", "Questions"];
  it("moves on a section's name said as an announcement", () => {
    expect(spokenSection("Pricing and plans.", titles, 0)).toBe(1);
    expect(spokenSection("OK, roadmap now", titles, 0)).toBe(2);
    expect(spokenSection("Now let's talk about pricing and the plans", titles, 0)).toBe(1);
    expect(spokenSection("so let's move on to the questions", titles, 1)).toBe(3);
    expect(spokenSection("what comes next for us", titles, 0)).toBe(2);
    expect(spokenSection("torniamo all'intro", titles, 2)).toBe(0);
  });
  it("ignores passing mentions, the current section and empty speech", () => {
    expect(spokenSection("the pricing and plans we chose last year were too complex", titles, 0)).toBeNull();
    expect(spokenSection("we will have time for questions at the very end of the talk", titles, 0)).toBeNull();
    expect(spokenSection("Pricing and plans.", titles, 1)).toBeNull();
    expect(spokenSection("", titles, 0)).toBeNull();
    expect(spokenSection("roadmap", ["Q&A", "Roadmap"], 0)).toBe(1);
    expect(spokenSection("q and a", ["Q&A", "Roadmap"], 1)).toBeNull();
  });
  it("prefers the longer name, then the next section ahead", () => {
    expect(spokenSection("Plans.", ["Intro", "Plans", "Pricing and plans"], 0)).toBe(1);
    expect(spokenSection("Pricing and plans.", ["Intro", "Plans", "Pricing and plans"], 0)).toBe(2);
    expect(spokenSection("Demo.", ["Demo", "Intro", "Demo"], 1)).toBe(2);
  });
});
