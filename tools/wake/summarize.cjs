// Persist numerical evidence without WAVs, machine-specific paths or profiles.
const fs=require('node:fs'),path=require('node:path');
const [root,output]=process.argv.slice(2);
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f)));
const before=read('parity-before-final-context.json'),after=read('parity-after.json');
const heads=read('head-comparison.json').flatMap(v=>v.clips.map(c=>({...c,voice:v.voice,lang:v.lang})));
const spotters=read('spotter-parity.json');
const report={
  baseline: '0a21663',
  caveat:'Embedding parity is the final retained context after each clip, not a claim that causal early outputs can see future clip audio. Training/calibration parity is NOT achieved.',
  parity:after.map((r,i)=>({clip:r.stem,voice:r.voice,language:r.lang,kind:r.kind,offline:r.offline,beforeFinalContext:before[i].streaming,afterFinalContext:r.streaming,head:heads.find(h=>h.stem===r.stem),spotter:spotters.find(k=>k.stem===r.stem)})),
  correctedNative:read('round1-native.json'),
  hardNegativeCalibration:read('hard-native.json'),
  heldout:read('heldout-five-native.json'),
  background:read('heldout-five-background.json'),
  cpuBeforeBuffer:read('round1-ui-results.json'),
  cpuAfterBuffer:read('round1-ui-buffered.json'),
  mutations:read('round1-mutations.json'),
  augmentationAblation:read('augmentation-ablation.json'),
};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
