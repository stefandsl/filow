// SEC-08 (docs/autoloop/STANDARDS.md): which web permissions a page of the real packaged app gets.
// The standard: the microphone and screen capture for Filow's own pages, nothing else. Notifications
// are reported but not judged: the row as written lists them among the refused, while the app grants
// them for apps/web/lib/notify.ts. That is an owner decision (docs/autoloop/HANDOFF.md). The probe asks from inside the main page, the way a
// page would: the permission states, then the real calls (getUserMedia for the microphone, the
// camera and both together, geolocation, MIDI, notifications). Writes tmp/autoloop/permissions.json
// and exits 4 when an answer is not the expected one.
// Not exercised: screen capture (getDisplayMedia needs the source handler of main.js to pick a screen)
// and a page of another origin inside a Filow window (the navigation guard keeps one from loading;
// apps/desktop/page-permissions.test.ts covers the rule for such pages).
//
// It needs a QA build (-c.extraMetadata.filowQa=true): the instance runs with test isolation on
// (FILOW_QA_NO_GLOBAL_INPUT=1, no global keys, never the real microphone) and a silent recording
// stands in for every microphone (FILOW_OKF_FAKE_MIC). Chromium's fake devices include a camera, so
// a build that grants the camera really hands this probe a video track.
//
// Usage: node tools/autoloop/e2e/permissions.mjs [path\to\win-unpacked]   (default: newest release-autoloop*)
// Ports as a11y.mjs: 4787/4788 and DevTools 9344, moved with FILOW_E2E_PORT and FILOW_E2E_DEVTOOLS.
import fs from "node:fs";
import path from "node:path";
import { launchFilow, logLineCount, stopTree, waitForLine } from "./launch.mjs";
import { NO_PUBLIC_LINK, seedProfile } from "./profile.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../..");
const PORT = Number(process.env.FILOW_E2E_PORT || 4787), DEVTOOLS = Number(process.env.FILOW_E2E_DEVTOOLS || 9344);

function newestBuild() {
  const dirs = fs.readdirSync(ROOT).filter((d) => d.startsWith("release-autoloop") && fs.existsSync(path.join(ROOT, d, "win-unpacked", "Filow.exe")));
  dirs.sort((a, b) => fs.statSync(path.join(ROOT, b, "win-unpacked", "Filow.exe")).mtimeMs - fs.statSync(path.join(ROOT, a, "win-unpacked", "Filow.exe")).mtimeMs);
  if (!dirs.length) throw new Error("no packaged build found (release-autoloop*)");
  return path.join(ROOT, dirs[0], "win-unpacked");
}

/** One second of silence, 16 kHz mono 16-bit: the recording that stands in for the microphone. */
function silentWav(file) {
  const samples = 16000, data = Buffer.alloc(samples * 2), head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(16000, 24); head.writeUInt32LE(32000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([head, data]));
  return file;
}

/** What the standard asks of each answer; the keys are the fields the page reports. */
export const EXPECTED = {
  "state.microphone": "granted",
  "state.camera": "denied",
  "state.geolocation": "denied",
  "state.midi": "denied",
  "call.microphone": "audio",
  "call.camera": "NotAllowedError",
  "call.microphoneAndCamera": "NotAllowedError",
  "call.geolocation": "denied",
  "call.midi": "refused",
};

/** The answers that differ from the standard, as readable lines; empty when the build conforms. */
export function problemsOf(answers) {
  return Object.entries(EXPECTED)
    .filter(([key, want]) => answers?.[key] !== want)
    .map(([key, want]) => `${key}: ${JSON.stringify(answers?.[key])} (expected ${JSON.stringify(want)})`);
}

// Runs inside the page. Every call is bounded: a prompt nobody answers must not hang the probe.
const PAGE_SCRIPT = `(async () => {
  const within = (p, ms, late) => Promise.race([p, new Promise((r) => setTimeout(() => r(late), ms))]);
  const out = {};
  for (const name of ["microphone", "camera", "geolocation", "midi", "notifications"]) {
    out["state." + name] = await within(navigator.permissions.query({ name }).then((s) => s.state, (e) => "error " + e.name), 5000, "timeout");
  }
  const media = async (constraints) => {
    try {
      const stream = await within(navigator.mediaDevices.getUserMedia(constraints), 8000, null);
      if (!stream) return "timeout";
      const kinds = stream.getTracks().map((t) => t.kind).sort().join("+");
      stream.getTracks().forEach((t) => t.stop());
      return kinds;
    } catch (e) { return e.name; }
  };
  out["call.microphone"] = await media({ audio: true });
  out["call.camera"] = await media({ video: true });
  out["call.microphoneAndCamera"] = await media({ audio: true, video: true });
  out["call.geolocation"] = await within(new Promise((r) => navigator.geolocation.getCurrentPosition(() => r("position"), (e) => r(e.code === 1 ? "denied" : "error " + e.code), { timeout: 4000 })), 6000, "timeout");
  out["call.midi"] = navigator.requestMIDIAccess ? await within(navigator.requestMIDIAccess().then(() => "access", () => "refused"), 5000, "timeout") : "no api"; // an absent API would not be a refusal: it fails the probe
  out["call.notifications"] = await within(Notification.requestPermission(), 5000, "timeout");
  return out;
})()`;

async function main() {
  const exeDir = path.resolve(process.argv[2] || newestBuild());
  const profile = seedProfile(ROOT, NO_PUBLIC_LINK);
  const wav = silentWav(path.join(ROOT, "tmp", "autoloop", "permissions-silence.wav"));
  const startupLog = path.join(profile, "startup.log");
  const fromLine = logLineCount(startupLog);
  const env = { ...process.env, FILOW_USER_DATA_DIR: profile, FILOW_PORT: String(PORT), FILOW_SESSION_PORT: String(PORT + 1), FILOW_QA_NO_GLOBAL_INPUT: "1", FILOW_OKF_FAKE_MIC: wav };
  const { pid } = await launchFilow({ exeDir, profile, env, args: [`--remote-debugging-port=${DEVTOOLS}`] });
  let answers = null, error = null;
  try {
    await waitForLine(startupLog, /main window shown|startup failed/, { fromLine, timeoutMs: 60_000 });
    let target;
    for (let i = 0; i < 30 && !target; i++) {
      try { target = (await (await fetch(`http://127.0.0.1:${DEVTOOLS}/json`)).json()).find((t) => t.type === "page" && t.url.startsWith(`http://127.0.0.1:${PORT}/`) && !t.url.includes("/okfilow/")); } catch { /* not up yet */ }
      if (!target) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!target) throw new Error("the main page did not come up");
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("DevTools socket failed")); });
    const reply = new Promise((resolve) => { ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) resolve(d); }; });
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: PAGE_SCRIPT, awaitPromise: true, returnByValue: true, userGesture: true } }));
    const r = await reply;
    ws.close();
    answers = r.result?.result?.value ?? null;
    if (!answers) throw new Error("the page gave no answer: " + JSON.stringify(r.result?.exceptionDetails?.exception?.description || r.error || r.result).slice(0, 300));
  } catch (e) {
    error = String(e?.message || e);
  } finally {
    await stopTree(pid);
  }
  const problems = error ? [error] : problemsOf(answers);
  const out = { at: new Date().toISOString(), exe: exeDir, answers, expected: EXPECTED, problems };
  fs.writeFileSync(path.join(ROOT, "tmp", "autoloop", "permissions.json"), JSON.stringify(out, null, 2));
  for (const [k, v] of Object.entries(answers || {})) console.log(`${!(k in EXPECTED) ? "note" : EXPECTED[k] === v ? "ok  " : "FAIL"} ${k}: ${v}`);
  console.log(problems.length ? `permissions: ${problems.length} problem(s)\n  ${problems.join("\n  ")}` : "permissions: microphone granted; camera, geolocation and MIDI refused (notifications reported, not judged)");
  process.exit(problems.length ? 4 : 0);
}

// Imported by checks/permissions-probe.mjs for problemsOf: only a direct run launches the app.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) await main();
