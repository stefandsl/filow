// Writes apps/desktop/THIRD_PARTY_NOTICES.md from the production SBOM (npm run sbom): every bundled npm
// package with its license and, where the package ships one, its license text. The desktop build copies
// it into resources/. Also names the speech model and its license (see apps/desktop/stt.js).
import fs from "node:fs";
import path from "node:path";

const sbom = JSON.parse(fs.readFileSync("tmp/sbom.cdx.json", "utf8"));
const rows = [];
const walk = (arr) => {
  for (const c of arr || []) {
    rows.push(c);
    walk(c.components);
  }
};
walk(sbom.components);
rows.sort((a, b) => a.name.localeCompare(b.name));

const licenseText = (name) => {
  const dir = path.join("node_modules", ...name.split("/"));
  try {
    const f = fs.readdirSync(dir).find((n) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(n));
    return f ? fs.readFileSync(path.join(dir, f), "utf8").trim() : "";
  } catch {
    return "";
  }
};

const out = [
  "# Third-party notices",
  "",
  "Filow is free software under GPL-3.0-or-later. It bundles the components below; each keeps its own license.",
  "Electron's own notices (Chromium and its dependencies) ship next to Filow.exe as LICENSES.chromium.html.",
  "",
  "## Speech model",
  "",
  "The on-device speech recognizer that Filow downloads on request is NVIDIA Nemotron 3.5 ASR streaming",
  "(0.6B), released by NVIDIA under the OpenMDW license, in the int8 export made by the sherpa-onnx project",
  "(k2-fsa, Apache-2.0). It is not bundled in the installer.",
  "",
  "## npm packages",
  "",
];
for (const c of rows) {
  const ls = (c.licenses || []).map((l) => l.license?.id || l.license?.name || l.expression).filter(Boolean).join(" | ") || "unknown";
  out.push(`### ${c.name} ${c.version}`, "", `License: ${ls}`, "");
  const text = licenseText(c.group ? `${c.group}/${c.name}` : c.name);
  if (text) out.push("```", text, "```", "");
}
fs.writeFileSync("apps/desktop/THIRD_PARTY_NOTICES.md", out.join("\n"));
console.log(`wrote apps/desktop/THIRD_PARTY_NOTICES.md (${rows.length} packages)`);
