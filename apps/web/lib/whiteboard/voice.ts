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
 * being saved as a video with its voice (owner, 14/11/2026: "with voice or without"). A page can
 * record the sound that passes through it: the online voice's audio and the natural voice's samples.
 * The system voice is spoken by Windows and cannot be recorded: the natural voice reads the recording
 * in its place, said so; with neither, there is no voice to record (`off`, said so), and the video can
 * only be saved without voice. A recording reads even when OK Filow's voice is off: it was asked for.
 */
export function boardVoice(status: Pick<OkFilowStatus, "voice" | "offline"> | null | undefined, o: { natural: boolean; recording: boolean }): BoardVoice {
  const chosen = status?.voice ?? "system";
  if (o.recording) {
    if (chosen === "cloud" && voiceRoute(status) === "cloud") return { voice: "cloud", note: "" };
    if (o.natural) return { voice: "natural", note: chosen === "natural" ? "" : "voiceRecordNatural" };
    return { voice: "off", note: "voiceRecordNone" };
  }
  if (chosen === "off") return { voice: "off", note: "" };
  if (chosen === "cloud") {
    // Offline the online voice cannot speak: the natural voice of this PC, as for the panel's fallback.
    if (voiceRoute(status) !== "cloud") return { voice: "natural", note: "" };
    return { voice: "cloud", note: "" };
  }
  return { voice: chosen, note: "" };
}

/** True when the voice that reads the recording goes into the video (the online and the natural voice). */
export const recordsSound = (v: BoardVoice) => v.voice === "natural" || v.voice === "cloud";
