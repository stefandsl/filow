// Test switches (fake microphone, QA overlays, screenshots) work only in development or in a build
// packaged as a QA build: `electron-builder ... -c.extraMetadata.filowQa=true` writes the marker into
// the app's own package.json inside app.asar. A released build never has it, and no file a user or
// another program can drop next to Filow.exe can turn it on (STANDARDS SEC-13).

function isQaBuild(app = require("electron").app, pkg = () => require("./package.json")) {
  if (!app || !app.isPackaged) return true;
  try {
    return pkg().filowQa === true;
  } catch {
    return false;
  }
}

module.exports = { isQaBuild };
