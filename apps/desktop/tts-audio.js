/** Keep quiet consonants/reverb down to -66 dBFS, then end at zero and pad 80 ms.
 * Padding is audio duration, never a delay before delivering the first buffer. */
function finishAudio(samples, rate, floor = 0.003, span = false) {
  let a = 0;
  while (a < samples.length && Math.abs(samples[a]) < floor) a++;
  if (a === samples.length) return new Float32Array(0);
  let b = samples.length - 1;
  while (b > a && Math.abs(samples[b]) < (span ? floor : 0.0005)) b--;
  const from = Math.max(0, a - Math.round(rate * (span ? 0.005 : 0.02)));
  const end = Math.min(samples.length, b + 1 + Math.round(rate * (span ? 0.005 : 0.02)));
  const out = new Float32Array(end-from + (span ? 0 : Math.round(rate * 0.08)));
  out.set(samples.subarray(from,end));
  if (!span) {
    const fade = Math.min(end-from, Math.round(rate * 0.02));
    for (let i = 0; i < fade; i++) out[end-from-fade+i] *= (fade-i-1)/fade;
  }
  return out;
}
module.exports = { finishAudio };
