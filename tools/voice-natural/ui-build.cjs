// Static render of the actual settings component for hidden browser inspection.
const fs=require('node:fs');
const path=require('node:path');
const esbuild=require('esbuild');
const root='G:/FILOW/tmp/voice-natural';
fs.mkdirSync(`${root}/ui`,{recursive:true});
esbuild.buildSync({stdin:{contents:`
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {VoiceSettings} from './apps/web/app/okfilow/panel/voice-settings';
import {okfText} from './apps/web/lib/buddy/text';
export function render(lang){return renderToStaticMarkup(<VoiceSettings lang={lang} bridge={{tts:{}}} status={{voice:'natural',naturalVoice:-1,offline:true,enabled:true}} t={okfText(lang)} configure={async()=>{}} preview={()=>{}} initial={{installed:true,state:'ready',pct:100,error:'',sizeBytes:128774318,voices:10,mode:'natural',level:'standard',reason:''}}/>);}
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',alias:{'@':path.resolve('apps/web')},outfile:`${root}/ui/render.cjs`});
esbuild.buildSync({entryPoints:['apps/web/app/theme-tokens.css','apps/web/app/okfilow/okfilow.css'],bundle:true,outdir:`${root}/ui/css`});
const {render}=require(`${root}/ui/render.cjs`);
const css=fs.readFileSync(`${root}/ui/css/theme-tokens.css`,'utf8')+fs.readFileSync(`${root}/ui/css/okfilow/okfilow.css`,'utf8');
for(const lang of ['en','it','ru','ro','ja'])for(const theme of ['light','dark']){
  fs.writeFileSync(`${root}/ui/${lang}-${theme}.html`,`<!doctype html><html lang="${lang}" data-theme="${theme}"><meta charset="utf-8"><style>${css}\nbody{background:var(--bg);color:var(--text);font:16px system-ui;margin:24px}main{max-width:660px}</style><main class="okf-panel"><div class="okf-settings">${render(lang)}</div></main></html>`);
}
