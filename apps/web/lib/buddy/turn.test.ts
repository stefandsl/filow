import { describe, expect, it } from "vitest";
import { marksStarted } from "./motion";
import type { BuddyTurn } from "./prompt";
import { askSees, screenLeaves, seesScreen, slowToSee } from "./sees";
import { createAnswerTurn } from "./turn";

describe("stopping an answer", () => {
  const before: BuddyTurn[] = [{ role: "user", text: "hi" }, { role: "assistant", text: "Hello." }];

  it("ends the request to the model and keeps what was already said as the answer", () => {
    const turn = createAnswerTurn();
    const abort = new AbortController();
    turn.begin(7, "explain photosynthesis at length", abort);
    turn.progress(7, "Plants take in light");
    turn.progress(7, "Plants take in light and turn it into sugar. ");
    const was = turn.stop(before);
    expect(abort.signal.aborted).toBe(true);
    expect(was?.shown).toBe("Plants take in light and turn it into sugar.");
    expect(was?.history).toEqual([...before, { role: "user", text: "explain photosynthesis at length" }, { role: "assistant", text: "Plants take in light and turn it into sugar." }]);
    // The conversation is still question, answer, question, answer: the next question works.
    expect(was?.history.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(turn.active()).toBe(false);
  });

  it("stopped before a word came: the question is dropped too, nothing dangles", () => {
    const turn = createAnswerTurn();
    const abort = new AbortController();
    turn.begin(1, "draw a car", abort);
    const was = turn.stop(before);
    expect(abort.signal.aborted).toBe(true);
    expect(was?.shown).toBe("");
    expect(was?.history).toBe(before);
  });

  it("stopped while the finished answer is being spoken: the conversation already has it, once", () => {
    const turn = createAnswerTurn();
    turn.begin(2, "q", new AbortController());
    turn.progress(2, "The whole answer.");
    const withAnswer: BuddyTurn[] = [...before, { role: "user", text: "q" }, { role: "assistant", text: "The whole answer. [POINT:1,2:x]" }];
    turn.kept(2);
    const was = turn.stop(withAnswer);
    expect(was?.history).toBe(withAnswer);
    expect(was?.shown).toBe("The whole answer.");
  });

  it("nothing in progress: nothing to stop, and a second stop does nothing", () => {
    const turn = createAnswerTurn();
    expect(turn.stop(before)).toBeNull();
    turn.begin(3, "q", new AbortController());
    expect(turn.stop(before)).not.toBeNull();
    expect(turn.stop(before)).toBeNull();
  });

  it("an answer that ended by itself is no longer stoppable, and an older answer cannot touch a newer one", () => {
    const turn = createAnswerTurn();
    const abort = new AbortController();
    turn.begin(4, "old", new AbortController());
    turn.begin(5, "new", abort);
    turn.progress(4, "stale text");
    turn.end(4);
    expect(turn.active()).toBe(true);
    turn.end(5);
    expect(turn.stop(before)).toBeNull();
    expect(abort.signal.aborted).toBe(false);
  });

  it("keeps the conversation to its last twelve turns", () => {
    const long: BuddyTurn[] = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `t${i}` }) as BuddyTurn);
    const turn = createAnswerTurn();
    turn.begin(6, "q", new AbortController());
    turn.progress(6, "partial");
    const h = turn.stop(long)!.history;
    expect(h).toHaveLength(12);
    expect(h.at(-1)).toEqual({ role: "assistant", text: "partial" });
    expect(h[0].text).toBe("t2");
  });

  it("the marks that had not begun to draw are dropped, the ones on screen stay", () => {
    expect(marksStarted(4, 0, 900)).toBe(1);
    expect(marksStarted(4, 899, 900)).toBe(1);
    expect(marksStarted(4, 900, 900)).toBe(2);
    expect(marksStarted(4, 60_000, 900)).toBe(4);
    expect(marksStarted(0, 5000, 900)).toBe(0);
    expect(marksStarted(3, Number.NaN, 900)).toBe(0);
  });
});

describe('"Look at my screen": one setting decides', () => {
  it("the user's choice wins everywhere", () => {
    for (const route of ["local", "cloud", "freellm"] as const) {
      for (const local of ["picture", "text", "none", null] as const) {
        expect(seesScreen("on", route, local)).toBe(true);
        expect(seesScreen("off", route, local)).toBe(false);
      }
    }
  });

  it("until the user chooses, the setup for this computer decides on this PC and online answers see the screen", () => {
    expect(seesScreen("auto", "local", "picture")).toBe(true);
    expect(seesScreen("auto", "local", "text")).toBe(false);
    expect(seesScreen(undefined, "local", "text")).toBe(false);
    expect(seesScreen("auto", "local", null)).toBe(true);
    expect(seesScreen("auto", "cloud", "text")).toBe(true);
    expect(seesScreen("auto", "freellm", "text")).toBe(true);
  });

  it("the request carries the user's choice, or nothing so the server keeps the setup's pick", () => {
    expect(askSees("on")).toBe(true);
    expect(askSees("off")).toBe(false);
    expect(askSees("auto")).toBeUndefined();
    expect(askSees(undefined)).toBeUndefined();
  });

  it("says it is slow only where the setup left it off, and that pictures leave only online with it on", () => {
    expect(slowToSee("local", "text")).toBe(true);
    expect(slowToSee("local", "picture")).toBe(false);
    expect(slowToSee("cloud", "text")).toBe(false);
    expect(slowToSee("local", null)).toBe(false);
    expect(screenLeaves(true, "cloud")).toBe(true);
    expect(screenLeaves(true, "freellm")).toBe(true);
    expect(screenLeaves(true, "local")).toBe(false);
    expect(screenLeaves(false, "cloud")).toBe(false);
  });
});
