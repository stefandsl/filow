import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
export function portsFor(values) {
  assert.ok(Array.isArray(values) && values.length === 4 && new Set(values).size === 4);
  assert.ok(values.every(p => Number.isInteger(p) && p >= 1024 && p <= 65535 && ![4747, 4748, 11434].includes(p)));
  return values;
}
async function verifyFree(ports) {
  const probes = [];
  try {
    for (const port of ports) {
      const probe = net.createServer();
      await new Promise((resolve, reject) => probe.once("error", reject).listen(port, "127.0.0.1", resolve));
      probes.push(probe);
    }
  } finally { await Promise.all(probes.map(s => new Promise(resolve => s.close(resolve)))); }
}
export function wavInfo(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
  let format, data;
  for (let i = 12; i + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(i + 4), start = i + 8;
    assert.ok(start + size <= bytes.length);
    const name = bytes.toString("ascii", i, i + 4);
    if (name === "fmt ") {
      assert.ok(size >= 16);
      format = [bytes.readUInt16LE(start), bytes.readUInt16LE(start + 2), bytes.readUInt32LE(start + 4), bytes.readUInt16LE(start + 14)];
    }
    if (name === "data") data = bytes.subarray(start, start + size);
    i = start + size + size % 2;
  }
  assert.deepEqual(format, [1, 1, 16000, 16]);
  assert.ok(data?.length && data.length % 2 === 0);
  return { data, samples: data.length / 2, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function hashFile(file, algorithm) {
  const hash = createHash(algorithm);
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
async function until(readValue, name, ms = 40000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await readValue();
    if (value) return value;
    await sleep(80);
  }
  throw Error("Timed out at " + name);
}
export async function key(page, name) {
  const code = { Tab: 9, Enter: 13, Space: 32 }[name];
  const events = name === "Enter"
    ? [{ type: "keyDown", text: "\r", nativeVirtualKeyCode: code }, { type: "keyUp", nativeVirtualKeyCode: code }]
    : [{ type: "rawKeyDown" }, { type: "keyUp" }];
  for (const event of events) {
    const r = await page.call("Input.dispatchKeyEvent", {
      ...event, key: name === "Space" ? " " : name, code: name, windowsVirtualKeyCode: code
    });
    assert.ok(!r.error);
  }
}
async function focus(page, css) {
  await until(() => page.evaluate("Boolean(document.querySelector(" + JSON.stringify(css) + "))"), "control");
  for (let i = 0; i < 160; i++) {
    if (await page.evaluate("document.activeElement === document.querySelector(" + JSON.stringify(css) + ")")) return;
    await key(page, "Tab");
  }
  throw Error("Control unreachable by keyboard");
}
async function press(page, css) { await focus(page, css); await key(page, "Enter"); }
async function fill(page, css, text) {
  await focus(page, css);
  await page.call("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await page.call("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  const r = await page.call("Input.insertText", { text });
  assert.ok(!r.error);
}
const rows = page => page.evaluate(`Array.from(document.querySelectorAll(".daily-list li"), el => ({
  id: el.dataset.id, rev: Number(el.dataset.revision), text: el.querySelector(".daily-check span").textContent,
  done: el.querySelector("[type=checkbox]").checked, evidence: el.querySelector("details p")?.textContent
}))`);
const entry = ".daily > form.daily-entry";
const typedTask = entry + ":first-of-type";
const typedReport = entry + ":nth-of-type(2)";
async function writeForm(page, form, text) {
  await fill(page, form + " input", text);
  await press(page, form + " button");
}
const observeRows = (page, predicate) => until(async () => {
  const list = await rows(page);
  return predicate(list) && list;
}, "task revision");
async function attach(debug, web, relay, pid) {
  const origin = "http://127.0.0.1:" + web;
  const target = await until(async () => {
    let found;
    try { found = await (await fetch("http://127.0.0.1:" + debug + "/json/list", { signal: AbortSignal.timeout(1500) })).json(); }
    catch { return null; }
    return found.find(t => t.type === "page" && ["/", "/tour"].some(p => t.url.split("?")[0] === origin + p));
  }, "installed main page", 90000);
  const owners = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$ports=@(" + [debug,web,relay].join(",") + "); $rows=@(Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction Stop); " +
    "if (@($rows.LocalPort | Sort-Object -Unique).Count -ne 3) {throw 'Missing listener'}; $rows.OwningProcess | Sort-Object -Unique"],
    { encoding:"utf8", windowsHide:true }).trim();
  assert.equal(owners, String(pid), "Each listener must belong to the isolated launch");
  assert.equal(new URL(target.webSocketDebuggerUrl).origin, "ws://127.0.0.1:" + debug);
  const { connect } = await import("../../whiteboard/qa-dev.mjs");
  const page = await connect(target);
  await page.call("Page.bringToFront");
  if (new URL(target.url).pathname === "/tour") await press(page, ".tour-continue");
  await press(page, 'a[href="/day-by-day"]');
  await until(() => page.evaluate('document.querySelector("[data-mic]")?.dataset.mic === "off"'), "hydrated daily page");
  return page;
}

// One synthetic microphone producer. The browser schedules the samples on its real audio clock.
// The page still opens a MediaStream, runs its normal worklet and feeds the packaged local worker.
async function audioSetup(page, launch, activate) {
  await page.evaluate(`(() => {
    const ctx = new AudioContext({sampleRate:16000});
    const dest = ctx.createMediaStreamDestination();
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!constraints.audio || constraints.video) throw Error("Unexpected media request");
      await ctx.resume();
      return dest.stream.clone();
    };
    const words = [];
    window.filow.daily.onSpeech(m => { if (m.partial || m.final) words.push({ at: performance.now(), partial:m.partial, final:m.final }); });
    window.dailyReplay = {ctx, dest, words};
    return true;
  })()`);
  await pressTalk(page, launch, activate);
  await until(() => page.evaluate('document.querySelector("[data-mic]")?.dataset.mic === "live"'), "live microphone", 120000);
}

export async function pressTalk(page, launch, activate) {
  const observed = launch.talkFocus = activate();
  assert.ok(observed.foregroundHwnd === launch.hwnd && observed.foregroundPid === launch.pid,
    "Windows did not foreground the isolated Filow window before Talk");
  await focus(page, "[data-daily-talk]");
  await until(async () => {
    observed.documentFocused = await page.evaluate("document.hasFocus()");
    return observed.documentFocused;
  }, "daily document focus before Talk", 2000);
  await key(page, "Enter");
}
async function playClip(page, file, clips) {
  const clip = wavInfo(fs.readFileSync(file));
  const before = await rows(page);
  const receipt = await page.evaluate(`(async () => {
    const {ctx,dest,words} = window.dailyReplay;
    const bytes = Uint8Array.from(atob(${JSON.stringify(clip.data.toString("base64"))}), c => c.charCodeAt(0));
    const pcm = new DataView(bytes.buffer);
    const audio = ctx.createBuffer(1, bytes.length/2, 16000), out = audio.getChannelData(0);
    for (let i=0;i<out.length;i++) out[i]=pcm.getInt16(2*i,true)/32768;
    const source = ctx.createBufferSource();
    source.buffer = audio; source.connect(dest);
    const meter = () => window.filow.daily.control("meter");
    const initial = await meter(), start = performance.now(), index = words.length;
    await new Promise(resolve => { source.onended=resolve; source.start(); });
    const elapsed = performance.now()-start, end = await meter();
    source.disconnect();
    return {index, elapsed, frames:end.frames-initial.frames, acceptedSamples:end.samples-initial.samples, model:end.model};
  })()`);
  assert.ok(receipt.model && receipt.elapsed >= clip.samples / 16 - 80 && receipt.frames > 0);
  assert.ok(Math.abs(receipt.acceptedSamples - clip.samples) < 6400, "Capture did not keep pace");
  await until(() => page.evaluate("window.dailyReplay.words.slice(" + receipt.index + ").some(w => w.final)"), "recognized final");
  clips.push({ sha256: clip.sha256, samples: clip.samples, ...receipt, before,
    recognized: await page.evaluate("window.dailyReplay.words.slice(" + receipt.index + ")") });
}

function isolatedEnvironment(root, ports, spec, day) {
  const home = path.join(root, "home"), roaming = path.join(home, "AppData", "Roaming"), local = path.join(home, "AppData", "Local");
  const temp = path.join(root, "temp"), profile = path.join(root, "profile");
  for (const dir of [roaming, local, temp, path.join(home, "Desktop"), path.join(home, "Documents"), profile]) fs.mkdirSync(dir, { recursive: true });
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(path|systemroot|windir|comspec|systemdrive|computername|pathext|processor_architecture|number_of_processors)$/i.test(k)));
  return { ...inherited, USERPROFILE: home, HOME: home, APPDATA: roaming, LOCALAPPDATA: local, TEMP: temp, TMP: temp,
    XDG_CACHE_HOME: path.join(root, "cache"), FILOW_PORT: String(ports[0]), FILOW_SESSION_PORT: String(ports[1]),
    OLLAMA_HOST: "127.0.0.1:" + ports[3], OLLAMA_URL: "http://127.0.0.1:" + ports[3], OLLAMA_MODELS: path.join(root, "ollama"),
    FILOW_QA_NO_GLOBAL_INPUT: "1", FILOW_OFFLINE: "1", FILOW_USER_DATA_DIR: profile, FILOW_QA_DAILY_TIME: day,
    FILOW_QA_SOCKET_LOG: path.join(root, "sockets.jsonl"), LANG: spec.locale };
}

async function journey(spec, record, root, replayPath) {
  assert.equal(process.platform, "win32");
  assert.ok(["typed","audio"].includes(spec.mode) && ["crash","correction"].includes(spec.trial));
  assert.ok(["en-US","it-IT"].includes(spec.locale) && ["light","dark"].includes(spec.theme));
  assert.ok(spec.tasks?.length === 2 && spec.tasks.every(t => typeof t === "string" && t));
  assert.ok(spec.report && spec.correction && spec.edited && Number.isFinite(Date.parse(spec.dayOne)) && Number.isFinite(Date.parse(spec.dayTwo)));
  const ports = portsFor(spec.ports), exe = replayPath(spec.exe);
  const asar = path.join(path.dirname(exe), "resources", "app.asar");
  const { extractFile } = await import("@electron/asar");
  const pkg = JSON.parse(extractFile(asar, "package.json"));
  assert.match(spec.sha, /^[a-f0-9]{40}$/);
  assert.equal(pkg.sourceSha, spec.sha);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding:"utf8" }).trim(), spec.sha);
  assert.equal(pkg.filowQa, true);
  for (const file of ["day-by-day.js","day-by-day-store.js","day-by-day-decisions.js"]) assert.ok(extractFile(asar, file).length > 0);
  record.packageSha512 = await hashFile(replayPath(spec.archive), "sha512");
  assert.equal(record.packageSha512, spec.sha512.toLowerCase());
  record.asarSha512 = await hashFile(asar, "sha512");
  record.sha = spec.sha;
  const day1 = new Date(spec.dayOne), day2 = new Date(spec.dayTwo);
  const civil = d => [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
  assert.equal(civil(new Date(day1.getFullYear(), day1.getMonth(), day1.getDate()+1)), civil(day2));
  assert.ok([day1,day2].some(d => d.toISOString().slice(0,10) !== civil(d)), "Exercise UTC/local date disagreement");
  const profile = path.join(root, "profile");
  const env = isolatedEnvironment(root, ports, spec, spec.dayOne);
  const { PAST_ONBOARDING } = await import("./profile.mjs");
  fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({ ...PAST_ONBOARDING, remoteShare:false, lang:spec.locale.slice(0,2), theme:spec.theme }), { flag:"wx" });
  if (spec.mode === "audio") {
    const { default: stt } = await import("../../../apps/desktop/stt.js");
    const source = replayPath(spec.modelDir), dest = stt.modelDir(profile);
    fs.mkdirSync(dest, { recursive:true });
    record.modelFiles = {};
    for (const file of stt.MODEL.files) {
      fs.copyFileSync(path.join(source,file), path.join(dest,file), fs.constants.COPYFILE_EXCL);
      record.modelFiles[file] = await hashFile(path.join(dest,file), "sha256");
    }
  }
  let child, page;
  async function launch(day) {
    assert.equal(env.FILOW_PORT, String(ports[0]));
    assert.equal(env.FILOW_SESSION_PORT, String(ports[1]));
    assert.equal(env.OLLAMA_URL, "http://127.0.0.1:" + ports[3]);
    assert.equal(env.OLLAMA_HOST, "127.0.0.1:" + ports[3]);
    await verifyFree(ports);
    child = spawn(exe, ["--remote-debugging-port="+ports[2], "--remote-debugging-address=127.0.0.1", "--force-renderer-accessibility", "--lang="+spec.locale,
      "--log-net-log="+path.join(root,"chromium-"+record.launches.length+".json")], { env:{ ...env, FILOW_QA_DAILY_TIME:day }, stdio:"ignore" });
    await new Promise((resolve,reject) => { child.once("spawn",resolve); child.once("error",reject); });
    record.launches.push({ pid:child.pid, start:new Date().toISOString() });
    page = await attach(ports[2],ports[0],ports[1],child.pid);
    assert.equal(await page.evaluate("document.documentElement.dataset.theme"), spec.theme);
    assert.equal(await page.evaluate("document.querySelector('main.daily').lang"), spec.locale.slice(0,2));
    const hwnd = execFileSync("powershell.exe", ["-NoProfile","-NonInteractive","-Command", "(Get-Process -Id "+child.pid+").MainWindowHandle.ToInt64()"], { encoding:"utf8", windowsHide:true }).trim();
    assert.ok(Number(hwnd)>0);
    const scale = await page.evaluate("window.devicePixelRatio");
    if (spec.expectedScale) assert.equal(scale, spec.expectedScale);
    Object.assign(record.launches.at(-1), { hwnd, scale, theme:spec.theme });
  }
  async function kill() {
    if (!child) return;
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once("exit",resolve));
      child.kill();
      await exited;
    }
    record.launches.at(-1).end = new Date().toISOString();
    page?.close(); page = undefined; child = undefined;
  }
  async function report(type, text) {
    if (spec.mode === "audio") await playClip(page,replayPath(spec.clips[type]),record.clips);
    else await writeForm(page,typedReport,text);
    const words = await until(() => page.evaluate("document.querySelector('.daily-review blockquote')?.textContent"),"reviewed words");
    const before = await rows(page);
    assert.equal(before[0].done, type === "correction");
    assert.equal(before[1].done, false);
    await press(page,".daily-review > button:first-of-type");
    return { words, before };
  }
  try {
    await launch(spec.dayOne);
    assert.deepEqual(await rows(page),[]);
    assert.equal(await page.evaluate("document.querySelector('time').dateTime"),civil(day1));
    await press(page,".daily nav button:nth-child(2)");
    if (spec.mode === "audio") {
      const launchRecord = record.launches.at(-1);
      await audioSetup(page, launchRecord, () => JSON.parse(execFileSync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(import.meta.dirname, "n05-uia.ps1"),
        "-ProcessId", String(launchRecord.pid), "-ExpectedExe", exe, "-ExpectedHwnd", launchRecord.hwnd
      ], { encoding: "utf8", windowsHide: true, env, timeout: 15000 })));
    }
    for (const [i, text] of spec.tasks.entries()) {
      if (spec.mode === "audio") {
        await playClip(page,replayPath(spec.clips.tasks[i]),record.clips);
        await writeForm(page,".daily-review form",text);
      } else await writeForm(page,typedTask,text);
      const after = await observeRows(page,list => list.length === i+1 && list[i].text === text);
      if (spec.mode === "audio") Object.assign(record.clips.at(-1), { target:after[i].id, delta:after[i].rev });
    }
    const delivered = await report("report",spec.report);
    const tick = await observeRows(page,list => list[0]?.done && list[0].evidence === delivered.words && !list[1].done);
    assert.equal(tick[0].rev,delivered.before[0].rev+1);
    record.tick = tick;
    if (spec.mode === "audio") Object.assign(record.clips.at(-1), { target:tick[0].id, delta:1 });
    if (spec.trial === "correction") {
      await press(page,".daily-list li:first-child summary");
      assert.ok(await page.evaluate("document.querySelector('details').open"));
      const correction = await report("correction",spec.correction);
      const reopened = await observeRows(page,list => !list[0].done && list[0].evidence === correction.words);
      if (spec.mode === "audio") Object.assign(record.clips.at(-1), { target:reopened[0].id, delta:reopened[0].rev-tick[0].rev });
      await writeForm(page,".daily-list li:nth-child(2) form",spec.edited);
      await press(page,".daily-list li:first-child .controls button");
      await observeRows(page,list => list[0].done && list[0].evidence === delivered.words && list[1].text === spec.edited);
    }
    await kill();
    await launch(spec.dayTwo);
    assert.equal(await page.evaluate("document.querySelector('time').dateTime"),civil(day2));
    const recovered = await rows(page);
    assert.deepEqual(recovered.map(r => r.id), tick.map(r => r.id));
    assert.ok(recovered[0].done && !recovered[1].done && recovered[0].evidence === delivered.words);
    if (spec.trial === "crash") {
      assert.deepEqual(recovered,tick);
      await writeForm(page,".daily-list li:nth-child(2) form",spec.edited);
      await observeRows(page,list => list[1].text === spec.edited);
      await press(page,".daily-list li:first-child .controls button");
      await observeRows(page,list => !list[0].done && list[1].text === spec.edited);
    }
    record.dayTwo = await rows(page);
    await kill(); await launch(spec.dayTwo);
    assert.deepEqual(await rows(page),record.dayTwo);
  } finally { await kill(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { replayPath } = await import("./n02-fixtures.mjs");
  const spec = read(replayPath(process.argv[2]));
  const root = replayPath(spec.out);
  assert.match(root, /^G:[\\/]/i);
  assert.ok(fs.statfsSync("C:/").bavail * fs.statfsSync("C:/").bsize >= 20 * 2**30);
  fs.mkdirSync(root);
  const record = { start:new Date().toISOString(), cwd:process.cwd(), command:process.argv.slice(1),
    expected:"Two tasks, a grounded confirmed tick, local recovery and a durable edit", mode:spec.mode, trial:spec.trial,
    locale:spec.locale, timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone, device:os.hostname(), os:os.version(),
    launches:[], clips:[], egress:"HOLD", narrator:"HOLD", ownerTwoDays:"HOLD" };
  try { await journey(spec,record,root,replayPath); record.journey="PASS"; }
  catch (error) { record.journey="HOLD"; record.error=String(error); process.exitCode=1; }
  finally { record.exitCode=process.exitCode || 0; record.end=new Date().toISOString();
    fs.writeFileSync(path.join(root,"journey.json"),JSON.stringify(record,null,2),{flag:"wx"}); }
  console.log(JSON.stringify({journey:record.journey, exitCode:record.exitCode}));
}
