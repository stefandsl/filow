import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { wbText } from "@/lib/whiteboard/text";
import { VideoChoice, videoChoiceNotes } from "./VideoChoice";

const t = (k: Parameters<typeof wbText>[1]) => wbText("it", k);
const html = (voice: Parameters<typeof videoChoiceNotes>[0], voiceOn: boolean) => renderToStaticMarkup(<VideoChoice t={t} voice={voice} voiceOn={voiceOn} onPick={() => {}} onCancel={() => {}} />);

describe("Save video: with voice or without", () => {
  it("with a voice to record, With voice is the default; a muted voice is still recorded, said so", () => {
    const out = html({ voice: "cloud", note: "" }, false);
    expect(out).toMatch(/class="wb-btn primary" data-action="video-voice">Con voce</);
    expect(out).toMatch(/class="wb-btn" data-action="video-silent">Senza voce</);
    expect(out).toContain(wbText("it", "videoVoiceMuted"));
    expect(videoChoiceNotes({ voice: "cloud", note: "" }, true)).toEqual([]);
  });

  it("the natural voice in place of the chosen one is said before saving", () => {
    expect(videoChoiceNotes({ voice: "natural", note: "voiceRecordNatural" }, true)).toEqual(["voiceRecordNatural"]);
    expect(html({ voice: "natural", note: "voiceRecordNatural" }, true)).toContain(wbText("it", "voiceRecordNatural"));
  });

  it("no voice to record: With voice cannot be chosen, the reason is said, Without voice is the default", () => {
    const out = html({ voice: "off", note: "voiceRecordNone" }, true);
    expect(out).toMatch(/class="wb-btn" data-action="video-voice" disabled="">Con voce</);
    expect(out).toMatch(/class="wb-btn primary" data-action="video-silent">Senza voce</);
    expect(out).toContain(wbText("it", "voiceRecordNone"));
    expect(videoChoiceNotes({ voice: "off", note: "voiceRecordNone" }, false)).toEqual(["voiceRecordNone"]);
  });
});
