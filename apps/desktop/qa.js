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

/**
 * Where a net.Socket#connect call goes, from its arguments: { host, port } for TCP, { path } for a
 * named pipe or Unix socket. net.connect() hands connect() its already normalized arguments as an
 * array ([options, callback]); a direct call passes (options), (port, host) or (path).
 */
function describeConnect(args) {
  let a = args[0];
  if (Array.isArray(a)) a = a[0];
  if (a && typeof a === "object") {
    if (a.path) return { path: String(a.path) };
    return { host: a.host ? String(a.host) : "localhost", port: Number(a.port) };
  }
  if (typeof a === "number" || (typeof a === "string" && /^\d+$/.test(a))) {
    return { host: typeof args[1] === "string" ? args[1] : "localhost", port: Number(a) };
  }
  if (typeof a === "string") return { path: a };
  return null;
}

/**
 * QA builds only (FILOW_QA_SOCKET_LOG=<file>): one JSON line for every TCP connection this process
 * opens, at the moment it opens it. The main process runs the Next server and the session relay
 * in-process, so this covers the server side of a take, including connections far shorter than a
 * netstat sample (the take probe, tools/autoloop/e2e/take.mjs, reads it for PR-01). It wraps
 * net.Socket#connect, which net.connect, tls.connect, http(s) agents and fetch (undici) all go through.
 * @param {(line: string) => void} write
 * @returns {() => void} uninstall
 */
function installSocketLog(write, { net = require("node:net"), now = () => Date.now() } = {}) {
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    try {
      const where = describeConnect(args);
      if (where) write(JSON.stringify({ at: now(), ...where }) + "\n");
    } catch {
      /* a log that cannot be written never breaks a connection */
    }
    return original.apply(this, args);
  };
  return () => {
    net.Socket.prototype.connect = original;
  };
}

module.exports = { isQaBuild, describeConnect, installSocketLog };
