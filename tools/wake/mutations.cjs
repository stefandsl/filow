// Every mutant is restored in finally, including a timeout or failed runner.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),out=process.argv[2];
if(!out)throw Error('An evidence output path is required');
const policy='apps/desktop/wake-policy.js';
const cases=[
  ['training parity acceptance','tools/wake/training-parity.cjs','disagreements.length <= 10','disagreements.length <= 11'],
  ['relative speech-end label','apps/desktop/wake-head.js','energy[f] > peak * 1e-3','energy[f] > 0.01'],
  ['preserve enrolment tail','apps/desktop/wake-augmentation.js','Math.ceil(samples.length / speed)','Math.ceil(samples.length / speed) - 320'],
  ['speech-end window offset','apps/desktop/wake-head.js','end / speed / 16000 + dt','n / 16000 + dt'],
  ['shared mel floor','apps/desktop/wake-head.js','Math.max(mel[i], peak - 8)','mel[i]'],
  ['refresh cached vectors','apps/desktop/wake-head.js','if (changed || !history.length)','if (!history.length)'],
  ['stream frame stride','apps/desktop/wake-head.js','audio = audio.slice(1280);','audio = audio.slice(1600);'],
  ['hard-negative training','apps/desktop/wake-head.js','const useHard = !positive && bg.hard?.length && hardRate > 0 && i % (2 * Math.round(1 / hardRate)) === 1;','const useHard = false;'],
  ['portable noise SNR','apps/desktop/wake-augmentation.js','[20, 15, 10][variant % 3]','[30, 25, 20][variant % 3]'],
  ['portable reverb','apps/desktop/wake-augmentation.js','.2 * dry[i - 640]','.3 * dry[i - 640]'],
  ['portable RNG','apps/desktop/wake-augmentation.js','1664525','1664527'],
  ['personal negative windows','apps/desktop/wake-head.js','if(personal.length) bg =','if(false) bg ='],
  ['enrolment minimum','apps/desktop/wake-enrolment.js','row.recognised >= 4','row.recognised >= 3'],
  ['enrolment negative rejection','apps/desktop/wake-enrolment.js','row.negativeAccepts === 0','true'],
  ['enrolment reset','apps/desktop/wake-enrolment.js','await detectors.reset();','void detectors;'],
  ['enrolment enable guard','apps/desktop/wake.js','if (!canEnable(saved.verification, sensitivity(mode)))','if (false)'],
  ['combined detector response','apps/desktop/wake.js','return b.call({ type: "feed", samples, at });','return { at, score: -Infinity };'],
  ['hard-negative checksum','apps/desktop/wake-head.js','crypto.createHash("sha256").update(hardBytes).digest("hex") !== hardMeta.sha256','false'],
  ['wake scheduling buffer','apps/web/lib/buddy/wake.ts','latencyHint: "playback"','latencyHint: "interactive"'],
  ['audio scheduling option','packages/stt/src/mic.ts','{ latencyHint: options.latencyHint }','{}'],
  ['off by default',policy,'enabled: false','enabled: true'],
  ['one thread',policy,'threads: 1','threads: 2'],
  ['KWS native thread','apps/desktop/wake-worker.js','numThreads: 1','numThreads: 2'],
  ['embedding native thread','apps/desktop/wake-head.js','intraOpNumThreads: 1','intraOpNumThreads: 2'],
  ['five recordings',policy,'recordings: 5','recordings: 3'],
  ['no bundled models',policy,'bundleModels: false','bundleModels: true'],
  ['keep recordings',policy,'retainRecordings: true','retainRecordings: false'],
  ['no follow-up',policy,'followUpMs: 0','followUpMs: 1000'],
  ['no interruption',policy,'interruptSpeech: false','interruptSpeech: true'],
  ['strict agreement',policy,'return kws === true && score > thresholds.loose','return score > thresholds.loose'],
  ['sensitive head',policy,'return score > thresholds.sensitive','return kws === true && score > thresholds.sensitive'],
  ['balanced sure',policy,'return score > thresholds.sure ||','return false ||'],
  ...['off','models','enrol','take','slideshow','eye','paused','locked','busy','speech','indicator'].map(r=>['block '+r,policy,`return "${r}";`,`return "";`]),
  ['short recording',policy,'samples.length < 8000','samples.length < 0'],
  ['quiet recording',policy,'return "quiet";','return "";'],
  ['clipped recording',policy,'return "clipped";','return "";'],
  ['hash verification','apps/desktop/wake-models.js','await sha256File(file) !== entry.sha256','false'],
  ['download opt-in','apps/desktop/wake-models.js','!enabled || !consent','!consent'],
  ['download consent','apps/desktop/wake-models.js','!enabled || !consent','!enabled'],
  ['indicator clickable','apps/desktop/okfilow-stop.js','pill.hears === true','pill.hears === false'],
  ['no network listening','apps/desktop/wake.js','async function feed(samples) {','async function feed(samples) { require("node:https").get("https://example.invalid");'],
  ['delete recordings','apps/desktop/wake.js','fs.rmSync(root, { recursive: true, force: true });','void root;'],
  ['stale inference after pause','apps/desktop/wake.js','captureToken !== captureEpoch ||',''],
];
const results=[];
for(const [name,file,from,to] of cases.filter(c=>!process.env.FILOW_WAKE_MUTATION_FILTER || c[0].includes(process.env.FILOW_WAKE_MUTATION_FILTER))){
 const p=path.join(root,file),original=fs.readFileSync(p,'utf8');
 if(!original.includes(from))throw Error('Mutation target missing: '+name);
 try{
  fs.writeFileSync(p,original.replace(from,to));
  const r=spawnSync(process.execPath,[path.join(root,'node_modules/vitest/vitest.mjs'),'run','apps/desktop/wake.test.ts','apps/desktop/wake-head.test.ts','apps/desktop/wake-enrolment.test.ts','apps/desktop/wake-augmentation.test.ts','apps/web/lib/buddy/wake.test.ts','packages/stt/src/mic.test.ts','tools/wake/training-parity.test.ts','--maxWorkers=2'],{cwd:root,encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,FILOW_QA_NO_GLOBAL_INPUT:'1',FILOW_QA_HEADLESS:'1'}});
  const caught=r.status!==0&&!r.error;
  results.push({name,caught,status:r.status});console.log(name,caught?'caught':'SURVIVED');
 }finally{fs.writeFileSync(p,original)}
}
fs.writeFileSync(out,JSON.stringify(results,null,2));
if(results.some(r=>!r.caught))process.exitCode=1;
