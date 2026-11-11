import { describe, expect, it } from "vitest";
import { createVad } from "@/lib/buddy/listen";
import { createPhraseFlow } from "./handsfree";

describe("hands-free dictation: which phrases are typed, and when (issue #2)", () => {
  it("a closed phrase waits for the pause, then is typed once", () => {
    const f = createPhraseFlow();
    expect(f.committed("Hello there.", 1000)).toBe("");
    expect(f.pending()).toEqual(["Hello there."]);
    expect(f.pause(1700)).toBe("Hello there.");
    expect(f.pending()).toEqual([]);
    expect(f.pause(3000)).toBe("");
    expect(f.typed).toBe(1);
  });

  it("a sentence the recognizer cut in several pieces is typed as one text at the pause", () => {
    const f = createPhraseFlow();
    expect(f.committed("I would like", 1000)).toBe("");
    expect(f.committed("to book a table", 2200)).toBe("");
    expect(f.committed("for two.", 3100)).toBe("");
    expect(f.pause(4200)).toBe("I would like to book a table for two.");
  });

  it("a streaming model closes its phrase after the pause was heard: typed the moment it closes", () => {
    const f = createPhraseFlow();
    expect(f.pause(5000)).toBe("");
    expect(f.committed("See you on Friday.", 5150)).toBe("See you on Friday.");
    // The next phrase is a new one: it waits for its own pause.
    expect(f.committed("Bring the", 9000)).toBe("");
    expect(f.pause(10_200)).toBe("Bring the");
  });

  it("a pause with nothing recognized (a cough) does not make a much later phrase skip its pause", () => {
    const f = createPhraseFlow({ dueMs: 2500 });
    expect(f.pause(1000)).toBe("");
    expect(f.committed("Half a", 6000)).toBe("");
    expect(f.committed("sentence.", 7000)).toBe("");
    expect(f.pause(8200)).toBe("Half a sentence.");
  });

  it("phrases never wait forever for a pause in a noisy room", () => {
    const f = createPhraseFlow({ maxHoldMs: 6000 });
    expect(f.committed("One.", 0)).toBe("");
    expect(f.committed("Two.", 3000)).toBe("");
    expect(f.committed("Three.", 6500)).toBe("One. Two. Three.");
    expect(f.committed("Four.", 7000)).toBe("");
  });

  it("when the detector misses the pause (speech from the first instant), closed phrases are typed after a short wait", () => {
    const f = createPhraseFlow({ idleMs: 2000 });
    const vad = createVad();
    const typed: Array<{ at: number; text: string }> = [];
    // Loud from the very first reading: the detector takes that level for the room and hears no speech.
    for (let t = 0; t <= 6000; t += 128) {
      let text = t === 2560 ? f.committed("Straight in.", t) : "";
      if (vad.push(t < 2000 ? 0.6 : 0.02, t)) text = text || f.pause(t);
      text = text || f.tick(t);
      if (text) typed.push({ at: t, text });
    }
    expect(typed.map((x) => x.text)).toEqual(["Straight in."]);
    expect(typed[0].at).toBeGreaterThanOrEqual(4560);
    expect(typed[0].at).toBeLessThan(4800);
    // A phrase that closed a moment ago is not typed by the wait alone.
    expect(f.committed("More", 7000)).toBe("");
    expect(f.tick(8000)).toBe("");
    expect(f.tick(9000)).toBe("More");
  });

  it("nothing is typed twice and nothing is lost: what is left at the stop is the rest", () => {
    const f = createPhraseFlow();
    const typed: string[] = [];
    const out = (s: string) => { if (s) typed.push(s); };
    out(f.committed("First.", 100));
    out(f.pause(1300));
    out(f.committed("Second", 2000));
    out(f.committed("", 2100));
    out(f.committed("   ", 2200));
    // The keys are pressed here: the panel types pending() plus the recognizer's last words.
    expect(typed).toEqual(["First."]);
    expect(f.pending()).toEqual(["Second"]);
    expect(f.typed).toBe(1);
  });

  it("with the voice-activity detector OK Filow's hands-free uses: speech, a pause, speech, a pause", () => {
    const f = createPhraseFlow();
    const typed: Array<{ at: number; text: string }> = [];
    let vad = createVad();
    // 20 ms level readings: speech 0.2-2 s, quiet 2-4 s, speech 4-6 s, quiet 6-8 s.
    const loud = (t: number) => ((t >= 200 && t < 2000) || (t >= 4000 && t < 6000) ? 0.5 : 0.01);
    const commits: Record<number, string> = { 2500: "Good morning.", 6500: "How are you?" };
    for (let t = 0; t <= 8000; t += 20) {
      let text = commits[t] ? f.committed(commits[t], t) : "";
      if (vad.push(loud(t), t)) { vad = createVad(); text = text || f.pause(t); }
      if (text) typed.push({ at: t, text });
    }
    expect(typed.map((x) => x.text)).toEqual(["Good morning.", "How are you?"]);
    // Typed after about a second of quiet, while the microphone stays open.
    expect(typed[0].at).toBeGreaterThanOrEqual(3000);
    expect(typed[0].at).toBeLessThan(3400);
    expect(typed[1].at).toBeGreaterThanOrEqual(7000);
    expect(typed[1].at).toBeLessThan(7400);
  });
});
