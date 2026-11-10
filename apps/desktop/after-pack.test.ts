import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const afterPack = require("./after-pack.js");
const { missingNative } = afterPack;

const dir = path.resolve(__dirname, "../../tmp/test-after-pack");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A fake resources folder holding the given native files under app.asar.unpacked/node_modules. */
function resources(name: string, files: string[]) {
  const res = path.join(dir, name, "resources");
  for (const f of files) {
    const p = path.join(res, "app.asar.unpacked", "node_modules", ...f.split("/"));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "");
  }
  fs.mkdirSync(res, { recursive: true });
  return res;
}

/** The files of a real sherpa-onnx-<os>-<cpu> 2.0.1 package (npm pack --dry-run), plus the hotkey prebuild. */
const LIBS: Record<string, string[]> = {
  win: ["onnxruntime.dll", "sherpa-onnx-c-api.dll"],
  linux: ["libonnxruntime.so", "libsherpa-onnx-c-api.so"],
  darwin: ["libonnxruntime.dylib", "libsherpa-onnx-c-api.dylib"],
};
const sherpa = (os: string, cpu: string) => ["sherpa-onnx.node", ...LIBS[os]].map((f) => `sherpa-onnx-${os}-${cpu}/${f}`);
const hook = (platform: string, cpu: string) => `uiohook-napi/prebuilds/${platform}-${cpu}/uiohook-napi.node`;

it("passes a build that holds the speech and hotkey binaries for its own platform and CPU", () => {
  expect(missingNative(resources("linux-ok", [...sherpa("linux", "x64"), hook("linux", "x64")]), "linux", "x64")).toEqual([]);
  expect(missingNative(resources("win-ok", [...sherpa("win", "x64"), hook("win32", "x64")]), "win32", "x64")).toEqual([]);
});

it("names what is missing when the binaries are for another CPU (x64 build made on an arm64 Mac)", () => {
  const res = resources("mac-wrong-cpu", [...sherpa("darwin", "arm64"), hook("darwin", "arm64"), hook("darwin", "x64")]);
  expect(missingNative(res, "darwin", "x64")).toEqual(["sherpa-onnx-darwin-x64 (speech to text)"]);
  expect(missingNative(res, "darwin", "arm64")).toEqual([]);
  expect(missingNative(res, "darwin", "universal")).toEqual(["sherpa-onnx-darwin-x64 (speech to text)"]);
});

it("uses sherpa's win- prefix on Windows and needs the addon itself, not just the folder or another .node", () => {
  const res = resources("win-empty", ["sherpa-onnx-win-x64/README.md", "sherpa-onnx-win-x64/other.node", hook("win32", "x64")]);
  expect(missingNative(res, "win32", "x64")).toEqual(["sherpa-onnx-win-x64 (speech to text)"]);
  const noHook = resources("win-no-hook", [...sherpa("win", "x64"), "uiohook-napi/prebuilds/win32-x64/other.node"]);
  expect(missingNative(noHook, "win32", "x64")).toEqual(["uiohook-napi/prebuilds/win32-x64 (OK Filow hold-to-talk)"]);
});

it("names each library the speech addon cannot start without, with the target platform's file names", () => {
  const addonOnly = (os: string, platform: string) => resources(`${os}-addon-only`, [`sherpa-onnx-${os}-x64/sherpa-onnx.node`, hook(platform, "x64")]);
  expect(missingNative(addonOnly("linux", "linux"), "linux", "x64")).toEqual(["sherpa-onnx-linux-x64/libonnxruntime.so (speech to text)", "sherpa-onnx-linux-x64/libsherpa-onnx-c-api.so (speech to text)"]);
  expect(missingNative(addonOnly("darwin", "darwin"), "darwin", "x64")).toEqual(["sherpa-onnx-darwin-x64/libonnxruntime.dylib (speech to text)", "sherpa-onnx-darwin-x64/libsherpa-onnx-c-api.dylib (speech to text)"]);
  expect(missingNative(addonOnly("win", "win32"), "win32", "x64")).toEqual(["sherpa-onnx-win-x64/onnxruntime.dll (speech to text)", "sherpa-onnx-win-x64/sherpa-onnx-c-api.dll (speech to text)"]);
  // Windows libraries in a Linux build do not count
  const wrongOs = resources("linux-with-dlls", ["sherpa-onnx-linux-x64/sherpa-onnx.node", "sherpa-onnx-linux-x64/onnxruntime.dll", "sherpa-onnx-linux-x64/libsherpa-onnx-c-api.so", hook("linux", "x64")]);
  expect(missingNative(wrongOs, "linux", "x64")).toEqual(["sherpa-onnx-linux-x64/libonnxruntime.so (speech to text)"]);
});

it("fails the electron-builder run, reading the .app bundle on macOS", async () => {
  const appOutDir = path.join(dir, "mac-out");
  fs.mkdirSync(path.join(appOutDir, "Filow.app", "Contents", "Resources"), { recursive: true });
  const context = { appOutDir, electronPlatformName: "darwin", arch: 3, packager: { appInfo: { productFilename: "Filow" } } };
  await expect(afterPack(context)).rejects.toThrow(/darwin-arm64 build is missing native binaries: sherpa-onnx-darwin-arm64/);
  const linux = resources("linux-out", [...sherpa("linux", "x64"), hook("linux", "x64")]);
  await expect(afterPack({ appOutDir: path.dirname(linux), electronPlatformName: "linux", arch: 1 })).resolves.toBeUndefined();
});
