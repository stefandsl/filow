const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { download } = require("./download");

const archiveHash = "6ee4b1e078f4e78792e79f16e32e4a78b9919464aa3c55629b7e27ed53a08c13";
const exeHash = "a7ef5e539fb97287a35eb9ed49d3803b4d6bd705bc4106eb28617229f9be679e";
const url = "https://github.com/vercel-labs/agent-desktop/releases/download/v1.3.1/agent-desktop-v1.3.1-x86_64-pc-windows-msvc.tar.gz";
function verify(file, hash, size) {
  if (fs.statSync(file).size !== size || crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== hash) {
    throw new Error("agent_desktop_integrity");
  }
}

function agentDesktopAsset(userData) {
  const dir = path.join(userData, "computer-use", "agent-desktop-v1.3.1");
  const exe = path.join(dir, "agent-desktop.exe");
  let busy = false;
  const status = () => ({ available: Boolean(url) && process.platform === "win32" && process.arch === "x64",
    installed: fs.existsSync(exe), bytes: 1835706, sha256: archiveHash });
  function verifiedExe() { verify(exe, exeHash, 4037120); return exe; }
  async function change(op) {
    if (!status().available || busy) throw new Error("agent_desktop_unavailable");
    busy = true;
    try {
      if (op === "remove") fs.rmSync(exe, { force: true });
      else if (op === "install") {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = fs.mkdtempSync(path.join(dir, "install-"));
        try {
          const archive = path.join(tmp, "release.tgz");
          await download(url, archive);
          verify(archive, archiveHash, 1835706);
          execFileSync(path.join(process.env.SystemRoot, "System32", "tar.exe"), ["-xf", archive, "-C", tmp, "agent-desktop.exe"], { windowsHide: true });
          const candidate = path.join(tmp, "agent-desktop.exe");
          verify(candidate, exeHash, 4037120);
          fs.renameSync(candidate, exe);
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      } else throw new Error("unknown_asset_operation");
      return status();
    } finally { busy = false; }
  }
  return { status, change, verifiedExe, stateDir: path.join(dir, "state") };
}
module.exports = { agentDesktopAsset };
