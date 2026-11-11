// Writes apps/desktop/THIRD_PARTY_NOTICES.md from the production SBOM (npm run sbom): every bundled npm
// package with its license and, where the package ships one, its license text. The desktop build copies
// it into resources/. Also names the speech model and its license (see apps/desktop/stt.js).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const { CATALOGUE } = createRequire(import.meta.url)("../apps/desktop/stt.js");

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
  "## Speech models",
  "",
  "The on-device speech recognizers below are downloaded on request, the one each spoken language needs;",
  "none is bundled in the installer. The default is NVIDIA Nemotron 3.5 ASR streaming (0.6B), released by",
  "NVIDIA under the OpenMDW license. All are the ONNX exports made by the sherpa-onnx project (k2-fsa,",
  "Apache-2.0); each keeps its authors' license:",
  "",
  ...Object.values(CATALOGUE).map((m) => `- ${m.label} (${m.archive}): ${m.licence}`),
  "",
  "## Voice model",
  "",
  "The natural voice that Filow downloads on request is Supertonic 3 by Supertone Inc., in the int8 export",
  "made by the sherpa-onnx project (k2-fsa, Apache-2.0). It is not bundled in the installer. The model is",
  "released under the BigScience OpenRAIL-M license (https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE);",
  "its sample code is MIT. OpenRAIL-M allows commercial use and passes these use restrictions on to every user:",
  "you may not use the voice to break the law; to exploit or harm minors; to spread false information meant to",
  "harm others; to spread personal information that can harm someone; to publish machine-made audio without",
  "saying it is machine made; to defame, harass or impersonate people (no deepfakes); for fully automated",
  "decisions that harm someone's legal rights; to discriminate; to exploit the weaknesses of a group; for",
  "medical advice; or for justice, law enforcement, immigration or asylum decisions.",
  "",
  "## Dictation cleanup",
  "",
  "English dictations are written out by S1-mini by Superwhisper (https://huggingface.co/superwhisper/s1-mini),",
  "Copyright 2026 Superwhisper, a derivative of Qwen3-0.6B (Copyright 2024 Alibaba Cloud). It is released under",
  "the Apache License 2.0 with one additional term: it must keep its name, \"S1-mini\" by \"Superwhisper\", with",
  "that exact capitalization. The model is not bundled in the installer; Filow downloads the unmodified",
  "quantized file s1-mini-q4_k_m.gguf on request. Its LICENSE and NOTICE ship in licenses/s1-mini.",
  "It runs on this computer in llama.cpp's server program (https://github.com/ggml-org/llama.cpp, release b12284),",
  "MIT License, Copyright (c) 2023-2026 The ggml authors, bundled unmodified with the LLVM OpenMP runtime",
  "(Apache-2.0 with LLVM exceptions). Their license texts ship in licenses/llama.cpp.",
  "",
  "## Fonts",
  "",
  "The whiteboard sets formulas with KaTeX. Its math fonts (the KaTeX_* font files, 20 faces) ship inside the",
  "katex npm package and are bundled with Filow. They are published by Khan Academy and contributors under the",
  "MIT License: the LICENSE of https://github.com/KaTeX/KaTeX and of https://github.com/KaTeX/katex-fonts (the",
  "fonts' own repository), both read on 2026-11-11. The faces were originally generated from the MathJax fonts.",
  "The licence text is the katex entry below. All other text on the whiteboard uses fonts of the operating system;",
  "no other font is bundled for it.",
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
