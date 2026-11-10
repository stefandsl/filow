import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, expect, it } from "vitest";
import { tmpRoot } from "./test-tmp";

const require = createRequire(import.meta.url);
const { installMacApp } = require("./localai.js");

const dir = tmpRoot("localai");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A download waiting to be installed, and optionally an Ollama.app already in the Applications folder. */
function scene(name: string, existing = false) {
  const root = path.join(dir, name);
  fs.rmSync(root, { recursive: true, force: true });
  const zip = path.join(root, "bin", "Ollama-darwin.zip");
  const staging = path.join(root, "bin", "ollama-staging");
  const apps = path.join(root, "Applications");
  fs.mkdirSync(path.dirname(zip), { recursive: true });
  fs.writeFileSync(zip, "zip");
  if (existing) {
    fs.mkdirSync(path.join(apps, "Ollama.app"), { recursive: true });
    fs.writeFileSync(path.join(apps, "Ollama.app", "version"), "old");
  }
  return { zip, staging, apps, installed: () => fs.readFileSync(path.join(apps, "Ollama.app", "version"), "utf8") };
}

/** Stands in for ditto and codesign: ditto unpacks a new app unless told to fail, codesign answers as told. */
function tools(s: ReturnType<typeof scene>, { ditto = "ok", codesign = "ok" } = {}) {
  const calls: { cmd: string; args: string[] }[] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    if (cmd === "ditto") {
      if (ditto === "fail") throw new Error("ditto: bad zip");
      if (ditto === "empty") return; // unpacks nothing: the later move has no app to move
      fs.mkdirSync(path.join(s.staging, "Ollama.app"), { recursive: true });
      fs.writeFileSync(path.join(s.staging, "Ollama.app", "version"), "new");
    }
    if (cmd === "codesign" && codesign === "fail") throw new Error("code failed to satisfy specified code requirement(s)");
  };
  return { run, calls };
}

it("installs only after codesign accepts Ollama's Apple Team ID, and replaces the app that was there", () => {
  const s = scene("ok", true);
  const { run, calls } = tools(s);
  installMacApp(s.zip, s.staging, s.apps, run);
  expect(calls.map((c) => c.cmd)).toEqual(["ditto", "codesign"]);
  const requirement = calls[1].args.find((a) => a.startsWith("-R="));
  expect(requirement).toMatch(/certificate leaf\[subject\.OU\] = "3MU9H2V9Y9"$/);
  expect(calls[1].args.at(-1)).toBe(path.join(s.staging, "Ollama.app"));
  expect(s.installed()).toBe("new");
  expect(fs.readdirSync(s.apps)).toEqual(["Ollama.app"]); // no backup copy left behind
  expect(fs.existsSync(s.zip)).toBe(false);
  expect(fs.existsSync(s.staging)).toBe(false);
});

it("a download with the wrong signature is not installed: the old app stays, the reason is in plain words", () => {
  const s = scene("bad-signature", true);
  const { run } = tools(s, { codesign: "fail" });
  expect(() => installMacApp(s.zip, s.staging, s.apps, run)).toThrow("not signed by Ollama's Apple Developer ID");
  expect(s.installed()).toBe("old");
  expect(fs.readdirSync(s.apps)).toEqual(["Ollama.app"]);
  expect(fs.existsSync(s.zip)).toBe(false);
  expect(fs.existsSync(s.staging)).toBe(false);
});

it("a zip that cannot be unpacked leaves nothing behind and is never checked or installed", () => {
  const s = scene("bad-zip");
  const { run, calls } = tools(s, { ditto: "fail" });
  expect(() => installMacApp(s.zip, s.staging, s.apps, run)).toThrow("ditto: bad zip");
  expect(calls.map((c) => c.cmd)).toEqual(["ditto"]);
  expect(fs.existsSync(s.zip)).toBe(false);
  expect(fs.existsSync(s.staging)).toBe(false);
  expect(fs.existsSync(path.join(s.apps, "Ollama.app"))).toBe(false);
});

it("puts the old app back when the new one cannot be moved into place", () => {
  const s = scene("move-fails", true);
  const { run } = tools(s, { ditto: "empty" });
  expect(() => installMacApp(s.zip, s.staging, s.apps, run)).toThrow();
  expect(s.installed()).toBe("old");
  expect(fs.readdirSync(s.apps)).toEqual(["Ollama.app"]);
});
