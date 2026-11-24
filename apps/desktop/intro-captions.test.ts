import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { captions, captionVtt } from "../../scripts/intro-captions.mjs";
import * as introCaptions from "./intro-captions";
import { selectIntroCaptions } from "./intro-captions";

const languages = ["en", "it", "ru", "ro", "ja"] as const;
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
  expect(tracks.filter(track => track.mode === "showing").map(track => track.language)).toEqual([languages.includes(lang as typeof languages[number]) ? lang : "en"]);
});

it("resolves the first cue of each UI language before Play and live cues during playback", () => {
  const firstIntroCaption = (introCaptions as Record<string, unknown>).firstIntroCaption as
    | ((lang: string) => string)
    | undefined;
  const resolveIntroCaptionText = (introCaptions as Record<string, unknown>).resolveIntroCaptionText as
    | ((showing: { activeCues?: ArrayLike<{ text?: string }> | null; cues?: ArrayLike<{ text?: string }> | null } | undefined, lang: string, beforePlay: boolean) => string)
    | undefined;

  expect(typeof firstIntroCaption).toBe("function");
  expect(typeof resolveIntroCaptionText).toBe("function");

  for (const lang of languages) {
    expect(firstIntroCaption!(lang)).toBe(captions[lang][0]);
    // Before Play, even if the VTT track has not finished loading cues yet, show the UI language's first cue.
    expect(resolveIntroCaptionText!({ activeCues: [], cues: [] }, lang, true)).toBe(captions[lang][0]);
    // Before Play, prefer the loaded first cue from the showing track.
    expect(resolveIntroCaptionText!({ activeCues: [], cues: [{ text: captions[lang][0] }] }, lang, true)).toBe(captions[lang][0]);
    // During playback, show the active cue rather than sticking on the first cue.
    expect(resolveIntroCaptionText!({ activeCues: [{ text: captions[lang][1] }], cues: [{ text: captions[lang][0] }] }, lang, false)).toBe(captions[lang][1]);
    // During playback with no active cue, show nothing.
    expect(resolveIntroCaptionText!({ activeCues: [], cues: [{ text: captions[lang][0] }] }, lang, false)).toBe("");
    // When captions are explicitly turned off (no showing track), show nothing.
    expect(resolveIntroCaptionText!(undefined, lang, true)).toBe("");
  }
  expect(firstIntroCaption!("unknown")).toBe(captions.en[0]);
});
