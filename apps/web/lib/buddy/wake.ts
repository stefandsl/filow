import { startMic } from "@filow/stt";
import type { OkFilowBridge } from "./bridge";
export const WAKE_MIC_OPEN_TIMEOUT_MS = 10000;

/** One worklet stream, saved device honored by startMic -> openSelectedMic.
 * Generation checks close a late open after off, pause, take or unmount. */
export function createWakeCapture(b: OkFilowBridge, open = startMic) {
  let generation = 0, wanted = false;
  let capture: { stop(): void } | null = null;
  let droppedBlocks = 0;
  const buffered: Float32Array[] = [];
  const stop = () => { buffered.length = 0; wanted = false; generation++; capture?.stop(); capture = null; };
  return {
    stop,
    get droppedBlocks() { return droppedBlocks; },
    async set(on: boolean) {
      if (!on) { stop(); return; }
      if (wanted) return;
      wanted = true;
      droppedBlocks = 0;
      const id = ++generation;
      let sending = false;
      const fail = (message: string) => {
        if (id !== generation) return;
        stop();
        void b.wakeAction?.("error", message);
      };
      async function send(first: Float32Array) {
        sending = true;
        try {
          let next: Float32Array | undefined = first;
          while (next && id === generation) {
            await b.wakeFeed?.(next);
            next = id === generation ? buffered.shift() : undefined;
          }
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
        } finally { sending = false; }
      }
      const timeout = setTimeout(() => {
        if (id !== generation) return;
        stop(); void b.wakeAction?.("error", "The selected microphone did not open within 10 seconds");
      }, WAKE_MIC_OPEN_TIMEOUT_MS);
      try {
        const got = await open(16000, (pcm) => {
          if (id !== generation || !wanted) return;
          const data = Float32Array.from(new Int16Array(pcm), (v) => v / 32768);
          if (!sending) void send(data);
          else {
            if (buffered.length === 2) {
              buffered.shift();
              droppedBlocks++;
            }
            buffered.push(data);
          }
        }, (warning) => {
          if (warning?.kind === "ended" && id === generation) { stop(); void b.wakeAction?.("error", "The selected microphone disconnected"); }
        }, undefined, { latencyHint: "playback" });
        if (id !== generation || !wanted) got.stop(); else capture = got;
      } catch (e) {
        if (id !== generation) return;
        stop(); await b.wakeAction?.("error", e instanceof Error ? e.message : String(e));
      } finally { clearTimeout(timeout); }
    },
  };
}
