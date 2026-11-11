// The natural voice's rows in the OK Filow panel: Stop next to the download's percent, and for the
// voice on disk its size, whether it is the one in use, and Delete after one question.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VoiceSettings } from "@/app/okfilow/panel/voice-settings";
import type { OkFilowBridge, OkFilowStatus, OkFilowTtsStatus } from "@/lib/buddy/bridge";
import { okfText } from "@/lib/buddy/text";

const tts = (over: Partial<OkFilowTtsStatus> = {}): OkFilowTtsStatus => ({ installed: false, state: "idle", pct: 0, error: "", sizeBytes: 128774318, voices: 10, mode: "natural", level: "standard", reason: "", ...over });
const api = (over: Record<string, unknown> = {}) => ({
  status: async () => tts(), download: async () => tts({ state: "downloading" }), remove: vi.fn(async () => ({ ...tts(), freedBytes: 128774318 })),
  stopDownload: vi.fn(async () => tts()), onStatus: () => () => {}, ...over,
});
const view = (initial: OkFilowTtsStatus, voice: OkFilowStatus["voice"], lang = "en", bridgeTts: ReturnType<typeof api> = api(), confirmRemove: (q: string) => boolean = () => true) => (
  <VoiceSettings bridge={{ tts: bridgeTts } as unknown as OkFilowBridge} status={{ voice, offline: false, naturalVoice: 0 } as OkFilowStatus} t={okfText(lang)} configure={async () => {}} preview={() => {}} initial={initial} confirmRemove={confirmRemove} />
);
const plain = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
/** The props of the element with this data-testid, found while React renders (no DOM library in this repo). */
function handler(node: ReactElement, testid: string): Record<string, unknown> | undefined {
  let found: Record<string, unknown> | undefined;
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const el = n as { type?: unknown; props?: Record<string, unknown> };
    if (!el.props) return;
    if (el.props["data-testid"] === testid) found = el.props;
    if (typeof el.type === "function") return walk((el.type as (p: unknown) => unknown)(el.props));
    walk(el.props.children);
  };
  const Probe = () => { walk(node); return null; };
  renderToStaticMarkup(<Probe />);
  return found;
}

describe("the natural voice in the OK Filow panel", () => {
  it("while it downloads: the percent and a Stop button with a name a screen reader can say", () => {
    const html = renderToStaticMarkup(view(tts({ state: "downloading", pct: 4 }), "natural"));
    expect(plain(html)).toContain("Downloading the voice… 4% Stop");
    expect(html).toContain('<button type="button" class="okf-link" data-testid="voice-stop" aria-label="Stop the download of the voice">Stop</button>');
    expect(html).not.toContain("voice-remove");
  });

  it("Stop asks the desktop app to stop the download", async () => {
    const bridge = api();
    (handler(view(tts({ state: "downloading", pct: 4 }), "natural", "en", bridge), "voice-stop")!.onClick as () => void)();
    await Promise.resolve();
    expect(bridge.stopDownload).toHaveBeenCalledTimes(1);
  });

  it("a desktop build that cannot stop shows no Stop button", () => {
    const html = renderToStaticMarkup(view(tts({ state: "downloading", pct: 4 }), "natural", "en", api({ stopDownload: undefined })));
    expect(html).not.toContain("voice-stop");
  });

  it("installed and speaking: 'in use' next to the size; installed while another voice speaks: the size only", () => {
    const used = renderToStaticMarkup(view(tts({ installed: true, state: "ready", pct: 100 }), "natural"));
    expect(plain(used)).toContain("Natural voice installed (129 MB) · in use Listen Remove the voice");
    expect(used).toContain('<strong data-testid="voice-in-use">in use</strong>');
    for (const voice of ["system", "cloud", "off"] as const) {
      const idle = renderToStaticMarkup(view(tts({ installed: true, state: "ready", pct: 100 }), voice));
      expect(plain(idle), voice).toContain("Natural voice installed (129 MB) Remove the voice");
      expect(plain(idle), voice).not.toContain("Listen");
      expect(idle, voice).not.toContain("voice-in-use");
    }
    // this PC turned out too slow for it: on disk, not speaking
    expect(renderToStaticMarkup(view(tts({ installed: true, state: "ready", mode: "system", reason: "slow" }), "natural"))).not.toContain("voice-in-use");
  });

  it("Delete asks one question with the size; in use, it says what speaks instead; No deletes nothing", async () => {
    const asked: string[] = [];
    const bridge = api();
    const click = (voice: OkFilowStatus["voice"], answer: boolean) => (handler(view(tts({ installed: true, state: "ready" }), voice, "en", bridge, (q) => { asked.push(q); return answer; }), "voice-remove")!.onClick as () => void)();
    click("natural", false);
    await Promise.resolve();
    expect(asked[0]).toBe("Remove the natural voice (129 MB) from this computer?\n\nIt is the voice in use: OK Filow will speak with This PC's voice.");
    expect(bridge.remove).not.toHaveBeenCalled();
    click("system", true);
    await Promise.resolve();
    expect(asked[1]).toBe("Remove the natural voice (129 MB) from this computer?");
    expect(bridge.remove).toHaveBeenCalledTimes(1);
  });

  it("speaks the five languages, with no em dash", () => {
    for (const lang of ["en", "it", "ru", "ro", "ja"]) {
      const t = okfText(lang);
      for (const key of ["voiceStop", "voiceStopLabel", "voiceRemoveConfirm", "voiceRemoveInUse", "voiceRemoved", "voiceInstalled", "voiceInUse"] as const) {
        expect(t(key), `${lang} ${key}`).not.toContain("—");
        if (lang !== "en") expect(t(key), `${lang} ${key}`).not.toBe(okfText("en")(key));
        expect((t(key).match(/\{\w+\}/g) ?? []).join(), `${lang} ${key}`).toBe((okfText("en")(key).match(/\{\w+\}/g) ?? []).join());
      }
    }
  });
});
