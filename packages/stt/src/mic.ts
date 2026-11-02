/**
 * Captures the microphone as 16-bit mono PCM at a chosen sample rate and
 * hands out ~100 ms chunks. Shared by the ElevenLabs and OpenAI backends.
 */

const WORKLET_SOURCE = `
class PcmChunker extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = Math.round(sampleRate * 0.1);
    this.buf = new Float32Array(this.chunk);
    this.fill = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const n = Math.min(ch.length - i, this.chunk - this.fill);
      this.buf.set(ch.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === this.chunk) {
        const out = new Int16Array(this.chunk);
        for (let j = 0; j < this.chunk; j++) {
          const s = Math.max(-1, Math.min(1, this.buf[j]));
          out[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(out.buffer, [out.buffer]);
        this.fill = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-chunker", PcmChunker);
`;

export type MicCapture = {
  stop: () => void;
};

/** Rolled back to the 0.9.6 capture at the owner's request (2026-11-02): the 0.9.7–0.9.12 changes
 *  (kept probe stream, timeouts, device-rate context, level/track diagnostics) did not fix the
 *  "track ended" on their PC. The extra parameters stay so the backends compile; they do nothing. */
export async function preopenMic(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const t of stream.getTracks()) t.stop();
  return stream;
}
export function releasePreopenedMic(): void {}

export async function startMic(
  sampleRate: number,
  onChunk: (pcm16: ArrayBuffer) => void,
  _onNoAudio?: (detail: string) => void,
  onLog?: (line: string) => void,
): Promise<MicCapture> {
  onLog?.("microphone capture: 0.9.6 code path");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext({ sampleRate });
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-chunker");
  node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => onChunk(ev.data);
  source.connect(node);
  // Keep the graph alive without producing audible output.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);

  return {
    stop() {
      node.port.onmessage = null;
      node.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
