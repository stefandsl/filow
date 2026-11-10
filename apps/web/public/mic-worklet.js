// The microphone's AudioWorklet (packages/stt/src/mic.ts loads it with audioWorklet.addModule("/mic-worklet.js")).
// It is a same-origin static file, not a blob: URL, so the desktop CSP (apps/desktop/csp.js) needs no
// blob: in script-src. Cuts the input into ~100 ms chunks of 16-bit mono PCM and posts each with its peak.
// With processorOptions { format: "f32" } (OK Filow's panel, which feeds the on-device recognizer) each
// chunk is posted as the float samples themselves: { samples: ArrayBuffer of Float32, peak }.
class PcmChunker extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.float = Boolean(options && options.processorOptions && options.processorOptions.format === "f32");
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
      if (this.fill === this.chunk && this.float) {
        const out = this.buf.slice();
        let peak = 0;
        for (let j = 0; j < this.chunk; j++) peak = Math.max(peak, Math.abs(out[j]));
        this.port.postMessage({ samples: out.buffer, peak }, [out.buffer]);
        this.fill = 0;
      } else if (this.fill === this.chunk) {
        const out = new Int16Array(this.chunk);
        let peak = 0;
        for (let j = 0; j < this.chunk; j++) {
          const s = Math.max(-1, Math.min(1, this.buf[j]));
          peak = Math.max(peak, Math.abs(s));
          out[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage({ pcm: out.buffer, peak }, [out.buffer]);
        this.fill = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-chunker", PcmChunker);
