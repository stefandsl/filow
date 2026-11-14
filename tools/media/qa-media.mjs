#!/usr/bin/env node
// Hidden end-to-end check of the pictures on the screen and on the whiteboard (lib/buddy/media.ts,
// lib/whiteboard/media.ts). Nothing is shown on the real screen and no sound plays: an offscreen
// Electron window with its own profile loads the real overlay and whiteboard pages from a running
// `next dev` (port 5031, started with FILOW_QA_COMMONS_URL=http://127.0.0.1:5032), with a stand-in for
// window.okFilow (fake-bridge.cjs) that emits what main would send. Commons is a fake on 5032 and the
// "user's own" pictures are served on 5033, both from fixture files on this PC: no call to the web.
// Every request off 127.0.0.1:5031-5035 is refused in the window.
//
// Usage: node tools/media/qa-media.mjs [--fixtures G:\FILOW\tmp\media\fixtures] [--out G:\FILOW\tmp\media]
// Writes <out>/<frames>/*.png (dark and light; --frames, default "frames4") and <out>/qa-media.json (the numbers).
import { spawn } from "node:child_process";
import { buildSync } from "esbuild";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const FIX = arg("fixtures", "G:\\FILOW\\tmp\\media\\fixtures");
const OUT = arg("out", "G:\\FILOW\\tmp\\media");
const WORK = path.join(OUT, "work");
const FRAMES = path.join(OUT, arg("frames", "frames4"));
for (const d of [OUT, WORK, FRAMES]) fs.mkdirSync(d, { recursive: true });

// ---- the board file: a GIF placed by the same code an agent uses ----
const helper = path.join(WORK, "board-helper.cjs");
fs.writeFileSync(path.join(WORK, "board-entry.ts"), `export { mediaElement, cleanBoardMedia, filesOf } from "${path.join(ROOT, "apps/web/lib/whiteboard/media.ts").replace(/\\/g, "/")}";\nexport { applyOps, applyEdits, noEdits, excalidrawFile, parseExcalidrawFile } from "${path.join(ROOT, "apps/web/lib/whiteboard/doc.ts").replace(/\\/g, "/")}";\n`);
buildSync({ entryPoints: [path.join(WORK, "board-entry.ts")], bundle: true, platform: "node", format: "cjs", outfile: helper, logLevel: "silent", alias: { "@": path.join(ROOT, "apps/web") } });
const board = (await import(pathToFileURL(helper).href)).default;
const gif = `data:image/gif;base64,${fs.readFileSync(path.join(FIX, "heart.gif")).toString("base64")}`;
const placed = board.mediaElement({ kind: "gif", src: gif, caption: "Animated test pattern", source: "Wikimedia Commons · Jane Doe · CC BY-SA 4.0" }, { x: 60, y: 120, w: 520 }, 0, "pattern");
const title = { id: "t1", type: "text", x: 660, y: 130, width: 480, height: 40, text: "How a test pattern moves", originalText: "How a test pattern moves", fontSize: 32, fontFamily: 5, textAlign: "left", verticalAlign: "top", strokeColor: "#1e1e1e", backgroundColor: "transparent", lineHeight: 1.25, customData: { wb: { step: 0, key: "t1", role: "title" } } };
const note = (id, y, text) => ({ ...title, id, y, x: 660, width: 480, height: 30, text, originalText: text, fontSize: 24, customData: { wb: { step: 0, key: id, role: "label" } } });
const notes = [note("n1", 220, "Each frame moves the pattern a little"), note("n2", 270, "A dropped frame shows as a jump"), note("n3", 320, "Torn frames split the colour bars")];
const { edits } = board.applyOps({ elements: [], files: {} }, board.noEdits(), [{ op: "add", element: placed.element, files: placed.files }, { op: "add", element: placed.label }, { op: "add", element: title }, ...notes.map((element) => ({ op: "add", element }))]);
const boardFile = path.join(WORK, "heart.excalidraw");
fs.writeFileSync(boardFile, board.excalidrawFile(board.applyEdits({ elements: [], files: {} }, edits)));

// ---- fake Commons (5032) and the user's own pictures (5033) ----
const serveFile = (res, name) => {
  const file = path.join(FIX, path.basename(decodeURIComponent(name)));
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const type = file.endsWith(".gif") ? "image/gif" : file.endsWith(".webm") ? "video/webm" : "image/png";
  const body = fs.readFileSync(file);
  res.writeHead(200, { "Content-Type": type, "Content-Length": body.length }).end(body);
};
const seen = [];
const commons = http.createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1:5032");
  seen.push(u.pathname + u.search);
  if (u.pathname === "/w/api.php") {
    const video = /filemime:video/.test(u.searchParams.get("gsrsearch") ?? "");
    const file = video ? "eclipse.webm" : "heart.gif";
    const size = fs.statSync(path.join(FIX, file)).size;
    const info = { url: `http://127.0.0.1:5032/f/${file}`, ...(video ? {} : { thumburl: `http://127.0.0.1:5032/f/${file}` }), mime: video ? "video/webm" : "image/gif", size, ...(video ? { duration: 4 } : {}), extmetadata: { Artist: { value: video ? "<a href=\"//commons.wikimedia.org/wiki/User:Example\">Ravi Kumar</a>" : "<span>Jane Doe</span>" }, LicenseShortName: { value: video ? "CC BY 4.0" : "CC BY-SA 4.0" }, ObjectName: { value: video ? "Moving colour bars" : "Animated test pattern" } } };
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ query: { pages: { 1: { index: 1, title: `File:${file}`, imageinfo: [info] } } } }));
    return;
  }
  if (u.pathname.startsWith("/f/")) return serveFile(res, u.pathname.slice(3));
  res.writeHead(404).end();
});
const own = http.createServer((req, res) => serveFile(res, new URL(req.url, "http://127.0.0.1:5033").pathname.slice(1)));
await new Promise((r) => commons.listen(5032, "127.0.0.1", r));
await new Promise((r) => own.listen(5033, "127.0.0.1", r));

// ---- the hidden window ----
const require = createRequire(import.meta.url);
const electron = require(path.join(ROOT, "node_modules/electron"));
const resultFile = path.join(OUT, "qa-media.json");
if (fs.existsSync(resultFile)) fs.rmSync(resultFile);
const child = spawn(electron, [path.join(ROOT, "tools/media/qa-media-electron.cjs")], {
  env: { ...process.env, FILOW_QA_HEADLESS: "1", FILOW_QA_NO_GLOBAL_INPUT: "1", QA_MEDIA_OUT: OUT, QA_MEDIA_FRAMES: FRAMES, QA_MEDIA_BOARD: boardFile, QA_MEDIA_ROOT: ROOT, ELECTRON_ENABLE_LOGGING: "0" },
  stdio: ["ignore", "inherit", "inherit"],
});
const code = await new Promise((r) => child.on("exit", r));
commons.close();
own.close();
const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, "utf8")) : null;
if (result) {
  // the board as saved by the page, read back by the same filter that opens files
  const saved = path.join(WORK, "saved.excalidraw");
  const back = fs.existsSync(saved) ? board.parseExcalidrawFile(fs.readFileSync(saved, "utf8")) : null;
  result.board.savedAndReopened = Boolean(back && back.elements.some((e) => board.cleanBoardMedia(e.customData?.media)?.kind === "gif" && back.files[e.fileId]?.dataURL === gif));
  result.commonsCalls = seen.length;
  result.commonsAsked = seen.filter((s) => s.startsWith("/w/api.php")).map((s) => new URL(s, "http://x").searchParams.get("gsrsearch"));
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, frames: undefined }, null, 1));
}
process.exit(code || (result ? 0 : 1));
