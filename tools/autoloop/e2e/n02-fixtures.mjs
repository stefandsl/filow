// Windows operator fixture. Prepare a NEW private directory before launching the candidate:
// node n02-fixtures.mjs prepare ../run/fixture 5101 5102 6101 6102
// Prepend that directory to PATH for Filow only, with no cloudflared in the synthetic profile.
// The two advertised hostnames are labels. The replay connects only to the fixture's loopback ports.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolve junctions in existing ancestors even when the requested output is new.
function realPath(input) {
  if (fs.existsSync(input)) return fs.realpathSync.native(input);
  const parent = path.dirname(input);
  assert(parent !== input, "Replay volume is unavailable");
  return path.join(realPath(parent), path.basename(input));
}

export function replayPath(input, runRoot = process.env.FILOW_REPLAY_ROOT || ".") {
  assert(input, "Missing replay path");
  const full = realPath(path.resolve(runRoot, input));
  const checkout = fs.realpathSync.native(path.resolve(import.meta.dirname, "../../.."));
  const relative = path.relative(checkout, full);
  assert(relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative), "Use a directory outside the checkout");
  return full;
}

function checkedPorts(values) {
  const ports = values.map(Number);
  assert.equal(ports.length, 4);
  assert.equal(new Set(ports).size, 4);
  assert(ports.every(p => Number.isInteger(p) && p > 1023 && p < 65536 && ![4747, 4748, 11434].includes(p)));
  return ports;
}

async function prepare(dir, values) {
  assert.equal(process.platform, "win32");
  const ports = checkedPorts(values);
  for (const port of ports) {
    const probe = net.createServer();
    await new Promise((resolve, reject) => probe.once("error", reject).listen(port, "127.0.0.1", resolve));
    await new Promise(resolve => probe.close(resolve));
  }
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "ports.json"), JSON.stringify(ports), { flag: "wx" });
  const cs = value => '@"' + value.replaceAll('"', '""') + '"';
  const script = fileURLToPath(import.meta.url);
  const wrapper = `using System;
using System.Diagnostics;
class Program {
  static int Main(string[] args) {
    if (args.Length != 4 || args[0] != "tunnel" || args[1] != "--url" || args[3] != "--no-autoupdate") return 2;
    string role;
    if (args[2] == "http://127.0.0.1:${ports[0]}") role = "web";
    else if (args[2] == "http://127.0.0.1:${ports[1]}") role = "relay";
    else return 2;
    var info = new ProcessStartInfo(${cs(process.execPath)}, ${cs('"' + script + '" serve "' + dir + '" ')} + role);
    info.UseShellExecute = false;
    using (var child = Process.Start(info)) { child.WaitForExit(); return child.ExitCode; }
  }
}`;
  const source = path.join(dir, "fixture.cs");
  fs.writeFileSync(source, wrapper, { flag: "wx" });
  const compiler = path.join(process.env.SystemRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  execFileSync(compiler, ["/nologo", "/noconfig", "/reference:System.dll", "/target:exe", "/out:" + path.join(dir, "cloudflared.exe"), source],
    { windowsHide: true, timeout: 60000, cwd: dir, env: { SystemRoot: process.env.SystemRoot, TEMP: dir, TMP: dir } });
}

async function serve(dir, role) {
  assert(["web", "relay"].includes(role));
  const ports = checkedPorts(JSON.parse(fs.readFileSync(path.join(dir, "ports.json"), "utf8")));
  const index = role === "web" ? 0 : 1;
  const events = path.join(dir, role + ".jsonl");
  const record = event => fs.appendFileSync(events, JSON.stringify({ pid: process.pid, utc: new Date().toISOString(), event }) + "\n");
  const server = net.createServer(client => {
    record("connection");
    const upstream = net.connect(ports[index], "127.0.0.1");
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
    client.pipe(upstream).pipe(client);
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(ports[index + 2], "127.0.0.1", resolve));
  record("listening");
  // The operator can hold a connection open before it announces its URL or fail this fixture child.
  const timer = setInterval(() => {
    if (fs.existsSync(path.join(dir, "fail-" + role))) process.exit(17);
    if (!fs.existsSync(path.join(dir, "hold")) && !announced) {
      announced = true;
      process.stdout.write("https://n02-" + role + ".trycloudflare.com\n");
    }
  }, 100);
  let announced = false;
  server.once("close", () => clearInterval(timer));
}

// A synthetic OpenRouter receiver for a private package configured with
// OPENROUTER_BASE_URL=http://127.0.0.1:<port>/v1 and an inert fixture key.
// Hold each response until the UI observer has checked the visible indicator.
export async function openRouterFixture(port) {
  assert(Number.isInteger(port) && port > 1023 && port < 65536 && ![4747, 4748, 11434].includes(port));
  const requests = [], pending = [];
  const marker = randomUUID().slice(0, 8);
  const server = createServer(async (req, res) => {
    const record = { start: new Date().toISOString(), expectedPath: req.method === "POST" && req.url === "/v1/chat/completions" };
    requests.push(record);
    try {
      assert(record.expectedPath);
      let data = "";
      for await (const chunk of req) {
        data += chunk;
        assert(data.length <= 256000);
      }
      const body = JSON.parse(data);
      record.maker = String(body.model).split("/")[0];
      record.hosts = body.provider?.only;
      record.wordsOnly = body.messages.filter(m => Array.isArray(m.content)).every(m => m.content.every(part => part.type === "text"));
      record.questionMatched = body.messages.at(-1)?.content?.some(part => part.text?.includes("Where is Save practice?") || part.text?.includes("Dove si trova Salva prova?")) === true;
      record.privateOriginAbsent = req.headers["http-referer"] === undefined;
      pending.push(res);
    } catch {
      res.writeHead(400).end();
    }
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));
  return {
    marker, requests, waiting: () => pending.length,
    release(status = 200) {
      const res = pending.shift();
      assert(res, "Expected a held provider request");
      if (status === 200) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end("data: " + JSON.stringify({ choices: [{ delta: { content: "Select Save practice (Salva prova). " + marker } }] }) + "\n\ndata: [DONE]\n\n");
      } else res.writeHead(status).end(JSON.stringify({ error: { message: "synthetic failure" } }));
      requests.at(-1).end = new Date().toISOString();
    },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

if (pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [mode, directory, ...values] = process.argv.slice(2);
  const dir = replayPath(directory);
  if (mode === "prepare") await prepare(dir, values);
  else if (mode === "serve") await serve(dir, values[0]);
  else throw new Error("Expected prepare or serve");
}
