// Acceptance gate, deliberately separate from unit tests. Never labels a failed
// comparison as parity. Input is compare-heads.cjs output on identical WAVs.
const fs = require('node:fs');
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: training-parity.cjs comparison.json report.json');
const rows = JSON.parse(fs.readFileSync(input, 'utf8'));
const clips = rows.flatMap(row => row.clips.map(clip => ({voice:row.voice, lang:row.lang, ...clip})));
if (clips.length !== 500 || new Set(clips.map(c => c.stem)).size !== 500) throw Error('Expected 500 distinct clips');
const disagreements = clips.filter(c => c.fired.python !== c.fired.baseline).map(c => ({
  voice:c.voice, lang:c.lang, stem:c.stem, kind:c.kind, keyword:c.spot,
  referenceScore:c.scores.python, appScore:c.scores.baseline,
  referenceDecision:c.fired.python, appDecision:c.fired.baseline,
}));
const counts = key => Object.fromEntries(['enrol','test','near'].map(kind => {
  const subset = clips.filter(c => c.kind === kind);
  return [kind, {total:subset.length, accepted:subset.filter(c => c.fired[key]).length}];
}));
const report = {
  scope:'Per-clip maximum score and Balanced Boolean rule, not chronological live replay; app hard negatives disabled to isolate base training',
  seed:12345, clips:clips.length, agreed:clips.length-disagreements.length,
  agreement:(clips.length-disagreements.length)/clips.length, target:.98,
  pass:disagreements.length <= 10, reference:counts('python'), app:counts('baseline'),
  disagreements,
};
fs.writeFileSync(output, JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,disagreements:disagreements.length}));
if (!report.pass) process.exitCode=1;
