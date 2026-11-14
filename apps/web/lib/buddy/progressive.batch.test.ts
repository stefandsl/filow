import { describe, expect, it } from "vitest";
import { createProgressiveSpeech } from "./progressive";

const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };

describe("speech queued while the first sentence plays", () => {
  it("never enlarges the first request even if more text arrives before its promise runs", async () => {
    const calls: string[] = [];
    const voice = createProgressiveSpeech({isCurrent: () => true, speak: async text => { calls.push(text); }});
    voice.update("First sentence. Second");
    await voice.finish("First sentence. Second sentence. Third sentence.");
    expect(calls[0]).toBe("First sentence.");
    expect(calls.join(" ")).toBe("First sentence. Second sentence. Third sentence.");
  });

  it("does not merge past the desktop text limit and keeps every queued word", async () => {
    const calls: Array<[string, number]> = [];
    const voice = createProgressiveSpeech({isCurrent: () => true, speak: async (text, base) => { calls.push([text, base]); }});
    const a = "Alpha ".repeat(400) + ".";
    const b = "Bravo ".repeat(400) + ".";
    voice.update("First. Next");
    voice.update("First. " + a + " Next");
    await voice.finish("First. " + a + " " + b);
    expect(calls).toEqual([["First.", 0], [a, 1], [b, 2]]);
    expect(calls.every(([text]) => text.length <= 4000)).toBe(true);
  });

  it("keeps the first request short and combines waiting sentences into the next request", async () => {
    const calls: Array<[string, number]> = [];
    let release!: () => void;
    const voice = createProgressiveSpeech({
      isCurrent: () => true,
      speak: (text, base) => {
        calls.push([text, base]);
        return calls.length === 1 ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
      },
    });
    voice.update("Apri il menu. Poi");
    await settle();
    expect(calls).toEqual([["Apri il menu.", 0]]);
    voice.update("Apri il menu. Poi scegli File. Controlla");
    voice.update("Apri il menu. Poi scegli File. Controlla il nome. Infine");
    const done = voice.finish("Apri il menu. Poi scegli File. Controlla il nome. Infine salva.");
    expect(calls).toHaveLength(1);
    release();
    await done;
    expect(calls).toEqual([["Apri il menu.", 0], ["Poi scegli File.\nControlla il nome.\nInfine salva.", 1]]);
  });

  it("preserves the Resume position inside a combined request", async () => {
    let release!: () => void;
    let live = true;
    const voice = createProgressiveSpeech({
      isCurrent: () => live,
      speak: () => new Promise<void>(resolve => { release = resolve; }),
    });
    voice.update("One. Two");
    await settle();
    voice.update("One. Two. Three");
    const done = voice.finish("One. Two. Three. Four.");
    release();
    await settle();
    live = false;
    release();
    await done;
    expect(voice.where("Three. Four.")).toEqual({heard: 2, left: "Three. Four."});
  });
});
