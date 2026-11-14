const fs=require('node:fs'),path=require('node:path');
const {background,trainHead,dot}=require('../../apps/desktop/wake-head');
const root='G:/FILOW/tmp/wake-word',out=path.join(root,'round3');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'fixtures/manifest.json'))),kws=JSON.parse(fs.readFileSync(path.join(root,'spotter-reference.json')));
const bg=background(path.resolve('apps/desktop/wake-data')),rows=[];
const floats=file=>{const b=fs.readFileSync(file);return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));};
for(const rate of [0,.1,.2,.5]) {
  const row={rate,total:0,miss:0,near:0,nearAccepted:0,voices:[]};
  for(const i of [0,4,8,12,16]) {
    const matrix=floats(path.join(out,`voice-${i}/positive.f32`)), positives=[];
    for(let at=0;at<matrix.length;at+=1152)positives.push(matrix.subarray(at,at+1152));
    const profile=trainHead(positives,bg,{hardRate:rate}),v=manifest.voices[i];
    const result={voice:v.voice,lang:v.lang,total:0,miss:0,near:0,nearAccepted:0};
    for(const kind of ['test','near'])for(const clip of v[kind]) {
      if(kind==='test'&&clip.condition.includes('pitch'))continue;
      const stem=path.parse(clip.file).name,e=floats(path.join(root,'round1-reference',stem+'.emb'));
      let score=-99;for(let at=0;at+1152<=e.length;at+=96)score=Math.max(score,dot(profile.weights,e,at)+profile.bias);
      const keyword=kws.find(k=>k.stem===stem).hits.length>0,fired=score>profile.thresholds.sure||(keyword&&score>profile.thresholds.loose);
      if(kind==='test'){result.total++;result.miss+=!fired;}else{result.near++;result.nearAccepted+=fired;}
    }
    row.voices.push(result);for(const key of ['total','miss','near','nearAccepted'])row[key]+=result[key];
  }
  rows.push(row);fs.writeFileSync(path.join(out,'curve.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(row));
}
