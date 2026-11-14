// Which voice reads a whiteboard lesson (owner, 14/11/2026: the board spoke with the robotic system
// voice while OK Filow's answers used the chosen one). The board speaks with the voice chosen in
// OK Filow: online with its own yes and signal (the same "voice" kind as the panel, no new one), else
// the natural voice of this PC; the system voice only when neither can speak, which the speaker says.
import type { OkFilowStatus } from "@/lib/buddy/bridge";
import { voiceRoute } from "@/lib/buddy/outbound";
import type { WbKey } from "./text";

export type BoardVoice = { voice: OkFilowStatus["voice"]; note: WbKey | "" };

/**
 * `natural`: the natural voice is on this PC and this PC can carry it. `recording`: the lesson is
 * being saved as a video, and a page can record only the natural voice (its samples pass through the
 * recorder); the online voice is then replaced by the natural one for the recording, and said so.
 */
export function boardVoice(status: Pick<OkFilowStatus, "voice" | "offline"> | null | undefined, o: { natural: boolean; recording: boolean }): BoardVoice {
  const chosen = status?.voice ?? "system";
  if (chosen === "off") return { voice: "off", note: "" };
  if (chosen === "cloud") {
    if (o.recording) return o.natural ? { voice: "natural", note: "voiceRecordNatural" } : { voice: "system", note: "voiceRecordSilent" };
    // Offline the online voice cannot speak: the natural voice of this PC, as for the panel's fallback.
    if (voiceRoute(status) !== "cloud") return { voice: "natural", note: "" };
    return { voice: "cloud", note: "" };
  }
  return { voice: chosen, note: "" };
}

/** True when the voice that reads the recording can go into the video (only the natural voice can). */
export const recordsSound = (v: BoardVoice) => v.voice === "natural";
