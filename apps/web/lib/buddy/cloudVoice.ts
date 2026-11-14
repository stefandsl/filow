// The online voice's audio for one text, behind the notice and the going-outside signal. Shared by
// the OK Filow panel and the whiteboard, so both ask the same yes ("voice" to the voice service) and
// neither can send without it.
import type { OutboundController } from "./outboundClient";

/**
 * A Blob: play it. "system": the user kept the voice on this PC (`onKept` says so). null: the notice
 * was closed without a choice, say nothing. Throws when the service fails or who would receive the text
 * cannot be told; the speaker then reads with a voice of this PC (lib/buddy/voice.ts).
 */
export function cloudVoiceAudio(o: {
  out: Pick<OutboundController, "recipients" | "allow" | "sending">;
  headers: () => Promise<Record<string, string>>;
  onKept: () => void;
  unknown: () => string;
  post?: (headers: Record<string, string>, text: string) => Promise<Response>;
}) {
  const post = o.post ?? ((headers, text) => fetch("/api/buddy/tts", { method: "POST", headers, body: JSON.stringify({ text }) }));
  return async (text: string): Promise<Blob | "system" | null> => {
    const rec = await o.out.recipients();
    if (!rec) throw new Error(o.unknown());
    const decision = await o.out.allow("voice", rec.voice);
    if (decision === "declined") { o.onKept(); return "system"; }
    if (decision !== "granted") return null;
    return o.out.sending("voice", rec.voice, async (consent) => {
      const res = await post({ "Content-Type": "application/json", ...(await o.headers()), ...consent }, text);
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `voice ${res.status}`);
      return res.blob();
    });
  };
}
