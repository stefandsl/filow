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
  const FRAMES = process.env.QA_MEDIA_FRAMES || path.join(OUT, "frames4");
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
  // Numeric checks of what the reviewer looks at: the ring on its target, source lines on one line, shared column edges, the margin under the toolbar.
  const CHECKS = `(() => {
    const R = (e) => e.getBoundingClientRect();
    const out = { marks: document.querySelectorAll('.okf-marks g.okf-mark:not(.okf-mark--leaving)').length };
    const ink = document.querySelector('.okf-marks g.okf-mark:not(.okf-mark--leaving) .okf-mark-ink');
    const target = document.getElementById('qa-desk-target');
    if (ink && target) { const a = R(ink), b = R(target); out.ringOffPx = Math.round(Math.hypot((a.left + a.right) / 2 - (b.left + b.right) / 2, (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) * 10) / 10; }
    const lines = [...document.querySelectorAll('.okf-media-source, .okf-media-caption')].map((e) => ({ h: R(e).height, lh: parseFloat(getComputedStyle(e).lineHeight) || 16, cut: e.scrollWidth > e.clientWidth }));
    out.wrappedLines = lines.filter((l) => l.h > l.lh * 1.5).length;
    out.truncatedWithTooltip = [...document.querySelectorAll('.okf-media-source')].filter((e) => e.scrollWidth > e.clientWidth).every((e) => e.title === e.textContent);
    const tiles = [...document.querySelectorAll('.okf-media-tile')].map(R);
    const slide = document.querySelector('.okf-slide');
    if (slide && tiles.length) { const s = R(slide); out.edgeLeftPx = Math.abs(s.left - Math.min(...tiles.map((t) => t.left))); out.edgeRightPx = Math.abs(s.right - Math.max(...tiles.map((t) => t.right))); }
    const pill = document.querySelector('.okf-notch');
    if (pill) { const p = R(pill); const below = [...tiles, ...(slide ? [R(slide)] : [])].filter((m) => m.left < p.right && m.right > p.left && m.top >= p.bottom); if (below.length) out.toolbarGapPx = Math.round(Math.min(...below.map((m) => m.top - p.bottom)) * 10) / 10; }
    const bubble = document.querySelector(".okf-bubble");
    const media = [...document.querySelectorAll(".okf-media-tile, .okf-slide")].map(R);
    if (bubble && media.length) { const b = R(bubble); const d = (m) => Math.hypot(Math.max(0, m.left - b.right, b.left - m.right), Math.max(0, m.top - b.bottom, b.top - m.bottom)); out.bubbleToMediaPx = Math.round(Math.min(...media.map(d))); }
    const first = document.querySelector(".okf-media-tile") ?? document.querySelector(".okf-slide");
    const arrow = document.querySelector(".okf-buddy .okf-arrow");
    if (first && arrow) { const f = R(first), a = R(arrow); const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2; out.pointerInFirst = x >= f.left && x <= f.right && y >= f.top && y <= f.bottom; out.pointerPaintedOver = Boolean(document.querySelector(".okf-media")?.compareDocumentPosition(document.querySelector(".okf-overlay")) & Node.DOCUMENT_POSITION_FOLLOWING); }
    out.sourceClipped = [...document.querySelectorAll(".okf-media-source")].filter((s) => { const box = R(s); return [...s.children].some((p) => { const r = R(p); return r.right > box.right + 0.5 || r.bottom > box.bottom + 0.5; }); }).length;
    out.sourceLines = Math.max(0, ...[...document.querySelectorAll(".okf-media-source")].map((s) => Math.round(R(s).height / (parseFloat(getComputedStyle(s).lineHeight) || 15))));
    return JSON.stringify(out);
  })()`;
  // A desktop icon for the answer to circle (the real overlay sits over the user's desktop and circles real things).
  const desktopIcon = (on) => js(`(() => { document.getElementById('qa-desk-target')?.remove(); if (${on}) { const d = document.createElement('div'); d.id = 'qa-desk-target'; d.style.cssText = 'position:fixed;left:932px;top:372px;width:96px;height:96px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font:13px system-ui;color:' + (document.documentElement.dataset.theme === 'light' ? '#18191c' : '#eceff3') + ';z-index:0'; d.innerHTML = '<svg width="48" height="40" viewBox="0 0 48 40"><path d="M2 6a4 4 0 0 1 4-4h12l5 5h19a4 4 0 0 1 4 4v23a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" fill="#e8b23a" stroke="#a87512" stroke-width="2"/></svg><span>Images</span>'; document.body.prepend(d); } return true; })()`);
  const emit = (ch, p) => js(`window.__qa.emit(${JSON.stringify(ch)}, ${JSON.stringify(p)}); true`);
  const answer = async (text, mark = "") => {
    await emit("state", { mode: "speaking", purpose: "talk", sees: true });
    await emit("pill", { sees: true, paused: false, resumable: false });
    await emit("cursor", { x: 980, y: 560 });
    await emit("text", text);
    await desktopIcon(Boolean(mark));
    await emit("draw", mark ? [{ kind: "circle", x: 980, y: 420, r: 70, label: mark, done: true }] : []);
  };
  // the pill and the bubble are on screen well before the pictures arrive (the lookup takes a moment): let them settle first
  const show = async (s) => { await sleep(500); await emit("media", { x: 960, y: 540, gallery: [], slide: null, ...s }); await sleep(1200); };
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
    await answer("Here are the four test images from your folder: a colour test card, the Mandelbrot set, SMPTE colour bars and a Rule 110 pattern.");
    await show({ gallery: items.photos });
    t.gallery4 = { ...JSON.parse(await js(MEASURE)), ...JSON.parse(await js(CHECKS)) };
    if (process.env.QA_MEDIA_DEBUG) await debug(`gallery ${theme}`);
    t.gallery4.hit = await hitTest();
    await shot(`gallery4-${theme}`);
    // 2. a GIF
    await emit("clear", null);
    await answer("This animation from Wikimedia Commons shows the test pattern moving, frame by frame.");
    await show({ gallery: [items.gif] });
    t.gif = { ...JSON.parse(await js(MEASURE)), ...JSON.parse(await js(CHECKS)), decoded: await js("(() => { const i = document.querySelector('.okf-media-tile img'); return Boolean(i && i.complete && i.naturalWidth > 0); })()") };
    await shot(`gif-${theme}`);
    // 3. a video: muted, looping, playing; pause works (each new question clears the screen first, as the app does)
    await emit("clear", null);
    await answer("Here is a short silent clip of moving colour bars; it loops, and you can pause it.");
    await show({ gallery: [items.video] });
    for (let i = 0; i < 40 && !(await js("(() => { const v = document.querySelector('.okf-media-tile video'); return Boolean(v && v.readyState >= 2 && v.currentTime > 0.3); })()")); i++) await sleep(250);
    t.video = { ...JSON.parse(await js(MEASURE)), ...JSON.parse(await js(CHECKS)), ...JSON.parse(await js("JSON.stringify((() => { const v = document.querySelector('.okf-media-tile video'); return { playing: Boolean(v && !v.paused && v.currentTime > 0.3), muted: Boolean(v && v.muted), loop: Boolean(v && v.loop), seconds: v ? Math.round(v.duration * 10) / 10 : 0 }; })())")) };
    await shot(`video-${theme}`);
    t.video.pauseWorks = await js("(async () => { document.querySelector('.okf-media-tile [data-action=play]').click(); await new Promise((r) => setTimeout(r, 300)); return document.querySelector('.okf-media-tile video').paused; })()");
    // 4. a slide with two pictures, and two more pictures beside it
    await emit("clear", null);
    await answer("Here is a slide on test patterns, with two examples on it and two more above it.");
    await show({ slide: { title: "What a test pattern is for", points: ["A known picture to check a screen or a camera", "Colour bars show if the colours are right", "Moving patterns show dropped or torn frames"], media: [items.gif, items.photos[0]] }, gallery: [items.photos[1], items.video] });
    t.slide = { ...JSON.parse(await js(MEASURE)), ...JSON.parse(await js(CHECKS)), slideMedia: await js("document.querySelectorAll('.okf-slide .okf-media-box').length") };
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
    const tall = await wjs("Math.ceil(document.querySelector(\"main.wb-page\").getBoundingClientRect().bottom + 24)");
    wb.setContentSize(1400, Math.max(600, tall));
    await sleep(900);
    result.board.clippedPx = await wjs("Math.max(0, document.documentElement.scrollHeight - innerHeight)");
    // the hairline round a GIF on the board against the board itself (WCAG non-text contrast reads 3:1; asked here: 1.5:1)
    result.board[`frameContrast_${theme}`] = await wjs("(() => { const g = document.querySelector(\".wb-gif\"); const board = document.querySelector(\".wb-frame\") ?? document.querySelector(\".wb-ex\"); if (!g || !board) return null; const n = (s) => (s.match(/[\\d.]+/g) || []).map(Number); const sh = getComputedStyle(g).boxShadow; if (!sh || sh === \"none\") return 1; const c = n(sh.slice(0, sh.indexOf(\")\") + 1)); let bg = n(getComputedStyle(board).backgroundColor); if (bg.length < 3 || bg[3] === 0) bg = [255, 255, 255]; const a = c.length > 3 ? c[3] : 1; const line = [0, 1, 2].map((i) => c[i] * a + bg[i] * (1 - a)); const lum = (v) => v.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0); const p = lum(line), q = lum(bg); return Math.round(((Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05)) * 100) / 100; })()");
    // the contrast of every button's words on its own background, in this theme (WCAG: 4.5 for normal text)
    result.board[`minButtonContrast_${theme}`] = await wjs("(() => { const rgb = (s) => { const n = (s.match(/[\\d.]+/g) || []).map(Number); return s.startsWith(\"color(srgb\") ? [n[0] * 255, n[1] * 255, n[2] * 255, ...(n.length > 3 ? [n[3]] : [])] : n; }; const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }; const page = rgb(getComputedStyle(document.body).backgroundColor); const ratio = (el) => { const s = getComputedStyle(el); let bg = rgb(s.backgroundColor); if (bg.length === 4 && bg[3] === 0) bg = page; const fg = rgb(s.color); const k = (fg.length === 4 ? fg[3] : 1) * Number(s.opacity); const seen = [0, 1, 2].map((i) => fg[i] * k + bg[i] * (1 - k)); const a = lum(seen), c = lum(bg); return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05); }; const all = [...document.querySelectorAll('main.wb-page button.wb-btn')].filter((b) => b.offsetParent && (b.textContent || '').trim()); const worst = all.map((b) => [ratio(b), b.textContent.trim()]).sort((x, y) => x[0] - y[0])[0]; return worst ? Math.round(worst[0] * 100) / 100 + ' ' + worst[1] : null; })()");
    fs.writeFileSync(path.join(FRAMES, `board-gif-${theme}.png`), (await wb.webContents.capturePage()).toPNG());
  }
  const pre = result.board;
  result.board = JSON.parse(await wjs("JSON.stringify({ media: Number(document.querySelector('.wb-ex')?.dataset.media || 0), gifShown: [...document.querySelectorAll('.wb-gif')].some((i) => i.complete && i.naturalWidth > 0), alignPx: (() => { const a = document.querySelector('.wb-gif')?.getBoundingClientRect(); const b = (document.querySelector('.wb-ex svg use') ?? document.querySelector('.wb-ex svg image'))?.getBoundingClientRect(); return a && b ? Math.round(Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height)) * 10) / 10 : null; })(), gifInSvg: [...document.querySelectorAll('.wb-ex svg image')].some((i) => (i.getAttribute('href') || '').startsWith('data:image/gif')), overflow: document.documentElement.scrollWidth - innerWidth, primaryContrast: (() => { const b = document.querySelector(\x27main.wb-page button.primary\x27); if (!b) return null; const rgb = (s) => (s.match(/[\\d.]+/g) || []).map(Number); const lum = ([r, g, bl]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl); }; const s = getComputedStyle(b); const fg = rgb(s.color), bg = rgb(s.backgroundColor); const a = lum(fg), c = lum(bg); return Math.round(((Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05)) * 100) / 100; })(), sourceLine: [...document.querySelectorAll('.wb-ex .wb-sr li')].map((l) => l.textContent).find((x) => /Wikimedia Commons/.test(x || '')) ?? null })"));
  Object.assign(result.board, pre);
  const saved = await wjs(`(async () => { let text = null; const blobs = new Map(); const make = URL.createObjectURL; URL.createObjectURL = (b) => { const u = make.call(URL, b); blobs.set(u, b); return u; }; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { const b = blobs.get(this.href); if (b) b.text().then((t) => { text = t; }); } else orig.call(this); }; document.querySelector('main.wb-page [data-action=save-excalidraw]')?.click(); for (let i = 0; i < 40 && text === null; i++) await new Promise((r) => setTimeout(r, 100)); HTMLAnchorElement.prototype.click = orig; URL.createObjectURL = make; return text; })()`);
  if (saved) fs.writeFileSync(path.join(path.dirname(BOARD), "saved.excalidraw"), saved);
  result.board.saved = Boolean(saved);
  result.board.consoleErrors = wbLogs;
  result.overlayConsoleErrors = logs.filter((l) => !/Security Warning|preloaded using link preload/.test(l));
  wb.destroy();

  fs.writeFileSync(path.join(OUT, "qa-media.json"), JSON.stringify(result, null, 2));
  exit(0);
}).catch((e) => { fs.writeFileSync(path.join(OUT, "qa-media-error.txt"), String(e && e.stack || e)); exit(1); });
