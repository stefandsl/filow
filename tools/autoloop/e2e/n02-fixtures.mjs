// Windows operator fixture. Prepare a NEW private directory before launching the candidate:
// node n02-fixtures.mjs prepare G:/run/fixture 5101 5102 6101 6102
// Prepend that directory to PATH for Filow only, with no cloudflared in the synthetic profile.
// The two advertised hostnames are labels. The replay connects only to the fixture's loopback ports.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  execFileSync(compiler, ["/nologo", "/noconfig", "/target:exe", "/out:" + path.join(dir, "cloudflared.exe"), source],
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

const [mode, directory, ...values] = process.argv.slice(2);
assert(directory && /^G:\\/i.test(path.resolve(directory)) && !/^G:\\FILOW(?:\\|$)/i.test(path.resolve(directory)));
const dir = path.resolve(directory);
if (mode === "prepare") await prepare(dir, values);
else if (mode === "serve") await serve(dir, values[0]);
else throw new Error("Expected prepare or serve");
