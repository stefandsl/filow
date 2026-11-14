// Hidden check of moving and resizing what OK Filow puts over the desktop (lib/buddy/layout-move.ts,
// apps/desktop/okfilow-move.js), run by tools/media/qa-media.mjs --move. Offscreen windows only, sound
// muted, own profile, debug port 9631, only 127.0.0.1:5031-5035 reachable. The pointer is driven with
// input events into the offscreen pages (never the real mouse).
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

if (process.env.FILOW_QA_HEADLESS !== "1" || process.env.FILOW_QA_NO_GLOBAL_INPUT !== "1") throw new Error("QA isolation required");
const OUT = process.env.QA_MEDIA_OUT;
const ROOT = process.env.QA_MEDIA_ROOT;
const FRAMES = process.env.QA_MEDIA_FRAMES || path.join(OUT, "frames7");
const BASE = "http://127.0.0.1:5031";
const { insideAny, cleanRects } = require(path.join(ROOT, "apps/desktop/okfilow-hit.js"));
const { movedBounds } = require(path.join(ROOT, "apps/desktop/okfilow-move.js"));
app.setPath("userData", path.join(OUT, "qa-profile-move"));
app.commandLine.appendSwitch("remote-debugging-port", "9631");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const W = 1920, H = 1080;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exit = (code) => app.exit(code);
setTimeout(() => { fs.writeFileSync(path.join(OUT, "qa-move-error.txt"), "timed out"); exit(2); }, 600_000).unref();

const CAR = { title: "Car", parts: [
  { name: "Body", shape: "box", size: [3.2, 0.7, 1.5], pos: [0, 0.2, 0], rot: [0, 0, 0], color: "#c0392b" },
  { name: "Cabin", shape: "box", size: [1.6, 0.6, 1.3], pos: [-0.2, 0.85, 0], rot: [0, 0, 0], color: "#2c3e50" },
  { name: "Front left wheel", shape: "cylinder", size: [0.7, 0.3, 0.7], pos: [1, -0.25, 0.8], rot: [90, 0, 0], color: "#222222" },
  { name: "Front right wheel", shape: "cylinder", size: [0.7, 0.3, 0.7], pos: [1, -0.25, -0.8], rot: [90, 0, 0], color: "#222222" },
  { name: "Rear left wheel", shape: "cylinder", size: [0.7, 0.3, 0.7], pos: [-1, -0.25, 0.8], rot: [90, 0, 0], color: "#222222" },
  { name: "Rear right wheel", shape: "cylinder", size: [0.7, 0.3, 0.7], pos: [-1, -0.25, -0.8], rot: [90, 0, 0], color: "#222222" },
  { name: "Headlight", shape: "sphere", size: [0.25], pos: [1.6, 0.3, 0.5], rot: [0, 0, 0], color: "#f1c40f" },
] };

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !(/^(?:https?|wss?):\/\/127\.0\.0\.1:503[1-5]\//.test(d.url) || /^(?:data|blob|devtools|chrome-extension):/.test(d.url)) }));
  const make = (w, h, transparent = false) => {
    const b = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, transparent, ...(transparent ? { backgroundColor: "#00000000" } : {}), webPreferences: { offscreen: true, preload: path.join(ROOT, "tools/media/fake-bridge.cjs"), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
    b.webContents.setAudioMuted(true);
    b.webContents.setFrameRate(30);
    return b;
  };
  const noBadge = "nextjs-portal { display: none !important; }";
  const result = { at: new Date().toISOString(), themes: {} };

  // ---- the 3D model window: its handle drags, its grip resizes, arrows move, the view is drawn at the new size ----
  // transparent like the real model window: on the desktop only the model, its labels and its tools show
  const model = make(640, 480, true);
  const mjs = (c) => model.webContents.executeJavaScript(c, true);
  await model.loadURL(`${BASE}/okfilow/model`);
  for (let i = 0; i < 120 && !(await mjs("Boolean(window.__qa && document.querySelector('.okf-model-tools'))")); i++) await sleep(500);
  await model.webContents.insertCSS(noBadge);
  await mjs(`window.__qa.emit("model", ${JSON.stringify(CAR)}); true`);
  await sleep(2500);
  // globalX/Y: where the pointer is on the screen (the model page reads screenX/Y; offscreen windows sit at 0,0)
  const mouse = async (wc, type, x, y) => { wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), globalX: Math.round(x), globalY: Math.round(y), button: "left", clickCount: 1 }); await sleep(30); };
  const dragIn = async (wc, from, dx, dy, steps = 8) => {
    await mouse(wc, "mouseMove", from.x, from.y);
    await mouse(wc, "mouseDown", from.x, from.y);
    for (let i = 1; i <= steps; i++) await mouse(wc, "mouseMove", from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    await mouse(wc, "mouseUp", from.x + dx, from.y + dy);
  };
  const centre = (sel, js) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`).then((v) => v);
  // the size of a handle or grip, and the contrast of its mark against what is behind it
  const CHROME = `JSON.stringify([...document.querySelectorAll(".okf-model-grip, .okf-model-resize, .okf-model-tools .okf-x, .okf-move, .okf-resize")].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); const bgs = []; for (let p = e; p; p = p.parentElement) bgs.push(getComputedStyle(p).backgroundColor); return { cls: String(e.className.baseVal ?? e.className), w: Math.round(r.width), h: Math.round(r.height), color: s.color, image: s.backgroundImage, bgs, cursor: s.cursor }; }))`;
  // the contrast of a handle's mark against what is behind it (WCAG), worked out here from the page's colours
  const rgb = (v) => { const m = (String(v).match(/[\d.]+/g) || []).map(Number); return String(v).startsWith("color(srgb") ? [m[0] * 255, m[1] * 255, m[2] * 255, m.length > 3 ? m[3] : 1] : [m[0], m[1], m[2], m.length > 3 ? m[3] : 1]; };
  const lum = (v) => v.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
  const withContrast = (list, desk) => list.map((h) => {
    const bg = (h.bgs.map(rgb).find((c) => c[3] >= 0.5) ?? rgb(desk)).slice(0, 3);
    const fgRaw = h.cls.includes("okf-model-grip") ? rgb((String(h.image).match(/rgba?\([^)]*\)/) || ["rgb(0,0,0)"])[0]) : rgb(h.color);
    const a = fgRaw[3];
    const fg = [0, 1, 2].map((i) => fgRaw[i] * a + bg[i] * (1 - a));
    const p = lum(fg), q = lum(bg);
    return { cls: h.cls, w: h.w, h: h.h, contrast: Math.round(((Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05)) * 10) / 10, cursor: h.cursor };
  });  const sum = (list, k) => list.reduce((s, d) => s + (Number.isFinite(d[k]) ? d[k] : 0), 0);
  const calls = () => mjs("JSON.stringify(window.__qa.calls())").then(JSON.parse);
  const modelShots = {};
  for (const theme of ["dark", "light"]) {
    await mjs(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true`);
    await mouse(model.webContents, "mouseMove", 320, 240);
    await sleep(500);
    const shot = await model.webContents.capturePage();
    fs.writeFileSync(path.join(FRAMES, `model-${theme}.png`), shot.toPNG());
    modelShots[theme] = shot.toDataURL();
  }
  const before = (await calls()).modelMove.length;
  // the 3D window's chrome: handle, close and grip, in both themes, at least 24 px, at 3:1 or more against the window
  result.modelChrome = withContrast(JSON.parse(await mjs(CHROME)), "#1c2027");
  const grip = await centre(".okf-model-grip", mjs);
  await dragIn(model.webContents, grip, 140, 60);
  let moves = (await calls()).modelMove.slice(before);
  const drag = { dx: sum(moves, "dx"), dy: sum(moves, "dy"), done: moves.some((d) => d.done === true) };
  const before2 = (await calls()).modelMove.length;
  const corner = await centre(".okf-model-resize", mjs);
  await dragIn(model.webContents, corner, 120, 80);
  moves = (await calls()).modelMove.slice(before2);
  const resize = { dw: sum(moves, "dw"), dh: sum(moves, "dh"), dx: sum(moves, "dx") };
  // the window as main would size it (okfilow-move.js), then the page drawn at that size
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 1920, y: 0, width: 2560, height: 1400 }];
  const grown = movedBounds({ x: 400, y: 200, width: 640, height: 480 }, { dx: 0, dy: 0, dw: resize.dw, dh: resize.dh }, areas);
  model.setContentSize(grown.width, grown.height);
  await sleep(800);
  const canvas = JSON.parse(await mjs("JSON.stringify((() => { const c = document.querySelector('canvas'); return c ? { w: c.clientWidth, h: c.clientHeight, view: [innerWidth, innerHeight] } : null; })())"));
  const before3 = (await calls()).modelMove.length;
  model.webContents.sendInputEvent({ type: "keyDown", keyCode: "Right" });
  model.webContents.sendInputEvent({ type: "keyDown", keyCode: "Down", modifiers: ["shift"] });
  await sleep(200);
  const keys = (await calls()).modelMove.slice(before3);
  const across = movedBounds({ x: 1500, y: 300, width: 640, height: 480 }, { dx: 900, dy: 0 }, areas);
  result.model = {
    dragSent: drag, dragOk: drag.dx === 140 && drag.dy === 60 && drag.done,
    resizeSent: resize, resizeOk: resize.dw === 120 && resize.dh === 80 && resize.dx === 0,
    redrawnAtNewSize: Boolean(canvas && Math.abs(canvas.w - grown.width) <= 2 && Math.abs(canvas.h - grown.height) <= 2), canvas, grown,
    arrowKeys: keys, arrowsOk: keys.some((d) => d.dx === 16 && d.dy === 0) && keys.some((d) => d.dw === 0 && d.dh === 16),
    draggedOntoSecondScreen: across, staysOnSecondScreen: across.x >= 1920 + 8 && across.x + across.width <= 1920 + 2560 - 8,
  };


  // ---- the overlay: the pictures and the bubble move and resize; outside them clicks go through ----
  const win = make(W, H);
  const js = (c) => win.webContents.executeJavaScript(c, true);
  await win.loadURL(`${BASE}/okfilow/overlay`);
  for (let i = 0; i < 120 && !(await js("Boolean(window.__qa && document.querySelector('.okf-overlay'))")); i++) await sleep(500);
  await win.webContents.insertCSS(noBadge);
  const emit = (ch, p) => js(`window.__qa.emit(${JSON.stringify(ch)}, ${JSON.stringify(p)}); true`);
  const items = JSON.parse(await js(`(async () => { const own = async (n) => (await (await fetch('/api/buddy/media?own=' + encodeURIComponent('http://127.0.0.1:5033/' + n) + '&label=' + encodeURIComponent('Your file'))).json()).item; return JSON.stringify(await Promise.all(['Colour test card.png', 'Mandelbrot set.png', 'SMPTE colour bars.png', 'Rule 110 automaton.png'].map(own))); })()`));
  const box = (sel) => js(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.getBoundingClientRect()); if (!all.length) return null; const l = Math.min(...all.map((r) => r.left)), t = Math.min(...all.map((r) => r.top)), r = Math.max(...all.map((r) => r.right)), b = Math.max(...all.map((r) => r.bottom)); return { x: l, y: t, w: r - l, h: b - t }; })()`);
  for (const theme of ["dark", "light"]) {
    const t = {};
    const desk = theme === "light" ? "#dfe5ec" : "#1c2027";
    win.setBackgroundColor(desk);
    await js(`sessionStorage.clear(); document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.documentElement.style.setProperty("background", ${JSON.stringify(desk)}, "important"); document.body.style.setProperty("background", ${JSON.stringify(desk)}, "important"); true`);
    await emit("resetLayout", null);
    await emit("clear", null);
    // the 3D window as it stands on the desktop (its picture behind the overlay), and main saying where it is
    const mb = { left: 1180, top: 160, right: 1180 + 640, bottom: 160 + 480 };
    await js(`(() => { document.getElementById('qa-model')?.remove(); const i = document.createElement('img'); i.id = 'qa-model'; i.src = ${JSON.stringify(modelShots[theme])}; i.style.cssText = 'position:fixed;left:${mb.left}px;top:${mb.top}px;width:640px;height:480px;z-index:0'; document.body.prepend(i); return true; })()`);
    await emit("modelBounds", mb);
    await emit("state", { mode: "speaking", purpose: "talk", sees: true });
    await emit("pill", { sees: true, paused: false, resumable: false });
    // the pointer is on the model: the bubble would sit on it, and must not
    await emit("cursor", { x: 1400, y: 380 });
    await emit("text", "This is the car you asked about: drag the dots to move it, the corner to resize it.");
    await sleep(900);
    t.bubbleToModelPx = await js(`(() => { const b = document.querySelector(".okf-bubble").getBoundingClientRect(); const m = ${JSON.stringify(mb)}; return Math.round(Math.hypot(Math.max(0, m.left - b.right, b.left - m.right), Math.max(0, m.top - b.bottom, b.top - m.bottom))); })()`);
    const bub = await box(".okf-bubble");
    t.bubbleOverModelPx = bub ? Math.max(0, Math.min(bub.x + bub.w, mb.right) - Math.max(bub.x, mb.left)) * Math.max(0, Math.min(bub.y + bub.h, mb.bottom) - Math.max(bub.y, mb.top)) : null;
    await sleep(300);
    fs.writeFileSync(path.join(FRAMES, `bubble-model-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    // the gallery: drag its handle, resize it from its grip, drag it far (it stays on screen)
    await emit("cursor", { x: 600, y: 700 });
    await emit("text", "Here are the four test images from your folder. Drag the dots on any of them to move the set, or the corner of the last one to resize it.");
    await sleep(400);
    await emit("media", { x: 600, y: 700, gallery: items, slide: null });
    await sleep(1500);
    const g0 = await box(".okf-media-tile");
    await sleep(1500);
    // the pointer's label on the first picture never covers any caption or source line
    t.labelOverCaptionPx = await js(`(() => { const l = document.querySelector(".okf-label"); if (!l) return 0; const a = l.getBoundingClientRect(); let s = 0; for (const e of document.querySelectorAll(".okf-media-caption, .okf-media-source")) { const r = e.getBoundingClientRect(); s += Math.max(0, Math.min(a.right, r.right) - Math.max(a.left, r.left)) * Math.max(0, Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top)); } return Math.round(s); })()`);
    t.bubbleToGalleryPx = await js(`(() => { const b = document.querySelector(".okf-bubble").getBoundingClientRect(); const ts = [...document.querySelectorAll(".okf-media-tile")].map((e) => e.getBoundingClientRect()); return Math.round(Math.min(...ts.map((m) => Math.hypot(Math.max(0, m.left - b.right, b.left - m.right), Math.max(0, m.top - b.bottom, b.top - m.bottom))))); })()`);
    t.chrome = withContrast(JSON.parse(await js(CHROME)), desk);
    fs.writeFileSync(path.join(FRAMES, `gallery-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    const handle = await centre(".okf-media-tile .okf-move", js);
    await dragIn(win.webContents, handle, 180, -120);
    await sleep(300);
    const g1 = await box(".okf-media-tile");
    const grip2 = await centre(".okf-media-tile:last-of-type .okf-resize", js);
    await dragIn(win.webContents, grip2, 160, 0);
    await sleep(300);
    const g2 = await box(".okf-media-tile");
    t.gallery = { start: g0, moved: g1, resized: g2,
      moveOk: Math.abs(g1.x - g0.x - 180) <= 1 && Math.abs(g1.y - g0.y + 120) <= 1 && Math.abs(g1.w - g0.w) <= 1,
      resizeOk: Math.abs(g2.w - g1.w - 160) <= 4 && Math.abs(g2.x - g1.x) <= 1 };
    t.bubbleOverMediaPx = await js(`(() => { const b = document.querySelector('.okf-bubble')?.getBoundingClientRect(); if (!b) return null; let a = 0; for (const e of document.querySelectorAll('.okf-media-tile')) { const r = e.getBoundingClientRect(); a += Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left)) * Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top)); } return a; })()`);
    // nothing of the pointer shows at the bubble's edge, and every handle keeps 8 px from the words and pictures
    t.pointerUnderBubblePx = await js(`(() => { const a = document.querySelector(".okf-buddy:not(.okf-hidden) .okf-arrow")?.getBoundingClientRect(); const b = document.querySelector(".okf-bubble")?.getBoundingClientRect(); if (!a || !b) return 0; return Math.round(Math.max(0, Math.min(a.right, b.right + 8) - Math.max(a.left, b.left - 8)) * Math.max(0, Math.min(a.bottom, b.bottom + 8) - Math.max(a.top, b.top - 8))); })()`);
    t.handleClearancePx = await js(`(() => { let min = Infinity; for (const h of document.querySelectorAll(".okf-move")) { const r = h.getBoundingClientRect(); const item = h.closest(".okf-media-tile, .okf-slide, .okf-bubble, .okf-cards"); if (!item) continue; for (const e of item.querySelectorAll("img, video, h2, li, .okf-text, .okf-media-caption, .okf-media-source")) { const q = e.getBoundingClientRect(); if (q.width === 0 || q.right < r.left || q.left > r.right) continue; const gap = q.top >= r.bottom ? q.top - r.bottom : r.top >= q.bottom ? r.top - q.bottom : -1; min = Math.min(min, gap); } } return min === Infinity ? null : Math.round(min); })()`);
    t.handleDesigns = await js(`[...new Set([...document.querySelectorAll(".okf-move")].map((e) => { const s = getComputedStyle(e); return Math.round(e.getBoundingClientRect().width) + "x" + Math.round(e.getBoundingClientRect().height) + " " + (s.backgroundImage.includes("radial-gradient") ? "grid" : "other"); }))]`);
    fs.writeFileSync(path.join(FRAMES, `gallery-moved-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    // click-through: the boxes main is told about are the pictures, and only they take the mouse
    await sleep(300);
    const rc = JSON.parse(await js("JSON.stringify(window.__qa.calls().overlayRects)"));
    const rects = cleanRects(rc[rc.length - 1] || []);
    const pts = [];
    for (let y = 10; y < H; y += 40) for (let x = 10; x < W; x += 40) pts.push([x, y]);
    const truth = JSON.parse(await js(`JSON.stringify(${JSON.stringify(pts)}.map(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.okf-media-tile, .okf-slide, .okf-card, .okf-cards-bar'))))`));
    let mismatch = 0, outside = 0, through = 0;
    pts.forEach(([x, y], i) => { const on = insideAny({ x, y }, rects); if (!truth[i]) { outside++; if (!on) through++; } if (on !== truth[i]) mismatch++; });
    t.clickThrough = { outside, clickThroughOutside: through, mismatch };
    // far away: kept inside the screen
    const handle2 = await centre(".okf-media-tile .okf-move", js);
    await dragIn(win.webContents, handle2, 3000, 3000, 4);
    await sleep(300);
    const g3 = await box(".okf-media-tile");
    t.farDragInside = g3.x >= 0 && g3.y >= 0 && g3.x + g3.w <= W && g3.y + g3.h <= H;
    t.remembered = await js("sessionStorage.getItem('filow.okf.layout')");
    // a slide: moved with its handle, its words reflow when it is made wider
    await emit("text", "Here is a slide on reading a test card, with two examples; drag its corner to make it wider.");
    await emit("media", { x: 600, y: 600, gallery: [], slide: { title: "Reading a test card", points: ["Colour bars show whether the colours come through right", "Fine lines and patterns show sharpness and scaling", "A moving element shows dropped or torn frames"], media: [items[0], items[2]] } });
    await sleep(1500);
    const s0 = await box(".okf-slide");
    const lines0 = await js("document.querySelector('.okf-slide ul').getBoundingClientRect().height");
    const sg = await centre(".okf-slide .okf-resize", js);
    await dragIn(win.webContents, sg, 200, 0);
    await sleep(400);
    const s1 = await box(".okf-slide");
    const lines1 = await js("document.querySelector('.okf-slide ul').getBoundingClientRect().height");
    // wider: its points take fewer or as many lines (its picture grows with it)
    t.slideCloseButtons = await js("document.querySelectorAll('.okf-slide [data-action=close]').length");
    t.slide = { start: s0, wider: s1, pointsHeight: [lines0, lines1], reflowOk: s1.w > s0.w + 150 && lines1 <= lines0 };
    t.bubbleToSlidePx = await js(`(() => { const b = document.querySelector(".okf-bubble").getBoundingClientRect(); const m = document.querySelector(".okf-slide").getBoundingClientRect(); return Math.round(Math.hypot(Math.max(0, m.left - b.right, b.left - m.right), Math.max(0, m.top - b.bottom, b.top - m.bottom))); })()`);
    fs.writeFileSync(path.join(FRAMES, `slide-resized-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    // reset layout: a double click on a handle puts it back
    const sh = await centre(".okf-slide .okf-move", js);
    win.webContents.sendInputEvent({ type: "mouseDown", x: Math.round(sh.x), y: Math.round(sh.y), button: "left", clickCount: 2 });
    win.webContents.sendInputEvent({ type: "mouseUp", x: Math.round(sh.x), y: Math.round(sh.y), button: "left", clickCount: 2 });
    await sleep(400);
    const s2 = await box(".okf-slide");
    t.resetOk = Math.abs(s2.w - s0.w) <= 2 && (await js("sessionStorage.getItem('filow.okf.layout')")) === null;
    await emit("clear", null);
    result.themes[theme] = t;
  }
  fs.writeFileSync(path.join(OUT, "qa-move.json"), JSON.stringify(result, null, 2));
  exit(0);
}).catch((e) => { fs.writeFileSync(path.join(OUT, "qa-move-error.txt"), String((e && e.stack) || e)); exit(1); });
