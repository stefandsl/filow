const { profileCombiner } = require('./wake-policy');
function canEnable(result, mode = 'balanced') {
  const row = result?.[mode];
  return row?.total === 5 && row.recognised >= 4 && row.negativeAccepts === 0;
}
// Bare takes cannot demonstrate a prefixed call. Keep the four-of-five gate
// for bare listening and use the prefix spotter with the same personal head
// when only bare recognition failed. A personal negative must still be rejected.
function prefixFallback(profile, mode) {
  const row = profile?.verification?.[mode];
  if (profile?.phrase !== "Filow" || !["balanced", "strict"].includes(mode) ||
      row?.total !== 5 || !Number.isInteger(row.recognised) || row.recognised < 0 || canEnable(profile.verification, mode)) return false;
  return (profile.prefixNegatives?.[mode] ?? row.negativeAccepts) === 0;
}
async function replayEnrolment(detectors, profile, recordings, negatives = []) {
  const result = Object.fromEntries(['strict','balanced','sensitive'].map(mode => [mode,{total:recordings.length,recognised:0,negatives:negatives.length,negativeAccepts:0}]));
  for (const [index, pcm] of [...recordings,...negatives].entries()) {
    await detectors.reset();
    const audio = new Float32Array(16000 + pcm.length + 16000); audio.set(pcm,16000);
    const combiners = Object.fromEntries(Object.keys(result).map(mode => [mode,profileCombiner(profile,mode)]));
    const fired = new Set();
    for (let at=0;at<audio.length;at+=1600) {
      const samples = new Float32Array(1600); samples.set(audio.subarray(at,at+1600));
      const event = await detectors.feed(samples,(at+1600)/16);
      for (const mode of Object.keys(result)) if(combiners[mode].push(event)) fired.add(mode);
    }
    for(const mode of fired) result[mode][index<recordings.length?'recognised':'negativeAccepts']++;
  }
  return result;
}
module.exports = { canEnable, replayEnrolment, prefixFallback };
