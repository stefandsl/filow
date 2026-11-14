const fs=require('node:fs');
const {normalizeNumbers}=require('../../apps/desktop/tts-numbers');
const root='G:/FILOW/tmp/voice-natural/round2';
const read=name=>JSON.parse(fs.readFileSync(`${root}/${name}.json`));
const exists=name=>fs.existsSync(`${root}/${name}.json`);
const tokens=(s,l)=>{
  s=s.toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  return l==='ja'?[...s.replace(/\s/g,'')]:s.split(/\s+/).filter(Boolean);
};
function distance(a,b){let v=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const n=[i+1];for(let j=0;j<b.length;j++)n.push(Math.min(n[j]+1,v[j+1]+1,v[j]+(a[i]===b[j]?0:1)));v=n;}return v[b.length];}
const targetTokens=text=>tokens(text,'en').join(' ').replace(/p d f/g,'pdf').replace(/power point/g,'powerpoint').split(' ');
const summary={foreign:{},isolatedSpans:{},numbers:{},tail:{}};
for(const mode of ['before','after','lexicon']){
  let rows=[];
  if(mode==='after' && ['it','ru','ro'].every(l=>exists(`asr-after-foreign-en-${l}`))) rows=['it','ru','ro'].flatMap(l=>read(`asr-after-foreign-en-${l}`));
  else if(exists(`asr-${mode}-foreign-en`))rows=read(`asr-${mode}-foreign-en`);
  for(const lang of ['it','ru','ro']){
    const a=rows.filter(r=>r.lang===lang);
    const target=a.reduce((n,r)=>n+r.targets.length,0);
    const matched=a.reduce((n,r)=>n+r.targets.filter(w=>targetTokens(r.hypothesis).includes(w.toLowerCase())).length,0);
    const spanMatched=a.reduce((n,r)=>n+r.targets.filter(w=>targetTokens((r.spans??[]).map(s=>s.hypothesis).join(' ')).includes(w.toLowerCase())).length,0);
    (summary.foreign[lang]??={})[mode]={sentences:a.length,matched,target,recall:target?matched/target:null,spanMatched:mode==='after'?spanMatched:null};
  }
}
for(const lang of ['it','ru','ro']){
  const key=`asr-span-before-foreign-en-${lang}`;
  if(!exists(key))continue;
  const a=read(key);
  const matched=a.reduce((n,r)=>n+r.targets.filter(w=>targetTokens(r.spans.map(s=>s.hypothesis).join(' ')).includes(w.toLowerCase())).length,0);
  summary.isolatedSpans[lang]={sentences:a.length,before:matched,after:summary.foreign[lang].after.spanMatched,target:a.reduce((n,r)=>n+r.targets.length,0)};
}
for(const lang of ['it','ru','ro','en','ja'])for(const mode of ['before','after']){
  const manifest=read(`${mode}-numbers-all`).filter(r=>r.lang===lang);
  if(!exists(`asr-${mode}-numbers-${lang}`))continue;
  const rows=read(`asr-${mode}-numbers-${lang}`);
  let errors=0,total=0;
  const detail=[];
  for(const row of rows){
    const reference=manifest.find(r=>r.id===row.id).expected;
    const a=tokens(reference,lang),b=tokens(normalizeNumbers(row.hypothesis,lang),lang);
    const edits=distance(a,b);errors+=edits;total+=a.length;
    detail.push({...row,reference,edits,tokens:a.length});
  }
  (summary.numbers[lang]??={})[mode]={samples:rows.length,errors,tokens:total,errorRate:errors/total};
  fs.writeFileSync(`${root}/scored-numbers-${mode}-${lang}.json`,JSON.stringify(detail,null,2));
}
for(const mode of ['before','after']){
  const rows=['listen','foreign','numbers'].flatMap(k=>read(`${mode}-${k}-all`));
  summary.tail[mode]={sentences:rows.length,aboveThreshold:rows.filter(r=>r.tail20Rms>.003).length,max20Rms:Math.max(...rows.map(r=>r.tail20Rms)),max150Rms:Math.max(...rows.map(r=>r.tail150Rms))};
}
fs.writeFileSync(`${root}/summary.json`,JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
