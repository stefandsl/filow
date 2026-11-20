import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { sweepDiagnostics } = require("./diag.js");
const { createDictationDiag } = require("./dictation-diag.js");
const day = 86_400_000;
let profile: string;
const file = (name: string) => path.join(profile, name);
beforeEach(() => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "diagnostics-"));
  fs.mkdirSync(file("Crashpad/reports"), { recursive: true });
});
afterEach(() => { fs.rmSync(profile, { recursive: true, force: true }); });

it("expires dated records with continuations and removes old dumps by modification time", () => {
  const now = Date.now();
  const old = new Date(now - 8 * day);
  const recent = new Date(now - 6 * day);
  fs.writeFileSync(file("startup.log"), old.toISOString() + " old\nstack line\n" + recent.toISOString() + " recent\n");
  for (const [name, date] of [["expired", old], ["current", recent]] as const) {
    fs.writeFileSync(file("Crashpad/reports/" + name + ".dmp"), name);
    fs.utimesSync(file("Crashpad/reports/" + name + ".dmp"), date, date);
  }
  sweepDiagnostics(profile);
  expect(fs.readdirSync(file("Crashpad/reports"))).toEqual(["current.dmp"]);
  expect(fs.readFileSync(file("startup.log"), "utf8")).toBe(recent.toISOString() + " recent\n");
  fs.utimesSync(file("startup.log"), old, old);
  sweepDiagnostics(profile);
  expect(fs.existsSync(file("startup.log"))).toBe(false);
});

it("removes current diagnostics on request and preserves other profile files", () => {
  for (const name of ["startup.log", "Crashpad/reports/current.dmp", "script.md", "settings.json"]) fs.writeFileSync(file(name), "keep");
  sweepDiagnostics(profile, { clear: true });
  expect(fs.existsSync(file("startup.log"))).toBe(false);
  expect(fs.readdirSync(file("Crashpad/reports"))).toEqual([]);
  expect(fs.readFileSync(file("script.md"), "utf8")).toBe("keep");
  expect(fs.readFileSync(file("settings.json"), "utf8")).toBe("keep");
});

it("forgets the active dictation as well as completed history", () => {
  const history = createDictationDiag();
  history.begin("hold");
  history.clear();
  history.mark("audio");
  expect(history.current).toBeNull();
  expect(history.runs()).toEqual([]);
});
