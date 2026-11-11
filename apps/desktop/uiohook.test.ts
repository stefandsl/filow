// Issue #6, root cause: Windows refused the hook library's DLL (error 126). Filow loads its own build of the
// library's Windows binary, which then registers the hooks for the program itself (native/uiohook).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADDED, ORIGINAL, patchInputHook } from "./native/uiohook/patch.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { nativeDir } = require("./uiohook.js") as {
  nativeDir(o?: { platform?: string; arch?: string; baseDir?: string; exists?: (p: string) => boolean }): string;
};
const lib = path.dirname(require.resolve("uiohook-napi/package.json"));
const ours = path.join(here, "native", "uiohook");

describe("the keyboard hook library Filow loads", () => {
  it("on Windows x64 it is Filow's build; elsewhere, or when that file is missing, the stock one", () => {
    const all = () => true;
    expect(nativeDir({ platform: "win32", arch: "x64", baseDir: "G:\\app", exists: all })).toBe(path.join("G:\\app", "native", "uiohook"));
    expect(nativeDir({ platform: "darwin", arch: "arm64", baseDir: "/app", exists: all })).toBe("");
    expect(nativeDir({ platform: "linux", arch: "x64", baseDir: "/app", exists: all })).toBe("");
    expect(nativeDir({ platform: "win32", arch: "arm64", baseDir: "G:\\app", exists: () => false })).toBe("");
    // The real folder: the binary is committed for x64.
    expect(nativeDir({ platform: "win32", arch: "x64" })).toBe(ours);
  });

  it("in a package the binary is read from app.asar.unpacked (a native file cannot load from inside the archive)", () => {
    const asked: string[] = [];
    const dir = nativeDir({ platform: "win32", arch: "x64", baseDir: "C:\\Programs\\Filow\\resources\\app.asar", exists: (p) => { asked.push(p); return true; } });
    expect(dir).toBe("C:\\Programs\\Filow\\resources\\app.asar.unpacked\\native\\uiohook");
    expect(asked[0]).toBe(path.join(dir, "prebuilds", "win32-x64", "uiohook-napi.node"));
  });

  it("the patch still fits the library's source: the fallback goes right after its two registration calls", () => {
    const source = fs.readFileSync(path.join(lib, "libuiohook", "src", "windows", "input_hook.c"), "utf8");
    const patched = patchInputHook(source);
    const at = patched.indexOf(ORIGINAL);
    expect(at).toBeGreaterThan(0);
    expect(patched.slice(at + ORIGINAL.length, at + ORIGINAL.length + ADDED.length)).toBe(ADDED);
    // The fallback tries the program's own module, then no module, only for a hook that is still missing.
    expect(ADDED).toContain("HINSTANCE fallback[2] = { GetModuleHandle(NULL), NULL };");
    expect(ADDED).toContain("if (keyboard_event_hhook == NULL || mouse_event_hhook == NULL) {");
    // Applying it twice changes nothing; a library whose lines moved is refused loudly.
    expect(patchInputHook(patched)).toBe(patched);
    expect(() => patchInputHook(source.replace("WH_KEYBOARD_LL, keyboard_hook_event_proc, hInst", "WH_KEYBOARD_LL, keyboard_hook_event_proc, module"))).toThrow(/changed/);
  });

  it("the committed binary was built from the library version that is installed, and is not the stock file", () => {
    const version = (JSON.parse(fs.readFileSync(path.join(lib, "package.json"), "utf8")) as { version: string }).version;
    expect(fs.readFileSync(path.join(ours, "prebuilds", "win32-x64", "BUILT-FROM.txt"), "utf8")).toContain(`uiohook-napi ${version} `);
    const built = fs.readFileSync(path.join(ours, "prebuilds", "win32-x64", "uiohook-napi.node"));
    const stock = fs.readFileSync(path.join(lib, "prebuilds", "win32-x64", "uiohook-napi.node"));
    expect(built.equals(stock)).toBe(false);
    // The fallback's log line is in the binary: it is the patched build.
    expect(built.includes(Buffer.from("refused the library module"))).toBe(true);
    expect(stock.includes(Buffer.from("refused the library module"))).toBe(false);
  });

  it.runIf(process.platform === "win32" && process.arch === "x64")("on this Windows PC the hook registers through Filow's loader", () => {
    // In its own process: a real low-level hook for a moment, then stopped. The stock binary fails here with
    // UIOHOOK_ERROR_SET_WINDOWS_HOOK_EX on a PC in the state of issue #6; ours must register either way.
    const script = "const { loadUiohook } = require('./uiohook.js'); const { uIOhook } = loadUiohook(); try { uIOhook.start(); uIOhook.stop(); console.log('HOOK OK'); } catch (e) { console.log('HOOK FAILED ' + e.code); } process.exit(0);";
    const r = spawnSync(process.execPath, ["-e", script], { cwd: here, encoding: "utf8", timeout: 20_000 });
    expect(r.stdout).toContain("HOOK OK");
  });
});
