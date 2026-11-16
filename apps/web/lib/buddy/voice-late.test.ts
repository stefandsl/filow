import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OkFilowBridge, OkFilowStatus } from "./bridge";
import { createSpeaker, type ChunkPlayer, type VoiceFallback } from "./voice";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("a natural voice that never replied before the deadline (nothing heard) falls back to the system voice and says why", async () => {
  // The voice built into the PC: records what it is asked to say.
  const spoken: string[] = [];
  const synth = { speaking: false, pending: false, cancel() {}, getVoices: () => [], speak(u: { text: string }) { spoken.push(u.text); } };
  vi.stubGlobal("window", { speechSynthesis: synth });
  vi.stubGlobal("SpeechSynthesisUtterance", class { voice = null; lang = ""; rate = 1; constructor(public text: string) {} });

  // The desktop natural voice: its model is still loading, so speak() has not replied and no piece came.
  const tts = {
    warm: async () => true,
    speak: () => new Promise(() => {}),
    cancel: async () => {},
    played: () => {},
    onChunk: () => () => {},
    onStatus: () => () => {},
  } as unknown as NonNullable<OkFilowBridge["tts"]>;
  const player: ChunkPlayer = { add() {}, remaining: () => 0, played: () => 0, stop() {}, pause() {}, resume() {}, state: () => "running" } as ChunkPlayer;
  const fallbacks: VoiceFallback[] = [];
  const speaker = createSpeaker({
    bridge: () => ({ tts, onMode: () => () => {} }) as unknown as OkFilowBridge,
    status: () => ({ voice: "natural", speed: 1, offline: false, naturalVoice: 3 }) as OkFilowStatus,
    isCurrent: (id) => id === 1,
    uiLang: () => "en",
    onFallback: (r) => fallbacks.push(r),
    player: () => player,
  });

  const done = speaker.speak("Hello.", 1);
  // speechDeadline("Hello.") = 9000 ms, + 8000 ms load allowance: well past it, plus the system voice's turn.
  await vi.advanceTimersByTimeAsync(40000);
  await done;

  expect(spoken).toEqual(["Hello."]);
  expect(fallbacks).toHaveLength(1);
});
