import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { waitForTranscript } from "./transcript-tail";
afterEach(() => vi.useRealTimers());
it("hands complete question text on after one IPC turn, not a fixed 200 ms tail", async () => {
  vi.useFakeTimers(); let done = false;
  const waiting = waitForTranscript(() => true, false, () => false).then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(49); expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1); expect(done).toBe(true); await waiting;
});
it("keeps the grace period for late final text and stops at 1500 ms for silence", async () => {
  vi.useFakeTimers(); let text = false, done = false;
  const waiting = waitForTranscript(() => text, false, () => false).then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(200); expect(done).toBe(false);
  text = true; await vi.advanceTimersByTimeAsync(50); await waiting; expect(done).toBe(true);
  done = false;
  const empty = waitForTranscript(() => false, false, () => false).then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(1499); expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await empty; expect(done).toBe(true);
});
it("preserves dictation's immediate text and queued-recording exits", async () => {
  vi.useFakeTimers(); await waitForTranscript(() => true, true, () => false);
  expect(vi.getTimerCount()).toBe(0);
  const p = waitForTranscript(() => false, true, () => true);
  await vi.advanceTimersByTimeAsync(50); await p; expect(vi.getTimerCount()).toBe(0);
});
it("closes audio and awaits recognizer acknowledgement before the tail, then checks session ownership", () => {
  const page = readFileSync(new URL("../../app/okfilow/panel/page.tsx", import.meta.url), "utf8");
  expect(page).toMatch(/stopAudio\(\);\s*try \{ await b.stt.stop\(\);[\s\S]*?await waitForTranscript\([\s\S]*?if \(session.current !== sid\) return/);
});
