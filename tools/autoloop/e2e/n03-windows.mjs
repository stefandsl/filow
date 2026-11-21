// Operator entry points. Verify the same inputs for both builds, then score each private capture.
// node n03-windows.mjs fixtures <clip directory>
// node n03-windows.mjs schedule en|it
// node n03-windows.mjs score <receipt.json> <expected full SHA>
// Each clip has desktop "points" and "phonePoints" [id, state] pairs read after its paced PCM.
// Record faults in independent runs with the before/down/after process and listener observations.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
export const cases = read(new URL("./n03-cases.json", import.meta.url));
const requiredDone = {
  noise: [], point: ["s0b0"], digress: ["s0b0"], correction: ["s0b0"],
  near: ["s0b0"], alias: ["s0b0", "s0b1"], resume: ["s0b0", "s0b1", "s0b2"],
};
const target = { point: "s0b0", alias: "s0b1", resume: "s0b2" };

export function verifyFixtures(dir) {
  for (const [lang, journey] of Object.entries(cases.journeys)) {
    for (const [label, clip] of Object.entries(journey.clips)) {
      const bytes = fs.readFileSync(path.join(dir, `${lang}-${label}.wav`));
      if (createHash("sha256").update(bytes).digest("hex") !== clip.sha256) throw Error(`Changed ${lang} ${label}`);
    }
  }
}

function rows(raw) {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  if (!raw.every(row => Array.isArray(row) && row.length === 2)) return null;
  const points = new Map(raw);
  if (!cases.sectionIds[0].every(id => ["waiting", "active", "done"].includes(points.get(id)))) return null;
  return points;
}

// A socket disconnect is insufficient evidence for the relay trial. Check the listener and the two
// surviving processes. For process faults, require disappearance and a different live replacement.
export function recovered(trial) {
  if (!trial || !cases.faults.includes(trial.kind)) return false;
  const { before, down, after, faultAt, desktopAt, phoneAt, continuedAt } = trial;
  if (![faultAt, desktopAt, phoneAt, continuedAt].every(Number.isFinite) ||
      Math.min(desktopAt, phoneAt) < faultAt || continuedAt < Math.max(desktopAt, phoneAt)) return false;
  if (!before || !down || !after) return false;
  const pid = value => Number.isSafeInteger(value) && value > 0;
  if (!pid(before.main) || !pid(after.main)) return false;
  if (trial.kind === "relay") {
    if (!pid(before.renderer) || before.renderer !== down.renderer || before.renderer !== after.renderer ||
        before.relay !== "listening" || down.relay !== "closed" || after.relay !== "listening") return false;
  } else if (!pid(before[trial.kind]) || down[trial.kind] !== null ||
             !pid(after[trial.kind]) || before[trial.kind] === after[trial.kind]) return false;
  if (trial.kind !== "main" && (down.main !== before.main || after.main !== before.main)) return false;
  const restored = place => place?.current === "s1b1" && place.done?.includes("s1b0") &&
    place.reopened?.includes("s0b1") && place.openTracks === 0 && place.pendingExecuted === 0;
  return restored(trial.desktop) && restored(trial.phone) && trial.continuation?.desktop === "s1b2" &&
    trial.continuation?.phone === "s1b2" && trial.continuation?.executions === 1;
}

export function score(receipt, sha) {
  const issues = [];
  if (!/^[\da-f]{40}$/.test(sha) || receipt.manifest?.sha !== sha || !/^[\da-f]{128}$/i.test(receipt.manifest?.sha512 ?? "")) issues.push("package");
  const journey = cases.journeys[receipt.lang];
  if (!journey || receipt.error) issues.push("capture");
  if (JSON.stringify(receipt.clips?.map(c => c.label)) !== JSON.stringify(cases.captureOrder)) issues.push("schedule");
  const metrics = {};
  for (const surface of ["points", "phonePoints"]) {
    let previous = null;
    const counts = {};
    for (const label of cases.captureOrder) {
      const c = receipt.clips?.find(x => x.label === label);
      const current = rows(c?.[surface]);
      const observed = Number.isSafeInteger(c?.paced?.chunks) && c.paced.chunks > 0 && Number.isFinite(c.paced.ms) && c.paced.ms > 0 && c.paced.ms >= (c.paced.chunks - 1) * 100 &&
        Array.isArray(c.words) && current;
      if (!observed) {
        issues.push(`${surface}/${label}/unobserved`);
        counts[label] = { opportunities: 0 };
        previous = null;
        continue;
      }
      const done = [...current.keys()].filter(id => current.get(id) === "done");
      const wrong = done.filter(id => !requiredDone[label].includes(id));
      const missing = requiredDone[label].filter(id => !done.includes(id));
      if (wrong.length || missing.length) issues.push(`${surface}/${label}/state`);
      const eligible = label === "noise" || previous && (target[label] ? previous.get(target[label]) !== "done" :
        !wrong.some(id => previous.get(id) === "done"));
      const recognized = c.words.some(w => w.committed?.trim());
      if (!eligible || (label !== "noise" && !recognized)) issues.push(`${surface}/${label}/${eligible ? "unrecognized" : "contaminated"}`);
      counts[label] = { opportunities: eligible ? 1 : 0, wrongTicks: wrong.filter(id => previous?.get(id) !== "done").length,
        correctTicks: eligible && target[label] && done.includes(target[label]) ? 1 : 0, missing, recognized };
      if (label === "noise") {
        counts.noise.minutes = Math.min(c.paced.ms, cases.format.noiseMs) / 60000;
        counts.noise.falsePerMinute = counts.noise.wrongTicks / counts.noise.minutes;
        if (c.paced.ms < cases.format.noiseMs) issues.push(`${surface}/short noise`);
      }
      if (!journey || c.sha256?.toLowerCase() !== journey.clips[label].sha256) issues.push(`${label}/WAV digest`);
      previous = current;
    }
    metrics[surface] = counts;
  }
  for (const kind of cases.faults) {
    const trials = receipt.faults?.filter(t => t.kind === kind);
    if (trials?.length !== 1 || !recovered(trials[0])) issues.push(`${kind}/recovery`);
  }
  return { scope: "packaged clip sequence and four recoveries", verdict: issues.length ? "HOLD" : "PASS", language: receipt.lang, metrics, issues };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [verb, arg, sha] = process.argv.slice(2);
  if (verb === "fixtures") verifyFixtures(arg);
  else if (verb === "schedule" && cases.journeys[arg]) console.log(JSON.stringify({ ...cases, journeys: { [arg]: cases.journeys[arg] } }, null, 2));
  else if (verb === "score") {
    const result = score(read(arg), sha);
    console.log(JSON.stringify(result, null, 2));
    if (result.verdict !== "PASS") process.exitCode = 1;
  } else throw Error("Use fixtures <dir>, schedule en|it, or score <receipt.json> <sha>");
}
