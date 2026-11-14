// Dedicated hidden Electron instance. No Filow main.js, hooks, microphone or audio playback.
const fs=require('node:fs');
const {app,BrowserWindow}=require('electron');
const root='G:/FILOW/tmp/voice-natural';
for(const name of ['userData','sessionData','logs','crashDumps']){
  const dir=`${root}/ui-profile/${name}`;fs.mkdirSync(dir,{recursive:true});app.setPath(name,dir);
}
app.commandLine.appendSwitch('disk-cache-dir',`${root}/ui-profile/cache`);
app.commandLine.appendSwitch('disable-gpu');
const deadline=setTimeout(()=>app.exit(2),45000);
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:740,height:700,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true}});
  const results=[];
  try{
    for(const lang of ['en','it','ru','ro','ja'])for(const theme of ['light','dark']){
      await window.loadFile(`${root}/ui/${lang}-${theme}.html`);
      const state=await window.webContents.executeJavaScript(`({value:document.querySelector('[data-testid="voice-speaker"]').value, options:document.querySelector('[data-testid="voice-speaker"]').options.length, overflow:document.documentElement.scrollWidth>innerWidth, visibleAudio:document.querySelectorAll('audio').length})`);
      if(state.value!=='-1'||state.options!==11||state.overflow||state.visibleAudio)throw new Error(JSON.stringify(state));
      const shot=await window.webContents.capturePage();
      fs.writeFileSync(`${root}/ui/${lang}-${theme}.png`,shot.toPNG());
      results.push({lang,theme,...state});
    }
    fs.writeFileSync(`${root}/ui/results.json`,JSON.stringify(results,null,2));
    if(fs.existsSync(`${root}/listen/index.html`)){
      await window.loadFile(`${root}/listen/index.html`);
      const listen=await window.webContents.executeJavaScript(`({count:document.querySelectorAll('audio').length,safe:[...document.querySelectorAll('audio')].every(a=>a.paused&&!a.autoplay&&a.src.startsWith('file:')),external:document.querySelectorAll('script[src],link[href]').length})`);
      if(listen.count!==78||!listen.safe||listen.external)throw new Error(JSON.stringify(listen));
      fs.writeFileSync(`${root}/ui/listen.json`,JSON.stringify(listen));
      fs.writeFileSync(`${root}/ui/listen.png`,(await window.webContents.capturePage()).toPNG());
    }
  }finally{window.destroy();clearTimeout(deadline);app.quit();}
}).catch(error=>{console.error(error);app.exit(1);});
