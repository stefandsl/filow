// A hidden QA instance of Filow from this checkout (not a package): Electron on apps/desktop with the
// built web and session servers, its own profile and ports, invisible and deaf to the PC
// (FILOW_QA_HEADLESS, FILOW_QA_NO_GLOBAL_INPUT), every model answered by the fake model server on
// loopback. Build first: npm run build -w apps/web && npm run build -w apps/server.
// Ports: web 5091, session 5092, fake model 5093, HTTPS 5094, DevTools 9691.
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAST_ONBOARDING } from "../autoloop/e2e/profile.mjs";
import { startFakeModel } from "./fake-model.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PORTS = { web: 5091, session: 5092, fake: 5093, https: 5094, devtools: 9691 };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, ms, every = 300) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > until) return null;
    await sleep(every);
  }
}

const targets = async () => { try { return await (await fetch(`http://127.0.0.1:${PORTS.devtools}/json`)).json(); } catch { return []; } };

export async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "evaluate failed");
    return r.result?.result?.value;
  };
  return { call, evaluate, close: () => ws.close() };
}

/**
 * Starts the fake model and Filow on `profile` (created with `settings` merged in). Returns
 * { fake, page (the whiteboard window), stop }. `topic` opens the whiteboard on that topic; without it the page opens empty.
 */
export async function launch({ profile, settings = {}, env = {}, files = {} }) {
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({ ...PAST_ONBOARDING, remoteShare: false, ...settings }, null, 2));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(profile, rel)), { recursive: true });
    fs.writeFileSync(path.join(profile, rel), body);
  }
  const fake = await startFakeModel(PORTS.fake);
  const electron = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
  const app = spawn(electron, [path.join(ROOT, "apps", "desktop"), `--remote-debugging-port=${PORTS.devtools}`], {
    env: {
      ...process.env,
      FILOW_QA_HEADLESS: "1",
      FILOW_QA_NO_GLOBAL_INPUT: "1",
      FILOW_USER_DATA_DIR: profile,
      FILOW_PORT: String(PORTS.web),
      FILOW_SESSION_PORT: String(PORTS.session),
      FILOW_HTTPS_PORT: String(PORTS.https),
      FILOW_SPLASH_MIN_MS: "0",
      OPENROUTER_BASE_URL: `http://127.0.0.1:${PORTS.fake}/v1`,
      OPENROUTER_API_KEY: "test-key-not-real",
      OLLAMA_URL: `http://127.0.0.1:${PORTS.fake}`,
      BUDDY_LOCAL_MODEL: "fake-local",
      BUDDY_CLOUD_MODEL: "",
      FILOW_OFFLINE: "",
      WHITEBOARD_TEMPLATES: "off",
      ...env,
    },
    stdio: "ignore",
    windowsHide: true,
  });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ }
    await fake.stop();
  };
  process.on("exit", () => { try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ } });
  const helper = await waitFor(async () => (await targets()).find((t) => t.type === "page" && t.url.startsWith(`http://127.0.0.1:${PORTS.web}/okfilow/`)), 150_000, 1500);
  if (!helper) { await stop(); throw new Error("no OK Filow window"); }
  const okf = await connect(helper);
  await waitFor(() => okf.evaluate("typeof window.okFilow?.showWhiteboard === 'function'"), 30_000);
  /** Opens the whiteboard window (on a topic, which asks it at once like the panel does, or empty) and connects to it. */
  const openBoard = async (topic = " ") => {
    await okf.evaluate(`window.okFilow.showWhiteboard(${JSON.stringify(topic)}); true`);
    const t = await waitFor(async () => (await targets()).find((x) => x.type === "page" && x.url.includes("/okfilow/whiteboard")), 30_000);
    if (!t) throw new Error("no whiteboard window");
    const page = await connect(t);
    await page.call("Page.enable");
    await page.call("Runtime.enable");
    await waitFor(() => page.evaluate(`Boolean(document.querySelector("main.wb-page"))`), 30_000);
    return page;
  };
  return { fake, okf, openBoard, stop, pid: app.pid };
}

export const cloudCalls = (fake) => fake.seen.filter((x) => x.url.endsWith("/chat/completions"));
