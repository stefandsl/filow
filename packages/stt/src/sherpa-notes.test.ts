import { describe, expect, it } from "vitest";
import { sherpaNotes, sherpaUsable, type SherpaStatus } from "./sherpa";

const base: SherpaStatus = { model: "missing", pct: 0, running: false, language: "ro", wanted: "parakeet-v3", wantedLabel: "Parakeet TDT 0.6b v3", wantedStreaming: false, downloadBytes: 487_855_297, usable: false, active: null, notes: [] };

describe("what the settings page says about the spoken language", () => {
  it("names the model and its size, says Romanian is followed phrase by phrase and that nothing is downloaded yet", () => {
    expect(sherpaNotes(base)).toEqual([
      { key: "speech.model", vars: { model: "Parakeet TDT 0.6b v3", mb: 488 } },
      { key: "speech.notePhrases" },
      { key: "speech.noneForLang" },
    ]);
  });

  it("says nothing more than the model for a streaming language whose model is downloaded", () => {
    expect(sherpaNotes({ ...base, language: "en", model: "ready", wanted: "nemotron", wantedLabel: "Nemotron 3.5 streaming", wantedStreaming: true, usable: true, active: "nemotron" })).toEqual([]);
  });

  it("names the fallback in use until the better model is downloaded", () => {
    const s: SherpaStatus = { ...base, language: "ja", wanted: "nemotron", wantedLabel: "Nemotron 3.5 streaming", wantedStreaming: true, usable: true, active: "dolphin", activeLabel: "Dolphin base", notes: ["fallback", "phrases"] };
    expect(sherpaNotes(s).map((n) => n.key)).toEqual(["speech.model", "speech.notePhrases", "speech.noteFallback"]);
    expect(sherpaNotes(s)[2].vars).toEqual({ active: "Dolphin base", wanted: "Nemotron 3.5 streaming" });
  });

  it("does not promise phrase by phrase while a streaming fallback is what runs", () => {
    const s: SherpaStatus = { ...base, usable: true, active: "nemotron", activeLabel: "Nemotron 3.5 streaming", streaming: true, notes: ["fallback"] };
    expect(sherpaNotes(s).map((n) => n.key)).toEqual(["speech.model", "speech.noteFallback"]);
  });

  it("offers the more accurate questions model when it is another one and not on disk", () => {
    const q = { wanted: "parakeet-v3", wantedLabel: "Parakeet TDT 0.6b v3", state: "missing" as const, pct: 0, downloadBytes: 487_855_297, usable: true, active: "nemotron", notes: [] };
    const en: SherpaStatus = { ...base, language: "en", model: "ready", wanted: "nemotron", wantedLabel: "Nemotron 3.5 streaming", wantedStreaming: true, usable: true, active: "nemotron", questions: q };
    expect(sherpaNotes(en)).toEqual([{ key: "speech.questionsModel", vars: { model: "Parakeet TDT 0.6b v3", mb: 488 } }]);
    expect(sherpaNotes({ ...en, questions: { ...q, state: "ready" } })).toEqual([]);
    expect(sherpaNotes({ ...base, questions: q }).map((n) => n.key)).not.toContain("speech.questionsModel");
  });

  it("reads an older shell that only reports its one model", () => {
    expect(sherpaNotes({ model: "ready", pct: 100, running: false })).toEqual([]);
    expect(sherpaUsable({ model: "ready", pct: 100, running: false })).toBe(true);
    expect(sherpaUsable({ model: "missing", pct: 0, running: false })).toBe(false);
    expect(sherpaUsable({ ...base, model: "missing", usable: true })).toBe(true);
  });
});
