// Freeze the pre-round-3 production augmentation for the first-stage diagnosis.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process'),Module=require('node:module');
const file=path.resolve('apps/desktop/wake-head.js'),m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
m._compile(execFileSync('git',['show','d4aac39:apps/desktop/wake-head.js'],{encoding:'utf8',windowsHide:true}),file);
const {readSample}=require('../../apps/desktop/wake'),root='G:/FILOW/tmp/wake-word';
const voice=JSON.parse(fs.readFileSync(path.join(root,'fixtures/manifest.json'))).voices[0],rows=[];
m.exports.positiveWindows({embed:async audio=>{rows.push({id:rows.length,samples:audio.length,seconds:audio.length/16000,sha256:crypto.createHash('sha256').update(Buffer.from(audio.buffer)).digest('hex')});return new Float32Array(60*96);}},voice.enrol.map(c=>readSample(c.file))).then(()=>fs.writeFileSync(path.join(root,'round3/original-app-a.json'),JSON.stringify(rows,null,2)));
