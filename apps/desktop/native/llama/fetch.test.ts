import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { ARCHIVES, fetchRuntime, tarCommand } from "./fetch.mjs";

test("on Windows the archive is unpacked by the system bsdtar, by its full path", () => {
  expect(tarCommand("win32", { SystemRoot: "C:\\Windows" })).toBe("C:\\Windows\\System32\\tar.exe");
  expect(tarCommand("win32", { windir: "D:\\Win" })).toBe("D:\\Win\\System32\\tar.exe");
  expect(tarCommand("linux", {})).toBe("tar");
  expect(tarCommand("darwin", {})).toBe("tar");
});

// Test data stays in the repo's own tmp folder (on G:), never in the system temp folder.
const root = path.resolve("tmp", `test-llama-fetch-${process.pid}`);
const saved = { entry: { ...ARCHIVES["win32-x64"] }, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP };
afterEach(() => {
  Object.assign(ARCHIVES["win32-x64"], saved.entry);
  process.env.PATH = saved.PATH;
  process.env.TEMP = saved.TEMP;
  process.env.TMP = saved.TMP;
  if (root.startsWith(path.resolve("tmp") + path.sep)) fs.rmSync(root, { recursive: true, force: true });
});

test.skipIf(process.platform !== "win32")("a zip unpacks from a Git Bash PATH and with no usable temp folder", async () => {
  const src = path.join(root, "src");
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, "llama-server.exe"), "server");
  fs.writeFileSync(path.join(src, "llama-cli.exe"), "not needed");
  const zip = path.join(root, "runtime.zip");
  execFileSync(tarCommand(), ["-a", "-cf", zip, "-C", src, "llama-server.exe", "llama-cli.exe"]);
  ARCHIVES["win32-x64"].sha256 = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");

  // GNU tar first on the PATH, as in Git Bash, and a temp folder that does not exist.
  const gitTar = "C:\\Program Files\\Git\\usr\\bin";
  if (fs.existsSync(path.join(gitTar, "tar.exe"))) process.env.PATH = `${gitTar};${saved.PATH}`;
  process.env.TEMP = process.env.TMP = path.join(root, "no-such-temp");

  const outRoot = path.join(root, "out");
  const out = await fetchRuntime({ platform: "win32", arch: "x64", from: zip, outRoot, log: () => {} });
  expect(fs.readdirSync(out).sort()).toEqual(["FETCHED-FROM.txt", "llama-server.exe"]);
  expect(fs.readdirSync(outRoot)).toEqual(["win32-x64"]); // the work folder is gone
});
