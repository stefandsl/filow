// Launching and watching a packaged Filow from a test tool (coldstart.mjs, take.mjs, tools/eval/latency.mjs).
// One place for: starting Filow.exe on its own profile and ports (optionally on a processor mask),
// finding its main process, reading startup.log as it grows, and stopping exactly the processes it
// started. Nothing here touches any other process.
import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Offset and length of the PCM samples of a WAV: System.Speech writes an 18-byte fmt chunk, so not always 44. */
export function wavData(buf) {
  for (let o = 12; o + 8 <= buf.length;) {
    const id = buf.toString("ascii", o, o + 4), size = buf.readUInt32LE(o + 4);
    if (id === "data") return { offset: o + 8, length: Math.min(size, buf.length - o - 8) };
    o += 8 + size + (size % 2);
  }
  throw new Error("no data chunk in the WAV");
}

/** The lines of a log from line `fromLine` (0-based) on; [] when it does not exist yet. */
export function logLinesSince(logPath, fromLine = 0) {
  let text;
  try { text = fs.readFileSync(logPath, "utf8"); } catch { return []; }
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(fromLine);
}

/** How many lines the log has now (where a later logLinesSince starts). */
export const logLineCount = (logPath) => logLinesSince(logPath, 0).length;

/** The ISO time at the start of a startup.log line, as ms since 1970 (NaN when it has none). */
export const lineTime = (line) => Date.parse(String(line).slice(0, 24));

/**
 * Resolves with the first line from `fromLine` on that matches `regex`, and when it was written (its
 * own time stamp, else when it was seen). Rejects after `timeoutMs`.
 */
export async function waitForLine(logPath, regex, { fromLine = 0, timeoutMs = 60_000, everyMs = 100 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const lines = logLinesSince(logPath, fromLine);
    const line = lines.find((l) => regex.test(l));
    if (line !== undefined) {
      const stamped = lineTime(line);
      return { line, at: Number.isFinite(stamped) ? stamped : Date.now() };
    }
    if (Date.now() > until) throw new Error(`timed out after ${timeoutMs} ms waiting for ${regex}`);
    await sleep(everyMs);
  }
}

/** The processes of this PC as { pid, ppid, name, cmd }; one PowerShell call. */
export function processTable() {
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const list = JSON.parse(out);
  return (Array.isArray(list) ? list : [list]).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: String(p.Name || ""), cmd: String(p.CommandLine || "") }));
}

/** `rootPid` and every process below it in `table`. */
export function treeOf(table, rootPid) {
  const out = new Set([rootPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of table) if (!out.has(p.pid) && out.has(p.ppid)) { out.add(p.pid); grew = true; }
  }
  return [...out];
}

/** The PID of Filow's main process: Filow.exe from `exeDir` whose command line has --remote-debugging-port=<port> and no --type= (not a Chromium child). */
export function findMainPid(table, exeDir, port) {
  const exe = path.join(exeDir, "Filow.exe").toLowerCase();
  const hits = table.filter((p) => p.name.toLowerCase() === "filow.exe" && p.cmd.toLowerCase().includes(exe) && p.cmd.includes(`--remote-debugging-port=${port}`) && !/--type=/.test(p.cmd));
  return hits.length === 1 ? hits[0].pid : null;
}

/**
 * Starts Filow.exe from `exeDir` with `env` (whole environment, as given) and `args`. With `affinity`
 * (a hex mask such as "55") it starts through `cmd /c start "" /affinity <hex> /b`, so Filow and every
 * process it starts run on those logical processors. Resolves with the main process's PID, found by its
 * --remote-debugging-port in Win32_Process, and the time it was started.
 */
export async function launchFilow({ exeDir, profile, env, args = [], affinity = "", timeoutMs = 20_000 }) {
  const port = (/--remote-debugging-port=(\d+)/.exec(args.join(" ")) || [])[1];
  if (!port) throw new Error("launchFilow needs --remote-debugging-port=<port> in args (it finds the main process by it)");
  if (profile && env.FILOW_USER_DATA_DIR !== profile) throw new Error("FILOW_USER_DATA_DIR must be the profile");
  const exe = path.join(exeDir, "Filow.exe");
  if (!fs.existsSync(exe)) throw new Error(`no Filow.exe in ${exeDir}`);
  const startedAt = Date.now();
  if (affinity) {
    if (!/^[0-9a-f]{1,16}$/i.test(affinity)) throw new Error(`bad affinity mask ${affinity}`);
    const child = spawn("cmd.exe", ["/d", "/c", "start", '""', "/affinity", affinity, "/b", `"${exe}"`, ...args], { env, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true });
    child.unref();
  } else {
    const child = spawn(exe, args, { env, stdio: "ignore", windowsHide: true, detached: false });
    child.unref();
  }
  const until = Date.now() + timeoutMs;
  for (;;) {
    await sleep(300);
    const pid = findMainPid(processTable(), exeDir, port);
    if (pid) return { pid, startedAt };
    if (Date.now() > until) throw new Error(`Filow's main process did not appear within ${timeoutMs} ms`);
  }
}

/** Stops `pid` and its children (taskkill /T /F). Only ever called with a PID this tool started. */
export function stopTree(pid) {
  if (!Number.isInteger(pid) || pid <= 4) throw new Error(`refusing to stop pid ${pid}`);
  return new Promise((resolve) => execFile("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true }, () => resolve()));
}
