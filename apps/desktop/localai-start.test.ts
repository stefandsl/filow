// Bringing up an installed Ollama (localai.js startOllama, installOllama): GitHub issue #1. On a clean
// Windows laptop the installer ran, Ollama's desktop app never opened its port, and Filow only ever
// asked that app again, so the status ended on "did not start; open it once by hand" every time.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { tmpRoot } from "./test-tmp";

const require = createRequire(import.meta.url);
const { startOllama, installOllama, probeOllama, scrubLogLine, isOllamaStopped, OLLAMA_STOPPED } = require("./localai.js");

const dir = tmpRoot("localai-start");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

type Probe = { state: "up" | "busy" | "down"; version: string };
type Run = { pid: number; exit: null | { code: number | null; signal: string | null; error: string } };

/**
 * A computer with a clock that only moves when the code under test waits. `port(t, served)` says what
 * is at Ollama's address t ms after the start; `served` is the time our own "ollama serve" was started
 * (null: not yet). Nothing real is started and no real time passes.
 */
function machine(port: (t: number, served: number | null) => Probe["state"], opts: { app?: boolean; exitAfterMs?: number; exitCode?: number; earlier?: boolean } = {}) {
  let clock = 0;
  let served: number | null = null;
  let earlier = opts.earlier === true; // an "ollama serve" Filow started before this try, still running
  const calls = { app: 0, serve: 0, stop: 0 };
  const logs: string[] = [];
  const run: Run = { pid: 4242, exit: null };
  const deps = {
    platform: "win32",
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
      if (served !== null && opts.exitAfterMs !== undefined && clock - served >= opts.exitAfterMs) run.exit = { code: opts.exitCode ?? 1, signal: null, error: "" };
    },
    probe: async (): Promise<Probe> => {
      const state = port(clock, served);
      return { state, version: state === "up" ? "0.40.16" : "" };
    },
    launchApp: () => {
      calls.app++;
      return opts.app !== false;
    },
    serve: () => {
      calls.serve++;
      served = clock;
      return run;
    },
    hasOwn: () => earlier,
    stop: () => {
      calls.stop++;
      earlier = false;
      return true;
    },
    log: (line: string) => logs.push(line),
    ollamaLogs: [] as string[],
  };
  return { deps, calls, logs, elapsed: () => clock, servedAt: () => served };
}

describe("starting an installed Ollama", () => {
  it("an Ollama that already answers is left alone", async () => {
    const m = machine(() => "up");
    expect(await startOllama("ollama.exe", m.deps)).toMatchObject({ ok: true, version: "0.40.16", by: "running" });
    expect(m.calls).toEqual({ app: 0, serve: 0, stop: 0 });
  });

  it("Ollama's own app gets its chance: when it opens the port in time, Filow starts no second server", async () => {
    const m = machine((t) => (t >= 8000 ? "up" : "down"));
    expect(await startOllama("ollama.exe", m.deps)).toMatchObject({ ok: true, by: "app" });
    expect(m.calls).toEqual({ app: 1, serve: 0, stop: 0 });
  });

  it("issue #1: the app never opens the port, so Filow runs the server itself and Ollama comes up", async () => {
    // the port answers only once "ollama serve" has been running for 7 s; the app alone never gets there
    const m = machine((t, served) => (served !== null && t - served >= 7000 ? "up" : "down"));
    const r = await startOllama("ollama.exe", m.deps);
    expect(r).toMatchObject({ ok: true, version: "0.40.16", by: "serve" });
    expect(m.calls).toMatchObject({ app: 1, serve: 1 });
    expect(m.servedAt()).toBe(20_000); // the app had its 20 s first
    expect(m.elapsed()).toBeLessThan(30_000);
    expect(m.logs.join("\n")).toMatch(/app did not open its port in 20 s: started "ollama serve" \(pid 4242\)/);
  });

  it("with no desktop app next to it (zip install, Linux) the server is started at once", async () => {
    const m = machine((t, served) => (served !== null && t - served >= 3000 ? "up" : "down"), { app: false });
    expect(await startOllama("ollama", m.deps)).toMatchObject({ ok: true, by: "serve" });
    expect(m.servedAt()).toBe(0);
  });

  it("a port that is open but silent is Ollama still looking for graphics cards: wait, start nothing on top", async () => {
    // the app opens the port after 5 s and answers only after 150 s, far past the 20 s it normally gets
    const m = machine((t) => (t >= 150_000 ? "up" : t >= 5000 ? "busy" : "down"));
    const r = await startOllama("ollama.exe", m.deps);
    expect(r).toMatchObject({ ok: true, by: "app" });
    expect(m.calls.serve).toBe(0);
    expect(m.elapsed()).toBeGreaterThanOrEqual(150_000);
  });

  it("a server that stops as soon as it starts ends the wait in seconds, with the exit code and the end of its output", async () => {
    const logFile = path.join(dir, "ollama-serve.log");
    fs.writeFileSync(logFile, ["line one", "", `Error: listen tcp 127.0.0.1:11434: bind: An attempt was made to access a socket in a way forbidden by its access permissions. ${"x".repeat(400)}`].join("\r\n"));
    const m = machine(() => "down", { app: false, exitAfterMs: 1000, exitCode: 3 });
    const r = await startOllama("ollama.exe", { ...m.deps, logFile });
    expect(r).toMatchObject({ ok: false, code: "start_exited", exitCode: 3 });
    expect(r.error).toBe("Ollama stopped right after it was started (exit code 3)");
    expect(m.elapsed()).toBeLessThanOrEqual(5000); // not the 4 minutes of a server that might still come up
    expect(r.lines[0]).toBe('"ollama serve" output, last 2 lines:');
    expect(r.lines[1]).toBe("  line one");
    expect(r.lines[2]).toMatch(/^ {2}Error: listen tcp .*forbidden by its access permissions\. x+\.\.\.$/);
    expect(r.lines[2].length).toBeLessThan(320); // long lines are cut
    expect(m.calls.stop).toBe(0); // nothing left to stop
  });

  it("an Ollama that never answers ends as a failure after 4 minutes, never as an endless start, and is not left running", async () => {
    const m = machine(() => "down");
    const r = await startOllama("ollama.exe", m.deps);
    expect(r).toMatchObject({ ok: false, code: "start_timeout", exitCode: null, minutes: 4 });
    expect(r.error).toBe("Ollama did not answer within 4 minutes (nothing listens on its port)");
    expect(m.elapsed()).toBe(240_000);
    expect(m.calls).toEqual({ app: 1, serve: 1, stop: 1 });
  });

  it("our server giving way to something silent already at the port is a start that timed out, not one that stopped at once", async () => {
    // nothing at the port for the app's 20 s, then something takes it and stays silent; our server exits on the taken port
    const m = machine((t) => (t >= 20_500 ? "busy" : "down"), { exitAfterMs: 1000, exitCode: 1 });
    const r = await startOllama("ollama.exe", m.deps);
    expect(r).toMatchObject({ ok: false, code: "start_timeout", exitCode: null });
    expect(r.error).toMatch(/its port is open but it does not answer/);
    expect(m.elapsed()).toBe(240_000);
  });

  it("a server Filow started earlier that no longer answers is stopped, so the new try is not blocked by it", async () => {
    // the old server holds the port in silence until it is stopped; after that a fresh one answers
    let stopped = false;
    const m = machine((t, served) => (!stopped ? "busy" : served !== null && t - served >= 2000 ? "up" : "down"), { app: false, earlier: true });
    const stop = m.deps.stop;
    m.deps.stop = () => ((stopped = true), stop());
    const r = await startOllama("ollama.exe", m.deps);
    expect(r).toMatchObject({ ok: true, by: "serve" });
    expect(m.calls).toMatchObject({ serve: 1, stop: 1 });
    expect(m.logs[0]).toMatch(/stopped the "ollama serve" Filow started earlier/);
  });

  it("a server Filow started earlier that is only slow for a moment is not stopped", async () => {
    const m = machine((t) => (t >= 3000 ? "up" : "busy"), { earlier: true });
    expect(await startOllama("ollama.exe", m.deps)).toMatchObject({ ok: true, by: "running" });
    expect(m.calls).toEqual({ app: 0, serve: 0, stop: 0 });
  });

  it("Ollama's own logs go into the reason when its app was the one that failed", async () => {
    const serverLog = path.join(dir, "server.log");
    const appLog = path.join(dir, "app.log");
    fs.writeFileSync(serverLog, "");
    fs.writeFileSync(appLog, 'level=INFO msg="starting ollama server"\nlevel=WARN msg="ollama server not ready, continuing anyway"\n');
    const m = machine((t) => (t >= 1000 ? "busy" : "down"));
    const r = await startOllama("ollama.exe", { ...m.deps, ollamaLogs: [serverLog, appLog, path.join(dir, "missing.log")] });
    expect(r).toMatchObject({ ok: false, code: "start_timeout" });
    expect(r.error).toMatch(/its port is open but it does not answer/);
    expect(r.lines).toEqual(["Ollama server.log: empty", "Ollama app.log, last 2 lines:", '  level=INFO msg="starting ollama server"', '  level=WARN msg="ollama server not ready, continuing anyway"']);
  });
});

describe("what the page is told (installOllama)", () => {
  const states = () => {
    const seen: { state: string; code: string; error: string; version: string }[] = [];
    return { seen, onStatus: (s: { state: string; code: string; error: string; version: string }) => void seen.push(s) };
  };

  it("an installed Ollama that will not start ends on an error with a code, and the reason is in the log", async () => {
    const s = states();
    const logs: string[] = [];
    await installOllama(path.join(dir, "bin"), s.onStatus, {
      findExe: () => "ollama.exe", version: async () => "", platform: "win32", log: (l: string) => logs.push(l),
      start: async () => ({ ok: false, code: "start_exited", exitCode: 1, error: "Ollama stopped right after it was started (exit code 1)", minutes: 4, lines: ['"ollama serve" output, last 1 lines:', "  Error: boom"] }),
    });
    expect(s.seen.map((x) => x.state)).toEqual(["checking", "starting", "error"]);
    expect(s.seen.at(-1)).toMatchObject({ code: "start_exited", error: "Ollama stopped right after it was started (exit code 1)" });
    expect(s.seen.at(-1)?.error).not.toMatch(/by hand/);
    expect(logs).toEqual(['"ollama serve" output, last 1 lines:', "  Error: boom"]);
  });

  it("when the start works the status ends on ready with the version", async () => {
    const s = states();
    await installOllama(path.join(dir, "bin"), s.onStatus, { findExe: () => "ollama.exe", version: async () => "", platform: "win32", start: async () => ({ ok: true, version: "0.40.16", by: "serve", seconds: 27 }) });
    expect(s.seen.at(-1)).toMatchObject({ state: "ready", version: "0.40.16", code: "" });
  });

  it("a start that throws still ends the status: it can not stay on starting", async () => {
    const s = states();
    await installOllama(path.join(dir, "bin"), s.onStatus, { findExe: () => "ollama.exe", version: async () => "", platform: "win32", start: async () => { throw Object.assign(new Error("spawn EPERM"), { code: "EPERM" }); } });
    expect(s.seen.at(-1)).toMatchObject({ state: "error", code: "unexpected", error: "spawn EPERM" });
  });

  it("start only: with no Ollama installed nothing is downloaded and nothing is reported as wrong", async () => {
    const s = states();
    const binDir = path.join(dir, "bin-start-only");
    await installOllama(binDir, s.onStatus, { findExe: () => "", version: async () => "", platform: "win32", startOnly: true, urls: { win32: "http://127.0.0.1:9/never" } });
    expect(s.seen.map((x) => x.state)).toEqual(["checking", "idle"]);
    expect(fs.existsSync(binDir)).toBe(false);
  });
});

describe("what is at Ollama's address (probeOllama)", () => {
  const before = process.env.OLLAMA_URL;
  const open: (http.Server | net.Server)[] = [];
  afterEach(async () => {
    if (before === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = before;
    for (const s of open.splice(0)) await new Promise((r) => s.close(r));
  });
  const listen = async (server: http.Server | net.Server) => {
    open.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    process.env.OLLAMA_URL = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  };

  it("up: Ollama answers with its version", async () => {
    await listen(http.createServer((_req, res) => res.end(JSON.stringify({ version: "0.40.16" }))));
    expect(await probeOllama(500)).toEqual({ state: "up", version: "0.40.16" });
  });

  it("busy: the port takes the connection but nothing answers yet", async () => {
    const sockets: net.Socket[] = [];
    await listen(net.createServer((socket) => void sockets.push(socket)));
    expect(await probeOllama(300)).toEqual({ state: "busy", version: "" });
    for (const s of sockets) s.destroy();
  });

  it("down: nothing listens", async () => {
    const server = net.createServer();
    await listen(server);
    await new Promise((r) => server.close(r)); // the port is free again, and known
    open.length = 0;
    expect(await probeOllama(300)).toEqual({ state: "down", version: "" });
  });
});

it("log lines are made safe before they reach the startup log", () => {
  // Go doubles the backslashes, which would hide the home folder from the report's own masking
  expect(scrubLogLine('OLLAMA_MODELS:C:\\\\Users\\\\Anna Rossi\\\\.ollama\\\\models')).toBe("OLLAMA_MODELS:C:\\Users\\Anna Rossi\\.ollama\\models");
  expect(scrubLogLine('msg="server config" env="map[HTTPS_PROXY:http://anna:s3cret@proxy.example:8080 HTTP_PROXY: NO_PROXY:localhost OLLAMA_HOST:http://127.0.0.1:11434]"'))
    .toBe('msg="server config" env="map[HTTPS_PROXY:<set> HTTP_PROXY: NO_PROXY:<set> OLLAMA_HOST:http://127.0.0.1:11434]"');
  expect(scrubLogLine("pull from https://anna:s3cret@registry.example/v2/")).toBe("pull from https://<secret>@registry.example/v2/");
  expect(scrubLogLine("Your new public key is: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEsZ0kq9Qx1ZP7example")).toBe("Your new public key is: <public key>");
});

it("OK Filow's 'Ollama is not running' answer is the one the desktop shell reacts to", () => {
  const providers = fs.readFileSync(path.resolve(__dirname, "../web/lib/buddy/providers.ts"), "utf8");
  const sentence = /throw new Error\(`(Ollama, which runs[^`]+)`/.exec(providers)?.[1] ?? "";
  expect(sentence).not.toBe("");
  expect(OLLAMA_STOPPED.test(sentence)).toBe(true);
  expect(isOllamaStopped({ error: sentence, code: "" })).toBe(true);
  // the panel says it in the user's language and sends its code instead; it uses the same test on the server's answer
  expect(isOllamaStopped({ error: "Ollama, che su questo PC fa rispondere OK Filow, non è in esecuzione.", code: "ollama_stopped" })).toBe(true);
  expect(isOllamaStopped({ error: "Non ho sentito.", code: "" })).toBe(false);
  expect(fs.readFileSync(path.resolve(__dirname, "../web/lib/buddy/text.ts"), "utf8")).toContain(`OLLAMA_STOPPED_ANSWER = ${OLLAMA_STOPPED};`);
  // the other answers about Ollama are not a stopped Ollama
  expect(OLLAMA_STOPPED.test("OK Filow got no answer on this PC within 3 minutes: the AI that runs it here is busy")).toBe(false);
  expect(OLLAMA_STOPPED.test("The screen helper for this computer's setup is not downloaded yet.")).toBe(false);
});
