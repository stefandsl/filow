// Exposes desktop-only settings to the page. Nothing here is a secret the page
// does not already need: the LAN access password gates the spend endpoints
// against other devices on the Wi-Fi, and the page is the engine.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("intelliprompter", {
  desktop: true,
  mode: process.env.INTELLIPROMPTER_SESSION_URL ? "hosted" : "lan",
  sessionUrl: process.env.INTELLIPROMPTER_SESSION_URL || `http://${process.env.INTELLIPROMPTER_LAN_IP || "127.0.0.1"}:${process.env.SESSION_PORT || 4748}`,
  mirrorOrigin: `http://${process.env.INTELLIPROMPTER_LAN_IP || "127.0.0.1"}:${process.env.PORT || 4747}`,
  accessPassword: process.env.ACCESS_PASSWORD || "",
});
