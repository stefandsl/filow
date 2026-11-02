/**
 * Captures the microphone as 16-bit mono PCM at a chosen sample rate and hands out ~100 ms chunks.
 * The audio context runs at the device's own rate and the worklet resamples: asking Windows for a
 * 16 kHz context on a USB microphone (native 48 kHz) blocked the whole app for 14 s on the owner's PC.
 */

const WORKLET_SOURCE = `
class PcmChunker extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.target = (options.processorOptions && options.processorOptions.targetRate) || sampleRate;
    this.ratio = sampleRate / this.target;
    this.pos = 0; // read position in the input, in input samples, carried across blocks
    this.last = 0; // previous input sample, for interpolation across block boundaries
    this.chunk = Math.round(this.target * 0.1);
    this.buf = new Float32Array(this.chunk);
    this.fill = 0;
  }
  push(v) {
    this.buf[this.fill++] = v;
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
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    if (this.ratio === 1) {
      for (let i = 0; i < ch.length; i++) this.push(ch[i]);
      return true;
    }
    // linear interpolation between consecutive input samples; pos is relative to index -1 = this.last
    let pos = this.pos;
    while (pos < ch.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const a = i < 0 ? this.last : ch[i];
      const b = i + 1 < ch.length ? ch[i + 1] : ch[ch.length - 1];
      this.push(a + (b - a) * frac);
      pos += this.ratio;
    }
    this.pos = pos - ch.length;
    this.last = ch[ch.length - 1];
    return true;
  }
}
registerProcessor("pcm-chunker", PcmChunker);
`;

export type MicCapture = {
  stop: () => void;
};

const NO_AUDIO_MS = 4000;
const OPEN_MS = 10000;
const STEP_MS = 5000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} did not finish in ${ms / 1000} s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

let preopened: MediaStream | null = null;

/**
 * Opens the microphone once, ahead of the take (the "checking the microphone" probe), and keeps the
 * stream for the capture that follows. Opening the device a second time right after closing it hung
 * forever on a Windows PC (the take sat in "Starting"), so the probe and the capture now share one open.
 */
export async function preopenMic(): Promise<MediaStream> {
  releasePreopenedMic();
  const stream = await withTimeout(
    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).catch(() =>
      navigator.mediaDevices.getUserMedia({ audio: true }),
    ),
    OPEN_MS,
    "opening the microphone",
  );
  preopened = stream;
  return stream;
}

export function releasePreopenedMic(): void {
  if (!preopened) return;
  for (const t of preopened.getTracks()) t.stop();
  preopened = null;
}

function takePreopened(): MediaStream | null {
  const s = preopened;
  preopened = null;
  if (s && s.getAudioTracks().some((t) => t.readyState === "live")) return s;
  if (s) for (const t of s.getTracks()) t.stop();
  return null;
}

/**
 * `onNoAudio` fires once if no PCM chunk arrives within 4 s of starting: a suspended audio context
 * (autoplay policy, a start that took too long after the click), a muted or busy device. Without
 * it the take looked "live" while nothing was being sent.
 */
export async function startMic(
  sampleRate: number,
  onChunk: (pcm16: ArrayBuffer) => void,
  onNoAudio?: (detail: string) => void,
  onLog?: (line: string) => void,
): Promise<MicCapture> {
  const t0 = Date.now();
  const reused = takePreopened();
  const stream = reused ?? (await preopenMic().then(takePreopened))!;
  const ctx = new AudioContext(); // device rate; the worklet resamples to sampleRate
  if (ctx.state !== "running") await withTimeout(ctx.resume(), STEP_MS, "starting the audio context").catch((e: Error) => onLog?.(e.message));
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
  try {
    await withTimeout(ctx.audioWorklet.addModule(url), STEP_MS, "loading the audio worklet");
  } catch (err) {
    for (const t of stream.getTracks()) t.stop();
    void ctx.close();
    throw err;
  }
  URL.revokeObjectURL(url);
  const track = stream.getAudioTracks()[0];
  onLog?.(`microphone: ${track?.label || "default"}${reused ? " (kept from the check)" : ""} in ${Date.now() - t0} ms, audio context ${ctx.state}, ${ctx.sampleRate} Hz → ${sampleRate} Hz`);

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-chunker", { processorOptions: { targetRate: sampleRate } });
  let got = false;
  let watchdog: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    watchdog = null;
    if (got) return;
    onNoAudio?.(`no audio from the microphone in ${NO_AUDIO_MS / 1000} s (audio context ${ctx.state}, track ${track?.readyState ?? "none"}${track?.muted ? ", muted" : ""})`);
  }, NO_AUDIO_MS);
  node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
    if (!got) {
      got = true;
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
    }
    onChunk(ev.data);
  };
  source.connect(node);
  // Keep the graph alive without producing audible output.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);

  return {
    stop() {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
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
