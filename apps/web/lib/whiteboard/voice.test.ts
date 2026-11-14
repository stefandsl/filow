// The whiteboard speaks with the voice chosen in OK Filow (owner, 14/11/2026: it used the robotic
// system voice while the panel used the online one). Online only with the voice's own yes and signal,
// as in the panel; the video gets the natural voice, the only one a page can record.
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { boardVoice, recordsSound } from "./voice";
import { cloudVoiceAudio } from "@/lib/buddy/cloudVoice";
import { createOutboundController } from "@/lib/buddy/outboundClient";
import { withConsent, type BuddyRecipients, type ConsentMap } from "@/lib/buddy/outbound";
import { wbText } from "./text";

describe("which voice reads the lesson", () => {
  it("the online voice when it was chosen and the PC is online", () => {
    expect(boardVoice({ voice: "cloud", offline: false }, { natural: true, recording: false })).toEqual({ voice: "cloud", note: "" });
    expect(boardVoice({ voice: "cloud", offline: false }, { natural: false, recording: false })).toEqual({ voice: "cloud", note: "" });
  });
  it("the natural voice when it was chosen, or in place of the online one offline", () => {
    expect(boardVoice({ voice: "natural", offline: false }, { natural: true, recording: false }).voice).toBe("natural");
    expect(boardVoice({ voice: "cloud", offline: true }, { natural: true, recording: false }).voice).toBe("natural");
  });
  it("none: nothing speaks; the system voice only when it is the choice", () => {
    expect(boardVoice({ voice: "off", offline: false }, { natural: true, recording: true })).toEqual({ voice: "off", note: "" });
    expect(boardVoice({ voice: "system", offline: false }, { natural: true, recording: false }).voice).toBe("system");
    expect(boardVoice(null, { natural: false, recording: false }).voice).toBe("system");
  });
  it("recording: the online voice is replaced by the natural one, said so; without it the video is silent, said so", () => {
    const natural = boardVoice({ voice: "cloud", offline: false }, { natural: true, recording: true });
    expect(natural).toEqual({ voice: "natural", note: "voiceRecordNatural" });
    expect(recordsSound(natural)).toBe(true);
    const none = boardVoice({ voice: "cloud", offline: false }, { natural: false, recording: true });
    expect(none).toEqual({ voice: "system", note: "voiceRecordSilent" });
    expect(recordsSound(none)).toBe(false);
    expect(recordsSound(boardVoice({ voice: "natural", offline: false }, { natural: true, recording: true }))).toBe(true);
  });
  it("the notes speak the five languages, with no em dash", () => {
    for (const lang of ["en", "it", "ru", "ro", "ja"]) for (const key of ["voiceRecordNatural", "voiceRecordSilent"] as const) {
      expect(wbText(lang, key), `${lang} ${key}`).not.toContain(String.fromCharCode(0x2014));
      if (lang !== "en") expect(wbText(lang, key)).not.toBe(wbText("en", key));
    }
  });
});

describe("the online voice's audio (shared by the panel and the board)", () => {
  const VOICE = { id: "elevenlabs", names: ["ElevenLabs"] };
  const rec = { voice: VOICE } as BuddyRecipients;
  const make = (consent: ConsentMap, answer: "granted" | "declined" | "dismissed" = "dismissed") => {
    const signal = { begin: vi.fn(), end: vi.fn() };
    let notice: unknown = null;
    const out = createOutboundController({ consent: () => consent, save: async () => true, fetchRecipients: async () => rec, signal, onNotice: (n) => { notice = n; } });
    const post = vi.fn(async (_h: Record<string, string>, _t: string) => new Response("mp3"));
    const onKept = vi.fn();
    const audio = cloudVoiceAudio({ out, headers: async () => ({}), onKept, unknown: () => "?", post });
    return { audio, post, signal, onKept, out, notice: () => notice, answer };
  };

  it("no yes: the notice is asked, and closing it sends nothing", async () => {
    const m = make({});
    const got = m.audio("Hello.");
    await vi.waitFor(() => expect(m.notice()).toMatchObject({ kind: "voice", recipient: VOICE }));
    m.out.dismissAll();
    expect(await got).toBeNull();
    expect(m.post).not.toHaveBeenCalled();
    expect(m.signal.begin).not.toHaveBeenCalled();
  });

  it("a no keeps the voice on this PC and sends nothing", async () => {
    const m = make({});
    const got = m.audio("Hello.");
    await vi.waitFor(() => expect(m.notice()).not.toBeNull());
    await m.out.decide("declined");
    expect(await got).toBe("system");
    expect(m.onKept).toHaveBeenCalled();
    expect(m.post).not.toHaveBeenCalled();
  });

  it("with the yes: the text goes once, with the voice's own key, under the signal", async () => {
    const m = make(withConsent({}, "voice", VOICE, "granted"));
    expect(await m.audio("Hello.")).toBeInstanceOf(Blob);
    expect(m.post).toHaveBeenCalledTimes(1);
    expect(m.post.mock.calls[0][0]).toMatchObject({ "x-filow-consent": "voice:elevenlabs" });
    expect(m.signal.begin).toHaveBeenCalledWith(expect.any(String), "voice", ["ElevenLabs"]);
  });

  it("a refused service throws (the speaker then reads with a voice of this PC)", async () => {
    const m = make(withConsent({}, "voice", VOICE, "granted"));
    m.post.mockResolvedValueOnce(Response.json({ error: "ElevenLabs 401" }, { status: 502 }));
    await expect(m.audio("Hello.")).rejects.toThrow("ElevenLabs 401");
  });

  it("the board's speaker gets this audio and tells why another voice speaks", () => {
    const page = fs.readFileSync(new URL("../../app/okfilow/whiteboard/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("cloudAudio: cloudVoiceAudio({ out, headers: engineHeaders,");
    expect(page).toContain("onFallback: (reason) => setNote(okfTRef.current(`voiceWhy_${reason}`)),");
    expect(page).toContain("void speaker.speak(say, turn, { lang: lessonLang, voice })");
  });
});
