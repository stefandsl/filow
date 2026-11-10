// electron-builder afterPack hook (docs/PLATFORMS.md). Fails the build when the packaged app lacks the
// native binaries for the platform and CPU it targets. npm installs only the host's optional packages
// (sherpa-onnx-<os>-<cpu>), so building x64 on an Apple Silicon Mac, or Linux on Windows, would
// otherwise ship an app whose speech-to-text cannot load. Not shipped inside the app.
const fs = require("node:fs");
const path = require("node:path");

const OS = { win32: "win", darwin: "darwin", linux: "linux" };
const ARCH = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" }; // electron-builder's Arch enum
// What sherpa-onnx.node loads from its own folder when it is required: the addon alone does not start.
const SHERPA_LIBS = {
  win32: ["onnxruntime.dll", "sherpa-onnx-c-api.dll"],
  linux: ["libonnxruntime.so", "libsherpa-onnx-c-api.so"],
  darwin: ["libonnxruntime.dylib", "libsherpa-onnx-c-api.dylib"],
};

/** Native pieces the target needs that are missing from resources/app.asar.unpacked; [] when complete. */
function missingNative(resourcesDir, platform, arch) {
  const unpacked = path.join(resourcesDir, "app.asar.unpacked", "node_modules");
  const has = (...parts) => fs.existsSync(path.join(unpacked, ...parts));
  const archs = arch === "universal" ? ["x64", "arm64"] : [arch];
  const missing = [];
  for (const a of archs) {
    const sherpa = `sherpa-onnx-${OS[platform] || platform}-${a}`;
    if (!has(sherpa, "sherpa-onnx.node")) missing.push(`${sherpa} (speech to text)`);
    else for (const lib of SHERPA_LIBS[platform] || []) if (!has(sherpa, lib)) missing.push(`${sherpa}/${lib} (speech to text)`);
    const hook = `uiohook-napi/prebuilds/${platform}-${a}`;
    if (!has(...hook.split("/"), "uiohook-napi.node")) missing.push(`${hook} (OK Filow hold-to-talk)`);
  }
  return missing;
}

function resourcesOf(context) {
  if (context.electronPlatformName !== "darwin") return path.join(context.appOutDir, "resources");
  return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources");
}

module.exports = async function afterPack(context) {
  const arch = ARCH[context.arch] || String(context.arch);
  const missing = missingNative(resourcesOf(context), context.electronPlatformName, arch);
  if (missing.length) {
    throw new Error(`Filow ${context.electronPlatformName}-${arch} build is missing native binaries: ${missing.join(", ")}. ` +
      `Build on that platform and CPU, or install the optional package for it (npm install --no-save --os=<os> --cpu=<cpu> sherpa-onnx-<os>-<cpu>).`);
  }
};
module.exports.missingNative = missingNative;
