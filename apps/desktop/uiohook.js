// The one place that loads uiohook-napi (the keyboard hook behind OK Filow's hold keys and dictation).
// On Windows it loads Filow's own build of the library's binary (native/uiohook, see its README.md): the
// stock one registers the low-level hooks for its DLL only, and Windows can refuse that with error 126
// (issue #6: the hold keys were dead for the whole session); ours then registers them for the program
// itself. The JavaScript side stays the published package; only the native file differs.
const fs = require("node:fs");
const path = require("node:path");
const { globalInputOff, inertUiohook } = require("./global-input");

/**
 * The folder holding `prebuilds/<platform>-<arch>/uiohook-napi.node` built by Filow, or "" when there is
 * none for this system (macOS, Linux, a Windows architecture we did not build): the stock binary is used.
 * Inside a package the native file lives next to app.asar, in app.asar.unpacked.
 */
function nativeDir({ platform = process.platform, arch = process.arch, baseDir = __dirname, exists = fs.existsSync } = {}) {
  if (platform !== "win32") return "";
  const dir = path.join(baseDir, "native", "uiohook").replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
  return exists(path.join(dir, "prebuilds", `${platform}-${arch}`, "uiohook-napi.node")) ? dir : "";
}

let loaded = null;
/** uiohook-napi's exports ({ uIOhook, UiohookKey, ... }). Every caller goes through here. */
function loadUiohook({ env = process.env, load = () => require("uiohook-napi") } = {}) {
  if (loaded) return loaded;
  // Test isolation (global-input.js): the library is not even loaded; callers get a stand-in that does nothing.
  if (globalInputOff(env)) return (loaded = inertUiohook());
  // node-gyp-build (the library's loader) looks in this folder first when the variable is set.
  const dir = nativeDir();
  if (dir && !process.env.UIOHOOK_NAPI_PREBUILD) process.env.UIOHOOK_NAPI_PREBUILD = dir;
  loaded = load();
  return loaded;
}
/** Tests only: forget what was loaded. */
function forgetUiohook() { loaded = null; }

module.exports = { loadUiohook, nativeDir, forgetUiohook };
