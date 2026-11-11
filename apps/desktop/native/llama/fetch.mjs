// Fetches llama.cpp's server program (MIT) for the package: the runtime of S1-mini by Superwhisper
// (apps/desktop/s1-runtime.js, docs/dictation/S1-MINI.md). The official release archive is downloaded by
// its pinned tag, checked against its pinned SHA-256, and only the files the server needs are put in
// native/llama/<platform>-<arch>/ (not kept in git: about 40 MB). Run by `npm run vendor` before a build:
//   node apps/desktop/native/llama/fetch.mjs [--platform win32] [--arch x64] [--from <archive already on disk>]
// Windows x64 is verified (the server was run with the model on 2026-11-11). The macOS and Linux
// archives are pinned too but were not run by us: they are fetched only when asked for by name, and
// Filow says "runtime not in this build" on a platform that has none.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TAG = "b12284";
export const ARCHIVES = {
  "win32-x64": { name: `llama-${TAG}-bin-win-cpu-x64.zip`, sha256: "6b3d2c7034b0c0bac65aa0524ddf01ba9c2b622ce7e32675976df642627defa9", verified: true },
  "darwin-arm64": { name: `llama-${TAG}-bin-macos-arm64.tar.gz`, sha256: "7965e7701df311c49cfc629cfe14cc5092fcc590ef8c85f4c436a2973031e9d0", verified: false },
  "darwin-x64": { name: `llama-${TAG}-bin-macos-x64.tar.gz`, sha256: "4513149cdc86dff07dcfafcaca1b3522b81a2ccd6476e32b9ef185b3fcdbbe49", verified: false },
  "linux-x64": { name: `llama-${TAG}-bin-ubuntu-x64.tar.gz`, sha256: "50b5f85d45f8ddc7179d1b9b65de6534fbb18dc075942413238cb3471570123f", verified: false },
};
/** Files of the archive the server does not need (other tools, their libraries, the web page is built in). */
const SKIP = /^(llama-(?!server)[\w-]+|ggml-rpc[\w-]*|rpc-server|llama)\.(exe|dll)$|^llama-(cli|bench|completion|imatrix|perplexity|quantize|tts|mtmd-cli|gguf-split|connect|batched-bench|run|tokenize)[\w-]*$/i;
const KEEP = /^(llama\.dll|llama-common\.dll|llama-server\.exe|llama-server-impl\.dll)$/i;

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };

export async function fetchRuntime({ platform = process.platform, arch = process.arch, from = "", outRoot = here, log = console.log } = {}) {
  const id = `${platform}-${arch}`;
  const a = ARCHIVES[id];
  if (!a) { log(`llama runtime: no archive pinned for ${id}; Filow will say "runtime not in this build" there`); return ""; }
  const out = path.join(outRoot, id);
  const stamp = path.join(out, "FETCHED-FROM.txt");
  const want = `llama.cpp ${TAG} ${a.name} sha256 ${a.sha256}\n`;
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === want) { log(`llama runtime: ${id} already in place`); return out; }
  const work = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), "filow-llama-"));
  try {
    let archive = from;
    if (!archive) {
      archive = path.join(work, a.name);
      const url = `https://github.com/ggml-org/llama.cpp/releases/download/${TAG}/${a.name}`;
      log(`llama runtime: downloading ${url}`);
      const r = await fetch(url, { redirect: "follow" });
      if (!r.ok) throw new Error(`download failed: ${r.status}`);
      fs.writeFileSync(archive, Buffer.from(await r.arrayBuffer()));
    }
    const sha = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    if (sha !== a.sha256) throw new Error(`${a.name}: SHA-256 is ${sha}, expected ${a.sha256}. Nothing was unpacked.`);
    const unpacked = path.join(work, "x");
    fs.mkdirSync(unpacked);
    execFileSync("tar", ["-xf", archive, "-C", unpacked]); // bsdtar on Windows 10 and later reads zip too
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    let n = 0;
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (KEEP.test(e.name) || !SKIP.test(e.name)) { fs.copyFileSync(p, path.join(out, e.name)); if (platform !== "win32") fs.chmodSync(path.join(out, e.name), 0o755); n += 1; }
      }
    };
    walk(unpacked);
    const server = path.join(out, platform === "win32" ? "llama-server.exe" : "llama-server");
    if (!fs.existsSync(server)) throw new Error(`${a.name} has no llama-server`);
    fs.writeFileSync(stamp, want);
    log(`llama runtime: ${n} files in ${out}${a.verified ? "" : " (this platform's archive was never run by us)"}`);
    return out;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const platform = arg("--platform", process.platform);
  const arch = arg("--arch", process.arch);
  // Without a name, only a platform we have run: an unverified runtime is never shipped by default.
  const id = `${platform}-${arch}`;
  if (!process.argv.includes("--platform") && ARCHIVES[id] && !ARCHIVES[id].verified) console.log(`llama runtime: ${id} is not verified; pass --platform ${platform} to fetch it anyway`);
  else await fetchRuntime({ platform, arch, from: arg("--from", "") });
}
