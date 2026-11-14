import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { captions, captionVtt } from "../../scripts/intro-captions.mjs";
import { selectIntroCaptions } from "./intro-captions";

const languages = ["en", "it", "ru", "ro", "ja"];
it("ships all five generated tracks with identical timings and nonempty cues", () => {
  expect(Object.keys(captions)).toEqual(languages);
  const timing = (vtt: string) => vtt.split("\n").filter(line => line.includes(" --> "));
  for (const lang of languages) {
    const vtt = readFileSync(new URL(`./media/intro.${lang}.vtt`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(vtt).toBe(captionVtt(lang));
    expect(timing(vtt)).toEqual(timing(captionVtt("en")));
    const cues = vtt.trim().split("\n\n").slice(1);
    expect(cues).toHaveLength(3);
    for (const cue of cues) expect(cue.split("\n").slice(1).join(" ").trim().length).toBeGreaterThan(0);
  }
});
it.each([...languages, "unknown"])("selects %s or English fallback without leaving two tracks showing", lang => {
  const tracks = languages.map(language => ({ language, mode: "disabled" as TextTrackMode }));
  selectIntroCaptions(tracks, "it");
  selectIntroCaptions(tracks, lang);
  expect(tracks.filter(track => track.mode === "showing").map(track => track.language)).toEqual([languages.includes(lang) ? lang : "en"]);
});
