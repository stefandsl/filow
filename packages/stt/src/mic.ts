/**
 * Captures the microphone as 16-bit mono PCM at a chosen sample rate and
 * hands out ~100 ms chunks. Shared by the ElevenLabs and OpenAI backends.
 */

import { openSelectedMic } from "./micDevice";
import { detectSilence, type MicWarning } from "./silence";

/**
 * The PCM chunker AudioWorklet ("pcm-chunker"): a same-origin static file served by the web app
 * (apps/web/public/mic-worklet.js). Not a blob: URL, so the desktop CSP keeps blob: out of script-src
 * (worklet modules follow script-src).
 */
export const MIC_WORKLET_URL = "/mic-worklet.js";

export type MicCapture = {
  stop: () => void;
};

/** Keep the 0.9.6 open/stop probe and fixed-rate capture graph. Only device selection and
 *  passive health diagnostics are added; no device-rate context or resampling. */
export async function preopenMic(onLog?: (line: string) => void): Promise<MediaStream> {
  const stream = await openSelectedMic({}, onLog);
  for (const t of stream.getTracks()) t.stop();
  return stream;
}
export function releasePreopenedMic(): void {}

export async function startMic(
  sampleRate: number,
  onChunk: (pcm16: ArrayBuffer) => void,
  onWarning?: (warning: MicWarning | null) => void,
  onLog?: (line: string) => void,
): Promise<MicCapture> {
  onLog?.("microphone capture: 0.9.6 code path");
  // How long the system took to hand the microphone over: Windows once took 15 s on every open, and
  // nothing in the log said so.
  const askedAt = performance.now();
  const stream = await openSelectedMic({ channelCount: 1, echoCancellation: true, noiseSuppression: true }, onLog);
  onLog?.(`microphone opened in ${Math.round(performance.now() - askedAt)} ms`);
  const track = stream.getAudioTracks()[0];
  const label = track?.label || "";
  let health = { lastAudioAt: performance.now(), silent: false };
  let warning: MicWarning | null = null;
  const report = (next: MicWarning | null) => {
    if (warning?.kind === next?.kind) return;
    warning = next;
    onLog?.(next ? `microphone ${next.kind}: ${label}${next.elapsedMs !== undefined ? ` (${next.elapsedMs} ms)` : ""}` : `microphone audio recovered: ${label}`);
    onWarning?.(next);
  };
  const ended = () => report({ kind: "ended", label });
  track?.addEventListener("ended", ended);
  const level = (peak: number) => {
    health = detectSilence(health, peak, performance.now());
    if (peak > 1e-4) report(null);
    else if (health.silent && warning?.kind !== "ended") report({ kind: "silence", label });
  };
  const timer = setInterval(() => level(0), 250);
  let ctx: AudioContext | undefined;
  let node: AudioWorkletNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let mute: GainNode | undefined;
  const stop = () => {
    clearInterval(timer);
    track?.removeEventListener("ended", ended);
    if (node) { node.port.onmessage = null; node.disconnect(); }
    source?.disconnect();
    mute?.disconnect();
    stream.getTracks().forEach(t => t.stop());
    if (ctx) void ctx.close().catch(() => undefined);
  };
  try {
    const openedAt = performance.now();
    try { ctx = new AudioContext({ sampleRate }); }
    finally {
      const elapsedMs = Math.round(performance.now() - openedAt);
      onLog?.(`microphone AudioContext opened in ${elapsedMs} ms`);
      // A synchronous constructor can block timers. Measure immediately on returning.
      if (elapsedMs > 5000) report({ kind: "slow-context", label, elapsedMs });
    }
    if (track?.readyState === "ended") ended();
    await ctx.audioWorklet.addModule(MIC_WORKLET_URL);

    source = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, "pcm-chunker");
    node.port.onmessage = (ev: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => {
      level(ev.data.peak);
      onChunk(ev.data.pcm);
    };
    source.connect(node);
    // Keep the graph alive without producing audible output.
    mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);

    return { stop };
  } catch (err) { stop(); throw err; }
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
