// Actual OK Filow panel, overlays and Settings component, all hidden. WAV fake mic only.
const { app, BrowserWindow, ipcMain, session, nativeTheme } = require('electron');
const path=require('node:path'),fs=require('node:fs');
if(process.env.FILOW_QA_NO_GLOBAL_INPUT!=='1'||process.env.FILOW_QA_HEADLESS!=='1')throw Error('Isolation required');
const root=process.env.FILOW_USER_DATA_DIR;
if(!root?.replace(/\\/g,'/').toLowerCase().startsWith('g:/filow/tmp/wake-word/'))throw Error('Own profile required');
app.setPath('userData',root);app.setPath('sessionData',root);
const fixtures=JSON.parse(fs.readFileSync(path.join(root,'../fixtures/manifest.json')));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-file-for-fake-audio-capture',fixtures.voices[0].test[0].file);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('remote-debugging-port','9571');
let okf,window;
const replayAll=process.env.FILOW_QA_WAKE_REPLAY==='1';
const deadline=setTimeout(()=>finish(124),replayAll?1200000:240000);
function finish(code){clearTimeout(deadline);okf?.dispose();for(const w of BrowserWindow.getAllWindows())w.destroy();app.exit(code)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  session.defaultSession.setPermissionRequestHandler((_w,p,cb)=>cb(p==='media'));
  let blocked=0;
  session.defaultSession.webRequest.onBeforeRequest((d,cb)=>{const u=new URL(d.url);const allow=u.protocol==='devtools:'||u.protocol==='blob:'||u.protocol==='data:'||(u.hostname==='127.0.0.1'&&u.port==='4971'&&!u.pathname.startsWith('/api/'));if(!allow)blocked++;cb({cancel:!allow})});
  const base=path.resolve('apps/desktop');
  let settings={okFilow:{enabled:true,onboarded:true,provider:'local',voice:'off',seeScreen:'on',wakeSensitivity:'balanced'}};
  let take=false,slideshow=false;
  const no=()=>{};
  okf=require('../../apps/desktop/okfilow').createOkFilow({appUrl:'http://127.0.0.1:4971',getSettings:()=>settings,saveSettings:s=>{settings=s},iconPath:path.join(base,'build/icon.png'),logLine:console.log,
    sttLocal:{modelReady:()=>false},userData:root,menuText:k=>k,isOffline:()=>true,elementReader:null,
    takeRunning:()=>take,slideShowRunning:()=>slideshow,
    dictation:{status:()=>({enabled:false,mode:'hold',chord:'ctrl+meta',chords:[],check:{ok:true,warnings:[]},language:'auto'}),cfg:()=>({enabled:false,mode:'hold'}),activeChord:()=>null,onChange:no,userMoved:no,configure:no},
  });
  ipcMain.handle('qa:status',()=>okf.status());ipcMain.handle('qa:configure',(_e,p)=>okf.applyConfig(p));ipcMain.handle('qa:wake',(_e,a,d)=>okf.wakeAction(a,d));
  okf.start();
  window=new BrowserWindow({show:false,width:1000,height:1000,webPreferences:{preload:path.join(__dirname,'ui-qa-preload.cjs'),contextIsolation:true,backgroundThrottling:false}});
  await window.loadURL('http://127.0.0.1:4971/okfilow/wake-qa');
  await sleep(2000);
  const results={hidden:true,blockedRequests:0,checks:[]};
  for(const theme of ['dark','light']){nativeTheme.themeSource=theme;await window.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.style.colorScheme=${JSON.stringify(theme)}`);await sleep(300);fs.writeFileSync(path.join(root,'../settings-'+theme+'.png'),(await window.webContents.capturePage(undefined,{stayHidden:true})).toPNG())}
  // An already-trained synthetic profile, from this task only. Model checks still run.
  fs.cpSync(path.join(root,'../native-profile/models'),path.join(root,'models'),{recursive:true});
  const { readSample } = require('../../apps/desktop/wake');
  for (const [index, clip] of fixtures.voices[0].enrol.entries()) await okf.wakeAction('sample', { index, samples: readSample(clip.file) });
  await okf.wakeAction('train');
  await okf.wakeAction('test',true);await okf.wakeAction('enable');
  const cpuNow=()=>app.getAppMetrics().reduce((n,p)=>n+(p.cpu.cumulativeCPUUsage||0),0);
  await sleep(5000);
  const startMetrics=app.getAppMetrics();
  const cpuStart=cpuNow(),wallStart=Date.now();
  await sleep(60000);console.log('wake status',okf.wakeAction('status'));
  results.realtimeCpuPercentOneCore=(cpuNow()-cpuStart)/((Date.now()-wallStart)/1000)*100;
  results.cpuByProcess=app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,name:p.name,cpuPercentOneCore:100*((p.cpu.cumulativeCPUUsage||0)-(startMetrics.find(s=>s.pid===p.pid)?.cpu.cumulativeCPUUsage||0))/((Date.now()-wallStart)/1000)}));
  const status=()=>okf.wakeAction('status');
  if(!status().listening)throw Error('Did not open fake mic: '+JSON.stringify(status()));
  const overlays=BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('/overlay'));
  for(const w of overlays){const label=await w.webContents.executeJavaScript(`document.querySelector('[data-testid="wake-indicator"]')?.textContent`);console.log('indicator',label);if(!label?.includes('OK Filow'))throw Error('Missing indicator');}
  results.checks.push({name:'fake microphone and persistent indicator',pass:true,detections:status().count});
  take=true;okf.wakeReconcile();await sleep(300);if(status().listening)throw Error('take still listening');results.checks.push({name:'take stops wake',pass:true});take=false;okf.wakeReconcile();await sleep(400);
  slideshow=true;okf.wakeReconcile();await sleep(300);if(status().listening)throw Error('slideshow still listening');results.checks.push({name:'slideshow stops wake',pass:true});slideshow=false;okf.wakeReconcile();await sleep(400);
  okf.applyConfig({seeScreen:'off'});await sleep(300);if(status().listening)throw Error('eye still listening');results.checks.push({name:'eye stops wake',pass:true});okf.applyConfig({seeScreen:'on'});await sleep(500);
  const overlay=overlays[0];
  await overlay.webContents.executeJavaScript(`document.querySelectorAll('[data-testid="wake-indicator"] button')[1].click()`);await sleep(300);if(status().listening)throw Error('pause still listening');results.checks.push({name:'pause stops wake',pass:true});
  await overlay.webContents.executeJavaScript(`document.querySelectorAll('[data-testid="wake-indicator"] button')[1].click()`);await sleep(500);if(!status().listening)throw Error('resume failed');
  await overlay.webContents.executeJavaScript(`document.querySelector('[data-testid="wake-indicator"] button').click()`);await sleep(300);if(status().enabled)throw Error('one-click off failed');results.checks.push({name:'one-click off',pass:true});
  results.hidden=BrowserWindow.getAllWindows().every(w=>!w.isVisible());if(!results.hidden)throw Error('QA window became visible');results.blockedRequests=blocked;
  fs.writeFileSync(path.join(root,'../',process.env.FILOW_WAKE_REPORT || 'round1-ui-results.json'),JSON.stringify(results,null,2));
  if(replayAll){
    const panel=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/panel'));
    await panel.loadURL('http://127.0.0.1:4971/okfilow/wake-qa');await sleep(1000);
    if(!await panel.webContents.executeJavaScript('typeof window.wakeReplay === "function"'))throw Error('Renderer fake-microphone fixture missing');
    const report={kind:'hidden Electron renderer fake-WAV capture helper -> production IPC -> dual native detectors; accelerated',positives:0,misses:0,near:0,nearFired:0,backgroundSeconds:0,falseAccepts:0,cpuSeconds:0,voices:[],outboundAttempts:0};
    const replay=async(file)=>{
      const samples=readSample(file),before=status().count;
      // 10 s transport batches; within the renderer, the same 100 ms capture
      // callbacks and Float32 conversion run, waiting for the production IPC.
      for(let at=0;at<samples.length;at+=160000){
        const data=Array.from(samples.subarray(at,at+160000),x=>Math.round(x*32768));
        await panel.webContents.executeJavaScript(`window.wakeReplay(${JSON.stringify(data)})`);
        if(!status().listening)throw Error(JSON.stringify(status()));
      }
      await panel.webContents.executeJavaScript('window.wakeReplay(Array(32000).fill(0))');
      return status().count-before;
    };
    for(const [index,voice] of fixtures.voices.entries()){
      const started=Date.now();
      for(const [i,clip] of voice.enrol.entries())await okf.wakeAction('sample',{index:i,samples:readSample(clip.file)});
      await okf.wakeAction('train');if(status().error)throw Error(status().error);
      const trainMs=Date.now()-started;
      await okf.wakeAction('test',true);await okf.wakeAction('enable');await sleep(200);
      if(!status().listening)throw Error(JSON.stringify(status()));
      const row={voice:voice.voice,lang:voice.lang,trainMs,positives:0,misses:0,near:0,nearFired:0,conditions:{}};
      for(const clip of voice.test){const fired=await replay(clip.file);row.positives++;row.misses+=!fired;const c=row.conditions[clip.condition]??={n:0,miss:0};c.n++;c.miss+=!fired}
      for(const clip of voice.near){row.near++;row.nearFired+=Boolean(await replay(clip.file))}
      report.voices.push(row);report.positives+=row.positives;report.misses+=row.misses;report.near+=row.near;report.nearFired+=row.nearFired;
      if(index===0){
        const cpu=()=>app.getAppMetrics().reduce((n,p)=>n+(p.cpu.cumulativeCPUUsage||0),0);
        const before=cpu(),connections=blocked;
        for(const bg of fixtures.background){report.falseAccepts+=await replay(bg.file);report.backgroundSeconds+=bg.seconds;console.log('renderer background',bg.file,report.falseAccepts)}
        report.cpuSeconds=cpu()-before;report.outboundAttempts=blocked-connections;
      }
      await okf.wakeAction('off');console.log('renderer',JSON.stringify(row));
      fs.writeFileSync(path.join(root,'../e2e-results.json'),JSON.stringify(report,null,2));
    }
    report.cpuPercentOneCore=report.cpuSeconds/report.backgroundSeconds*100;
    fs.writeFileSync(path.join(root,'../e2e-results.json'),JSON.stringify(report,null,2));
  }
  finish(0);
}).catch(e=>{console.error(e);finish(1)});
