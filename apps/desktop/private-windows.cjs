// Build with electron-builder --config private-windows.cjs --win nsis --publish never.
const { execFileSync } = require("node:child_process");
const base = require("./package.json").build;
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: __dirname, encoding: "utf8" }).trim();
const appId = "com.filow.private.n07";
const productName = "Filow Private N07";

module.exports = {
  ...base, appId, productName, executableName: "FilowPrivateN07",
  artifactName: "Filow-Private-N07-${version}-win-x64.${ext}",
  extraMetadata: {
    name: "filow-private-n07", version: "0.9.45-qa." + sourceSha.slice(0, 8),
    privateAppId: appId, sourceSha, filowQa: true, updates: false,
  },
  // The following resource entry already copies the standalone root dependencies.
  extraResources: base.extraResources.map(resource => resource.to === "app"
    ? { ...resource, filter: [...resource.filter, "!node_modules/**"] }
    : resource),
  nsis: { ...base.nsis, shortcutName: productName },
};
