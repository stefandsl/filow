const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { augment, random } = require('../../apps/desktop/wake-augmentation');
const { createEmbedding, speechEnd, background, trainHead } = require('../../apps/desktop/wake-head');
const { readSample } = require('../../apps/desktop/wake');
const root = 'G:/FILOW/tmp/wake-word', voiceIndex=Number(process.argv[2]||0), out = path.join(root, 'round3',`voice-${voiceIndex}`);
const hash = x => crypto.createHash('sha256').update(Buffer.from(x.buffer,x.byteOffset,x.byteLength)).digest('hex');
(async () => {
  fs.mkdirSync(out,{recursive:true});
  const voice=JSON.parse(fs.readFileSync(path.join(root,'fixtures/manifest.json'))).voices[voiceIndex];
  const embedding=await createEmbedding(path.join(root,'native-profile/models/wake'));
  const rng=random(), rows=[], positives=[];
  for (const [take,clip] of voice.enrol.entries()) {
    const samples=readSample(clip.file); fs.writeFileSync(path.join(out,`take-${take}.f32`),Buffer.from(samples.buffer));
    for(let a=0;a<16;a++) {
      const {audio,speed}=augment(samples,a,rng), id=take*16+a;
      fs.writeFileSync(path.join(out,`audio-${id}.f32`),Buffer.from(audio.buffer));
      const e=await embedding.embed(audio), indices=[];
      fs.writeFileSync(path.join(out,`embedding-${id}.f32`),Buffer.from(e.buffer));
      for(const dt of [.08,.16,.24,.32]) {
        const i=Math.ceil(((1+speechEnd(samples)/speed/16000+dt-.015)/.01-76)/8);
        if(i>=11&&(i+1)*96<=e.length) {indices.push(i);positives.push(e.slice((i-11)*96,(i+1)*96));}
      }
      rows.push({id,take,variant:a,samples:audio.length,seconds:audio.length/16000,sha256:hash(audio),embeddingFrames:e.length/96,indices});
    }
  }
  const bg=background(path.resolve('apps/desktop/wake-data')); delete bg.hard; delete bg.hardMeta;
  const trace=[]; const profile=trainHead(positives,bg,{trace:x=>trace.push({...x,sha256:hash(Float32Array.from(x.weights))})});
  fs.writeFileSync(path.join(out,'app-stages.json'),JSON.stringify({voice:voice.voice,seed:12345,rows,negative:{source:bg.meta.source,frames:bg.data.length/96,sha256:hash(bg.data),segments:bg.meta.segments},windows:positives.length,trace,profile}));
  fs.writeFileSync(path.join(out,'positive.f32'),Buffer.concat(positives.map(x=>Buffer.from(x.buffer))));
  await embedding.dispose(); console.log('exported',rows.length,positives.length);
})().catch(e=>{console.error(e);process.exitCode=1});
