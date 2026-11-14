// SEC-08: the packaged app grants its own pages the microphone and refuses the camera, geolocation
// and MIDI. Reads what tools/autoloop/e2e/permissions.mjs measured on a packaged
// QA build (tmp/autoloop/permissions.json), ignores the file's own list of problems and judges the
// answers again with that probe's rule. It cannot tell edited answers from measured ones. Missing, unreadable or older than
// 48 hours fails, like the other end-to-end results.
// Not wired into the score yet (proposed in docs/autoloop/PROPOSED-PROGRAM.md): the SEC-08 row of
// docs/autoloop/standards.json still only looks for the words setPermissionRequestHandler in main.js,
// which passed while every page got the camera.
// Usage: node tools/autoloop/checks/permissions-probe.mjs [result file]
import fs from "node:fs";
import { problemsOf } from "../e2e/permissions.mjs";

const file = process.argv[2] || "tmp/autoloop/permissions.json";
let result;
try {
  result = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  console.log(`no readable ${file} (run node tools/autoloop/e2e/permissions.mjs on a packaged QA build)`);
  process.exit(1);
}
const ageH = (Date.now() - Date.parse(result.at)) / 3.6e6;
if (!(ageH <= 48)) {
  console.log(`permissions probe is ${Number.isFinite(ageH) ? Math.round(ageH) + " h old" : "undated"} (rerun tools/autoloop/e2e/permissions.mjs)`);
  process.exit(1);
}
const problems = problemsOf(result.answers);
if (problems.length) {
  console.log(problems.join("\n"));
  process.exit(1);
}
