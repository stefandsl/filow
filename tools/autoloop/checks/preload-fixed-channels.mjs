// SEC-07: no preload hands a page a way to pick its own IPC channel.
// Behavioural, not textual: each apps/desktop/*preload*.js is loaded against a fake `electron`,
// then every function it exposes (at any depth, including functions returned by functions) is
// called with a canary string in every argument. If the canary ever arrives as the channel of an
// ipcRenderer call, a page could reach any main-process handler through that function.
// Also fails if a preload exposes ipcRenderer itself or one of its methods.
import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";

const CANARY = "sec07-canary-channel";
const dir = path.resolve(process.argv[2] || "apps/desktop"); // a folder argument is for mutation tests
const files = fs.readdirSync(dir).filter((n) => /preload.*\.js$/.test(n));
const require = createRequire(import.meta.url);
const bad = [];
let exposed = 0;
const channels = new Set();

for (const f of files) {
  const seen = [];
  const record = (method) => (channel) => {
    seen.push({ method, channel: String(channel) });
    return method === "invoke" ? Promise.resolve(undefined) : undefined;
  };
  const ipcRenderer = {};
  for (const m of ["send", "sendSync", "sendToHost", "invoke", "on", "once", "off", "addListener", "removeListener", "removeAllListeners", "postMessage"]) ipcRenderer[m] = record(m);
  const worlds = {};
  const contextBridge = {
    exposeInMainWorld: (name, api) => { worlds[name] = api; },
    exposeInIsolatedWorld: (_id, name, api) => { worlds[name] = api; },
  };
  const realLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "electron") return { contextBridge, ipcRenderer, webFrame: {}, webUtils: {} };
    return realLoad.call(this, request, ...rest);
  };
  const listeners = [];
  const target = { addEventListener: (_t, fn) => listeners.push(fn), removeEventListener() {}, dispatchEvent() {} };
  globalThis.window = Object.assign(target, { location: { href: "http://127.0.0.1/" } });
  globalThis.document = { ...target, readyState: "complete" };
  const full = path.join(dir, f);
  try {
    delete require.cache[full];
    require(full);
    for (const fn of listeners) { try { fn({}); } catch { /* page events are not the subject */ } }
  } catch (e) {
    bad.push(`${f}: could not be loaded (${e.message})`);
  } finally {
    Module._load = realLoad;
  }

  const ipcFns = new Set(Object.values(ipcRenderer));
  const visited = new Set();
  const walk = (value, where, depth) => {
    if (value === ipcRenderer || ipcFns.has(value)) { bad.push(`${f}: ${where} exposes ipcRenderer itself`); return; }
    if (depth > 4 || value === null || visited.has(value)) return;
    if (typeof value === "function") {
      visited.add(value);
      exposed++;
      const before = seen.length;
      let out;
      try { out = value(CANARY, CANARY, CANARY, CANARY); } catch { /* argument validation is fine */ }
      if (out && typeof out.catch === "function") out.catch(() => {});
      for (const call of seen.slice(before)) {
        if (call.channel.includes(CANARY)) bad.push(`${f}: ${where}() passes its argument to ipcRenderer.${call.method} as the channel`);
      }
      if (typeof out === "function" || (out && typeof out === "object" && typeof out.then !== "function")) walk(out, `${where}()`, depth + 1);
    } else if (typeof value === "object") {
      visited.add(value);
      for (const [k, v] of Object.entries(value)) walk(v, `${where}.${k}`, depth + 1);
    }
  };
  for (const [name, api] of Object.entries(worlds)) walk(api, name, 0);
  for (const call of seen) if (!call.channel.includes(CANARY)) channels.add(call.channel);
  if (!Object.keys(worlds).length) bad.push(`${f}: exposes nothing (is it still a preload?)`);
}

console.log(`${files.length} preloads, ${exposed} exposed functions called, ${channels.size} fixed channels, ${bad.length} problems`);
if (!files.length || !exposed) { console.log("nothing was checked"); process.exit(1); }
if (bad.length) { console.log(bad.join("\n")); process.exit(1); }
