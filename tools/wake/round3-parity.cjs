const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {dot}=require('../../apps/desktop/wake-head');
const root='G:/FILOW/tmp/wake-word', out=path.join(root,'round3');
const fixtures=JSON.parse(fs.readFileSync(path.join(root,'fixtures/manifest.json')));
const kws=JSON.parse(fs.readFileSync(path.join(root,'spotter-reference.json')));
const results=[];
for(const [i,voice] of fixtures.voices.entries()) {
  execFileSync(process.execPath,['tools/wake/stage-export.cjs',String(i)],{stdio:'inherit',windowsHide:true,timeout:120000});
  execFileSync('G:/FILOW/tmp/wakeword-spike/.venv/Scripts/python.exe',['tools/wake/stage-reference.py',String(i)],{stdio:'inherit',windowsHide:true,timeout:180000});
  const dir=path.join(out,`voice-${i}`), app=JSON.parse(fs.readFileSync(path.join(dir,'app-stages.json'))).profile, ref=JSON.parse(fs.readFileSync(path.join(dir,'python-profile.json')));
  for(const kind of ['enrol','test','near']) for(const clip of voice[kind]) {
    const stem=path.parse(clip.file).name,b=fs.readFileSync(path.join(root,'round1-reference',stem+'.emb')),e=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));
    const keyword=kws.find(k=>k.stem===stem).hits.length>0;
    const decisions=[app,ref].map(p=>{let score=-99;for(let at=0;at+1152<=e.length;at+=96)score=Math.max(score,dot(p.weights,e,at)+p.bias);return {score,fired:score>p.thresholds.sure||(keyword&&score>p.thresholds.loose)};});
    results.push({stem,voice:voice.voice,lang:voice.lang,kind,app:decisions[0],reference:decisions[1]});
  }
  fs.writeFileSync(path.join(out,'parity.json'),JSON.stringify({referenceChanged:true,clips:results.length,agreed:results.filter(c=>c.app.fired===c.reference.fired).length,results},null,2));
  console.log('completed voice',i,'clips',results.length);
}
if(results.length!==500 || new Set(results.map(c=>c.stem)).size!==500)throw Error('Expected 500 distinct evaluation clips');
if(results.filter(c=>c.app.fired!==c.reference.fired).length>10)process.exitCode=1;
