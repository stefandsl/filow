// The Electron side of tools/media/qa-media.mjs: one offscreen window (never on screen, sound muted),
// its own profile under the output folder, debug port 9631, only 127.0.0.1:5031-5035 reachable.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

if (process.env.FILOW_QA_HEADLESS !== "1" || process.env.FILOW_QA_NO_GLOBAL_INPUT !== "1") throw new Error("QA isolation required");
const OUT = process.env.QA_MEDIA_OUT;
const ROOT = process.env.QA_MEDIA_ROOT;
const BOARD = process.env.QA_MEDIA_BOARD;
const BASE = "http://127.0.0.1:5031";
const { insideAny, cleanRects } = require(path.join(ROOT, "apps/desktop/okfilow-hit.js"));
const { overlayMouse } = require(path.join(ROOT, "apps/desktop/okfilow-stop.js"));
app.setPath("userData", path.join(OUT, "qa-profile"));
app.commandLine.appendSwitch("remote-debugging-port", "9631");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const W = 1920, H = 1080;
let win = null;
const exit = (code) => { try { win?.destroy(); } catch { /* gone */ } app.exit(code); };
setTimeout(() => { fs.writeFileSync(path.join(OUT, "qa-media-error.txt"), "timed out"); exit(2); }, 600_000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !(/^(?:https?|wss?):\/\/127\.0\.0\.1:503[1-5]\//.test(d.url) || /^(?:data|blob|devtools|chrome-extension):/.test(d.url)) }));
  win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true, preload: path.join(ROOT, "tools/media/fake-bridge.cjs"), contextIsolation: true, sandbox: false, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.setAudioMuted(true);
  win.webContents.setFrameRate(30);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const FRAMES = process.env.QA_MEDIA_FRAMES || path.join(OUT, "frames2");
  const shot = async (name) => { await sleep(700); fs.writeFileSync(path.join(FRAMES, `${name}.png`), (await win.webContents.capturePage()).toPNG()); };
  const result = { at: new Date().toISOString(), view: { width: W, height: H }, hidden: true, themes: {}, board: {} };

  const logs = [];
  win.webContents.on("console-message", (_e, level, message) => { if (level >= 2) logs.push(message.slice(0, 300)); });
  await win.loadURL(`${BASE}/okfilow/overlay`);
  for (let i = 0; i < 120 && !(await js("Boolean(window.__qa && document.querySelector('.okf-overlay'))")); i++) await sleep(500);
  // `next dev` draws its own badge in a corner; a released build has none, so it is not in the frames
  const noDevBadge = "nextjs-portal { display: none !important; }";
  await win.webContents.insertCSS(noDevBadge);
  const debug = async (tag) => fs.appendFileSync(path.join(OUT, "qa-media-debug.txt"), `--- ${tag}\n${await js("JSON.stringify({ tags: [...document.body.children].map((e) => e.tagName + '.' + e.className).join(' '), next: typeof window.next, nextVer: window.next && window.next.version, ready: document.readyState, overlay: Boolean(document.querySelector('.okf-overlay')), media: document.querySelectorAll('.okf-media *').length, tiles: [...document.querySelectorAll('.okf-media-tile')].map((e) => e.getAttribute('style')), listeners: Object.keys(window.__qa ? window.__qa : {}), html: document.querySelector('.okf-media')?.outerHTML.slice(0, 600) ?? null, size: [innerWidth, innerHeight, devicePixelRatio] })")}\nlogs: ${logs.splice(0).join(" | ")}\n`);

  // The items, through the real routes: the user's own pictures on loopback, a GIF and a video from (fake) Commons.
  const items = JSON.parse(await js(`(async () => {
    const get = async (p, h = {}) => { const r = await fetch(p, { headers: h }); return { status: r.status, j: await r.json() }; };
    const own = (n) => get('/api/buddy/media?own=' + encodeURIComponent('http://127.0.0.1:5033/' + n) + '&label=' + encodeURIComponent('Your file'));
    const yes = { 'x-filow-consent': 'photo:wikimedia' };
    const photos = await Promise.all(['Colour test card.png', 'Mandelbrot set.png', 'SMPTE colour bars.png', 'Rule 110 automaton.png'].map(own));
    const refused = await get('/api/buddy/media?kind=gif&q=Test%20pattern');
    const gif = await get('/api/buddy/media?kind=gif&q=Test%20pattern', yes);
    const video = await get('/api/buddy/media?kind=video&q=Colour%20bars', yes);
    return JSON.stringify({ photos: photos.map((p) => p.j.item), gif: gif.j.item, video: video.j.item, refusedStatus: refused.status, refusedCode: refused.j.code });
  })()`));
  result.routes = { photos: items.photos.filter(Boolean).length, gif: Boolean(items.gif), video: Boolean(items.video), withoutYes: `${items.refusedStatus} ${items.refusedCode}` };

  const MEASURE = `(() => {
    const R = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    const seen = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && Number(s.opacity) > 0.05; };
    const media = [...document.querySelectorAll('.okf-media-tile, .okf-slide')].filter(seen).map(R);
    const others = [...document.querySelectorAll('.okf-bubble, .okf-notch, .okf-marks g.okf-mark .okf-mark-ink, .okf-mark-label, .okf-card')].filter(seen).map((e) => ({ cls: e.getAttribute('class'), ...R(e) }));
    const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    let overlaps = 0; const pairs = [];
    media.forEach((m, i) => { media.slice(i + 1).forEach((n) => { if (area(m, n) > 0) { overlaps++; pairs.push('media/media'); } }); others.forEach((o) => { if (area(m, o) > 0) { overlaps++; pairs.push('media/' + o.cls); } }); });
    const inside = media.filter((m) => m.left >= 0 && m.top >= 0 && m.right <= innerWidth && m.bottom <= innerHeight).length;
    return JSON.stringify({ media: media.length, others: others.map((o) => o.cls), overlaps, pairs, insidePct: media.length ? Math.round((inside / media.length) * 100) : 100 });
  })()`;
  const emit = (ch, p) => js(`window.__qa.emit(${JSON.stringify(ch)}, ${JSON.stringify(p)}); true`);
  const answer = async (text, mark = "") => {
    await emit("state", { mode: "speaking", purpose: "talk", sees: true });
    await emit("pill", { sees: true, paused: false, resumable: false });
    await emit("cursor", { x: 980, y: 560 });
    await emit("text", text);
    await emit("draw", mark ? [{ kind: "circle", x: 980, y: 420, r: 70, label: mark, done: true }] : []);
  };
  const show = async (s) => { await emit("media", { x: 960, y: 540, gallery: [], slide: null, ...s }); await sleep(1200); };
  const hitTest = async () => {
    const calls = JSON.parse(await js("JSON.stringify(window.__qa.calls().overlayRects)"));
    const rects = cleanRects(calls[calls.length - 1] || []);
    const pts = [];
    for (let y = 10; y < H; y += 40) for (let x = 10; x < W; x += 40) pts.push([x, y]);
    const truth = JSON.parse(await js(`JSON.stringify(${JSON.stringify(pts)}.map(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.okf-media-tile, .okf-slide'))))`));
    let mismatch = 0, outside = 0, through = 0, onMedia = 0, takes = 0;
    const wrong = [];
    pts.forEach(([x, y], i) => {
      const media = insideAny({ x, y }, rects);
      const ignore = overlayMouse({ caught: false, hover: false, media, mode: "speaking", pill: {}, bubble: false }).ignore;
      if (truth[i]) { onMedia++; if (!ignore) takes++; } else { outside++; if (ignore) through++; }
      if (media !== truth[i]) { mismatch++; if (wrong.length < 6) wrong.push([x, y, media]); }
    });
    return { points: pts.length, outside, clickThroughOutside: through, onMedia, takesOnMedia: takes, mismatch, ...(wrong.length ? { wrong, rects } : {}) };
  };

  for (const theme of ["dark", "light"]) {
    const t = {};
    // The real overlay is transparent over the user's desktop: here a plain desktop colour of the theme stands behind it.
    const desk = theme === "light" ? "#dfe5ec" : "#1c2027";
    win.setBackgroundColor(desk);
    await js(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.documentElement.style.setProperty("background", ${JSON.stringify(desk)}, "important"); document.body.style.setProperty("background", ${JSON.stringify(desk)}, "important"); true`);
    await emit("clear", null);
    // 1. four pictures
    await answer("Here are the four test images from your folder: a colour test card, the Mandelbrot set, SMPTE colour bars and a Rule 110 pattern.", "Images folder");
    await show({ gallery: items.photos });
    t.gallery4 = JSON.parse(await js(MEASURE));
    if (process.env.QA_MEDIA_DEBUG) await debug(`gallery ${theme}`);
    t.gallery4.hit = await hitTest();
    await shot(`gallery4-${theme}`);
    // 2. a GIF
    await emit("clear", null);
    await answer("This animation from Wikimedia Commons shows the test pattern moving, frame by frame.");
    await show({ gallery: [items.gif] });
    t.gif = { ...JSON.parse(await js(MEASURE)), decoded: await js("(() => { const i = document.querySelector('.okf-media-tile img'); return Boolean(i && i.complete && i.naturalWidth > 0); })()") };
    await shot(`gif-${theme}`);
    // 3. a video: muted, looping, playing; pause works
    await answer("Here is a short silent clip of moving colour bars; it loops, and you can pause it.");
    await show({ gallery: [items.video] });
    for (let i = 0; i < 40 && !(await js("(() => { const v = document.querySelector('.okf-media-tile video'); return Boolean(v && v.readyState >= 2 && v.currentTime > 0.3); })()")); i++) await sleep(250);
    t.video = { ...JSON.parse(await js(MEASURE)), ...JSON.parse(await js("JSON.stringify((() => { const v = document.querySelector('.okf-media-tile video'); return { playing: Boolean(v && !v.paused && v.currentTime > 0.3), muted: Boolean(v && v.muted), loop: Boolean(v && v.loop), seconds: v ? Math.round(v.duration * 10) / 10 : 0 }; })())")) };
    await shot(`video-${theme}`);
    t.video.pauseWorks = await js("(async () => { document.querySelector('.okf-media-tile [data-action=play]').click(); await new Promise((r) => setTimeout(r, 300)); return document.querySelector('.okf-media-tile video').paused; })()");
    // 4. a slide with two pictures, and two more pictures beside it
    await answer("Here is a slide on test patterns, with two examples on it and two more above it.", "Images folder");
    await show({ slide: { title: "What a test pattern is for", points: ["A known picture to check a screen or a camera", "Colour bars show if the colours are right", "Moving patterns show dropped or torn frames"], media: [items.gif, items.photos[0]] }, gallery: [items.photos[1], items.video] });
    t.slide = { ...JSON.parse(await js(MEASURE)), slideMedia: await js("document.querySelectorAll('.okf-slide .okf-media-box').length") };
    t.slide.hit = await hitTest();
    await shot(`slide-${theme}`);
    // 5. Stop: everything goes, playback ends
    t.stop = JSON.parse(await js(`new Promise((done) => { const t0 = performance.now(); window.__qa.emit('state', { mode: 'idle', stopped: true }); const check = () => { if (!document.querySelector('.okf-media')) done(JSON.stringify({ ms: Math.round((performance.now() - t0) * 10) / 10, videos: document.querySelectorAll('video').length })); else requestAnimationFrame(check); }; check(); })`));
    t.stop.rectsCleared = await js("(() => { const c = window.__qa.calls().overlayRects; return (c[c.length - 1] || []).length === 0; })()");
    await emit("clear", null);
    result.themes[theme] = t;
  }

  // 6. The whiteboard with a GIF: opened from a .excalidraw file, saved again by the page.
  const wb = new BrowserWindow({ show: false, width: 1400, height: 1000, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  wb.webContents.setAudioMuted(true);
  const wjs = (code) => wb.webContents.executeJavaScript(code, true);
  const wbLogs = [];
  wb.webContents.on("console-message", (_e, level, message) => { if (level >= 2 && !/Security Warning|preloaded using link preload/.test(message)) wbLogs.push(message.slice(0, 400)); });
  await wb.loadURL(`${BASE}/okfilow/whiteboard?voice=off`);
  for (let i = 0; i < 160 && !(await wjs("Boolean(document.querySelector('main.wb-page input[type=file]'))")); i++) await sleep(500);
  await wb.webContents.insertCSS(noDevBadge);
  wb.webContents.debugger.attach("1.3");
  const cdp = (m, p) => wb.webContents.debugger.sendCommand(m, p);
  const { root } = await cdp("DOM.getDocument", { depth: -1 });
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "main.wb-page input[type=file]" });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [BOARD] });
  for (let i = 0; i < 60 && !(await wjs("Number(document.querySelector('.wb-ex')?.dataset.media || 0) > 0 && Boolean(document.querySelector('.wb-ex svg image'))")); i++) await sleep(500);
  for (const theme of ["dark", "light"]) {
    await wjs(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true`);
    await sleep(900);
    // the whole page, not the top of it: the window is made as tall as the page before the frame is taken
    const tall = await wjs("Math.ceil(document.documentElement.scrollHeight)");
    wb.setContentSize(1400, Math.max(1000, tall));
    await sleep(900);
    result.board.clippedPx = await wjs("Math.max(0, document.documentElement.scrollHeight - innerHeight)");
    fs.writeFileSync(path.join(FRAMES, `board-gif-${theme}.png`), (await wb.webContents.capturePage()).toPNG());
  }
  const clipped = result.board.clippedPx;
  result.board = JSON.parse(await wjs("JSON.stringify({ media: Number(document.querySelector('.wb-ex')?.dataset.media || 0), gifShown: [...document.querySelectorAll('.wb-gif')].some((i) => i.complete && i.naturalWidth > 0), alignPx: (() => { const a = document.querySelector('.wb-gif')?.getBoundingClientRect(); const b = (document.querySelector('.wb-ex svg use') ?? document.querySelector('.wb-ex svg image'))?.getBoundingClientRect(); return a && b ? Math.round(Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height)) * 10) / 10 : null; })(), gifInSvg: [...document.querySelectorAll('.wb-ex svg image')].some((i) => (i.getAttribute('href') || '').startsWith('data:image/gif')), overflow: document.documentElement.scrollWidth - innerWidth, sourceLine: [...document.querySelectorAll('.wb-ex .wb-sr li')].map((l) => l.textContent).find((x) => /Wikimedia Commons/.test(x || '')) ?? null })"));
  result.board.clippedPx = clipped;
  const saved = await wjs(`(async () => { let text = null; const blobs = new Map(); const make = URL.createObjectURL; URL.createObjectURL = (b) => { const u = make.call(URL, b); blobs.set(u, b); return u; }; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { const b = blobs.get(this.href); if (b) b.text().then((t) => { text = t; }); } else orig.call(this); }; document.querySelector('main.wb-page [data-action=save-excalidraw]')?.click(); for (let i = 0; i < 40 && text === null; i++) await new Promise((r) => setTimeout(r, 100)); HTMLAnchorElement.prototype.click = orig; URL.createObjectURL = make; return text; })()`);
  if (saved) fs.writeFileSync(path.join(path.dirname(BOARD), "saved.excalidraw"), saved);
  result.board.saved = Boolean(saved);
  result.board.consoleErrors = wbLogs;
  result.overlayConsoleErrors = logs.filter((l) => !/Security Warning|preloaded using link preload/.test(l));
  wb.destroy();

  fs.writeFileSync(path.join(OUT, "qa-media.json"), JSON.stringify(result, null, 2));
  exit(0);
}).catch((e) => { fs.writeFileSync(path.join(OUT, "qa-media-error.txt"), String(e && e.stack || e)); exit(1); });
