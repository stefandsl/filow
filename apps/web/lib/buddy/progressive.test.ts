import { describe, expect, it, vi } from "vitest";
import { createProgressiveSpeech } from "./progressive";
import { parseBuddyAnswer } from "./prompt";
import { createAnswerTurn, sentenceParts } from "./turn";

/** Lets every queued promise step run. */
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe("one speech queue with the pill's pause (turn.ts)", () => {
  it("a pause starts no new chunk; Resume carries on at the right sentence, each chunk at its place among the answer's sentences", async () => {
    const turn = createAnswerTurn();
    turn.begin(1, "q");
    const said: Array<[string, number]> = [];
    const voice = createProgressiveSpeech({
      speak: async (text, base) => { said.push([text, base]); },
      isCurrent: () => true,
      unpaused: () => turn.unpaused(1),
    });
    voice.update("One. Two. Three");
    await settle();
    expect(said).toEqual([["One. Two.", 0]]);
    turn.pause();
    voice.update("One. Two. Three. Four. Five");
    await settle();
    // paused: "Three. Four." waits, nothing is said
    expect(said).toEqual([["One. Two.", 0]]);
    turn.resume();
    await settle();
    expect(said).toEqual([["One. Two.", 0], ["Three. Four.", 2]]);
    await voice.finish("One. Two. Three. Four. Five.");
    expect(said).toEqual([["One. Two.", 0], ["Three. Four.", 2], ["Five.", 4]]);
  });

  it("a chunk waiting for Resume is never said when the answer is stopped meanwhile", async () => {
    const turn = createAnswerTurn();
    turn.begin(1, "q");
    const said: string[] = [];
    let live = true;
    const voice = createProgressiveSpeech({ speak: async (text) => { said.push(text); }, isCurrent: () => live, unpaused: () => turn.unpaused(1) });
    turn.pause();
    voice.update("One. Two. Three");
    await settle();
    live = false;
    turn.stop([]);
    await settle();
    expect(said).toEqual([]);
  });

  it("Resume after Stop starts where the user stopped hearing, at the sentence index the bubble shows", async () => {
    const turn = createAnswerTurn();
    turn.begin(1, "q");
    const said: Array<[string, number]> = [];
    let live = true;
    let cut!: () => void;
    const voice = createProgressiveSpeech({
      // the second chunk is still being spoken when Stop comes
      speak: (text, base) => { said.push([text, base]); return said.length === 1 ? Promise.resolve() : new Promise<void>((r) => { cut = r; }); },
      isCurrent: () => live,
      unpaused: () => turn.unpaused(1),
    });
    const text = "One. Two. Three. Four. Five.";
    voice.update("One. Two. Three");
    await settle();
    voice.update(text);
    await settle();
    expect(said).toEqual([["One. Two.", 0], ["Three. Four.", 2]]);
    // Stop while "Four." was not heard yet (voice.ts left() says so); "Five." never started
    live = false;
    cut();
    await settle();
    const where = voice.where("Four.");
    expect(where).toEqual({ heard: 3, left: "Four. Five." });
    // the continuation's voice starts after the part heard, and counts from there
    const again: Array<[string, number]> = [];
    const next = createProgressiveSpeech({ speak: async (t, base) => { again.push([t, base]); }, isCurrent: () => true, said: sentenceParts(text).slice(0, where.heard).join("") });
    await next.finish(text + " Six.");
    expect(again).toEqual([["Four. Five. Six.", 3]]);
  });
});

describe("progressive answer voice", () => {
  it("starts the first sentence before the response finishes, without repeating it", async () => {
    const speak = vi.fn(async (_text: string) => {});
    const voice = createProgressiveSpeech({ speak, isCurrent: () => true });
    voice.update("Click Save.");
    await Promise.resolve();
    // the chunk may end inside "Save.txt": the sentence counts once the next word has started
    expect(speak).not.toHaveBeenCalled();
    voice.update("Click Save. Then choose");
    await Promise.resolve();
    expect(speak).toHaveBeenCalledWith("Click Save.", 0);
    await voice.finish("Click Save. Then choose a folder.");
    expect(speak.mock.calls.map(c => c[0])).toEqual(["Click Save.", "Then choose a folder."]);
  });
  it("serializes audio and discards pending sentences on cancellation", async () => {
    let release!: () => void;
    const speak = vi.fn(() => new Promise<void>(r => { release = r; }));
    const voice = createProgressiveSpeech({ speak, isCurrent: () => true });
    voice.update("First sentence. Second");
    await Promise.resolve();
    voice.update("First sentence. Second sentence.");
    const done = voice.finish("First sentence. Second sentence.");
    voice.cancel(); release(); await done;
    expect(speak).toHaveBeenCalledTimes(1);
  });
  it("never speaks a stale turn or an incomplete visual tag", async () => {
    let current = true;
    const speak = vi.fn(async (_text: string) => {});
    const voice = createProgressiveSpeech({ speak, isCurrent: () => current });
    const screens = [{ index: 1, width: 100, height: 100 }];
    voice.update(parseBuddyAnswer("Click Save [POI", screens).text);
    voice.update(parseBuddyAnswer("Click Save [POINT:50,50:Save:screen1].", screens).text);
    await Promise.resolve();
    current = false;
    await voice.finish("Click Save . Never speak this.");
    expect(speak.mock.calls.flat().join(" ")).not.toMatch(/POINT|POI|Never/);
  });
  it("says the rest of the answer when the final text no longer starts with what was said", async () => {
    const speak = vi.fn(async (_text: string) => {});
    const voice = createProgressiveSpeech({ speak, isCurrent: () => true });
    voice.update("Click [POINT:5,5:Save. Then press");
    await voice.finish("Click now. After that you are done.");
    expect(speak.mock.calls.map(c => c[0])).toEqual(["Click [POINT:5,5:Save.", "After that you are done."]);
  });
  it("keeps split decimals together and flushes text without final punctuation", async () => {
    const speak = vi.fn(async (_text: string) => {});
    const voice = createProgressiveSpeech({ speak, isCurrent: () => true });
    voice.update("Choose version 3.");
    await Promise.resolve();
    expect(speak).not.toHaveBeenCalled();
    await voice.finish("Choose version 3.5 and save");
    expect(speak).toHaveBeenCalledWith("Choose version 3.5 and save", 0);
  });
});
