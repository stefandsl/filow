// Hidden, muted, file-only inspection. No Filow main process or device access.
const fs=require('node:fs');
const {app,BrowserWindow,nativeTheme}=require('electron');
const root='G:/FILOW/tmp/voice-natural';
for(const name of ['userData','sessionData','logs','crashDumps']){
  const dir=`${root}/round2-ui/${name}`;fs.mkdirSync(dir,{recursive:true});app.setPath(name,dir);
}
app.commandLine.appendSwitch('disk-cache-dir',`${root}/round2-ui/cache`);
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('mute-audio');
const timer=setTimeout(()=>app.exit(2),45000);
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:1000,height:850,webPreferences:{sandbox:true,backgroundThrottling:false}});
  window.webContents.setAudioMuted(true);
  const results=[];
  try{
    for(const theme of ['light','dark']){
      nativeTheme.themeSource=theme;
      await window.loadFile(`${root}/listen2/index.html`);
      const state=await window.webContents.executeJavaScript(`({items:document.querySelectorAll('section').length,audio:document.querySelectorAll('audio').length,paused:[...document.querySelectorAll('audio')].every(a=>a.paused&&!a.autoplay&&a.preload==='none'),local:[...document.querySelectorAll('audio')].every(a=>a.src.startsWith('file:')),external:document.querySelectorAll('script[src],link[href]').length,overflow:document.documentElement.scrollWidth>innerWidth,texts:[...document.querySelectorAll('section')].every(s=>s.querySelector('p').textContent.length>0)})`);
      if(state.items!==31||state.audio!==62||!state.paused||!state.local||state.external||state.overflow||!state.texts)throw new Error(JSON.stringify(state));
      await new Promise(resolve=>setTimeout(resolve,300));
      fs.writeFileSync(`${root}/round2-ui/${theme}.png`,(await window.webContents.capturePage()).toPNG());
      results.push({theme,...state});
    }
    fs.writeFileSync(`${root}/round2-ui/results.json`,JSON.stringify(results,null,2));
  }finally{window.destroy();clearTimeout(timer);app.quit();}
}).catch(error=>{console.error(error);app.exit(1);});
