#!/usr/bin/env node
// Owner, 14/11 (0.9.41): "Save video" saved the video without the voice. Now it asks: with voice or
// without. A hidden QA instance (qa-dev.mjs) with the online voice chosen (ElevenLabs answered by a
// stand-in on loopback with a tone) and the lesson's voice switched off, as in his screenshot:
//  - With voice: the saved WebM has an audio track that is not silent, about as long as the video;
//  - Without voice: no audio track;
//  - no voice to record (the system voice, no natural voice): With voice cannot be chosen, and the reason is said.
// The file is taken where the page hands it to the browser to save (no save box opens), then read with ffprobe.
// Usage: node tools/whiteboard/video-voice.mjs [--work G:\FILOW\tmp\board-library\video]
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { PORTS, launch, shot, sleep, waitFor } from "./qa-dev.mjs";

const argv = process.argv.slice(2);
const work = path.resolve(argv.includes("--work") ? argv[argv.indexOf("--work") + 1] : "G:\\FILOW\\tmp\\board-library\\video");
const frames = path.resolve(argv.includes("--frames") ? argv[argv.indexOf("--frames") + 1] : "G:\\FILOW\\tmp\\board-library\\frames");
fs.rmSync(path.join(work, "profile"), { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(frames, { recursive: true });
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${String(detail).slice(0, 240)})` : ""}`);
};

/** 1.2 s of a 440 Hz tone, 16-bit mono WAV: the online voice's "sentence". */
function tone() {
  const rate = 22050, n = Math.round(rate * 1.2), pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
const voiceCalls = [];
const voiceServer = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    voiceCalls.push(req.url);
    if (req.method === "POST" && req.url.startsWith("/v1/text-to-speech/")) { res.writeHead(200, { "Content-Type": "audio/wav" }); res.end(tone()); return; }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => voiceServer.listen(PORTS.https + 1, "127.0.0.1", r));

const probe = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_entries", "packet=stream_index,pts_time", "-of", "json", file], { encoding: "utf8", maxBuffer: 64 << 20 }));
/** ffmpeg's volumedetect report (it writes to stderr). */
const loudest = (file) => spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr;

const qa = await launch({ profile: path.join(work, "profile"), settings: { okFilow: { enabled: true, voice: "cloud" } }, env: { ELEVENLABS_API_KEY: "test-key-not-real", ELEVENLABS_BASE_URL: `http://127.0.0.1:${PORTS.https + 1}` } });
try {
  const page = await qa.openBoard("How does photosynthesis work?");
  const phase = () => page.evaluate(`(() => { const m = document.querySelector("main.wb-page"); return m ? m.dataset.phase + "/" + m.dataset.player : ""; })()`);
  const accept = () => page.evaluate(`(() => { const b = document.querySelector("dialog.okf-notice-modal[open] .okf-notice-send"); if (b) b.click(); return Boolean(b); })()`);
  const done = await waitFor(async () => { await accept(); return (await phase()) === "done/done"; }, 120_000, 400);
  check("the lesson is drawn and spoken with the online voice", done && voiceCalls.length > 0, `${await phase()} | voice calls ${voiceCalls.length} | ${await page.evaluate(`document.querySelector(".wb-alert")?.textContent ?? ""`)}`);
  // The voice off, as in the owner's screenshot ("Voce: spenta").
  await page.evaluate(`(() => { const b = [...document.querySelectorAll("main.wb-page .wb-controls button[aria-pressed]")].find((x) => x.getAttribute("aria-pressed") === "true" && !x.dataset.action); b.click(); return true; })()`);
  // The saved file is taken where the page gives it to the browser.
  await page.evaluate(`(() => { window.__saved = []; const blobs = new Map(); const make = URL.createObjectURL; URL.createObjectURL = (b) => { const u = make(b); blobs.set(u, b); return u; }; HTMLAnchorElement.prototype.click = function () { const href = this.href, name = this.download; const blob = blobs.get(href); if (!blob) return; window.__saved.push(blob.arrayBuffer().then((b) => { let s = ""; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return { name, b64: btoa(s) }; })); }; return true; })()`);
  const snap = (name) => shot(page, path.join(frames, `${name}.png`));
  const record = async (action) => {
    console.log(`.. recording ${action}`);
    const before = await page.evaluate("window.__saved.length");
    await page.evaluate(`document.querySelector('main.wb-page [data-action="video"]').click(), true`);
    await waitFor(() => page.evaluate(`Boolean(document.querySelector('[data-choice="video"]'))`), 5000);
    const choice = await page.evaluate(`(() => { const c = document.querySelector('[data-choice="video"]'); return { text: c.textContent, focus: document.activeElement?.dataset.action ?? "", voiceDisabled: c.querySelector('[data-action="video-voice"]').disabled }; })()`);
    if (action === "video-voice") await snap("video-choice-dark");
    await page.evaluate(`document.querySelector('[data-choice="video"] [data-action="${action}"]').click(), true`);
    const saved = await waitFor(async () => { await accept(); return (await page.evaluate("window.__saved.length")) > before; }, 180_000, 500);
    console.log(`.. ${action}: ${saved ? "saved" : "nothing saved"} ${JSON.stringify(await page.evaluate(`({ ...document.querySelector("main.wb-page").dataset })`))}`);
    if (!saved) return { choice, file: null };
    const got = await page.evaluate(`window.__saved[window.__saved.length - 1]`);
    const file = path.join(work, `${action}.webm`);
    fs.writeFileSync(file, Buffer.from(got.b64, "base64"));
    return { choice, file, name: got.name };
  };

  const withVoice = await record("video-voice");
  check("Save video asks first: With voice is the default, and a muted voice is said to be recorded anyway", withVoice.choice.focus === "video-voice" && !withVoice.choice.voiceDisabled && /anche con la voce spenta|even though the voice is off/.test(withVoice.choice.text), JSON.stringify(withVoice.choice));
  if (withVoice.file) {
    const p = probe(withVoice.file);
    const audio = p.streams.find((s) => s.codec_type === "audio");
    const video = p.streams.find((s) => s.codec_type === "video");
    const last = (i) => Math.max(0, ...p.packets.filter((x) => x.stream_index === i && x.pts_time !== undefined).map((x) => Number(x.pts_time)));
    const [va, aa] = [video ? last(video.index) : 0, audio ? last(audio.index) : 0];
    check("With voice: the WebM has an audio track about as long as the video", audio && video && va > 3 && Math.abs(va - aa) < 1.5, `${withVoice.name} video ${va.toFixed(2)} s, audio ${audio?.codec_name} ${aa.toFixed(2)} s`);
    const vol = /max_volume:\s*(-?[\d.]+) dB/.exec(audio ? loudest(withVoice.file) : "");
    check("With voice: the narration is in it (not silence), although the voice was off while it recorded", vol && Number(vol[1]) > -30, `max volume ${vol?.[1]} dB`);
  } else check("With voice: a video was saved", false);

  const silent = await record("video-silent");
  if (silent.file) {
    const p = probe(silent.file);
    check("Without voice: the WebM has a video track and no audio track", p.streams.some((s) => s.codec_type === "video") && !p.streams.some((s) => s.codec_type === "audio"), p.streams.map((s) => s.codec_type).join(","));
  } else check("Without voice: a video was saved", false);

  // No voice to record: the system voice chosen, no natural voice in this profile.
  await qa.okf.evaluate(`window.okFilow.configure({ voice: "system" }).then(() => true)`);
  await sleep(800);
  await page.evaluate(`document.querySelector('main.wb-page [data-action="video"]').click(), true`);
  await waitFor(() => page.evaluate(`Boolean(document.querySelector('[data-choice="video"]'))`), 5000);
  const none = await page.evaluate(`(() => { const c = document.querySelector('[data-choice="video"]'); return { text: c.textContent, focus: document.activeElement?.dataset.action ?? "", voiceDisabled: c.querySelector('[data-action="video-voice"]').disabled }; })()`);
  check("no voice to record: With voice cannot be chosen, the reason is said, Without voice is the default", none.voiceDisabled && none.focus === "video-silent" && /Nessuna voce|No voice of this PC/.test(none.text), JSON.stringify(none));
  await page.evaluate(`document.documentElement.dataset.theme = "light"; true`);
  await snap("video-choice-novoice-light");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true`);
    await sleep(900); // the theme change has a transition
    await page.evaluate(fs.readFileSync(path.resolve("node_modules/axe-core/axe.min.js"), "utf8") + ";true");
    const v = await page.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] }).then((r) => r.violations.map((x) => x.id + " " + x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")))`);
    check(`axe ${theme} with the choice open: 0 violations`, Array.isArray(v) && v.length === 0, (v || []).join("; "));
  }
} catch (e) {
  check("the run completed", false, e.stack || e);
} finally {
  await qa.stop();
  voiceServer.close();
}
fs.writeFileSync(path.join(work, "result.json"), JSON.stringify(checks, null, 2));
const failed = checks.filter((c) => !c.ok).length;
console.log(`${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
