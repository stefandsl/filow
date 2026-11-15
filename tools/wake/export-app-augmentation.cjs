// Diagnostic only: capture the app's positive training matrix without changing
// production source or running its optimizer. No audio is exported.
const fs=require('node:fs'),path=require('node:path');
const {readSample}=require('../../apps/desktop/wake');
const {createEmbedding,positiveWindows}=require('../../apps/desktop/wake-head');
const [root,output=path.join(root,'round1-reference')]=process.argv.slice(2);
fs.mkdirSync(output,{recursive:true});
(async()=>{
  const e=await createEmbedding(path.join(root,'native-profile/models/wake'));
  const rows=[];
  for(const [i,v] of JSON.parse(fs.readFileSync(path.join(root,'fixtures/manifest.json'))).voices.entries()){
    const features=await positiveWindows(e,v.enrol.map(c=>readSample(c.file)));
    const bytes=Buffer.concat(features.map(x=>Buffer.from(x.buffer,x.byteOffset,x.byteLength)));
    const name=`app-aug-${i}.f32`;fs.writeFileSync(path.join(output,name),bytes);
    rows.push({voice:v.voice,lang:v.lang,file:name,windows:features.length});
  }
  fs.writeFileSync(path.join(output,'app-augmentation.json'),JSON.stringify(rows));
  await e.dispose();
})().catch(e=>{console.error(e);process.exitCode=1});
