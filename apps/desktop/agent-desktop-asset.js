const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const archiveHash = "6ee4b1e078f4e78792e79f16e32e4a78b9919464aa3c55629b7e27ed53a08c13";
const exeHash = "a7ef5e539fb97287a35eb9ed49d3803b4d6bd705bc4106eb28617229f9be679e";
function verify(file, hash, size) {
  if (fs.statSync(file).size !== size || crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== hash) {
    throw new Error("agent_desktop_integrity");
  }
}

function agentDesktopAsset(userData) {
  const dir = path.join(userData, "computer-use", "agent-desktop-v1.3.1");
  const exe = path.join(dir, "agent-desktop.exe");
  // The manual pilot uses the pinned upstream binary. Filow has no signed, hosted download yet.
  const status = () => ({ available: false, installed: fs.existsSync(exe), bytes: 1835706, sha256: archiveHash });
  function verifiedExe() { verify(exe, exeHash, 4037120); return exe; }
  async function change(op) {
    if (op !== "remove") throw new Error("agent_desktop_unavailable");
    fs.rmSync(exe, { force: true });
    return status();
  }
  return { status, change, verifiedExe, stateDir: path.join(dir, "state") };
}
module.exports = { agentDesktopAsset };
