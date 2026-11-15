const fs=require('node:fs'),path=require('node:path');
const {createEmbedding,enrol,background,dot}=require('../../apps/desktop/wake-head');
const {readSample}=require('../../apps/desktop/wake');
const [root,repo,output=path.join(root,'head-comparison.json'),profileOutput=path.join(root,'round1-reference')]=process.argv.slice(2);
fs.mkdirSync(profileOutput,{recursive:true});
const maxScore=(p,e)=>{let score=-Infinity;for(let at=0;at+1152<=e.length;at+=96)score=Math.max(score,dot(p.weights,e,at)+p.bias);return score;};
(async()=>{
  const e=await createEmbedding(path.join(root,'native-profile/models/wake'));
  const bg=background(path.join(repo,'apps/desktop/wake-data'));delete bg.hard;delete bg.hardMeta;
  const refs=JSON.parse(fs.readFileSync(path.join(root,'training-reference.json')));
  const kws=JSON.parse(fs.readFileSync(path.join(root,'spotter-reference.json')));
  const fixtures=JSON.parse(fs.readFileSync(path.join(root,'fixtures/manifest.json')));
  const rows=[];
  for(const [i,voice] of fixtures.voices.entries()){
    const baseline=await enrol(e,voice.enrol.map(c=>readSample(c.file)),bg);
    const hard=JSON.parse(fs.readFileSync(path.join(root,`hard-profile/profile-${i}.json`)));
    fs.writeFileSync(path.join(profileOutput,`app-profile-${i}.json`),JSON.stringify(baseline));
    const ref=refs[i],clips=[];
    for(const clip of ref.clips){
      const b=fs.readFileSync(path.join(root,'round1-reference',clip.stem+'.emb'));
      const emb=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));
      const scores={python:clip.score,sharedHead:emb.length>=1152?maxScore(ref.profile,emb):-99,baseline:emb.length>=1152?maxScore(baseline,emb):-99,hard:emb.length>=1152?maxScore(hard,emb):-99};
      const spot=kws.find(k=>k.stem===clip.stem).hits.length>0;
      const fired=Object.fromEntries([['python',ref.profile],['baseline',baseline],['hard',hard]].map(([k,p])=>[k,scores[k]>p.thresholds.sure||(spot&&scores[k]>p.thresholds.loose)]));
      clips.push({...clip,scores,spot,fired});
    }
    rows.push({voice:voice.voice,lang:voice.lang,clips});fs.writeFileSync(output,JSON.stringify(rows,null,2));console.log(i,voice.voice,voice.lang);
  }
  await e.dispose();
})().catch(e=>{console.error(e);process.exitCode=1});
