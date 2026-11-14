// AR-2 FIXED Electron driver (do not edit; see ../program.md). Adapted from the overlay round 2B driver
// (G:/FILOW/tmp/overlay-r2b/driver/qa-rework4.cjs). Hidden offscreen windows, all permissions denied, no
// desktop input, only 127.0.0.1:4961 is reachable. Writes the sampled frames to AR2_OUT.
const { app, BrowserWindow, ipcMain, session, dialog } = require("electron");
const fs = require("node:fs"), path = require("node:path");
const WORK = process.env.AR2_WORK, OUT = process.env.AR2_OUT, REPO = process.env.AR2_REPO, BASE = process.env.AR2_BASE;
app.on("window-all-closed", () => {});
app.setPath("userData", WORK + "/profile"); app.setPath("sessionData", WORK + "/profile/session"); app.setPath("logs", WORK + "/logs");
app.commandLine.appendSwitch("disable-renderer-backgrounding"); app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
dialog.showErrorBox = () => {}; dialog.showMessageBox = async () => ({ response: 0 });
const deadline = setTimeout(() => app.exit(3), 180000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MODEL = { title: "Jet engine", parts: [
  { name: "Fan", shape: "cylinder", size: [1.6, .25, 1.6], pos: [-1.6, 0, 0], rot: [0, 0, 90], color: "#9aa4b2" },
  { name: "Compressor", shape: "cone", size: [1.3, 1.2, 1.3], pos: [-.7, 0, 0], rot: [0, 0, 90], color: "#6c8ebf" },
  { name: "Combustor", shape: "cylinder", size: [1, 1, 1], pos: [.3, 0, 0], rot: [0, 0, 90], color: "#e5484d" },
  { name: "Turbine", shape: "cylinder", size: [1.1, .4, 1.1], pos: [1.1, 0, 0], rot: [0, 0, 90], color: "#f5a524" },
  { name: "Nozzle", shape: "cone", size: [.9, .9, .9], pos: [1.8, 0, 0], rot: [0, 0, -90], color: "#4b5563" },
  { name: "Casing", shape: "cylinder", size: [1.9, 4.2, 1.9], pos: [0, 0, 0], rot: [0, 0, 90], color: "#cbd5e1" }] };
const sampler = `(()=>{
 window.qaFrames=[];window.qaOn=true;const start=performance.now();
 const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}};
 function tick(t){if(!window.qaOn)return;
  const identities=[...document.querySelectorAll('.okf-part')].map(e=>({name:e.textContent.replace(/^\\d+/,''),number:e.firstElementChild.textContent,side:e.getBoundingClientRect().left<380?'left':'right'}));
  const labels=[...document.querySelectorAll('.okf-part')].map(rect);
  const lines=[...document.querySelectorAll('.okf-part-ink')].map(e=>Array.from(e.points).map(p=>{const q=p.matrixTransform(e.getScreenCTM());return [q.x,q.y]}));
  const ring=document.querySelector('.okf-arrival');const rs=ring?getComputedStyle(ring):null;
  const arrow=document.querySelector('.okf-arrow'),pill=document.querySelector('.okf-label');
  let tip=null;if(arrow){const p=arrow.createSVGPoint();p.x=3;p.y=2;const v=p.matrixTransform(arrow.getScreenCTM());tip=[v.x,v.y];}
  window.qaFrames.push({pose:window.qaPose??'sheet',t:t-start,identities,labels,lines,tip,pill:pill?rect(pill):null,
   ring:ring?{rect:rect(ring),opacity:Number(rs.opacity)}:null});
  requestAnimationFrame(tick);
 } requestAnimationFrame(tick);return true;
})()`;
(async () => {
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith(BASE + "/") && !d.url.startsWith("data:") && !d.url.startsWith("devtools:") }));
  ipcMain.handle("okfilow:status", () => ({ color: "#ffb600", enabled: false, voice: "off" }));
  ipcMain.on("okfilow:overlay:ready", e => e.sender.send("okfilow:state", { mode: "idle" }));
  ipcMain.on("okfilow:model:ready", e => e.sender.send("okfilow:model", MODEL));
  const result = { scenes: [] };
  for (const theme of ["dark", "light"]) for (const scene of ["pointer", "model"]) {
    const w = new BrowserWindow({ show: false, x: -12000, y: -12000, width: scene === "model" ? 760 : 1000, height: scene === "model" ? 460 : 700, frame: false,
      webPreferences: { offscreen: true, backgroundThrottling: false, preload: path.join(REPO, "apps/desktop/okfilow-preload.js") } });
    w.webContents.setFrameRate(60);
    const errors = []; w.webContents.on("console-message", (_e, level, message) => { if (level >= 2) errors.push(message); });
    await w.loadURL(BASE + "/okfilow/" + (scene === "model" ? "model" : "overlay"));
    await sleep(900);
    await w.webContents.executeJavaScript(`localStorage.setItem('prefs:theme',${JSON.stringify(theme)});document.documentElement.dataset.theme=${JSON.stringify(theme)};true`);
    let avoid = [];
    if (scene === "pointer") {
      avoid = await w.webContents.executeJavaScript(`(()=>{
        const bg=document.createElement('div');bg.style.cssText='position:fixed;inset:0;z-index:-1;background:${theme === "dark" ? "#14161a" : "#f7f7f8"};color:${theme === "dark" ? "#e7e8ea" : "#202126"};font:20px system-ui';
        bg.innerHTML='<h1 style="position:absolute;left:70px;top:20px;font-size:25px">Workspace preferences</h1><div data-obstacle style="position:absolute;left:450px;top:250px">Make a decision</div><div data-obstacle style="position:absolute;left:420px;top:310px;width:320px;height:2px;background:#b88400"></div><div style="position:absolute;left:450px;top:340px;font-size:16px">Adjust your presentation settings</div>';
        document.body.prepend(bg);return [...bg.querySelectorAll('[data-obstacle]')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}});
      })()`);
      w.webContents.send("okfilow:cursor", { x: 64, y: 80 }); await sleep(600);
    } else await sleep(800);
    await w.webContents.executeJavaScript(sampler);
    if (scene === "pointer") { w.webContents.send("okfilow:point", [{ x: 500, y: 262, label: "Settings" }], avoid); await sleep(2200); }
    else {
      await sleep(5000);
      for (let pose = 0; pose < 24; pose++) {
        await w.webContents.executeJavaScript(`(()=>{const s=document.querySelector('.okf-model-view').__okf;window.qaPose=${pose};const p=s.camera.position;const r=Math.hypot(p.x,p.z);p.x=r*Math.cos(${pose}*Math.PI/12);p.z=r*Math.sin(${pose}*Math.PI/12);s.camera.lookAt(0,0,0);s.camera.updateMatrixWorld(true);})()`);
        await sleep(220);
      }
    }
    const frames = await w.webContents.executeJavaScript("window.qaOn=false;window.qaFrames");
    result.scenes.push({ scene, theme, avoid, target: scene === "pointer" ? [500, 262] : null, frames, errors });
    w.destroy();
  }
  fs.writeFileSync(OUT, JSON.stringify(result)); clearTimeout(deadline); app.exit(0);
})().catch(e => { fs.writeFileSync(OUT + ".error.txt", String(e.stack)); app.exit(2); });
