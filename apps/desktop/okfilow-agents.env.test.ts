import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createAgents } = require("./okfilow-agents.js");

// The CLI (claude) is an external program: a realistic fake on PATH records the environment it got.
const SECRETS = {
  OPENROUTER_API_KEY: "sk-or-test-secret-1",
  ANTHROPIC_API_KEY: "sk-ant-test-secret-2",
  OPENAI_API_KEY: "sk-openai-test-secret-3",
  ACCESS_PASSWORD: "lan-password-secret-4",
  FILOW_APP_PAIR_KEY: "pair-key-secret-5",
};
const saved: Record<string, string | undefined> = {};

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe.skipIf(process.platform === "win32")("OK Filow agent child environment", () => {
  it("does not hand Filow's decrypted keys or LAN secrets to the agent CLI", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "c29-"));
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    const fake = path.join(bin, "claude");
    fs.writeFileSync(fake, `#!${process.execPath}\nconst fs=require("fs");process.stdin.resume();process.stdin.on("end",()=>{fs.writeFileSync("output/env.json",JSON.stringify(process.env));process.stdout.write("Made it.\\nARTIFACTS: env.json\\n");});\n`);
    fs.chmodSync(fake, 0o755);
    // What loadSecrets() (main.js:664) and startServers() (main.js:2094-2098) leave in the main process env.
    for (const k of [...Object.keys(SECRETS), "PATH"]) saved[k] = process.env[k];
    Object.assign(process.env, SECRETS);
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;

    let done!: (job: { status: string; dir: string }) => void;
    const finished = new Promise<{ status: string; dir: string }>((r) => { done = r; });
    const agents = createAgents({
      baseDir: path.join(root, "agents"), logLine: () => {}, onChange: () => {},
      cli: () => "claude", which: (n: string) => n === "claude",
      openPath: () => {}, showItem: () => {}, announce: (job: { status: string; dir: string }) => done(job),
    });
    agents.start("write a note about rockets");
    const job = await finished;
    expect(job.status).toBe("done");
    const childEnv = JSON.parse(fs.readFileSync(path.join(job.dir, "output", "env.json"), "utf8"));
    const leaked = Object.keys(SECRETS).filter((k) => k in childEnv);
    expect(leaked).toEqual([]);
  }, 20000);
});
