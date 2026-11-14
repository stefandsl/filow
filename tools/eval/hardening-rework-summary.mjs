// Summarize saved local-only observations without making model calls.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const root = 'G:/FILOW/tmp/hardening';
await build({ stdin: { contents: 'export * from "./apps/web/lib/buddy/prompt"; export * from "./apps/web/lib/buddy/ground";', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', outfile: `${root}/rework-helpers.cjs` });
const { parseBuddyAnswer, placeTags } = createRequire(import.meta.url)(`${root}/rework-helpers.cjs`);
const screens = [{index:1,width:1920,height:1080}];
const rows = JSON.parse(fs.readFileSync(`${root}/rework-samples.json`, 'utf8'));
const median = values => { const a=values.filter(Number.isFinite).sort((a,b)=>a-b); const m=Math.floor(a.length/2); return !a.length ? null : a.length%2 ? a[m] : (a[m-1]+a[m])/2; };
const decoded = call => call.text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
const response = call => decoded(call).map(line=>line.message?.content ?? '').join('');
const hasWords = text => /[\p{L}\p{N}]/u.test(text);
const hasMark = parsed => parsed.points.length + parsed.marks.length > 0;
const variants = [];
for (const phase of [...new Set(rows.map(r=>r.phase))].filter(p=>p!=='after')) {
  for (const cohort of ['warm','pointing']) {
    const group=rows.filter(r=>r.phase===phase && r.cohort===cohort);
    const placed=group.filter(r=> {
      const elements=JSON.parse(fs.readFileSync(`G:/FILOW/tmp/latency/screens/${String(r.screen).padStart(3,'0')}.json`)).elements;
      const questions=JSON.parse(fs.readFileSync('tools/eval/latency-questions.json')).questions;
      const target=elements.find(e=>e.name===questions[(cohort==='warm'?r.i:r.i-60)%5].element);
      return parseBuddyAnswer(placeTags(r.raw,elements),screens).points.some(p=>p.screen===1 && p.x>=target.x1 && p.x<=target.x2 && p.y>=target.y1 && p.y<=target.y2);
    }).length;
    variants.push({phase,cohort,n:group.length,wordless:group.filter(r=>!hasWords(r.words)).length,validMarks:group.filter(r=>r.marks>0).length,strict:group.filter(r=>r.strict).length,placedStrict:placed,medianPromptTokens:median(group.map(r=>decoded(r.calls[0]).findLast(c=>c.done)?.prompt_eval_count)),medianOutputTokens:median(group.map(r=>decoded(r.calls[0]).findLast(c=>c.done)?.eval_count)),totalOutputTokens:group.reduce((n,r)=>n+(decoded(r.calls[0]).findLast(c=>c.done)?.eval_count||0),0),medianFirstTokenMs:median(group.map(r=>r.firstTokenMs))});
  }
}
const historical=JSON.parse(fs.readFileSync(`${root}/warm-samples.json`,'utf8')).filter(r=>r.phase==='after');
function outcomes(group, oldParser = false) {
  const first=group.map(r=> {
    const raw=response(r.calls[0]);
    // Reproduce the sole observed syntax difference in these historical samples.
    const original=oldParser ? raw.replace(/\[BOX:\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*(?::[^[\]]*)?\]/gi,'') : raw;
    return parseBuddyAnswer(original,screens);
  });
  return {n:group.length,trulyEmpty:first.filter(p=>!hasWords(p.text)&&!hasMark(p)).length,pointerOnly:first.filter(p=>!hasWords(p.text)&&hasMark(p)).length,modelWords:first.filter(p=>hasWords(p.text)).length,retries:group.filter(r=>r.calls.length>1).length,failureMessages:group.filter(r=>r.words.includes('The local model gave no answer')).length,appWords:group.filter((r,i)=>!hasWords(first[i].text)&&hasMark(first[i])&&!r.words.includes('The local model gave no answer')&&hasWords(r.words)).length};
}
const after=rows.filter(r=>r.phase==='after');
const gates=[...new Set(variants.map(r=>r.phase))].filter(p=>p!=='baseline').map(phase=> {
  const scores=variants.filter(r=>r.phase===phase);
  const complete=scores.length===2 && scores.every(r=>r.n===(r.cohort==='warm'?60:40));
  const wordless=complete && scores.every(r=>r.wordless/r.n<0.2);
  const pointing=complete && scores.every(r=> { const base=variants.find(b=>b.phase==='baseline'&&b.cohort===r.cohort); return base && r.strict/r.n>=base.strict/base.n-0.02; });
  const firstToken=complete && scores.every(r=> { const base=variants.find(b=>b.phase==='baseline'&&b.cohort===r.cohort); return base && r.medianFirstTokenMs<=base.medianFirstTokenMs*1.1; });
  return {phase,complete,wordless,pointing,firstToken,adoptable:complete&&wordless&&pointing&&firstToken};
});
const output={variants,gates,before:outcomes(historical,true),beforeWithRepairedParser:outcomes(historical),after:outcomes(after)};
fs.writeFileSync(`${root}/rework-summary.json`,JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
