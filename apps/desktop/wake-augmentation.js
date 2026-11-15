// Portable float32 augmentation. The Python reference implements these operations
// independently; no recorded noise, speech corpus or Python DSP dependency.
function random(seed = 12345) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function augment(samples, variant, rng) {
  const speed = [0.94, 1, 1.06][variant % 3];
  const gain = [1, 0.6, 0.35][variant % 3];
  const n = Math.ceil(samples.length / speed), audio = new Float32Array(16000 + n + 9600);
  let power = 0;
  for (let i = 0; i < n; i++) {
    const pos = i * speed, left = Math.floor(pos), frac = pos - left;
    const value = gain * ((samples[left] || 0) * (1 - frac) + (samples[left + 1] || 0) * frac);
    audio[16000 + i] = value; power += value * value;
  }
  const noise = Math.sqrt(power / n * 12) / Math.pow(10, [20, 15, 10][variant % 3] / 20);
  if (variant % 4) for (let i = 0; i < audio.length; i++) audio[i] += (rng() - 0.5) * noise;
  if (variant % 4 === 3) {
    const dry = audio.slice();
    for (let i = 640; i < audio.length; i++) audio[i] += .2 * dry[i - 640] + (i >= 1120 ? .1 * dry[i - 1120] : 0);
  }
  return { audio, speed };
}
module.exports = { random, augment };
