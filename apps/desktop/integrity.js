// Integrity of downloaded executables (docs/autoloop/STANDARDS.md SEC-15). Nothing Filow downloads is
// run or kept unless it checks out:
// - cloudflared is not Authenticode-signed, so its bytes must match the SHA-256 digest GitHub publishes
//   for that release asset (api.github.com, over HTTPS);
// - the Ollama installer is signed, so its Windows signature must be valid and name Ollama Inc.
const fs = require("node:fs");
const https = require("node:https");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (c) => h.update(c)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

function getJson(url, hops = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Filow", Accept: "application/vnd.github+json" }, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) {
        res.resume();
        return resolve(getJson(res.headers.location, hops - 1));
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`GitHub API ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on("error", reject).on("timeout", function () { this.destroy(new Error("GitHub API timeout")); });
  });
}

/** Picks the published "sha256:<hex>" digest of one asset from a GitHub release object. */
function assetDigest(release, assetName) {
  const a = (release && release.assets || []).find((x) => x.name === assetName);
  const m = a && /^sha256:([0-9a-f]{64})$/.exec(a.digest || "");
  return m ? m[1] : null;
}

/** Throws unless the file matches the digest GitHub publishes for repo's latest release asset. */
async function verifyGithubAsset(file, repo, assetName, fetchRelease = () => getJson(`https://api.github.com/repos/${repo}/releases/latest`)) {
  const release = await fetchRelease();
  const want = assetDigest(release, assetName);
  if (!want) throw new Error(`no published SHA-256 for ${assetName} in ${repo} ${release && release.tag_name || ""}`);
  const got = await sha256File(file);
  if (got !== want) throw new Error(`${assetName} failed its integrity check (sha256 ${got.slice(0, 12)}..., expected ${want.slice(0, 12)}...)`);
}

/** Parses Get-AuthenticodeSignature output (JSON) and checks status and publisher organisation. */
function signatureOk(json, organisation) {
  let s;
  try { s = JSON.parse(json); } catch { return false; }
  // Status 0 = Valid in the serialized enum; older PowerShell prints the name.
  const valid = s && (s.Status === 0 || s.Status === "Valid");
  return Boolean(valid && typeof s.Subject === "string" && s.Subject.includes(`O=${organisation},`));
}

/** Throws unless file carries a valid Windows signature from organisation (Windows only). */
function verifyAuthenticode(file, organisation) {
  return new Promise((resolve, reject) => {
    const cmd = "$s = Get-AuthenticodeSignature -LiteralPath $env:FILOW_VERIFY_FILE; [pscustomobject]@{ Status = [string]$s.Status; Subject = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress";
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd],
      { windowsHide: true, encoding: "utf8", timeout: 30000, env: { ...process.env, FILOW_VERIFY_FILE: file } },
      (err, out) => {
        if (err) return reject(new Error(`signature check failed to run: ${err.message}`));
        if (!signatureOk(out.trim(), organisation)) return reject(new Error(`${file} is not signed by ${organisation}`));
        resolve();
      });
  });
}

module.exports = { sha256File, assetDigest, verifyGithubAsset, signatureOk, verifyAuthenticode };
