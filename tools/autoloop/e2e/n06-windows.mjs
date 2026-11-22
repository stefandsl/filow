/* global window, document, innerHeight, innerWidth, requestAnimationFrame, AudioContext */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import os from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { privatePath } from "./n06-eval.mjs";
import { portsFor, wavInfo } from "./n05-windows.mjs";
import { spawnTestApp } from "./test-launch.cjs";
import { PAST_ONBOARDING } from "./profile.mjs";

const timeout = 60000;
const exec = promisify(execFile);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const quantile = (values, p) => values.length ? [...values].sort((a,b) => a-b)[Math.ceil(values.length*p)-1] : null;

export function observation(r) {
  const stages = r.events.filter(e => e.id === r.id && Number.isFinite(e.at));
  const at = name => stages.filter(e => e.stage === name);
  const word = at("lastWord")[0]?.at;
  const deadline = word + timeout;
  const paint = surface => at(surface).filter(e => e.row === r.target && e.at >= word && e.at <= deadline);
  const desktop = paint("desktop"), phone = paint("phone");
  const first = list => list.find(e => ["active","done"].includes(e.state))?.at;
  const done = list => list.find(e => e.state === "done")?.at;
  const missing = ["lastWord","endpoint","partial","final","queueEntry","queueExit","inferenceStart","inferenceEnd","desktop","phone"].filter(k => !at(k).length);
  const batch = at("queueExit").find(e => e.ids?.includes(r.target));
  const inference = at("inferenceStart").find(e => e.ids?.includes(r.target) && batch && e.at >= batch.at);
  const finished = inference && at("inferenceEnd").some(e => e.call === inference.call && e.at >= inference.at && e.at <= Math.max(done(desktop),done(phone)));
  const visible = [first(desktop),first(phone),done(desktop),done(phone)].every(Number.isFinite);
  const aligned = [r.clocks?.desktop,r.clocks?.phone].every(c => Number.isFinite(c?.offset) && Number.isFinite(c?.rtt));
  const otherTick = [...desktop,...phone].some(e => e.doneIds?.some(id => id !== r.target && r.initialRows?.includes(id)));
  const eligible = !otherTick && !missing.length && visible && aligned && finished && r.initialRows?.indexOf(r.target) >= 4;
  return { timed: Boolean(eligible), missing, backend: r.backend ?? "unknown",
    firstMs: eligible ? Math.min(first(desktop),first(phone))-word : null,
    completeMs: eligible ? Math.max(done(desktop),done(phone))-word : null,
    timeout: Boolean(r.timedOut), batches: at("queueExit").map(e => e.ids) };
}
export function aggregate(receipts) {
  assert.equal(new Set(receipts.map(r => r.id)).size, receipts.length, "Duplicate trace");
  const buckets = new Map();
  for (const r of receipts) {
    const key = [r.sha,r.tier,r.temperature,r.source,r.phoneType,r.route,r.gate].join("/");
    const bucket = buckets.get(key) ?? [];
    bucket.push({ ...observation(r), ram:r.peakRam, vram:r.peakVram });
    buckets.set(key,bucket);
  }
  return [...buckets].map(([key,rows]) => {
    const timed = rows.filter(r => r.timed);
    const distribution = field => [0.5,0.95].map(p => quantile(timed.map(r => r[field]),p));
    const peak = key => rows.every(r => Number.isFinite(r[key])) ? Math.max(...rows.map(r => r[key])) : null;
    return { key, attempts:rows.length, timed:timed.length, misses:rows.length-timed.length, timeouts:rows.filter(r=>r.timeout).length,
      firstMs:distribution("firstMs"), completeMs:distribution("completeMs"), peakRam:peak("ram"), peakVram:peak("vram") };
  });
}
async function until(get, ms) {
  const end = Date.now()+ms;
  do { const value = await get(); if (value) return value; await sleep(150); } while (Date.now()<end);
  throw Error("Required observation timed out");
}
async function digest(file) {
  const h = createHash("sha512");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
async function clock(page) {
  let best;
  for (let i=0; i<7; i++) {
    const t=Date.now(), remote=await page.evaluate("Date.now()"), end=Date.now(), rtt=end-t;
    if (!best || rtt<best.rtt) best={ rtt, offset:(t+end)/2-remote };
  }
  return best;
}

// Installed in each inspected renderer. Observe the first painted row after each DOM change.
function installPaint(id, target, surface) {
  const log = window.n06Events = [];
  const record = (stage, data = {}) => log.push({id, stage, at:Date.now(), ...data});
  const rows = () => [...document.querySelectorAll("[data-point-id]")].filter(e => e.getClientRects().length);
  window.n06Rows = () => rows().filter(e => e.dataset.state !== "done").map(e => e.dataset.pointId);
  let last, painted;
  function frame() {
    const el=rows().find(e => e.dataset.pointId === target);
    const rect=el?.getBoundingClientRect();
    const state=rect && rect.bottom>0 && rect.right>0 && rect.top<innerHeight && rect.left<innerWidth ? el.dataset.state : null;
    // A second animation frame observes the state after a rendering opportunity.
    if (state && state===last && state!==painted) {
      record(surface,{row:target,state,doneIds:rows().filter(r=>r.dataset.state==="done").map(r=>r.dataset.pointId)});
      painted=state;
    }
    if (!state) painted=null;
    last=state;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (surface==="desktop") {
    window.filowDecisionTrace = (stage, ids, route, gate, call) => record(stage,{ids,route,gate,call});
    window.filow.stt.onResult(r => {
      const t=r.trace;
      if (t?.id!==id) return;
      if (Number.isFinite(t.endpointAt)) record("endpoint",{at:t.endpointAt});
      if (r.partial || r.committed) record(r.committed?"final":"partial",{at:t.at,backend:t.backend});
    });
  }
}

function installMic(source, expectedDevice) {
  const actual=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const ctx=new AudioContext({sampleRate:16000});
  let live;
  navigator.mediaDevices.getUserMedia=async constraints => {
    if (!constraints.audio || constraints.video) return actual(constraints);
    if (live?.readyState==="live") throw Error("Second capture producer");
    await ctx.resume();
    const dest=ctx.createMediaStreamDestination();
    const stream=source==="pcm" ? dest.stream : await actual(constraints);
    live=stream.getAudioTracks()[0];
    window.n06Device=live.label;
    if (source==="bluetooth" && (!expectedDevice || live.label!==expectedDevice)) { live.stop(); throw Error("Unexpected physical microphone"); }
    if (source==="pcm") window.n06Play=(base64,lastSample) => {
      const bytes=Uint8Array.from(atob(base64), c=>c.charCodeAt(0)), view=new DataView(bytes.buffer);
      const buffer=ctx.createBuffer(1,bytes.length/2,16000), out=buffer.getChannelData(0);
      for(let i=0;i<out.length;i++) out[i]=view.getInt16(i*2,true)/32768;
      const node=ctx.createBufferSource();
      node.buffer=buffer; node.connect(dest);
      const when=ctx.currentTime+0.1, aligned=Date.now()+(when-ctx.currentTime)*1000;
      node.start(when);
      return aligned+lastSample/16;
    };
    window.n06Mic=()=>live.readyState==="live" && ctx.state==="running";
    return stream;
  };
}

async function endpoint(port, url) {
  const { connect }=await import("../../whiteboard/qa-dev.mjs");
  const target=await until(async () => {
    try { return (await (await fetch("http://127.0.0.1:"+port+"/json/list",{redirect:"error",signal:AbortSignal.timeout(1000)})).json())
      .find(t=>t.type==="page" && url(new URL(t.url))); } catch { return null; }
  },120000);
  assert.equal(new URL(target.webSocketDebuggerUrl).origin,"ws://127.0.0.1:"+port);
  return connect(target);
}

async function resources(pid) {
  // Count simultaneous private bytes across the app tree. WDDM dedicated usage is optional.
  const command="$p=@(Get-CimInstance Win32_Process); $ids=@("+pid+"); do {$new=@($p | Where-Object {$ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId} | ForEach-Object {[int]$_.ProcessId}); $ids+= $new} while($new.Count); "+
    "$ram=($p | Where-Object {$ids -contains [int]$_.ProcessId} | Measure-Object PrivatePageCount -Sum).Sum; "+
    "$gpu=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -ErrorAction SilentlyContinue | Where-Object {$_.Name -match '^pid_(\\d+)_' -and $ids -contains [int]$Matches[1]}); "+
    "@{ram=$ram;vram=$(if($gpu.Count){($gpu | Measure-Object DedicatedUsage -Sum).Sum})}|ConvertTo-Json -Compress";
  const {stdout}=await exec("powershell.exe",["-NoProfile","-NonInteractive","-Command",command],{windowsHide:true,timeout:8000});
  return JSON.parse(stdout);
}

export async function capture(spec, output) {
  assert.equal(process.platform,"win32");
  const free=fs.statfsSync("C:/",{bigint:true});
  assert.ok(free.bavail*free.bsize >= 20n*1024n**3n,"C: below disk floor");
  const root=privatePath(spec.root), exe=privatePath(spec.exe), asar=path.join(path.dirname(exe),"resources","app.asar");
  assert.ok(/^G:/i.test(root) && path.relative(root,exe).split(path.sep)[0]!==".." && !path.isAbsolute(path.relative(root,exe)));
  assert.match(spec.sha,/^[0-9a-f]{40}$/);
  assert.ok(["pcm","bluetooth"].includes(spec.source) && ["physical","surrogate"].includes(spec.phoneType));
  assert.ok(["cold","warm"].includes(spec.temperature) && spec.tier && spec.target);
  const [web,relay,debug,ollama]=portsFor(spec.ports);
  const others=[spec.phoneDebug,spec.https];
  assert.ok(others.every(p=>Number.isInteger(p) && p>=1024 && p<=65535 && ![4747,4748,11434].includes(p)));
  assert.equal(new Set([...spec.ports,...others]).size,6);
  for (const port of [...spec.ports,spec.https]) {
    const s=net.createServer();
    await new Promise((ok,bad)=>s.once("error",bad).listen(port,"127.0.0.1",ok));
    await new Promise(ok=>s.close(ok));
  }
  const { extractFile }=await import("@electron/asar");
  const pkg=JSON.parse(extractFile(asar,"package.json"));
  assert.ok(pkg.filowQa===true && pkg.sourceSha===spec.sha);
  assert.equal(await digest(asar),spec.asarSha512);
  assert.equal(await digest(exe),spec.exeSha512);
  const clip=spec.source==="pcm" ? wavInfo(fs.readFileSync(privatePath(spec.wav))) : null;
  if (clip) assert.ok(clip.sha256===spec.wavSha256 && Number.isInteger(spec.lastWordSample) && spec.lastWordSample>0 && spec.lastWordSample<=clip.samples);
  const id=randomUUID(), run=path.join(root,id), profile=path.join(run,"profile");
  fs.mkdirSync(run); fs.mkdirSync(profile);
  const home=path.join(run,"home"), temp=path.join(run,"temp"), local=path.join(home,"AppData/Local"), roaming=path.join(home,"AppData/Roaming");
  for (const d of [temp,local,roaming,path.join(home,"Desktop"),path.join(home,"Documents")]) fs.mkdirSync(d,{recursive:true});
  if (spec.speechModels) fs.cpSync(privatePath(spec.speechModels),path.join(profile,"models"),{recursive:true});
  fs.writeFileSync(path.join(profile,"settings.json"),JSON.stringify({...PAST_ONBOARDING,remoteShare:false}));
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(path|systemroot|windir|comspec|systemdrive|computername|pathext|number_of_processors|processor_architecture)$/i.test(k)));
  Object.assign(env,{HOME:home,USERPROFILE:home,TEMP:temp,TMP:temp,APPDATA:roaming,LOCALAPPDATA:local,
    FILOW_QA_TRACE_ID:id,FILOW_PORT:String(web),FILOW_SESSION_PORT:String(relay),FILOW_HTTPS_PORT:String(spec.https),
    FILOW_OFFLINE:"1",FILOW_QA_NO_GLOBAL_INPUT:"1",FILOW_USER_DATA_DIR:profile,OLLAMA_URL:"http://127.0.0.1:"+ollama,
    OLLAMA_MODELS:spec.ollamaModels ? privatePath(spec.ollamaModels) : path.join(run,"ollama")});
  const rec={id,sha:spec.sha,asarSha512:spec.asarSha512,exeSha512:spec.exeSha512,os:os.release(),tier:spec.tier,
    temperature:spec.temperature,source:spec.source,phoneType:spec.phoneType,target:spec.target,start:new Date().toISOString(),events:[],peakRam:null,peakVram:null};
  const fd=fs.openSync(output,"wx");
  let child,desktop,phone;
  try {
    child=spawnTestApp(exe,["--remote-debugging-port="+debug,"--remote-debugging-address=127.0.0.1"],{env,stdio:"ignore"});
    await new Promise((ok,bad)=>child.once("spawn",ok).once("error",bad));
    await until(()=> {
      const ids=execFileSync("powershell.exe",["-NoProfile","-Command","@(Get-NetTCPConnection -State Listen -LocalPort "+[web,relay,debug].join(",")+" -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess) | ConvertTo-Json -Compress"],{encoding:"utf8",windowsHide:true}).trim();
      if (!ids) return false;
      const listeners=[JSON.parse(ids)].flat();
      assert.ok(listeners.every(l=>l.OwningProcess===child.pid),"Foreign listener");
      return new Set(listeners.map(l=>l.LocalPort)).size===3;
    },90000);
    desktop=await endpoint(debug,u=>u.origin==="http://127.0.0.1:"+web && u.pathname==="/");
    const invoke=(fn,...args)=>"("+fn.toString()+")("+args.map(a=>JSON.stringify(a)).join(",")+")";
    await desktop.evaluate(invoke(installMic,spec.source,spec.device??""));
    console.error("Open the trial deck, pair the phone, then start the local microphone. Target must be open beyond the first four rows.");
    phone=await endpoint(spec.phoneDebug,u=>u.origin===spec.phoneOrigin && u.pathname==="/mirror");
    for (const [page,name] of [[desktop,"desktop"],[phone,"phone"]]) await page.evaluate(invoke(installPaint,id,spec.target,name));
    await until(async()=>await desktop.evaluate("window.n06Mic?.() && window.n06Rows().length>4") && await phone.evaluate("window.n06Rows().length>4"),180000);
    rec.initialRows=await desktop.evaluate("window.n06Rows()");
    assert.ok(rec.initialRows.indexOf(spec.target)>=4);
    assert.deepEqual(await phone.evaluate("window.n06Rows()"),rec.initialRows);
    rec.device=await desktop.evaluate("window.n06Device");
    rec.phoneDevice=await phone.evaluate("navigator.userAgent");
    rec.cpu=os.cpus()[0]?.model; rec.ramInstalled=os.totalmem();
    rec.clocks={desktop:await clock(desktop),phone:await clock(phone)};
    await desktop.evaluate("window.n06Events.length=0"); await phone.evaluate("window.n06Events.length=0");
    let word;
    if (clip) word=await desktop.evaluate("window.n06Play("+JSON.stringify(clip.data.toString("base64"))+","+spec.lastWordSample+")")+rec.clocks.desktop.offset;
    else console.error("Speak once. Record last-word time against the aligned host clock in the independent audio annotation.");
    const deadline=(word??Date.now())+timeout;
    while (Date.now()<deadline) {
      const [d,p,m]=await Promise.all([desktop.evaluate("window.n06Events"),phone.evaluate("window.n06Events"),resources(child.pid).catch(()=>null)]);
      rec.events=[...d.map(e=>({...e,at:e.at+rec.clocks.desktop.offset})),...p.map(e=>({...e,at:e.at+rec.clocks.phone.offset}))];
      if (word!==undefined) rec.events.push({id,stage:"lastWord",at:word});
      for(const [field,value] of [["peakRam",m?.ram],["peakVram",m?.vram]]) if(Number.isFinite(value)) rec[field]=Math.max(rec[field]??0,value);
      if ([d,p].every(events=>events.some(e=>e.row===spec.target && e.state==="done"))) break;
      await sleep(200);
    }
    rec.timedOut=!["desktop","phone"].every(s=>rec.events.some(e=>e.stage===s && e.row===spec.target && e.state==="done"));
    const inference=rec.events.find(e=>e.stage==="inferenceStart");
    rec.route=inference?.route; rec.gate=inference?.gate;
    rec.backend=rec.events.find(e=>e.backend)?.backend;
  } finally {
    desktop?.close(); phone?.close(); child?.kill();
    rec.end=new Date().toISOString();
    try { fs.writeFileSync(fd,JSON.stringify(rec)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  const [verb,...args]=process.argv.slice(2);
  const [spec,out,resultFile]=args.map(privatePath);
  if(verb==="capture") await capture(read(spec),out);
  else if (verb==="annotate") {
    const receipt=read(spec), note=read(out);
    assert.ok(receipt.source==="bluetooth" && !receipt.events.some(e=>e.stage==="lastWord"));
    assert.equal(note.id,receipt.id);
    const clip=wavInfo(fs.readFileSync(privatePath(note.wav)));
    assert.ok(clip.sha256===note.wavSha256 && Number.isInteger(note.lastWordSample) && note.lastWordSample>0 && note.lastWordSample<=clip.samples);
    const at=note.hostAlignedRecordingStart+note.lastWordSample/16;
    assert.ok(at>=Date.parse(receipt.start) && at<=Date.parse(receipt.end) && Number.isFinite(note.alignmentErrorMs) && note.alignmentErrorMs>=0);
    receipt.events.push({id:receipt.id,stage:"lastWord",at});
    receipt.annotation={sha256:clip.sha256,lastWordSample:note.lastWordSample,alignmentErrorMs:note.alignmentErrorMs};
    fs.writeFileSync(resultFile,JSON.stringify(receipt),{flag:"wx"});
  }
  else { assert.equal(verb,"score"); console.log(JSON.stringify(aggregate(read(spec)),null,2)); }
}
