const path = require("node:path");

function trayImage(platform, dir, nativeImage, iconPath) {
  if (platform === "win32") return path.join(dir, "build", "icon.ico");
  return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
}

module.exports = { trayImage };
