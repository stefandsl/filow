// Diagnostic only: capture the app's positive training matrix without changing
// production source or running its optimizer. No audio is exported.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {readSample}=require('../../apps/desktop/wake');
const [root]=process.argv.slice(2);
const file=path.resolve('apps/desktop/wake-head.js');
const source=fs.readFileSync(file,'utf8');
const target='return trainHead(positives, bg);';
if(source.split(target).length!==2)throw Error('Training interception changed');
const moduleCopy={exports:{}};
vm.runInNewContext(source.replace(target,'return positives;'),{module:moduleCopy,require:createRequire(file),Float32Array,Int8Array,Buffer});
(async()=>{
  const e=await moduleCopy.exports.createEmbedding(path.join(root,'native-profile/models/wake'));
  const rows=[];
  for(const [i,v] of JSON.parse(fs.readFileSync(path.join(root,'fixtures/manifest.json'))).voices.entries()){
    const features=await moduleCopy.exports.enrol(e,v.enrol.map(c=>readSample(c.file)),null);
    const bytes=Buffer.concat(features.map(x=>Buffer.from(x.buffer,x.byteOffset,x.byteLength)));
    const name=`app-aug-${i}.f32`;fs.writeFileSync(path.join(root,'round1-reference',name),bytes);
    rows.push({voice:v.voice,lang:v.lang,file:name,windows:features.length});
  }
  fs.writeFileSync(path.join(root,'round1-reference/app-augmentation.json'),JSON.stringify(rows));
  await e.dispose();
})().catch(e=>{console.error(e);process.exitCode=1});
