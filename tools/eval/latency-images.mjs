// Three-size screen experiment, reusing the latency harness's isolation and idle rules.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export async function measureImages(h) {
  const { ROOT, WORK, SCREENS, tier, say } = h;
  const dir = path.join(WORK, "phase2b-images");
  fs.mkdirSync(dir, { recursive: true });
  const { build } = await import("esbuild");
  const bundle = path.join(dir, "helpers.cjs");
  await build({ stdin: { contents: 'export * from "./apps/web/lib/buddy/prompt"; export * from "./apps/web/lib/buddy/ground"; export * from "./apps/desktop/prompt-date";', resolveDir: ROOT }, bundle: true, platform: "node", format: "cjs", outfile: bundle });
  const { buddySystemPrompt, withScreenNote, namedInQuestion, screenHint, withNamedPoint, withPlacedTags, parseBuddyAnswer, withLocalDate } = require(bundle);
  const electron = require("electron");
  const resize = path.join(dir, "resize.cjs");
  fs.writeFileSync(resize, `const {app,nativeImage}=require('electron'); const fs=require('fs'); app.setPath('userData',${JSON.stringify(path.join(dir,'profile'))}); app.whenReady().then(()=>{for(let n=1;n<=40;n++){const id=String(n).padStart(3,'0');const image=nativeImage.createFromPath(${JSON.stringify(SCREENS)}+'/'+id+'.png');for(const w of [1024,768,512])fs.writeFileSync(${JSON.stringify(dir)}+'/'+id+'-'+w+'.jpg',image.resize({width:w,quality:'good'}).toJPEG(72));}app.quit();});`);
  execFileSync(electron, [resize], { windowsHide: true, timeout: 60000, stdio: "pipe" });
  const ollamaPid = await h.serve(tier);
  await h.assertOnlyTierModels(tier);
  const cpuFile = path.join(dir, `cpu-${Date.now()}.jsonl`);
  const sampler = h.startCpuSampler(cpuFile);
  const ctx = { tier, ollamaPid, cpuFile, sampler, run: { pid: process.pid } };
  const questions = JSON.parse(fs.readFileSync(path.join(ROOT,"tools/eval/latency-questions.json"))).questions;
  const file = path.join(dir,"results.json");
  const rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
  const one = async function* (s) { yield s; };
  const collect = async (s) => { let text=""; for await(const part of s) text+=part; return text; };
  try {
    // Rotate order per screen. Keep a common instruction prefix and vary actual dimensions.
    for(let n=1;n<=40;n++) for(const w of [1024,768,512].slice((n-1)%3).concat([1024,768,512].slice(0,(n-1)%3))) {
      if(rows.some(r=>r.screen===n && r.width===w && r.valid)) continue;
      await h.waitForQuiet(ctx);
      const id=String(n).padStart(3,'0'), q=questions[(n-1)%questions.length];
      const elements=JSON.parse(fs.readFileSync(path.join(SCREENS,id+'.json'))).elements;
      const target=elements.find(e=>e.name===q.element);
      if(!target) throw new Error('fixture target absent');
      const screens=[{index:1,width:w,height:Math.round(w*9/16),cursor:true}];
      const named=namedInQuestion(q.text,elements);
      const start=Date.now();
      const r=await h.api(tier,'/api/chat',{model:tier.model,stream:false,think:false,keep_alive:'30m',options:{num_ctx:8192,temperature:0.3,num_predict:1500},messages:[{role:'system',content:withLocalDate(buddySystemPrompt(screens,'en',{pictures:true}),new Date())},{role:'user',content:withScreenNote(q.text+screenHint(named,1),true),images:[fs.readFileSync(path.join(dir,id+'-'+w+'.jpg')).toString('base64')]}]},180000);
      const raw=r.message?.content || '';
      const placed=await collect(withNamedPoint(withPlacedTags(one(raw),elements),named,1));
      const inside=(text)=>parseBuddyAnswer(text,screens).points.some(p=>p.screen===1 && p.x>=target.x1 && p.x<=target.x2 && p.y>=target.y1 && p.y<=target.y2);
      const ours=new Set([...h.treeOf(h.processTable(),process.pid),...h.treeOf(h.processTable(),ollamaPid),sampler.pid]);
      const cpu=h.foreignCpu(cpuFile,start-2000,Date.now(),ours);
      const split=await h.processorSplit(tier);
      const row={screen:n,width:w,promptTokens:r.prompt_eval_count,promptEvalMs:r.prompt_eval_duration/1e6,loadMs:r.load_duration/1e6,rawInside:inside(raw),placedInside:inside(placed),foreignCpu:cpu,split,valid:cpu!==null && cpu<=15 && split==='100% CPU'};
      rows.push(row);fs.writeFileSync(file,JSON.stringify(rows,null,2));
      say(`[images] screen ${n} width ${w}: ${row.valid?'valid':'invalid'} tokens ${row.promptTokens}, eval ${Math.round(row.promptEvalMs)} ms, raw ${+row.rawInside}, placed ${+row.placedInside}`);
    }
    // Identical first-screen prompts without the image quantify its token contribution.
    // This is a token diagnostic, not an answer-quality or latency sample.
    const controls = [];
    for (const width of [1024, 768, 512]) {
      await h.waitForQuiet(ctx);
      const screens = [{ index: 1, width, height: Math.round(width * 9 / 16), cursor: true }];
      const q = questions[0];
      const elements = JSON.parse(fs.readFileSync(path.join(SCREENS, "001.json"))).elements;
      const r = await h.api(tier, "/api/chat", { model: tier.model, stream: false, think: false, keep_alive: "30m", options: { num_ctx: 8192, temperature: 0.3, num_predict: 1 }, messages: [
        { role: "system", content: withLocalDate(buddySystemPrompt(screens, "en", { pictures: true }), new Date()) },
        { role: "user", content: withScreenNote(q.text + screenHint(namedInQuestion(q.text, elements), 1), true), images: [] },
      ] });
      controls.push({ width, withoutImageTokens: r.prompt_eval_count });
    }
    fs.writeFileSync(path.join(dir, "token-controls.json"), JSON.stringify(controls, null, 2));
  } finally { sampler.kill(); }
}
