import { describe, expect, it, vi } from "vitest";
import { createWakeCapture } from "./wake";
import type { OkFilowBridge } from "./bridge";
describe("wake capture cancellation", () => {
  it("uses an efficient audio scheduling buffer while keeping 16 kHz PCM", async () => {
    const open = vi.fn(async () => ({ stop: vi.fn() }));
    const c = createWakeCapture({} as OkFilowBridge, open);
    await c.set(true);
    expect(open).toHaveBeenCalledWith(16000, expect.any(Function), expect.any(Function), undefined, {latencyHint: "playback"});
    c.stop();
  });
  it("closes a microphone that opens after off", async () => {
    let resolve!: (v: { stop(): void }) => void;
    const open = vi.fn(() => new Promise<{ stop(): void }>((r) => { resolve = r; }));
    const b = { wakeFeed: vi.fn(), wakeAction: vi.fn() } as unknown as OkFilowBridge;
    const c = createWakeCapture(b, open), stop = vi.fn();
    const opening = c.set(true); c.stop(); resolve({ stop }); await opening;
    expect(stop).toHaveBeenCalledOnce(); expect(b.wakeFeed).not.toHaveBeenCalled();
  });
  it("reports the actual open failure and stays closed", async () => {
    const wakeAction = vi.fn();
    const c = createWakeCapture({ wakeAction } as unknown as OkFilowBridge, async () => { throw new Error("Permission denied"); });
    await c.set(true); expect(wakeAction).toHaveBeenCalledWith("error", "Permission denied");
  });
  it("fails closed on a stalled open and closes a later stream", async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (v: { stop(): void }) => void;
      const wakeAction = vi.fn(), stop = vi.fn();
      const c = createWakeCapture({ wakeAction } as unknown as OkFilowBridge, () => new Promise((r) => { resolve = r; }));
      const pending = c.set(true);
      await vi.advanceTimersByTimeAsync(10000);
      expect(wakeAction).toHaveBeenCalledWith("error", expect.stringContaining("did not open"));
      resolve({ stop }); await pending; expect(stop).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
