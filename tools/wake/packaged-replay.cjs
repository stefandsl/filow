// Windows QA package only. Usage: node packaged-replay.cjs FILOW_EXE MODELS CLIPS NEW_PROFILE
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { setTimeout: wait } = require("node:timers/promises");
const { chromium } = require("playwright-core");
const { readSample, wav } = require("../../apps/desktop/wake-pcm");
const [exe, models, clips, root] = process.argv.slice(2).map(p => path.resolve(p));

async function run() {
  if (!/^g:/i.test(root) || fs.existsSync(root) || !/^g:/i.test(exe) ||
      path.basename(path.dirname(exe)) !== "win-unpacked") throw new Error("Expected an unpacked QA build and a fresh isolated G: profile");
  const servers = [];
  let ports;
  try {
    for (let i = 0; i < 5; i++) {
      const server = net.createServer();
      servers.push(server);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
    }
    ports = servers.map(s => s.address().port);
    if (ports.some(p => [4747, 4748, 11434].includes(p))) throw new Error("Reserved port");
  } finally { for (const server of servers) server.close(); }
  const [web, relay, https, debug, ollama] = ports;
  const home = path.join(root, "home");
  const roaming = path.join(home, "AppData", "Roaming"), local = path.join(home, "AppData", "Local");
  for (const dir of [roaming, local, path.join(home, "Documents"), path.join(home, "Desktop"), path.join(root, "temp")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.cpSync(models, path.join(root, "models/wake"), { recursive: true });
  fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({ welcomeCompleted: true, localAiOffered: true,
    okFilow: { enabled: true, showAlways: true, onboarded: true, provider: "local", voice: "off" } }));
  const silent = path.join(root, "silence.wav");
  fs.writeFileSync(silent, wav(new Float32Array(32000)));
  const env = { ...process.env, USERPROFILE: home, APPDATA: roaming, LOCALAPPDATA: local, TEMP: path.join(root, "temp"), TMP: path.join(root, "temp"),
    FILOW_USER_DATA_DIR: root, FILOW_QA_NO_GLOBAL_INPUT: "1", FILOW_QA_HEADLESS: "1", FILOW_OFFLINE: "1", FILOW_OKF_FAKE_MIC: silent,
    FILOW_PORT: String(web), FILOW_SESSION_PORT: String(relay), FILOW_HTTPS_PORT: String(https), OLLAMA_URL: "http://127.0.0.1:" + ollama,
    OLLAMA_HOST: "127.0.0.1:" + ollama, FILOW_QA_OLLAMA_EXE: path.join(root, "missing.exe") };
  const app = spawn(exe, ["--remote-debugging-port=" + debug, "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"], { env, windowsHide: true, stdio: "ignore" });
  let browser;
  try {
    const endpoint = "http://127.0.0.1:" + debug;
    for (let i = 0; i < 120 && !browser; i++) {
      if (app.exitCode !== null) throw new Error("Package exited: " + app.exitCode);
      try { browser = await chromium.connectOverCDP(endpoint, { timeout: 1500 }); } catch { await wait(500); }
    }
    if (!browser) throw new Error("Packaged browser unavailable");
    const ctx = browser.contexts()[0];
    let panel;
    for (let i = 0; i < 120 && !panel; i++) {
      panel = ctx.pages().find(p => p.url().startsWith(`http://127.0.0.1:${web}/okfilow/panel`));
      if (!panel) await wait(500);
    }
    if (!panel) throw new Error("Packaged panel unavailable");
    // Substitute only the 16-bit worklet output. The panel owns device lifetime,
    // conversion, IPC authorization, native inference and the question transition.
    await panel.evaluate(() => {
      globalThis.qaWakeQuestions = 0;
      globalThis.okFilow.onWakeDetected(() => { globalThis.qaWakeQuestions++; });
      const NativeNode = globalThis.AudioWorkletNode;
      globalThis.AudioWorkletNode = class extends NativeNode {
        constructor(context, name, options) {
          super(context, name, options);
          if (name === "pcm-chunker" && !options?.processorOptions?.format) {
            Object.defineProperty(this, "port", { value: {
              set onmessage(callback) { globalThis.qaWakeChunk = callback; },
            } });
          }
        }
      };
    });
    const action = (name, data) => panel.evaluate(([n, d]) => globalThis.okFilow.wakeAction(n, d), [name, data]);
    const status = () => action("status");
    for (let index = 0; index < 5; index++) {
      const samples = Array.from(readSample(path.join(clips, `bare-${index}.wav`)));
      await panel.evaluate(([i, s]) => globalThis.okFilow.wakeAction("sample", { index: i, samples: Float32Array.from(s) }), [index, samples]);
    }
    const trained = await action("train");
    if (trained.error || !trained.trained) throw new Error("Packaged training failed: " + trained.error);
    const config = await panel.evaluate(() => globalThis.okFilow.status());
    if (config.wakeBare !== true || config.wakeSensitivity !== "balanced") throw new Error("Unexpected defaults");
    const report = { ports, defaults: { bare: config.wakeBare, sensitivity: config.wakeSensitivity }, cases: [] };
    await action("test", true);
    await action("enable");
    const replay = async (file, expected, question = false) => {
      await panel.waitForFunction(() => typeof globalThis.qaWakeChunk === "function", null, { timeout: 12000 });
      const initial = await status();
      const questionsBefore = await panel.evaluate(() => globalThis.qaWakeQuestions);
      if (!initial.listening || initial.error) throw new Error(JSON.stringify(initial));
      const samples = readSample(path.join(clips, file)), audio = new Int16Array(32000 + samples.length);
      audio.set(Int16Array.from(samples, x => Math.round(x * 32768)), 16000);
      const elapsed = await panel.evaluate(async ({ data, stopOnWake }) => {
        const pcm = Int16Array.from(data), started = performance.now();
        for (let i = 0; i < pcm.length; i += 1600) {
          if (i) await new Promise(resolve => setTimeout(resolve, 100));
          if (!globalThis.qaWakeChunk) {
            if (stopOnWake && globalThis.qaWakeQuestions) break;
            throw new Error("Capture stopped: " + JSON.stringify(await globalThis.okFilow.wakeAction("status")));
          }
          const block = new Int16Array(1600);
          block.set(pcm.subarray(i, i + 1600));
          globalThis.qaWakeChunk({ data: { pcm: block.buffer, peak: block.some(v => v) ? .5 : 0 } });
        }
        return performance.now() - started;
      }, { data: Array.from(audio), stopOnWake: question });
      await wait(250);
      const after = await status(), delta = after.count - initial.count;
      const row = { file, bareAllowed: (await panel.evaluate(() => globalThis.okFilow.status())).wakeBare, expected, delta,
        questionEvents: await panel.evaluate(() => globalThis.qaWakeQuestions) - questionsBefore,
        elapsedMs: Math.round(elapsed), phase: after.phase, error: after.error };
      console.log(row);
      report.cases.push(row);
      fs.writeFileSync(path.join(root, "result.json"), JSON.stringify(report, null, 2));
      if (row.questionEvents !== Number(question) || delta !== expected || after.error || (!question && !after.listening)) throw new Error("Packaged case failed: " + file);
    };
    await replay("near0-0.wav", 0);
    await replay("bare-6.wav", 1);
    await replay("ok-6.wav", 1);
    await panel.evaluate(() => globalThis.okFilow.configure({ wakeBare: false }));
    await panel.waitForFunction(async () => (await globalThis.okFilow.wakeAction("status")).listening);
    await replay("bare-6.wav", 0);
    await replay("bare-6.wav", 0);
    await replay("ok-6.wav", 1);
    await panel.evaluate(() => globalThis.okFilow.configure({ wakeBare: true }));
    await panel.waitForFunction(async () => (await globalThis.okFilow.wakeAction("status")).listening);
    await action("test", false);
    await replay("bare-6.wav", 1, true);
  } finally {
    if (browser) await browser.close();
    if (app.exitCode === null) app.kill();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
