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

it("passes a build that holds the speech and hotkey binaries for its own platform and CPU", () => {
  const res = resources("linux-ok", ["sherpa-onnx-linux-x64/sherpa-onnx.node", "uiohook-napi/prebuilds/linux-x64/uiohook-napi.node"]);
  expect(missingNative(res, "linux", "x64")).toEqual([]);
});

it("names what is missing when the binaries are for another CPU (x64 build made on an arm64 Mac)", () => {
  const res = resources("mac-wrong-cpu", ["sherpa-onnx-darwin-arm64/sherpa-onnx.node", "uiohook-napi/prebuilds/darwin-arm64/uiohook-napi.node", "uiohook-napi/prebuilds/darwin-x64/uiohook-napi.node"]);
  expect(missingNative(res, "darwin", "x64")).toEqual(["sherpa-onnx-darwin-x64 (speech to text)"]);
  expect(missingNative(res, "darwin", "arm64")).toEqual([]);
  expect(missingNative(res, "darwin", "universal")).toEqual(["sherpa-onnx-darwin-x64 (speech to text)"]);
});

it("uses sherpa's win- prefix on Windows and needs a .node file, not just the folder", () => {
  const res = resources("win-empty", ["sherpa-onnx-win-x64/README.md", "uiohook-napi/prebuilds/win32-x64/uiohook-napi.node"]);
  expect(missingNative(res, "win32", "x64")).toEqual(["sherpa-onnx-win-x64 (speech to text)"]);
});

it("fails the electron-builder run, reading the .app bundle on macOS", async () => {
  const appOutDir = path.join(dir, "mac-out");
  fs.mkdirSync(path.join(appOutDir, "Filow.app", "Contents", "Resources"), { recursive: true });
  const context = { appOutDir, electronPlatformName: "darwin", arch: 3, packager: { appInfo: { productFilename: "Filow" } } };
  await expect(afterPack(context)).rejects.toThrow(/darwin-arm64 build is missing native binaries: sherpa-onnx-darwin-arm64/);
  const linux = resources("linux-out", ["sherpa-onnx-linux-x64/sherpa-onnx.node", "uiohook-napi/prebuilds/linux-x64/uiohook-napi.node"]);
  await expect(afterPack({ appOutDir: path.dirname(linux), electronPlatformName: "linux", arch: 1 })).resolves.toBeUndefined();
});
