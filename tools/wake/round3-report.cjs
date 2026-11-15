const fs=require('node:fs'),path=require('node:path');
const root='G:/FILOW/tmp/wake-word/round3',read=name=>JSON.parse(fs.readFileSync(path.join(root,name)));
const parity=read('parity.json'),app=read('voice-0/app-stages.json'),reference=read('voice-0/stage-reference.json');
const stages=Array.from({length:20},(_,i)=>read(`voice-${i}/stage-reference.json`));
const oldApp=read('original-app-a.json'),oldSpike=read('original-spike-a.json');
const counts=kind=>{const r=parity.results.filter(x=>x.kind===kind);return {total:r.length,appAccepted:r.filter(x=>x.app.fired).length,referenceAccepted:r.filter(x=>x.reference.fired).length};};
const report={
 reference:'Changed portable reference: deterministic generated augmentation, app SGD, quantized bundled CC0 negatives and separate bundled calibration partition. NOT the original sklearn/spike operating point.',
 scope:'500 cached common evaluation embedding sequences and keyword decisions; independently generated training audio, embeddings, labels, optimizer and thresholds in JS and Python. Chronological held-out replay reported separately.',
 originalFirstDivergence:{stage:'a: augmented audio',seed:12345,appCount:oldApp.length,spikeCount:oldSpike.length,durationDifferences:oldApp.filter((r,i)=>r.samples!==oldSpike[i].samples).length,checksumDifferences:oldApp.filter((r,i)=>r.sha256!==oldSpike[i].sha256).length,app:oldApp,spike:oldSpike},
 stages:{seed:12345,voice:app.voice,clips:app.rows,negative:app.negative,positiveWindows:app.windows,windowFrames:12,embeddingHopMs:80,positiveOffsetsSeconds:[.08,.16,.24,.32],appOptimizer:app.trace.map(({weights:_weights,...row})=>row),reference,maximumEmbeddingError:Math.max(...stages.flatMap(s=>s.rows.map(r=>r.embeddingMaxError))),maximumFinalWeightError:Math.max(...stages.map(s=>s.trace[2].weightMaxError))},
 parity:{clips:parity.clips,agreed:parity.agreed,agreement:parity.agreed/parity.clips,enrol:counts('enrol'),test:counts('test'),near:counts('near'),disagreements:parity.results.filter(r=>r.app.fired!==r.reference.fired)},
 curve:read('curve.json'),selectedHardNegativeRate:.2,
 heldout:read('heldout/results.json'),background:read('background.json'),
 cpu:{before:read('cpu-before.json'),after:read('cpu-after.json'),durationSeconds:60,host:'Intel Core i9-13900KF',limitation:'Chromium capture still lives in renderer/audio service; 100 ms IPC remains. Capture and both detectors are not in a single worker. No under-4-percent claim.'},
 mutations:read('mutations.json')
};
fs.writeFileSync(path.resolve('docs/okfilow/wake-round3-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({parity:report.parity,maxEmbeddingError:report.stages.maximumEmbeddingError,maxWeightError:report.stages.maximumFinalWeightError}));
