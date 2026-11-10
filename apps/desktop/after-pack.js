// electron-builder afterPack hook (docs/PLATFORMS.md). Fails the build when the packaged app lacks the
// native binaries for the platform and CPU it targets. npm installs only the host's optional packages
// (sherpa-onnx-<os>-<cpu>), so building x64 on an Apple Silicon Mac, or Linux on Windows, would
// otherwise ship an app whose speech-to-text cannot load. Not shipped inside the app.
const fs = require("node:fs");
const path = require("node:path");

const OS = { win32: "win", darwin: "darwin", linux: "linux" };
const ARCH = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" }; // electron-builder's Arch enum

/** Native pieces the target needs that are missing from resources/app.asar.unpacked; [] when complete. */
function missingNative(resourcesDir, platform, arch) {
  const unpacked = path.join(resourcesDir, "app.asar.unpacked", "node_modules");
  const has = (dir, ext) => fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith(ext));
  const archs = arch === "universal" ? ["x64", "arm64"] : [arch];
  const missing = [];
  for (const a of archs) {
    const sherpa = `sherpa-onnx-${OS[platform] || platform}-${a}`;
    if (!has(path.join(unpacked, sherpa), ".node")) missing.push(`${sherpa} (speech to text)`);
    const hook = `uiohook-napi/prebuilds/${platform}-${a}`;
    if (!has(path.join(unpacked, ...hook.split("/")), ".node")) missing.push(`${hook} (OK Filow hold-to-talk)`);
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
