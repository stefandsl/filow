import { describe, expect, it, vi } from "vitest";
import { createProgressiveSpeech } from "./progressive";
import { parseBuddyAnswer } from "./prompt";

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
    expect(speak).toHaveBeenCalledWith("Click Save.");
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
    expect(speak).toHaveBeenCalledWith("Choose version 3.5 and save");
  });
});
