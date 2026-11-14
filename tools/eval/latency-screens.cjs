// Renders the speed baseline's synthetic screens (tools/eval/latency.mjs, FILOW_OKF_QA_SCREEN): 40 layouts
// of latency-screen.html at 1920x1080, each saved as NNN.png with NNN.json beside it ({ elements }: what
// Windows would name on that screen). Offscreen: no window ever appears.
// Usage: <repo electron.exe> tools/eval/latency-screens.cjs <out dir> [count=40]
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const out = process.argv[2];
const count = Number(process.argv[3] || 40);
if (!out) { console.error("usage: electron latency-screens.cjs <out dir> [count]"); process.exit(2); }
// Electron's own profile stays beside the pictures, not in the user's AppData.
app.setPath("userData", path.join(path.resolve(out), ".electron-profile"));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-device-scale-factor", "1");

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const page = path.join(__dirname, "latency-screen.html");
  // One offscreen window for every layout (a fresh window per layout sometimes failed to load: ERR_FAILED).
  const win = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, webPreferences: { offscreen: true, sandbox: true } });
  for (let n = 1; n <= count; n++) {
    for (let attempt = 1; ; attempt++) {
      try {
        await win.loadFile(page, { query: { seed: String(n) } });
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    for (let i = 0; i < 50 && !(await win.webContents.executeJavaScript("window.__ready === true")); i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 300));
    // the boxes are on the grid of the viewport, which is what the capture shows (latency-screen.html)
    const elements = await win.webContents.executeJavaScript("window.__elements()");
    const viewport = await win.webContents.executeJavaScript("({ width: innerWidth, height: innerHeight })");
    // a thing the picture does not show cannot be a target
    const off = elements.filter((e) => e.x1 < 0 || e.y1 < 0 || e.x2 > 1000 || e.y2 > 1000);
    if (off.length) throw new Error(`layout ${n}: ${off.map((e) => e.name).join(", ")} outside the ${viewport.width}x${viewport.height} picture`);
    let img = await win.webContents.capturePage();
    const size = img.getSize();
    if (size.width !== viewport.width || size.height !== viewport.height) throw new Error(`layout ${n}: captured ${size.width}x${size.height}, viewport ${viewport.width}x${viewport.height}`);
    if (size.width !== 1920 || size.height !== 1080) img = img.resize({ width: 1920, height: 1080 });
    const name = String(n).padStart(3, "0");
    fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG());
    // viewport: the grid's size before the stretch; its presence also marks screens made by this version
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify({ elements, viewport }));
  }
  win.destroy();
  console.log(`latency screens: ${count} written`);
  app.quit();
}).catch((e) => {
  console.error(`latency screens: ${e && e.message}`);
  app.exit(1);
});
