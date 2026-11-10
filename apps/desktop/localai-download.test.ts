// The Ollama installer download (localai.js installOllama) against a local server that cuts or stalls
// the stream: the install must end with a clear error, and no partial installer may stay on disk.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpRoot } from "./test-tmp";

const require = createRequire(import.meta.url);
const { installOllama } = require("./localai.js");

const bytes = crypto.randomBytes(512 * 1024);
let root = "";
let server: http.Server;
let base = "";
let mode: "drop" | "hold" = "drop";
const held: http.ServerResponse[] = [];

beforeAll(async () => {
  root = tmpRoot("localai-download");
  server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Length": bytes.length });
    const half = bytes.subarray(0, bytes.length / 2);
    // drop: half the file, then the connection is cut like a dropped Wi-Fi.
    if (mode === "drop") return void res.write(half, () => setTimeout(() => res.destroy(), 100));
    // hold: half the file, then nothing more and the connection stays open.
    held.push(res);
    res.write(half);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  for (const res of held) res.destroy();
  await new Promise((r) => server.close(r));
  fs.rmSync(root, { recursive: true, force: true });
});

async function install(name: string) {
  const binDir = path.join(root, name);
  const states: { state: string; error: string }[] = [];
  await installOllama(binDir, (s: { state: string; error: string }) => states.push(s), {
    findExe: () => "", version: async () => "", platform: "win32", urls: { win32: `${base}/OllamaSetup.exe` }, idleMs: 300,
  });
  return { binDir, states };
}

describe("Ollama installer download", { timeout: 10_000 }, () => {
  it("a dropped connection ends the install with a clear error and leaves no partial installer", async () => {
    mode = "drop";
    const { binDir, states } = await install("drop");
    expect(states.at(-1)?.state).toBe("error");
    expect(states.at(-1)?.error).toMatch(/Ollama download failed: .*(aborted|incomplete|socket hang up|ECONNRESET)/i);
    expect(fs.readdirSync(binDir)).toEqual([]);
  });

  it("a connection that goes silent ends within the idle timeout, with no partial installer", async () => {
    mode = "hold";
    const { binDir, states } = await install("hold");
    expect(states.at(-1)?.state).toBe("error");
    expect(states.at(-1)?.error).toMatch(/Ollama download failed: download idle/);
    expect(fs.readdirSync(binDir)).toEqual([]);
  });
});
