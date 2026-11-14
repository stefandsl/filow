// Every mutant is restored in finally, including a timeout or failed runner.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),out=process.argv[2];
if(!out)throw Error('An evidence output path is required');
const policy='apps/desktop/wake-policy.js';
const cases=[
  ['shared mel floor','apps/desktop/wake-head.js','Math.max(mel[i], peak - 8)','mel[i]'],
  ['refresh cached vectors','apps/desktop/wake-head.js','if (changed || !history.length)','if (!history.length)'],
  ['stream frame stride','apps/desktop/wake-head.js','audio = audio.slice(1280);','audio = audio.slice(1600);'],
  ['hard-negative training','apps/desktop/wake-head.js','const useHard = !positive && bg.hard?.length && i % 10 === 1;','const useHard = false;'],
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
for(const [name,file,from,to] of cases){
 const p=path.join(root,file),original=fs.readFileSync(p,'utf8');
 if(!original.includes(from))throw Error('Mutation target missing: '+name);
 try{
  fs.writeFileSync(p,original.replace(from,to));
  const r=spawnSync(process.execPath,[path.join(root,'node_modules/vitest/vitest.mjs'),'run','apps/desktop/wake.test.ts','apps/desktop/wake-head.test.ts','apps/web/lib/buddy/wake.test.ts','packages/stt/src/mic.test.ts'],{cwd:root,encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,FILOW_QA_NO_GLOBAL_INPUT:'1',FILOW_QA_HEADLESS:'1'}});
  const caught=r.status!==0&&!r.error;
  results.push({name,caught,status:r.status});console.log(name,caught?'caught':'SURVIVED');
 }finally{fs.writeFileSync(p,original)}
}
fs.writeFileSync(out,JSON.stringify(results,null,2));
if(results.some(r=>!r.caught))process.exitCode=1;
