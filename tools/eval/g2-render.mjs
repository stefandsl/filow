// Builds an isolated page that uses the unchanged application renderer.
// Run after npm ci: node tools/eval/g2-render.mjs <task-root> <result-tree>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildSync } from 'esbuild';
import { requireFrozen } from './g2-protocol.mjs';
const [root, tree] = process.argv.slice(2);
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
requireFrozen(root, source);
const qa = path.join(root, 'qa');
fs.mkdirSync(qa, { recursive: true });
fs.cpSync(path.join(source, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts'), path.join(qa, 'excalidraw/fonts'), { recursive: true });
buildSync({ stdin: { contents: `
import {layoutBoard} from './apps/web/lib/whiteboard/layout';
import {boardLesson,sceneFromLayout} from './apps/web/lib/whiteboard/scene';
import {prepareScene,scenePng} from './apps/web/lib/whiteboard/excalidraw';
window.renderLesson = async (lesson, step, dark) => {
 const scene = await prepareScene(sceneFromLayout(layoutBoard(boardLesson(lesson), step, 'wide')));
 const blob = await scenePng(scene.elements, scene.files, {dark,maxSide:1200});
 return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
};`, resolveDir: source }, bundle: true, platform: 'browser', format: 'esm', outfile: path.join(qa, 'renderer.js'), alias: { '@': path.join(source, 'apps/web') }, define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.woff2': 'file', '.woff': 'file' } });
fs.writeFileSync(path.join(qa, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="/renderer.js"></script></body></html>');
const main = path.join(qa, 'main.cjs');
fs.writeFileSync(main, `
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=${JSON.stringify(root)},qa=${JSON.stringify(qa)},tree=${JSON.stringify(path.resolve(tree))};
app.setPath('userData',path.join(root,'profile'));app.setPath('sessionData',path.join(root,'profile','session'));
app.commandLine.appendSwitch('remote-debugging-port','9611');app.disableHardwareAcceleration();
let server;const deadline=setTimeout(()=>app.exit(2),600000);
const files=(dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):e.name==='lesson.json'?[path.join(dir,e.name)]:[]);
app.whenReady().then(async()=>{
 try {
 session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!d.url.startsWith('http://127.0.0.1:5012/')&&!d.url.startsWith('data:')&&!d.url.startsWith('blob:')}));
 server=http.createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1');const rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));const file=path.resolve(qa,rel);if(!file.startsWith(path.resolve(qa)+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');fs.createReadStream(file).pipe(res);});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(5012,'127.0.0.1',resolve);});
 const win=new BrowserWindow({show:false,width:1264,height:900,webPreferences:{nodeIntegration:false,contextIsolation:true}});win.webContents.setAudioMuted(true);await win.loadURL('http://127.0.0.1:5012/');
 for(const file of files(tree)){const lesson=JSON.parse(fs.readFileSync(file,'utf8'));for(let step=0;step<lesson.steps.length;step++)for(const dark of [true,false]){const data=await win.webContents.executeJavaScript('window.renderLesson('+JSON.stringify(lesson)+','+step+','+dark+')');fs.writeFileSync(path.join(path.dirname(file),(dark?'dark':'light')+'-step-'+(step+1)+'.png'),Buffer.from(data.split(',')[1],'base64'));}fs.writeFileSync(path.join(path.dirname(file),'render.json'),JSON.stringify({rendered:true,themes:2,steps:lesson.steps.length}));}
 }catch(e){fs.writeFileSync(path.join(root,'logs','render-error.txt'),String(e));process.exitCode=1;}finally{clearTimeout(deadline);server?.close();app.exit(process.exitCode||0);}
});`);
const executable = path.join(root, 'runtime/electron/electron.exe');
const child = spawn(executable, [main], { windowsHide: true, env: { ...process.env, TEMP: path.join(root, 'temp'), TMP: path.join(root, 'temp'), FILOW_QA_NO_GLOBAL_INPUT: '1', FILOW_QA_HEADLESS: '1', FILOW_USER_DATA_DIR: path.join(root, 'profile') }, stdio: 'inherit' });
const timeout = setTimeout(() => child.kill(), 610000);
child.on('error', (error) => { clearTimeout(timeout); console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { clearTimeout(timeout); process.exitCode = code ?? 1; });
